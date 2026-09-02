import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "private", "catalog", "books.json");
const TOPIC_AUTHORITY_PATH = path.join(ROOT, "private", "catalog", "topic-authority.json");
const CONTENT_MANIFEST_PATH = path.join(ROOT, "private", "book-content", "manifest.json");
const CONTENT_ROOT = path.join(ROOT, "private", "book-content");
// Public edition artifacts are deliberately static files. They are copied to
// the deployment CDN by Next/Vercel instead of being carried by every server
// function that happens to render a book page.
const OUTPUT_ROOT = path.join(ROOT, "public", "_editions");
const EDITIONS_ROOT = path.join(OUTPUT_ROOT, "editions");
const CURRENT_POINTER_PATH = path.join(OUTPUT_ROOT, "current.json");
const RELEASE_ATTESTATION_PATH = path.join(ROOT, "private", "publication-release-attestation.json");
const SCHEMA_VERSION = 1;
const PUBLISHER_FORMAT_VERSION = 4;
const MIN_CRAWLABLE_WORDS = 80;
const MAX_PRODUCTION_ATTESTATION_AGE_MS = 30 * 60 * 1000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function stableHash(value) {
  return sha256(stableJson(value));
}

function normalizeId(value) {
  return String(value || "").trim().replace(/\.json$/i, "").toLowerCase();
}

function text(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function safeKind(value) {
  return String(value || "default").toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "default";
}

function plainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(object|embed|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son[a-z]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, "")
    .replace(/\s(href|src)=["']\s*data:text\/html[^"']*["']/gi, "");
}

function countWords(value) {
  return plainText(value).split(/\s+/).filter(Boolean).length;
}

function isPublicCatalogRecord(book) {
  const id = normalizeId(book?.id);
  const status = text(book?.status || "ready").toLowerCase();
  const visibility = text(book?.archive ? "archive" : book?.visibility || "main").toLowerCase();
  return Boolean(id)
    && (status === "ready" || status === "coming-soon")
    && (visibility === "main" || visibility === "archive");
}

function isReadableCatalogRecord(book) {
  return isPublicCatalogRecord(book) && text(book?.status || "ready").toLowerCase() === "ready";
}

function isTableOfContentsSection(section) {
  const kind = safeKind(section.kind);
  const title = text(section.title).toLowerCase();
  if (/^chapter\b/i.test(section.title)) return false;
  if (title === "contents" || title === "table of contents") return true;
  if (/<nav\b[^>]*(?:epub:type=["']toc["']|id=["']toc["'])/i.test(section.html)) return true;
  return kind === "toc";
}

function inferReaderKind(section, visibleIndex, bookTitle) {
  const kind = safeKind(section.kind);
  const title = text(section.title).toLowerCase();
  const body = plainText(section.html).toLowerCase();
  const normalizedBookTitle = text(bookTitle).toLowerCase();

  if (isTableOfContentsSection(section)) return "toc";
  if (/^chapter\b/i.test(section.title)) return "chapter";
  if (/^dedication$/.test(title)) return "dedication";
  if (/^prologue$/.test(title)) return "prologue";
  if (/^preface$/.test(title)) return "preface";
  if (/^foreword$/.test(title)) return "foreword";
  if (/^introduction$/.test(title)) return "introduction";
  if (/^epilogue$/.test(title)) return "epilogue";
  if (/^afterword$/.test(title)) return "afterword";
  if (/acknowledg(e)?ments?/.test(title)) return "acknowledgments";
  if (/about( the)? author/.test(title)) return "about";
  if (/copyright/.test(title)) return "copyright";
  if (["title", "dedication", "prologue", "preface", "foreword", "introduction", "epilogue", "afterword", "acknowledgments", "about", "copyright", "backmatter"].includes(kind)) return kind;

  const looksLikeTitlePage = Boolean(normalizedBookTitle) && (
    title === normalizedBookTitle
    || (body.startsWith(normalizedBookTitle) && body.includes("james johnson"))
  );
  if (looksLikeTitlePage) return "title";
  if (visibleIndex === 0 && body.split(/\s+/).length < 80 && /\bby\s+(?:james johnson|jj)\b/.test(body)) return "title";
  return "section";
}

function isStructuralDuplicate(section) {
  const kind = safeKind(section.kind);
  const title = text(section.title).toLowerCase();
  if (/^(table of )?contents?$/.test(title)) return true;
  return kind === "title" && Number(section.wordCount || 0) <= 40;
}

function isEditionNote(section) {
  const title = text(section.title).toLowerCase();
  return /^(?:copyright(?:\s*(?:&|and|\/)\s*disclaimers?)?|disclaimers?|acknowledg(?:e)?ments?|about (?:the )?author|dedications?)(?:$|\s|[:—–-])/.test(title);
}

function isCrawlableSection(section) {
  if (isStructuralDuplicate(section) || isEditionNote(section)) return false;
  return Number(section.wordCount || 0) >= MIN_CRAWLABLE_WORDS || plainText(section.html).length > 420;
}

function excerpt(value, maxLength = 155) {
  const clean = text(value).replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

function subsectionFileName(section) {
  const sectionId = text(section?.section?.id || section?.id);
  return `${sha256(`section:${sectionId}:${stableJson(section)}`).slice(0, 32)}.json`;
}

function bookDirectoryName(bookId) {
  return sha256(`book:${bookId}`).slice(0, 24);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function renameWithRetry(source, target) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!error || !["EPERM", "EBUSY"].includes(error.code) || attempt === 7) throw error;
      await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
  throw lastError;
}

function assertInside(parent, target) {
  const relative = path.relative(parent, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Publication output escaped its intended directory: ${target}`);
  }
}

function findManifestEntry(entries, catalogBook) {
  const id = normalizeId(catalogBook.id);
  const bookFile = normalizeId(path.basename(String(catalogBook.bookFile || "")));
  return entries.find(entry => {
    const manifestId = normalizeId(entry?.id);
    const sourceFile = normalizeId(path.basename(String(entry?.sourceFile || "")));
    const contentFile = normalizeId(path.basename(String(entry?.path || "")));
    return manifestId === id || sourceFile === id || contentFile === id || (bookFile && (sourceFile === bookFile || contentFile === bookFile));
  });
}

function normalizeContent(raw, fallbackId) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const id = text(source.id || fallbackId);
  const title = text(source.title || fallbackId);
  const rawSections = Array.isArray(source.sections) ? source.sections : [];
  const ids = new Set();
  const indexes = new Set();
  const sections = rawSections.map((rawSection, position) => {
    const record = rawSection && typeof rawSection === "object" && !Array.isArray(rawSection) ? rawSection : {};
    const sectionId = text(record.id);
    const sectionTitle = text(record.title);
    const index = Number(record.index);
    const html = sanitizeHtml(record.html);
    if (!sectionId) throw new Error(`${id}: section ${position + 1} has no id.`);
    if (!sectionTitle) throw new Error(`${id}: section ${sectionId} has no title.`);
    if (!Number.isInteger(index) || index < 0) throw new Error(`${id}: section ${sectionId} has an invalid index.`);
    if (!html.trim()) throw new Error(`${id}: section ${sectionId} has no public HTML.`);
    if (ids.has(sectionId.toLowerCase())) throw new Error(`${id}: duplicate section id ${sectionId}.`);
    if (indexes.has(index)) throw new Error(`${id}: duplicate section index ${index}.`);
    ids.add(sectionId.toLowerCase());
    indexes.add(index);
    const bodyText = text(record.text) || plainText(html);
    return {
      id: sectionId,
      index,
      title: sectionTitle,
      kind: safeKind(record.kind),
      html,
      text: bodyText,
      wordCount: Number.isFinite(Number(record.wordCount)) ? Number(record.wordCount) : countWords(bodyText),
    };
  }).sort((left, right) => left.index - right.index);

  if (!sections.length) throw new Error(`${id}: no sections were found.`);
  sections.forEach((section, index) => {
    if (section.index !== index) throw new Error(`${id}: expected section index ${index}, found ${section.index}.`);
  });

  return {
    id,
    title,
    creator: text(source.creator),
    description: text(source.description),
    language: text(source.language),
    publisher: text(source.publisher),
    generatedAt: text(source.generatedAt),
    sections,
  };
}

function buildBookIndex({ catalogBook, content, editionId, sourceHash }) {
  const crawlableSections = content.sections.filter(isCrawlableSection);
  const titleCounts = new Map();
  const identityCounts = new Map();
  const routesBySectionId = new Map();
  crawlableSections.forEach((section, routeIndex) => {
    const titleSlug = slugify(section.title || section.id || `section-${routeIndex + 1}`) || `section-${routeIndex + 1}`;
    const titleCount = titleCounts.get(titleSlug) || 0;
    titleCounts.set(titleSlug, titleCount + 1);
    const legacySectionSlug = titleCount ? `${titleSlug}-${titleCount + 1}` : titleSlug;
    const identityBase = slugify(section.id || `section-${routeIndex + 1}`) || `section-${routeIndex + 1}`;
    const identityCount = identityCounts.get(identityBase) || 0;
    identityCounts.set(identityBase, identityCount + 1);
    const identitySlug = identityCount ? `${identityBase}-${identityCount + 1}` : identityBase;
    const sectionSlug = `${titleSlug}--${identitySlug}`;
    routesBySectionId.set(section.id, {
      sectionSlug,
      identitySlug,
      legacySectionSlug,
      path: `/books/${slugify(catalogBook.slug || catalogBook.title || catalogBook.id)}/${sectionSlug}`,
      routeIndex,
      routeTotal: crawlableSections.length,
    });
  });
  const extras = [];
  const sections = content.sections.map((section, sourceIndex) => {
    const crawlable = isCrawlableSection(section);
    const route = routesBySectionId.get(section.id);
    const artifact = {
      schemaVersion: SCHEMA_VERSION,
      editionId,
      sourceHash: stableHash(section),
      bookId: content.id,
      section: {
        id: section.id,
        index: section.index,
        title: section.title,
        kind: section.kind,
        html: section.html,
        wordCount: section.wordCount,
      },
    };
    const artifactPath = `sections/${subsectionFileName(artifact)}`;
    const summary = {
      id: section.id,
      index: section.index,
      title: section.title,
      kind: section.kind,
      wordCount: section.wordCount,
      readerKind: inferReaderKind(section, sourceIndex, content.title),
      tableOfContents: isTableOfContentsSection(section),
      crawlable,
      excerpt: excerpt(section.text),
      sectionSlug: route?.sectionSlug || "",
      identitySlug: route?.identitySlug || "",
      legacySectionSlug: route?.legacySectionSlug || "",
      path: route?.path || "",
      routeIndex: route?.routeIndex ?? -1,
      routeTotal: route?.routeTotal ?? 0,
      artifactPath,
      contentHash: artifact.sourceHash,
    };
    if (!crawlable && !isStructuralDuplicate(section) && text(section.text)) {
      extras.push({
        id: section.id,
        index: section.index,
        title: section.title,
        kind: section.kind,
        html: section.html,
        text: section.text,
        wordCount: section.wordCount,
      });
    }
    return { summary, artifact };
  });

  const visibleSections = sections.filter(item => !item.summary.tableOfContents);
  const rawKinds = visibleSections.map(item => item.summary.readerKind);
  const firstChapterIndex = rawKinds.indexOf("chapter");
  const lastChapterIndex = rawKinds.lastIndexOf("chapter");
  visibleSections.forEach((item, visibleIndex) => {
    let displayKind = item.summary.readerKind;
    if (displayKind === "section" && firstChapterIndex >= 0) {
      if (visibleIndex < firstChapterIndex) displayKind = "frontmatter";
      if (visibleIndex > lastChapterIndex) displayKind = "backmatter";
    }
    item.summary.readerKind = displayKind;
  });

  const firstReadable = visibleSections[0]?.summary;
  const firstSection = firstReadable ? content.sections.find(section => section.id === firstReadable.id) : undefined;
  let readerSubtitle = firstSection ? plainText(firstSection.html) : "";
  readerSubtitle = readerSubtitle.replace(new RegExp(`^${content.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "").trim();
  readerSubtitle = readerSubtitle.replace(/\bby\s+(?:james johnson|jj)\b.*$/i, "").trim();
  if (!readerSubtitle || readerSubtitle.toLowerCase() === content.title.toLowerCase()) readerSubtitle = "";

  return {
    index: {
      schemaVersion: SCHEMA_VERSION,
      editionId,
      sourceHash,
      book: {
        id: content.id,
        slug: text(catalogBook.slug),
        title: content.title,
        creator: content.creator || text(catalogBook.creator || catalogBook.author),
        description: content.description,
        language: content.language,
        publisher: content.publisher,
        generatedAt: content.generatedAt,
        sectionCount: content.sections.length,
        wordCount: content.sections.reduce((sum, section) => sum + Number(section.wordCount || 0), 0),
        readerSubtitle,
      },
      sections: sections.map(item => item.summary),
      extras,
      crawlableSectionCount: crawlableSections.length,
    },
    artifacts: sections.map(item => ({ path: item.summary.artifactPath, value: item.artifact })),
  };
}

async function promotePointer(pointer) {
  const temporary = `${CURRENT_POINTER_PATH}.${process.pid}.tmp`;
  await writeJson(temporary, pointer);
  if (await fileExists(CURRENT_POINTER_PATH)) await rm(CURRENT_POINTER_PATH, { force: true });
  await renameWithRetry(temporary, CURRENT_POINTER_PATH);
}

async function assertProductionReleaseAttestation({ editionId, sourceDigest }) {
  if (process.env.VERCEL_ENV !== "production") return;

  let attestation;
  try {
    attestation = await readJson(RELEASE_ATTESTATION_PATH);
  } catch {
    throw new Error(
      "Refusing to build a production public edition without a current Supabase/source attestation. "
      + "Run the read-only publication parity check, review it, then record the approved source snapshot before deploying.",
    );
  }

  if (
    !attestation
    || attestation.schemaVersion !== 2
    || attestation.status !== "verified"
    || attestation.bodyParity?.status !== "verified"
    || !attestation.metadataAuthority?.topicAuthority?.digest
    || attestation.editionId !== editionId
    || attestation.sourceDigest !== sourceDigest
  ) {
    throw new Error(
      "Refusing to build a production public edition from an unverified or stale source snapshot. "
      + "A Workshop save stays private until its exact Supabase/source parity has been checked and approved for publication.",
    );
  }

  const checkedAt = Date.parse(String(attestation.checkedAt || ""));
  const age = Date.now() - checkedAt;
  if (!Number.isFinite(checkedAt) || age < -5 * 60 * 1000 || age > MAX_PRODUCTION_ATTESTATION_AGE_MS) {
    throw new Error(
      "Refusing to build a production public edition from an expired publication attestation. "
      + "Run the read-only manuscript parity check again immediately before deploying.",
    );
  }
}

async function main() {
  const [rawCatalog, rawManifest, rawTopicAuthority] = await Promise.all([
    readJson(CATALOG_PATH),
    readJson(CONTENT_MANIFEST_PATH),
    readJson(TOPIC_AUTHORITY_PATH),
  ]);
  const catalog = Array.isArray(rawCatalog) ? rawCatalog : rawCatalog.books || [];
  const manifestEntries = Array.isArray(rawManifest?.books) ? rawManifest.books : [];
  if (!Array.isArray(catalog) || !catalog.length) throw new Error("The publication catalog is empty.");
  if (!manifestEntries.length) throw new Error("The book-content manifest is empty.");
  if (
    !rawTopicAuthority
    || typeof rawTopicAuthority !== "object"
    || Array.isArray(rawTopicAuthority)
    || Number(rawTopicAuthority.schemaVersion) !== 1
    || !Number.isSafeInteger(rawTopicAuthority.revision)
    || !rawTopicAuthority.topicsByBook
    || typeof rawTopicAuthority.topicsByBook !== "object"
    || Array.isArray(rawTopicAuthority.topicsByBook)
  ) {
    throw new Error("The local Topic authority is missing or malformed.");
  }

  const publicCatalog = catalog.filter(isPublicCatalogRecord);
  const readableCatalog = publicCatalog.filter(isReadableCatalogRecord);
  const catalogIds = new Set();
  for (const book of publicCatalog) {
    const id = normalizeId(book.id);
    if (!id) throw new Error("A public catalog record has no book id.");
    if (catalogIds.has(id)) throw new Error(`Duplicate public catalog id ${id}.`);
    catalogIds.add(id);
  }

  const contentEntries = new Set();
  for (const entry of manifestEntries) {
    const id = normalizeId(entry?.id);
    if (!id) throw new Error("A content manifest record has no book id.");
    if (contentEntries.has(id)) throw new Error(`Duplicate content manifest id ${id}.`);
    contentEntries.add(id);
  }

  const draftBooks = [];
  for (const catalogBook of readableCatalog) {
    const entry = findManifestEntry(manifestEntries, catalogBook);
    if (!entry?.path) throw new Error(`${catalogBook.id}: a ready public book has no source content snapshot.`);
    const sourcePath = path.join(CONTENT_ROOT, path.basename(String(entry.path)));
    assertInside(CONTENT_ROOT, sourcePath);
    const content = normalizeContent(await readJson(sourcePath), normalizeId(catalogBook.id));
    if (normalizeId(content.id) !== normalizeId(entry.id)) {
      throw new Error(`${catalogBook.id}: source content id ${content.id} does not match manifest id ${entry.id}.`);
    }
    if (content.sections.length !== Number(entry.sectionCount)) {
      throw new Error(`${catalogBook.id}: manifest has ${entry.sectionCount} sections, source has ${content.sections.length}.`);
    }
    draftBooks.push({ catalogBook, entry, content });
  }

  const sourceDigest = stableHash({
    schemaVersion: SCHEMA_VERSION,
    publisherFormatVersion: PUBLISHER_FORMAT_VERSION,
    catalog: publicCatalog,
    topicAuthority: rawTopicAuthority,
    contentManifest: manifestEntries,
    books: draftBooks.map(({ catalogBook, entry, content }) => ({
      catalogId: catalogBook.id,
      manifestId: entry.id,
      content: {
        id: content.id,
        title: content.title,
        creator: content.creator,
        description: content.description,
        language: content.language,
        publisher: content.publisher,
        generatedAt: content.generatedAt,
        sections: content.sections,
      },
    })),
  });
  const editionId = `edition-${sourceDigest.slice(0, 20)}`;
  const editionDirectory = path.join(EDITIONS_ROOT, editionId);
  const manifestPath = path.join(editionDirectory, "manifest.json");

  await assertProductionReleaseAttestation({ editionId, sourceDigest });

  if (await fileExists(manifestPath)) {
    await promotePointer({ schemaVersion: SCHEMA_VERSION, editionId, manifestPath: `editions/${editionId}/manifest.json` });
    console.log(`Publication edition ${editionId} is already built.`);
    return;
  }

  const stagingDirectory = path.join(OUTPUT_ROOT, `.staging-${editionId}-${process.pid}`);
  assertInside(OUTPUT_ROOT, stagingDirectory);
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });

  try {
    const publishedBooks = [];
    const allArtifactPaths = new Set();
    const allRoutePaths = new Set();

    for (const source of draftBooks) {
      const sourceHash = stableHash({ catalogBook: source.catalogBook, entry: source.entry, content: source.content });
      const built = buildBookIndex({ ...source, editionId, sourceHash });
      const directory = bookDirectoryName(source.content.id);
      const indexPath = `books/${directory}/index.json`;
      const targetIndexPath = path.join(stagingDirectory, indexPath);
      assertInside(stagingDirectory, targetIndexPath);
      await writeJson(targetIndexPath, built.index);

      for (const artifact of built.artifacts) {
        if (allArtifactPaths.has(artifact.path)) continue;
        allArtifactPaths.add(artifact.path);
        const targetArtifactPath = path.join(stagingDirectory, artifact.path);
        assertInside(stagingDirectory, targetArtifactPath);
        await writeJson(targetArtifactPath, artifact.value);
      }

      for (const section of built.index.sections) {
        if (!section.crawlable) continue;
        if (allRoutePaths.has(section.path)) throw new Error(`${source.content.id}: duplicate public route ${section.path}.`);
        allRoutePaths.add(section.path);
      }

      publishedBooks.push({
        id: normalizeId(source.catalogBook.id),
        sourceHash,
        indexPath,
        sectionCount: built.index.book.sectionCount,
        crawlableSectionCount: built.index.crawlableSectionCount,
      });
    }

    const editionManifest = {
      schemaVersion: SCHEMA_VERSION,
      publisherFormatVersion: PUBLISHER_FORMAT_VERSION,
      editionId,
      sourceDigest,
      catalog: publicCatalog,
      books: publishedBooks,
      counts: {
        catalogBooks: publicCatalog.length,
        readableBooks: publishedBooks.length,
        sections: publishedBooks.reduce((sum, book) => sum + book.sectionCount, 0),
        crawlableSections: publishedBooks.reduce((sum, book) => sum + book.crawlableSectionCount, 0),
      },
    };
    await writeJson(path.join(stagingDirectory, "manifest.json"), editionManifest);

    await mkdir(EDITIONS_ROOT, { recursive: true });
    if (await fileExists(editionDirectory)) throw new Error(`Publication edition ${editionId} appeared while this build was running.`);
    await renameWithRetry(stagingDirectory, editionDirectory);
    await promotePointer({ schemaVersion: SCHEMA_VERSION, editionId, manifestPath: `editions/${editionId}/manifest.json` });
    console.log(`Built ${editionId}: ${editionManifest.counts.readableBooks} ready books, ${editionManifest.counts.sections} sections, ${editionManifest.counts.crawlableSections} crawlable pages.`);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

await main();
