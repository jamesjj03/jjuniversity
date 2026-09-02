import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, "private", "catalog", "books.json");
const CONTENT_MANIFEST_PATH = path.join(ROOT, "private", "book-content", "manifest.json");
const CONTENT_ROOT = path.join(ROOT, "private", "book-content");
const TOPIC_AUTHORITY_PATH = path.join(ROOT, "private", "catalog", "topic-authority.json");
const EDITION_ROOT = path.join(ROOT, "public", "_editions");
const REPORT_ROOT = path.join(ROOT, "tmp", "publication-live-parity");
const ATTESTATION_PATH = path.join(ROOT, "private", "publication-release-attestation.json");
const WRITE_ATTESTATION = process.argv.includes("--write-attestation");
const SKIP_BUILD = process.argv.includes("--skip-build");

function text(value) {
  return String(value || "").trim();
}

function normalizeId(value) {
  return text(value).replace(/\.(json|epub)$/i, "").toLowerCase();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function hash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
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

function sanitizeHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(object|embed|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son[a-z]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, "")
    .replace(/\s(href|src)=["']\s*data:text\/html[^"']*["']/gi, "");
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

function wordCount(value) {
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

function isReadyCatalogRecord(book) {
  return isPublicCatalogRecord(book) && text(book.status || "ready").toLowerCase() === "ready";
}

function catalogRowFromLocal(book) {
  const id = normalizeId(book.id);
  const title = text(book.title || id || "Untitled");
  const tags = Array.isArray(book.tags) ? book.tags.map(String).filter(Boolean) : [];
  const visibility = book.archive || text(book.visibility || "main").toLowerCase() === "archive" ? "archive" : "main";
  const archiveCategory = text(book.archiveCategory || book.category);
  const slug = slugify(book.slug || title || id);
  const slugAliases = [
    id,
    slugify(book.title || ""),
    ...(Array.isArray(book.slugAliases) ? book.slugAliases.map(slugify) : []),
  ].filter(alias => alias && alias !== slug);
  return {
    id,
    slug,
    title,
    subtitle: text(book.subtitle),
    creator: text(book.creator || book.author || "James Johnson"),
    description: text(book.description),
    status: text(book.status || "ready").toLowerCase(),
    visibility,
    archive_category: archiveCategory,
    primary_category: text(book.primaryCategory || book.category || "Library") || "Library",
    cover_file: text(book.coverFile),
    book_file: text(book.bookFile),
    content_key: text(book.contentKey),
    word_count: Number(book.wordCount || 0),
    reading_minutes: Number(book.readingMinutes || 0),
    reading_label: text(book.readingLabel),
    chapter_count: Number(book.chapterCount || 0),
    tags,
    slug_aliases: [...new Set(slugAliases)],
    metadata: {
      series: text(book.series),
      similar: Array.isArray(book.similar) ? book.similar.map(item => text(item).toLowerCase()).filter(Boolean) : [],
      hiddenShelves: Array.isArray(book.hiddenShelves) ? book.hiddenShelves.map(String).filter(Boolean) : [],
      hiddenCategories: Array.isArray(book.hiddenCategories) ? book.hiddenCategories.map(String).filter(Boolean) : [],
    },
  };
}

function catalogRowFromLive(row) {
  const metadata = row && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  return {
    id: normalizeId(row?.id),
    slug: text(row?.slug),
    title: text(row?.title),
    subtitle: text(row?.subtitle),
    creator: text(row?.creator),
    description: text(row?.description),
    status: text(row?.status || "ready").toLowerCase(),
    visibility: text(row?.visibility || "main").toLowerCase(),
    archive_category: text(row?.archive_category),
    primary_category: text(row?.primary_category || "Library"),
    cover_file: text(row?.cover_file),
    book_file: text(row?.book_file),
    content_key: text(row?.content_key),
    word_count: Number(row?.word_count || 0),
    reading_minutes: Number(row?.reading_minutes || 0),
    reading_label: text(row?.reading_label),
    chapter_count: Number(row?.chapter_count || 0),
    tags: Array.isArray(row?.tags) ? row.tags.map(String).filter(Boolean) : [],
    slug_aliases: Array.isArray(row?.slug_aliases) ? row.slug_aliases.map(String).filter(Boolean) : [],
    metadata: {
      series: text(metadata.series),
      similar: Array.isArray(metadata.similar) ? metadata.similar.map(item => text(item).toLowerCase()).filter(Boolean) : [],
      hiddenShelves: Array.isArray(metadata.hiddenShelves) ? metadata.hiddenShelves.map(String).filter(Boolean) : [],
      hiddenCategories: Array.isArray(metadata.hiddenCategories) ? metadata.hiddenCategories.map(String).filter(Boolean) : [],
    },
  };
}

function changedFieldNames(left, right) {
  return [...new Set([...Object.keys(left || {}), ...Object.keys(right || {})])]
    .filter(key => stableJson(left?.[key]) !== stableJson(right?.[key]));
}

function sortedTextList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const values = value.map(item => text(item));
  if (values.some(item => !item)) throw new Error(`${label} contains blank text.`);
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameTextList(left, right) {
  return stableJson(sortedTextList(left, "left list")) === stableJson(sortedTextList(right, "right list"));
}

function validateTopicAuthority(rawAuthority, catalog) {
  if (!rawAuthority || typeof rawAuthority !== "object" || Array.isArray(rawAuthority)) {
    throw new Error("The local Topic authority is not a valid document.");
  }
  if (Number(rawAuthority.schemaVersion) !== 1 || !Number.isSafeInteger(rawAuthority.revision) || Number(rawAuthority.revision) < 1) {
    throw new Error("The local Topic authority has an unsupported schema or revision.");
  }
  if (typeof rawAuthority.updatedAt !== "string" || !Number.isFinite(Date.parse(rawAuthority.updatedAt))) {
    throw new Error("The local Topic authority is missing a valid update time.");
  }
  if (!rawAuthority.topicsByBook || typeof rawAuthority.topicsByBook !== "object" || Array.isArray(rawAuthority.topicsByBook)) {
    throw new Error("The local Topic authority is missing its book topics.");
  }

  const catalogById = new Map();
  for (const book of catalog) {
    const id = normalizeId(book?.id);
    if (!id || catalogById.has(id)) throw new Error("The local catalog has a missing or duplicate id.");
    catalogById.set(id, book);
  }
  const authorityIds = Object.keys(rawAuthority.topicsByBook).map(normalizeId).sort();
  if (authorityIds.length !== catalogById.size || authorityIds.some((id, index) => id !== [...catalogById.keys()].sort()[index])) {
    throw new Error("The local Topic authority does not cover exactly the local catalog.");
  }

  const topicsByBook = {};
  for (const [id, book] of catalogById) {
    const rawTopics = rawAuthority.topicsByBook[id];
    const authorityTopics = sortedTextList(rawTopics, `Topic authority for ${id}`);
    if (new Set(authorityTopics).size !== authorityTopics.length) {
      throw new Error(`Topic authority for ${id} contains duplicate topics.`);
    }
    const catalogTopics = sortedTextList(Array.isArray(book.tags) ? book.tags : [], `Catalog topics for ${id}`);
    if (stableJson(authorityTopics) !== stableJson(catalogTopics)) {
      throw new Error(`Topic authority for ${id} no longer matches the local catalog.`);
    }
    topicsByBook[id] = authorityTopics;
  }

  return {
    schemaVersion: 1,
    revision: Number(rawAuthority.revision),
    updatedAt: new Date(rawAuthority.updatedAt).toISOString(),
    topicsByBook,
    digest: hash({
      schemaVersion: 1,
      revision: Number(rawAuthority.revision),
      updatedAt: new Date(rawAuthority.updatedAt).toISOString(),
      topicsByBook,
    }),
  };
}

function contentKeyId(value) {
  return normalizeId(path.basename(text(value).replace(/\\/g, "/")));
}

function classifyCatalogDifference({ localBook, liveBook, entry, topicAuthority }) {
  const changed = changedFieldNames(localBook, liveBook);
  const recorded = [];
  const blocking = [];
  for (const field of changed) {
    if (field === "tags") {
      if (sameTextList(localBook.tags, topicAuthority.topicsByBook[localBook.id] || [])) {
        recorded.push({ field, reason: "local Topic authority supersedes stale Supabase tags" });
      } else {
        blocking.push({ field, reason: "local catalog tags are not backed by the Topic authority" });
      }
      continue;
    }
    if (field === "primary_category") {
      if (text(localBook.primary_category)) {
        recorded.push({ field, reason: "local catalog is the current category authority" });
      } else {
        blocking.push({ field, reason: "local catalog has no primary category" });
      }
      continue;
    }
    if (field === "content_key") {
      const expectedId = normalizeId(path.basename(String(entry?.path || localBook.id)));
      if (contentKeyId(liveBook.content_key) === expectedId) {
        recorded.push({ field, reason: "Supabase keeps a legacy content-path key" });
      } else {
        blocking.push({ field, reason: "Supabase content key does not resolve to this manuscript" });
      }
      continue;
    }
    if (field === "slug_aliases") {
      const liveAliases = new Set((liveBook.slug_aliases || []).map(slugify));
      if (liveBook.slug === localBook.slug && liveAliases.has(slugify(localBook.id))) {
        recorded.push({ field, reason: "Supabase keeps legacy route aliases" });
      } else {
        blocking.push({ field, reason: "Supabase aliases no longer include the canonical book id and slug" });
      }
      continue;
    }
    if (field === "metadata") {
      const metadataChanges = changedFieldNames(localBook.metadata, liveBook.metadata);
      if (
        metadataChanges.length === 1
        && metadataChanges[0] === "series"
        && text(localBook.metadata.series)
      ) {
        recorded.push({ field, reason: "local catalog is the current series authority" });
      } else {
        blocking.push({ field, reason: `unexpected metadata fields: ${metadataChanges.join(", ") || "unknown"}` });
      }
      continue;
    }
    if (
      field === "archive_category"
      && localBook.id === "tnd"
      && localBook.archive_category === "Experiments"
      && liveBook.archive_category === "Children’s Books"
    ) {
      recorded.push({ field, reason: "approved TND archive-category correction lives in the current catalog" });
      continue;
    }
    blocking.push({ field, reason: "not an approved legacy metadata field" });
  }
  return { changed, recorded, blocking };
}

function summarizeDifferences(differences) {
  return Object.fromEntries(
    [...differences.reduce((counts, difference) => {
      const key = `${difference.kind}: ${difference.detail}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeContent(raw, fallbackId) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const id = text(source.id || fallbackId);
  const title = text(source.title || fallbackId);
  const sections = (Array.isArray(source.sections) ? source.sections : []).map((rawSection, position) => {
    const section = rawSection && typeof rawSection === "object" && !Array.isArray(rawSection) ? rawSection : {};
    const sectionId = text(section.id);
    const sectionTitle = text(section.title);
    const index = Number(section.index);
    const html = sanitizeHtml(section.html);
    if (!sectionId || !sectionTitle || !Number.isInteger(index) || index < 0 || !html) {
      throw new Error(`${id}: malformed section ${position + 1} in the source-parity check.`);
    }
    const bodyText = text(section.text) || plainText(html);
    return {
      id: sectionId,
      index,
      title: sectionTitle,
      kind: safeKind(section.kind),
      html,
      text: bodyText,
      wordCount: Number.isFinite(Number(section.wordCount)) ? Number(section.wordCount) : wordCount(bodyText),
    };
  }).sort((left, right) => left.index - right.index);
  if (!id || !title || !sections.length || sections.some((section, index) => section.index !== index)) {
    throw new Error(`${fallbackId}: manuscript metadata or section order is invalid in the source-parity check.`);
  }
  return {
    // File names and the legacy rows disagree on casing for many manuscripts;
    // ids are identifiers, so compare their canonical form while retaining all
    // reader-visible metadata below as exact text.
    id: normalizeId(id),
    title,
    creator: text(source.creator),
    description: text(source.description),
    language: text(source.language),
    publisher: text(source.publisher),
    generatedAt: text(source.generatedAt),
    sections,
  };
}

function manifestEntry(entries, catalogBook) {
  const id = normalizeId(catalogBook.id);
  const bookFile = normalizeId(path.basename(String(catalogBook.bookFile || "")));
  return entries.find(entry => {
    const entryId = normalizeId(entry?.id);
    const sourceFile = normalizeId(path.basename(String(entry?.sourceFile || "")));
    const contentFile = normalizeId(path.basename(String(entry?.path || "")));
    return entryId === id || sourceFile === id || contentFile === id || (bookFile && (sourceFile === bookFile || contentFile === bookFile));
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function runPublisher() {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-publication-edition.mjs")], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function fetchAllRows(supabase, table, columns, orderColumn) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const result = await supabase.from(table).select(columns).order(orderColumn, { ascending: true }).range(start, start + 999);
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    const page = result.data || [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function projectRef(url) {
  try {
    return new URL(url).hostname.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
}

function revisionRows(rows, label, toRevision) {
  const result = rows.map(toRevision).filter(row => row.id);
  if (result.length !== rows.length || result.some(row => !row.updatedAt)) {
    throw new Error(`${label}: every live row must have an ID and updated_at value for a parity receipt.`);
  }
  result.sort((left, right) => left.id.localeCompare(right.id));
  if (result.some((row, index) => index > 0 && row.id === result[index - 1].id)) {
    throw new Error(`${label}: duplicate normalized live IDs prevent a safe parity receipt.`);
  }
  return result;
}

function liveRevisionSnapshot(catalogRows, contentRows) {
  return {
    catalog: revisionRows(catalogRows, "book_catalog", row => ({
      id: normalizeId(row?.id),
      updatedAt: text(row?.updated_at),
    })),
    content: revisionRows(contentRows, "book_content_live", row => ({
        id: normalizeId(row?.book_id),
        contentFile: text(row?.content_file),
        contentPath: text(row?.content_path),
        version: Number(row?.version_number || 0),
        updatedAt: text(row?.updated_at),
      })),
  };
}

async function fetchLiveRevisionSnapshot(supabase) {
  const [catalogRows, contentRows] = await Promise.all([
    fetchAllRows(supabase, "book_catalog", "id,updated_at", "id"),
    fetchAllRows(supabase, "book_content_live", "book_id,content_file,content_path,version_number,updated_at", "book_id"),
  ]);
  return liveRevisionSnapshot(catalogRows, contentRows);
}

async function main() {
  loadEnvConfig(ROOT);
  if (!SKIP_BUILD) runPublisher();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRole) throw new Error("Supabase admin configuration is unavailable for the read-only publication parity check.");

  const [rawCatalog, rawContentManifest, rawTopicAuthority, pointer] = await Promise.all([
    readJson(CATALOG_PATH),
    readJson(CONTENT_MANIFEST_PATH),
    readJson(TOPIC_AUTHORITY_PATH),
    readJson(path.join(EDITION_ROOT, "current.json")),
  ]);
  const catalog = Array.isArray(rawCatalog) ? rawCatalog : rawCatalog?.books || [];
  const contentManifest = Array.isArray(rawContentManifest?.books) ? rawContentManifest.books : [];
  const topicAuthority = validateTopicAuthority(rawTopicAuthority, catalog);
  const editionId = text(pointer?.editionId);
  const manifestPath = path.join(EDITION_ROOT, ...text(pointer?.manifestPath).replace(/\\/g, "/").split("/").filter(Boolean));
  const edition = await readJson(manifestPath);
  if (!editionId || edition?.editionId !== editionId || !edition?.sourceDigest) {
    throw new Error("The local public edition is missing its identity or source digest.");
  }

  const supabase = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
  const [liveCatalogRows, liveContentRows] = await Promise.all([
    fetchAllRows(
      supabase,
      "book_catalog",
      "id,slug,title,subtitle,creator,description,status,visibility,archive_category,primary_category,cover_file,book_file,content_key,word_count,reading_minutes,reading_label,chapter_count,tags,slug_aliases,metadata,updated_at",
      "id",
    ),
    fetchAllRows(supabase, "book_content_live", "book_id,content_file,content_path,version_number,updated_at,content", "book_id"),
  ]);

  const blockingDifferences = [];
  const recordedMetadataDrift = [];
  const addBlocking = difference => blockingDifferences.push(difference);
  const addRecordedDrift = difference => recordedMetadataDrift.push(difference);
  const localPublic = catalog.filter(isPublicCatalogRecord).map(catalogRowFromLocal);
  const livePublic = liveCatalogRows.filter(isPublicCatalogRecord).map(catalogRowFromLive);
  const localCatalogById = new Map(catalog.map(book => [normalizeId(book?.id), book]));
  const liveCatalogById = new Map();
  for (const liveBook of livePublic) {
    if (liveCatalogById.has(liveBook.id)) {
      addBlocking({ kind: "catalog", id: liveBook.id, detail: "duplicate normalized public catalog id in Supabase" });
    } else {
      liveCatalogById.set(liveBook.id, liveBook);
    }
  }
  for (const localBook of localPublic) {
    const liveBook = liveCatalogById.get(localBook.id);
    if (!liveBook) {
      addBlocking({ kind: "catalog", id: localBook.id, detail: "missing from Supabase public catalog" });
    } else if (stableJson(localBook) !== stableJson(liveBook)) {
      const sourceBook = localCatalogById.get(localBook.id);
      const classification = classifyCatalogDifference({
        localBook,
        liveBook,
        entry: sourceBook ? manifestEntry(contentManifest, sourceBook) : undefined,
        topicAuthority,
      });
      if (classification.recorded.length) {
        addRecordedDrift({
          kind: "catalog",
          id: localBook.id,
          detail: "approved legacy catalog metadata differs",
          fields: classification.recorded.map(item => item.field),
          reasons: classification.recorded,
        });
      }
      if (classification.blocking.length) {
        addBlocking({
          kind: "catalog",
          id: localBook.id,
          detail: "unapproved public catalog fields differ",
          fields: classification.blocking.map(item => item.field),
          reasons: classification.blocking,
        });
      }
    }
  }
  const localPublicIds = new Set(localPublic.map(book => book.id));
  for (const liveBook of livePublic) {
    if (!localPublicIds.has(liveBook.id)) {
      addBlocking({ kind: "catalog", id: liveBook.id, detail: "extra public catalog row in Supabase" });
    }
  }

  const liveContentById = new Map();
  for (const row of liveContentRows) {
    const id = normalizeId(row?.book_id);
    if (!id) {
      addBlocking({ kind: "manuscript", id: "unknown", detail: "live content row has no canonical book id" });
    } else if (liveContentById.has(id)) {
      addBlocking({ kind: "manuscript", id, detail: "duplicate normalized live content id" });
    } else {
      liveContentById.set(id, row);
    }
  }

  const readyCatalog = catalog.filter(isReadyCatalogRecord);
  let localSections = 0;
  for (const catalogBook of readyCatalog) {
    const entry = manifestEntry(contentManifest, catalogBook);
    const id = normalizeId(catalogBook.id);
    if (!entry?.path) {
      addBlocking({ kind: "manuscript", id, detail: "missing local content-manifest entry" });
      continue;
    }
    const localRaw = await readJson(path.join(CONTENT_ROOT, path.basename(String(entry.path))));
    const localContent = normalizeContent(localRaw, id);
    localSections += localContent.sections.length;
    if (localContent.id !== id) {
      addBlocking({ kind: "manuscript", id, detail: "local source id does not match its ready catalog id" });
      continue;
    }
    const liveRow = liveContentById.get(id);
    if (!liveRow?.content) {
      addBlocking({ kind: "manuscript", id, detail: "missing from Supabase live content" });
      continue;
    }
    const liveContent = normalizeContent(liveRow.content, id);
    if (liveContent.id !== id) {
      addBlocking({
        kind: "manuscript",
        id,
        detail: "live manuscript id does not match its canonical row id",
        liveVersion: Number(liveRow.version_number || 0) || undefined,
        liveUpdatedAt: text(liveRow.updated_at) || undefined,
      });
    } else if (hash(localContent.sections) !== hash(liveContent.sections)) {
      addBlocking({
        kind: "manuscript",
        id,
        detail: "section bodies or order differ",
        liveVersion: Number(liveRow.version_number || 0) || undefined,
        liveUpdatedAt: text(liveRow.updated_at) || undefined,
      });
    } else if (hash({ ...localContent, sections: undefined }) !== hash({ ...liveContent, sections: undefined })) {
      addBlocking({
        kind: "manuscript",
        id,
        detail: "manuscript metadata differs while section bodies match",
        fields: changedFieldNames(
          { ...localContent, sections: undefined },
          { ...liveContent, sections: undefined },
        ),
        liveVersion: Number(liveRow.version_number || 0) || undefined,
        liveUpdatedAt: text(liveRow.updated_at) || undefined,
      });
    }
  }

  const initialLiveRevision = liveRevisionSnapshot(liveCatalogRows, liveContentRows);
  const finalLiveRevision = await fetchLiveRevisionSnapshot(supabase);
  if (stableJson(initialLiveRevision) !== stableJson(finalLiveRevision)) {
    addBlocking({
      kind: "freshness",
      id: "live-revision",
      detail: "Supabase changed while the full manuscript parity read was running",
    });
  }

  const status = blockingDifferences.length
    ? "mismatch"
    : recordedMetadataDrift.length
      ? "verified_with_recorded_metadata_drift"
      : "verified";
  const blockingDifferenceSummary = summarizeDifferences(blockingDifferences);
  const recordedMetadataDriftSummary = summarizeDifferences(recordedMetadataDrift);
  const report = {
    schemaVersion: 3,
    status,
    checkedAt: new Date().toISOString(),
    readOnly: true,
    projectRef: projectRef(url),
    editionId,
    sourceDigest: edition.sourceDigest,
    local: {
      publicCatalogBooks: localPublic.length,
      readyBooks: readyCatalog.length,
      sections: localSections,
    },
    live: {
      catalogRows: liveCatalogRows.length,
      manuscriptRows: liveContentRows.length,
      publicCatalogBooks: livePublic.length,
      revision: initialLiveRevision,
      finalRevision: finalLiveRevision,
    },
    bodyParity: {
      status: blockingDifferences.some(difference => difference.kind === "manuscript") ? "mismatch" : "verified",
      readyBooks: readyCatalog.length,
      sections: localSections,
    },
    metadataAuthority: {
      source: "local catalog and Topic authority",
      topicAuthority: {
        schemaVersion: topicAuthority.schemaVersion,
        revision: topicAuthority.revision,
        updatedAt: topicAuthority.updatedAt,
        digest: topicAuthority.digest,
      },
    },
    differenceCount: blockingDifferences.length,
    differenceSummary: blockingDifferenceSummary,
    differences: blockingDifferences.slice(0, 100),
    blockingDifferenceCount: blockingDifferences.length,
    blockingDifferenceSummary,
    blockingDifferences: blockingDifferences.slice(0, 100),
    recordedMetadataDriftCount: recordedMetadataDrift.length,
    recordedMetadataDriftSummary,
    recordedMetadataDrift: recordedMetadataDrift.slice(0, 100),
  };
  await mkdir(REPORT_ROOT, { recursive: true });
  const reportPath = path.join(REPORT_ROOT, `${timestampId()}-${editionId}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (blockingDifferences.length) {
    console.error(`Publication source parity did not pass: ${blockingDifferences.length} blocking difference${blockingDifferences.length === 1 ? "" : "s"}. Report: ${reportPath}`);
    process.exitCode = 1;
    return;
  }

  if (WRITE_ATTESTATION) {
    const attestation = {
      schemaVersion: 2,
      status: "verified",
      resultStatus: status,
      source: "supabase-read-only-body-parity",
      projectRef: report.projectRef,
      editionId,
      sourceDigest: edition.sourceDigest,
      checkedAt: report.checkedAt,
      local: report.local,
      live: report.live,
      bodyParity: report.bodyParity,
      metadataAuthority: report.metadataAuthority,
      recordedMetadataDriftCount: report.recordedMetadataDriftCount,
      recordedMetadataDriftSummary: report.recordedMetadataDriftSummary,
    };
    await writeFile(ATTESTATION_PATH, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
    console.log(`Verified manuscript bodies and wrote the publication attestation for ${editionId}; recorded ${recordedMetadataDrift.length} legacy metadata difference${recordedMetadataDrift.length === 1 ? "" : "s"}.`);
  } else {
    console.log(`Verified ${editionId} against Supabase: ${readyCatalog.length} ready books and ${localSections} sections match; recorded ${recordedMetadataDrift.length} legacy metadata difference${recordedMetadataDrift.length === 1 ? "" : "s"}. Report: ${reportPath}`);
  }
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
