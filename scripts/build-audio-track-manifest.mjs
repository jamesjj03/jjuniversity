import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");

await main().catch(error => {
  console.error(`Audio manifest failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  const selector = parseSelector(process.argv.slice(2));
  const catalogPath = resolve(publicRoot, "books.json");
  const contentManifestPath = resolve(publicRoot, "book-content", "manifest.json");
  const [catalog, contentManifest] = await Promise.all([
    readJson(catalogPath, "public/books.json"),
    readJson(contentManifestPath, "public/book-content/manifest.json"),
  ]);

  if (!Array.isArray(catalog)) throw new Error("public/books.json must contain an array.");
  if (!contentManifest || !Array.isArray(contentManifest.books)) {
    throw new Error("public/book-content/manifest.json must contain a books array.");
  }

  assertUniqueBookIds(catalog, "public/books.json");
  assertUniqueBookIds(contentManifest.books, "public/book-content/manifest.json");

  const { catalogBook, contentEntry } = resolveBook(selector, catalog, contentManifest.books);
  validateResolvedBook(catalogBook, contentEntry);

  const manifestRelativePath = requiredString(contentEntry.path, "The content manifest path");
  const contentPath = resolve(publicRoot, manifestRelativePath);
  assertPathInside(publicRoot, contentPath);
  if (!contentPath.toLowerCase().endsWith(".json")) {
    throw new Error(`The canonical content path must be JSON: ${manifestRelativePath}`);
  }

  const sourceBytes = await readFile(contentPath).catch(error => {
    throw new Error(`Could not read canonical content ${displayPath(contentPath)}: ${error.message}`);
  });
  const content = parseJson(sourceBytes, displayPath(contentPath));
  validateContentIdentity(content, catalogBook, contentEntry);

  const sections = validateAndSortSections(content.sections, contentEntry.sectionCount);
  const readableSections = sections.filter(section => !isTableOfContentsSection(section));
  if (!readableSections.length) throw new Error("The selected book has no readable sections after Contents/TOC removal.");

  const output = {
    schemaVersion: 1,
    id: requiredString(catalogBook.id, "The catalog book ID"),
    slug: requiredString(contentEntry.slug, "The content manifest slug"),
    title: requiredString(contentEntry.title, "The content manifest title"),
    sourceFile: displayPath(contentPath),
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    tracks: readableSections.map((section, index) => ({
      position: index + 1,
      sectionKey: section.id,
      title: section.title,
      required: true,
    })),
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function parseSelector(args) {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write([
      "Build a read-only audio track manifest from canonical Reader content.",
      "",
      "Usage:",
      "  npm run audio:manifest -- <book-id|slug|title>",
      "  npm run audio:manifest -- --book=<book-id|slug|title>",
      "",
    ].join("\n"));
    process.exit(0);
  }

  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--book") {
      values.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith("--book=")) {
      values.push(argument.slice("--book=".length));
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    values.push(argument);
  }

  const cleaned = values.map(value => String(value || "").trim()).filter(Boolean);
  if (cleaned.length !== 1) {
    throw new Error("Pass exactly one book ID, slug, or full title. Try --help for usage.");
  }
  return cleaned[0];
}

async function readJson(path, label) {
  const bytes = await readFile(path).catch(error => {
    throw new Error(`Could not read ${label}: ${error.message}`);
  });
  return parseJson(bytes, label);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function resolveBook(selector, catalog, contentEntries) {
  const key = lookupKey(selector);
  const catalogMatches = catalog.filter(book => recordMatches(book, ["id", "slug", "title"], key));
  const contentMatches = contentEntries.filter(book => recordMatches(book, ["id", "slug", "title"], key));

  if (catalogMatches.length > 1) {
    throw new Error(`The selector "${selector}" matches multiple catalog books.`);
  }
  if (contentMatches.length > 1) {
    throw new Error(`The selector "${selector}" matches multiple content-manifest books.`);
  }
  if (!catalogMatches.length && !contentMatches.length) {
    throw new Error(`No book with ID, slug, or title "${selector}" was found.`);
  }

  let catalogBook = catalogMatches[0];
  let contentEntry = contentMatches[0];

  if (catalogBook && !contentEntry) {
    const linked = contentEntries.filter(entry => recordsDescribeSameBook(catalogBook, entry));
    if (linked.length !== 1) {
      throw new Error(`Catalog book "${catalogBook.id}" resolves to ${linked.length} content-manifest entries; expected exactly one.`);
    }
    [contentEntry] = linked;
  }

  if (contentEntry && !catalogBook) {
    const linked = catalog.filter(book => recordsDescribeSameBook(book, contentEntry));
    if (linked.length !== 1) {
      throw new Error(`Content-manifest book "${contentEntry.id}" resolves to ${linked.length} catalog books; expected exactly one.`);
    }
    [catalogBook] = linked;
  }

  if (!catalogBook || !contentEntry || !recordsDescribeSameBook(catalogBook, contentEntry)) {
    throw new Error(`The catalog and content manifest disagree about "${selector}".`);
  }

  return { catalogBook, contentEntry };
}

function validateResolvedBook(catalogBook, contentEntry) {
  const catalogTitle = requiredString(catalogBook.title, "The catalog title");
  const contentTitle = requiredString(contentEntry.title, "The content manifest title");
  const catalogSource = requiredString(catalogBook.bookFile, "The catalog book file");
  const contentSource = requiredString(contentEntry.sourceFile, "The content manifest source file");

  if (lookupKey(catalogTitle) !== lookupKey(contentTitle)) {
    throw new Error(`Catalog/content title mismatch: "${catalogTitle}" versus "${contentTitle}".`);
  }
  if (lookupKey(catalogSource) !== lookupKey(contentSource)) {
    throw new Error(`Catalog/content source mismatch: "${catalogSource}" versus "${contentSource}".`);
  }
}

function validateContentIdentity(content, catalogBook, contentEntry) {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("The canonical content document must be an object.");
  }

  const contentId = requiredString(content.id, "The canonical content book ID");
  const manifestId = requiredString(contentEntry.id, "The content manifest book ID");
  const contentTitle = requiredString(content.title, "The canonical content title");
  const catalogTitle = requiredString(catalogBook.title, "The catalog title");

  if (lookupKey(contentId) !== lookupKey(manifestId)) {
    throw new Error(`Canonical content ID mismatch: "${contentId}" versus "${manifestId}".`);
  }
  if (lookupKey(contentTitle) !== lookupKey(catalogTitle)) {
    throw new Error(`Canonical content title mismatch: "${contentTitle}" versus "${catalogTitle}".`);
  }
}

function validateAndSortSections(rawSections, expectedCount) {
  if (!Array.isArray(rawSections) || !rawSections.length) {
    throw new Error("The canonical content document has no sections.");
  }

  const manifestCount = Number(expectedCount);
  if (!Number.isInteger(manifestCount) || manifestCount < 1) {
    throw new Error("The content manifest has an invalid section count.");
  }
  if (rawSections.length !== manifestCount) {
    throw new Error(`Section-count mismatch: manifest=${manifestCount}, content=${rawSections.length}.`);
  }

  const seenIds = new Set();
  const seenIndexes = new Set();
  const sections = rawSections.map((section, sourcePosition) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error(`Section at source position ${sourcePosition} is not an object.`);
    }

    const id = requiredString(section.id, `Section at source position ${sourcePosition} ID`);
    const title = requiredString(section.title, `Section "${id}" title`);
    const index = Number(section.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Section "${id}" has an invalid index.`);
    }
    if (typeof section.html !== "string") {
      throw new Error(`Section "${id}" is missing HTML used by Reader TOC detection.`);
    }

    const idKey = lookupKey(id);
    if (seenIds.has(idKey)) throw new Error(`Duplicate section ID: "${id}".`);
    if (seenIndexes.has(index)) throw new Error(`Duplicate section index: ${index}.`);
    seenIds.add(idKey);
    seenIndexes.add(index);

    return {
      id,
      index,
      title,
      kind: String(section.kind || ""),
      html: section.html,
    };
  }).sort((left, right) => left.index - right.index);

  for (let index = 0; index < sections.length; index += 1) {
    if (sections[index].index !== index) {
      throw new Error(`Missing section index ${index}; found ${sections[index].index} instead.`);
    }
  }

  return sections;
}

// Keep this aligned with ReaderClient's Contents/TOC exclusion. A chapter title
// wins over a bad imported kind, followed by exact title, EPUB nav, and kind rules.
function isTableOfContentsSection(section) {
  const rawKind = safeKind(section.kind);
  const title = section.title.trim().toLowerCase();
  if (/^chapter\b/i.test(section.title)) return false;
  if (title === "contents" || title === "table of contents") return true;
  if (/<nav\b[^>]*(?:epub:type=["']toc["']|id=["']toc["'])/i.test(section.html)) return true;
  return rawKind === "toc";
}

function safeKind(kind) {
  return String(kind || "default").toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "default";
}

function assertUniqueBookIds(records, label) {
  const seen = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const id = requiredString(records[index]?.id, `${label} book at position ${index} ID`);
    const key = lookupKey(id);
    if (seen.has(key)) {
      throw new Error(`${label} contains duplicate book ID "${id}" (also "${seen.get(key)}").`);
    }
    seen.set(key, id);
  }
}

function recordMatches(record, fields, selectorKey) {
  return fields.some(field => {
    const value = String(record?.[field] || "").trim();
    return value && lookupKey(value) === selectorKey;
  });
}

function recordsDescribeSameBook(catalogBook, contentEntry) {
  const pairs = [
    [catalogBook?.id, contentEntry?.id],
    [catalogBook?.slug, contentEntry?.slug],
    [catalogBook?.title, contentEntry?.title],
    [catalogBook?.bookFile, contentEntry?.sourceFile],
  ];
  return pairs.some(([left, right]) => {
    const leftValue = String(left || "").trim();
    const rightValue = String(right || "").trim();
    return leftValue && rightValue && lookupKey(leftValue) === lookupKey(rightValue);
  });
}

function assertPathInside(parent, target) {
  const pathFromParent = relative(parent, target);
  if (!pathFromParent || pathFromParent === ".." || pathFromParent.startsWith(`..${sep}`) || isAbsolute(pathFromParent)) {
    throw new Error("The canonical content path escapes the public directory.");
  }
}

function requiredString(value, label) {
  const cleaned = String(value || "").trim();
  if (!cleaned) throw new Error(`${label} is missing.`);
  return cleaned;
}

function lookupKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function displayPath(path) {
  return relative(root, path).split(sep).join("/");
}
