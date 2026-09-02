import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_ROOT = path.join(ROOT, "public", "_editions");
const EDITIONS_ROOT = path.join(OUTPUT_ROOT, "editions");
const POINTER_PATH = path.join(OUTPUT_ROOT, "current.json");
const CATALOG_PATH = path.join(ROOT, "private", "catalog", "books.json");
const CONTENT_MANIFEST_PATH = path.join(ROOT, "private", "book-content", "manifest.json");
const CONTENT_ROOT = path.join(ROOT, "private", "book-content");
const SCHEMA_VERSION = 1;
const skipPublisher = process.argv.includes("--skip-build");

function fail(message) {
  throw new Error(`Publication verification failed: ${message}`);
}

function normalizeId(value) {
  return String(value || "").trim().replace(/\.json$/i, "").toLowerCase();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
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

function sourceSectionForArtifact(value) {
  const section = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const html = sanitizeHtml(section.html);
  const bodyText = String(section.text || "").trim() || plainText(html);
  return {
    id: String(section.id || "").trim(),
    index: Number(section.index),
    title: String(section.title || "").trim(),
    kind: safeKind(section.kind),
    html,
    text: bodyText,
    wordCount: Number.isFinite(Number(section.wordCount)) ? Number(section.wordCount) : countWords(bodyText),
  };
}

function publicRecord(book) {
  const id = normalizeId(book?.id);
  const status = String(book?.status || "ready").trim().toLowerCase();
  const visibility = String(book?.archive ? "archive" : book?.visibility || "main").trim().toLowerCase();
  return Boolean(id)
    && (status === "ready" || status === "coming-soon")
    && (visibility === "main" || visibility === "archive");
}

function readyRecord(book) {
  return publicRecord(book) && String(book.status || "ready").trim().toLowerCase() === "ready";
}

function relativeFile(parent, relativePath, label) {
  const clean = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("../") || clean.startsWith("..")) fail(`${label} is not a safe relative path.`);
  const target = path.join(parent, ...clean.split("/"));
  const relation = path.relative(parent, target);
  if (!relation || relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    fail(`${label} escaped its edition directory.`);
  }
  return target;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function manifestEntry(entries, book) {
  const id = normalizeId(book.id);
  const bookFile = normalizeId(path.basename(String(book.bookFile || "")));
  return entries.find(entry => {
    const entryId = normalizeId(entry?.id);
    const sourceFile = normalizeId(path.basename(String(entry?.sourceFile || "")));
    const contentFile = normalizeId(path.basename(String(entry?.path || "")));
    return entryId === id || sourceFile === id || contentFile === id || (bookFile && (sourceFile === bookFile || contentFile === bookFile));
  });
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

async function main() {
  if (!skipPublisher) runPublisher();
  const [pointer, rawCatalog, rawContentManifest] = await Promise.all([
    readJson(POINTER_PATH),
    readJson(CATALOG_PATH),
    readJson(CONTENT_MANIFEST_PATH),
  ]);
  const editionId = String(pointer?.editionId || "");
  if (!/^edition-[a-f0-9]{12,}$/i.test(editionId)) fail("the current pointer has no valid edition id.");
  if (Number(pointer?.schemaVersion) !== SCHEMA_VERSION) fail("the current pointer uses an unsupported format.");
  const manifestPath = relativeFile(OUTPUT_ROOT, pointer?.manifestPath, "The current pointer");
  const editionRoot = path.join(EDITIONS_ROOT, editionId);
  const edition = await readJson(manifestPath);
  if (edition?.editionId !== editionId || Number(edition?.schemaVersion) !== SCHEMA_VERSION) fail("the edition manifest does not match the current pointer.");
  if (!Array.isArray(edition?.catalog) || !Array.isArray(edition?.books)) fail("the edition manifest has no catalog or book list.");

  const catalog = Array.isArray(rawCatalog) ? rawCatalog : rawCatalog?.books || [];
  const sourceManifest = Array.isArray(rawContentManifest?.books) ? rawContentManifest.books : [];
  const expectedPublic = catalog.filter(publicRecord);
  const expectedReady = expectedPublic.filter(readyRecord);
  if (edition.catalog.length !== expectedPublic.length) {
    fail(`catalog count differs: expected ${expectedPublic.length}, found ${edition.catalog.length}.`);
  }
  const expectedPublicIds = new Set(expectedPublic.map(book => normalizeId(book.id)));
  const outputPublicIds = new Set(edition.catalog.map(book => normalizeId(book?.id)));
  if (expectedPublicIds.size !== outputPublicIds.size || [...expectedPublicIds].some(id => !outputPublicIds.has(id))) {
    fail("the public catalog differs from the source snapshot.");
  }
  const editionBooks = new Map(edition.books.map(book => [normalizeId(book?.id), book]));
  if (editionBooks.size !== expectedReady.length) {
    fail(`ready-book count differs: expected ${expectedReady.length}, found ${editionBooks.size}.`);
  }

  let observedSections = 0;
  let observedCrawlable = 0;
  const publicPaths = new Set();
  const artifactPaths = new Set();
  for (const catalogBook of expectedReady) {
    const id = normalizeId(catalogBook.id);
    const outputBook = editionBooks.get(id);
    if (!outputBook) fail(`${id} is ready but missing from the edition.`);
    const source = manifestEntry(sourceManifest, catalogBook);
    if (!source?.path) fail(`${id} is ready but has no source content manifest entry.`);
    const sourceFile = relativeFile(CONTENT_ROOT, path.basename(source.path), `${id} source file`);
    const sourceContent = await readJson(sourceFile);
    const sourceSections = Array.isArray(sourceContent?.sections) ? [...sourceContent.sections].sort((left, right) => Number(left.index) - Number(right.index)) : [];
    if (sourceSections.length !== Number(source.sectionCount)) fail(`${id} source section count does not match its content manifest.`);

    const indexPath = relativeFile(editionRoot, outputBook.indexPath, `${id} index path`);
    if (!await exists(indexPath)) fail(`${id} index file is missing.`);
    const index = await readJson(indexPath);
    if (index?.editionId !== editionId || normalizeId(index?.book?.id) !== id) fail(`${id} index does not match its edition identity.`);
    if (!Array.isArray(index?.sections) || index.sections.length !== sourceSections.length) fail(`${id} index section count differs from source.`);
    const seenIds = new Set();
    for (let position = 0; position < index.sections.length; position += 1) {
      const summary = index.sections[position];
      const sourceSection = sourceSections[position];
      const sectionId = String(summary?.id || "").trim();
      if (!sectionId || seenIds.has(sectionId.toLowerCase())) fail(`${id} has a missing or duplicate section id.`);
      seenIds.add(sectionId.toLowerCase());
      if (Number(summary?.index) !== position || Number(sourceSection?.index) !== position) fail(`${id} has a non-contiguous section index at ${position}.`);
      const expectedSourceSection = sourceSectionForArtifact(sourceSection);
      if (summary.title !== expectedSourceSection.title || summary.kind !== expectedSourceSection.kind) {
        fail(`${id}/${sectionId} metadata differs from source.`);
      }
      if ("html" in summary || "text" in summary) fail(`${id}/${sectionId} leaked a full body into its compact index.`);
      if (!summary.artifactPath || !summary.contentHash) fail(`${id}/${sectionId} is missing its section artifact receipt.`);
      const artifactPath = relativeFile(editionRoot, summary.artifactPath, `${id}/${sectionId} artifact path`);
      if (!await exists(artifactPath)) fail(`${id}/${sectionId} artifact file is missing.`);
      const artifact = await readJson(artifactPath);
      const expectedSourceHash = sha256(stableJson(expectedSourceSection));
      const expectedArtifact = {
        schemaVersion: SCHEMA_VERSION,
        editionId,
        sourceHash: expectedSourceHash,
        bookId: String(sourceContent?.id || id).trim(),
        section: {
          id: expectedSourceSection.id,
          index: expectedSourceSection.index,
          title: expectedSourceSection.title,
          kind: expectedSourceSection.kind,
          html: expectedSourceSection.html,
          wordCount: expectedSourceSection.wordCount,
        },
      };
      const expectedArtifactFile = `${sha256(`section:${expectedSourceSection.id}:${stableJson(expectedArtifact)}`).slice(0, 32)}.json`;
      if (summary.contentHash !== expectedSourceHash
        || path.basename(artifactPath) !== expectedArtifactFile
        || stableJson(artifact) !== stableJson(expectedArtifact)) {
        fail(`${id}/${sectionId} artifact does not match its index.`);
      }
      if ("text" in artifact.section) fail(`${id}/${sectionId} duplicated text in the public section artifact.`);
      observedSections += 1;
      if (summary.crawlable) {
        if (!summary.path || summary.routeIndex < 0 || summary.routeTotal < 1) fail(`${id}/${sectionId} has an invalid crawlable route.`);
        if (publicPaths.has(summary.path)) fail(`duplicate crawlable URL ${summary.path}.`);
        publicPaths.add(summary.path);
        observedCrawlable += 1;
      }
      artifactPaths.add(summary.artifactPath);
    }
    if (Number(outputBook.sectionCount) !== sourceSections.length) fail(`${id} manifest section count differs from source.`);
  }

  if (Number(edition?.counts?.sections) !== observedSections) fail("edition section total does not match its indexes.");
  if (Number(edition?.counts?.crawlableSections) !== observedCrawlable) fail("edition crawlable total does not match its indexes.");
  if (Number(edition?.counts?.readableBooks) !== expectedReady.length) fail("edition readable-book total does not match source.");
  console.log(`Verified ${editionId}: ${expectedReady.length} ready books, ${observedSections} sections, ${observedCrawlable} crawlable pages, ${artifactPaths.size} compact section artifacts.`);
}

await main();
