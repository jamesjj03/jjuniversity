import { inflateRawSync } from "node:zlib";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BOOKS_JSON = path.join(ROOT, "private", "catalog", "books.json");
const BOOKS_DIR = path.join(ROOT, "public", "books");
const BOOK_CONTENT_DIR = path.join(ROOT, "private", "book-content");
const BOOK_CONTENT_MANIFEST = path.join(BOOK_CONTENT_DIR, "manifest.json");
const WORDS_PER_MINUTE = 180;
const NON_READING_SECTION_KINDS = new Set(["toc", "contents", "title", "dedication", "acknowledgments", "about", "about-author", "copyright", "backmatter"]);
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "what", "how", "why", "who", "are", "was", "were", "has", "have", "not", "but", "you", "your", "its", "their", "our", "his", "her",
  "history", "book", "books", "edition", "university", "james", "johnson", "chapter", "part", "introduction", "conclusion",
]);

function findEnd(buffer) {
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("Invalid EPUB zip.");
}

function readZipEntries(buffer) {
  const eocd = findEnd(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { name, compression, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readEntry(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Invalid zip entry: ${entry.name}`);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported compression in ${entry.name}.`);
}

function textEntry(buffer, entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`Missing EPUB entry: ${name}`);
  return readEntry(buffer, entry).toString("utf8");
}

function attr(source, name) {
  return source.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] || "";
}

function dirname(filePath) {
  const dir = filePath.split("/").slice(0, -1).join("/");
  return dir ? `${dir}/` : "";
}

function absolutize(base, href) {
  const resolved = [];
  for (const part of `${base}${href}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/\.epub$/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleCase(value) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase())
    .trim();
}

function fileStem(value) {
  return path.basename(String(value || ""))
    .replace(/\.(epub|json)$/i, "")
    .toLowerCase();
}

function splitPath(value) {
  return String(value || "").split(/[\\/]+/).filter(Boolean);
}

async function safeReaddir(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function titleFromHtmlFiles(htmlFiles) {
  for (const html of htmlFiles.slice(0, 5)) {
    const title = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "")
      || cleanText(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "")
      || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
    if (title && !/^(contents|table of contents|dedication|chapter\s+\w+)/i.test(title)) return title;
  }
  return "";
}

function sectionText(section) {
  const record = section && typeof section === "object" ? section : {};
  const text = cleanText(record.text || "");
  return text || cleanText(record.html || "");
}

function wordCount(text) {
  return (text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g) || []).length;
}

function wordsFor(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [])]
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

function buildTagProfiles(books) {
  const profiles = new Map();
  for (const book of books) {
    const tags = Array.isArray(book.tags) ? book.tags : [];
    const sourceWords = wordsFor(`${book.id} ${book.title || ""} ${book.description || ""}`);
    for (const tag of tags) {
      if (!profiles.has(tag)) profiles.set(tag, new Map());
      const profile = profiles.get(tag);
      for (const word of [...wordsFor(tag), ...sourceWords]) {
        profile.set(word, (profile.get(word) || 0) + 1);
      }
    }
  }
  return profiles;
}

function inferTags({ title, text }, tagProfiles) {
  const haystack = new Set(wordsFor(`${title} ${text.slice(0, 12000)}`));
  const scored = [...tagProfiles.entries()]
    .map(([tag, profile]) => {
      let score = 0;
      for (const word of wordsFor(tag)) if (haystack.has(word)) score += 8;
      for (const [word, weight] of profile.entries()) if (haystack.has(word)) score += Math.min(weight, 5);
      return { tag, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));

  return scored.slice(0, 6).map(item => item.tag).sort();
}

function makeDescription(title, text) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(sentence =>
      sentence.length >= 60
      && sentence.length <= 260
      && !/^chapter\b/i.test(sentence)
      && !sentence.toLowerCase().includes("table of contents")
      && !sentence.toLowerCase().includes("all rights reserved")
      && !sentence.toLowerCase().includes(title.toLowerCase())
    );
  return sentences[0] || `A JJ University book about ${title}.`;
}

function isChapterHeading(line) {
  const value = cleanText(line);
  return /^(chapter|part)\s+([0-9]{1,3}|[ivxlcdm]+|[a-z]+(?:[-\s]+[a-z]+){0,4})(?:\b|[\s:.-])/i.test(value)
    || /^[0-9]{1,3}[.)]\s+[A-Z][A-Za-z0-9 ,:'"-]{3,120}$/.test(value);
}

function chapterCountFromText(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const matches = lines.filter(isChapterHeading);
  return matches.length >= 2 ? matches.length : null;
}

function chapterCountFromHtml(htmlFiles) {
  const headings = htmlFiles.flatMap(html => [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map(match => htmlToText(match[1])));
  const headingCount = chapterCountFromText(headings.join("\n"));
  if (headingCount) return headingCount;

  const fullText = htmlFiles
    .map(html => decodeEntities(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(h[1-3]|p|div|section|br|li)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " "))
    .join("\n");
  return chapterCountFromText(fullText);
}

function sectionKind(section, index, bookTitle) {
  const rawKind = String(section?.kind || "").trim().toLowerCase();
  const title = cleanText(section?.title || "");
  const normalizedTitle = title.toLowerCase();
  const normalizedBookTitle = String(bookTitle || "").trim().toLowerCase();

  if (rawKind === "toc" || normalizedTitle === "contents" || normalizedTitle === "table of contents") return "toc";
  if (rawKind === "about-author") return "about";
  if (rawKind && NON_READING_SECTION_KINDS.has(rawKind)) return rawKind;
  if (normalizedTitle === "copyright" || normalizedTitle.includes("all rights reserved")) return "copyright";
  if (/acknowledg(e)?ments?/.test(normalizedTitle)) return "acknowledgments";
  if (/about( the)? author/.test(normalizedTitle)) return "about";
  if (normalizedTitle === "dedication") return "dedication";
  if (index <= 1 && normalizedBookTitle && normalizedTitle === normalizedBookTitle) return "title";
  if (isChapterHeading(title) || rawKind === "chapter") return "chapter";
  return rawKind || "default";
}

function readingSections(sections, bookTitle) {
  return sections.filter((section, index) => !NON_READING_SECTION_KINDS.has(sectionKind(section, index, bookTitle)));
}

function chapterCountFromSections(sections, bookTitle) {
  const explicitChapters = sections.filter(section => isChapterHeading(section?.title || "")).length;
  if (explicitChapters >= 2) return explicitChapters;

  const fallbackChapters = sections.filter((section, index) => sectionKind(section, index, bookTitle) === "chapter").length;
  return fallbackChapters >= 2 ? fallbackChapters : null;
}

function readingLabel(minutes) {
  if (!minutes || minutes < 1) return "Under 1 min read";
  if (minutes < 60) return `${minutes} min read`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} hr ${mins} min read` : `${hours} hr read`;
}

function addContentLookup(index, key, record) {
  const normalized = fileStem(key);
  if (normalized && !index.has(normalized)) index.set(normalized, record);
}

async function loadContentIndex() {
  const index = new Map();
  const manifestRecords = [];

  try {
    const manifest = JSON.parse(await readFile(BOOK_CONTENT_MANIFEST, "utf8"));
    for (const item of Array.isArray(manifest.books) ? manifest.books : []) {
      const fileName = splitPath(item.path || `${item.id || item.slug || item.sourceFile}.json`).pop();
      if (!fileName) continue;
      manifestRecords.push({
        ...item,
        fileName,
        absolutePath: item.path ? path.join(ROOT, "public", ...splitPath(item.path)) : path.join(BOOK_CONTENT_DIR, fileName),
      });
    }
  } catch {
    const files = (await safeReaddir(BOOK_CONTENT_DIR)).filter(file => file.toLowerCase().endsWith(".json") && file.toLowerCase() !== "manifest.json");
    for (const fileName of files) {
      manifestRecords.push({ fileName, absolutePath: path.join(BOOK_CONTENT_DIR, fileName) });
    }
  }

  for (const record of manifestRecords) {
    addContentLookup(index, record.fileName, record);
    addContentLookup(index, record.id, record);
    addContentLookup(index, record.slug, record);
    addContentLookup(index, record.sourceFile, record);
    addContentLookup(index, record.path, record);
  }

  return index;
}

function resolveBookFile(file, epubFiles) {
  return epubFiles.find(item => item.toLowerCase() === file.toLowerCase()) || file;
}

async function analyzeEpubBook(book, epubFiles) {
  const file = resolveBookFile(book.bookFile || book.epub || book.file || `${book.id}.epub`, epubFiles);
  const buffer = await readFile(path.join(BOOKS_DIR, file));
  const entries = readZipEntries(buffer);
  const container = textEntry(buffer, entries, "META-INF/container.xml");
  const opfPath = attr(container, "full-path");
  const opf = textEntry(buffer, entries, opfPath);
  const metadataTitle = cleanText(opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || "");
  const opfBase = dirname(opfPath);
  const manifest = new Map();

  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const itemId = attr(match[0], "id");
    const href = attr(match[0], "href");
    if (itemId && href) manifest.set(itemId, absolutize(opfBase, href));
  }

  const chapterFiles = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
    .map(match => manifest.get(attr(match[0], "idref")))
    .filter(Boolean)
    .filter(href => /\.(xhtml|html?)$/i.test(href));

  const htmlFiles = chapterFiles.map(href => textEntry(buffer, entries, href));
  const texts = htmlFiles.map(htmlToText);
  const text = texts.join("\n");
  const words = wordCount(text);
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  const title = metadataTitle || titleFromHtmlFiles(htmlFiles) || book.title || titleCase(book.id);

  return {
    bookFile: file,
    title,
    text,
    wordCount: words,
    readingMinutes: minutes,
    readingLabel: readingLabel(minutes),
    chapterCount: chapterCountFromHtml(htmlFiles),
  };
}

async function analyzeContentBook(book, contentIndex) {
  const keys = [book.id, book.slug, book.bookFile, book.epub, book.file, `${book.id}.json`];
  const record = keys.map(key => contentIndex.get(fileStem(key))).find(Boolean);
  if (!record) throw new Error("Missing EPUB and generated reader content.");

  const raw = JSON.parse(await readFile(record.absolutePath, "utf8"));
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  if (!sections.length) throw new Error(`Generated reader content has no sections: ${record.fileName}`);

  const title = cleanText(raw.title || book.title || titleCase(book.id));
  const readableSections = readingSections(sections, title);
  const text = (readableSections.length ? readableSections : sections)
    .map(sectionText)
    .filter(Boolean)
    .join("\n");
  const words = wordCount(text);
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));

  return {
    bookFile: book.bookFile || raw.sourceFile || record.sourceFile || `${book.id}.epub`,
    title,
    text,
    wordCount: words,
    readingMinutes: minutes,
    readingLabel: readingLabel(minutes),
    chapterCount: chapterCountFromSections(sections, title),
  };
}

const raw = JSON.parse(await readFile(BOOKS_JSON, "utf8"));
const books = Array.isArray(raw) ? raw : raw.books || [];
const existingFiles = new Set(books.map(book => String(book.bookFile || book.epub || book.file || `${book.id}.epub`).toLowerCase()));
const existingIds = new Set(books.map(book => String(book.id || "").toLowerCase()));
const epubFiles = (await safeReaddir(BOOKS_DIR)).filter(file => file.toLowerCase().endsWith(".epub"));
const epubFileSet = new Set(epubFiles.map(file => file.toLowerCase()));
const contentIndex = await loadContentIndex();
let added = 0;

for (const file of epubFiles) {
  const id = slug(file);
  if (existingFiles.has(file.toLowerCase()) || existingIds.has(id)) continue;
  books.push({
    id,
    title: titleCase(id),
    description: "",
    tags: [],
    status: "ready",
    bookFile: file,
    coverFile: `${id}.jpg`,
  });
  added += 1;
}

const tagProfiles = buildTagProfiles(books);
let analyzed = 0;
let failed = 0;
const failures = [];

for (const book of books) {
  try {
    const requestedFile = resolveBookFile(book.bookFile || book.epub || book.file || `${book.id}.epub`, epubFiles);
    const metadata = epubFileSet.has(requestedFile.toLowerCase())
      ? await analyzeEpubBook(book, epubFiles)
      : await analyzeContentBook(book, contentIndex);
    const wasEmptyDescription = !book.description;
    const wasUntagged = !Array.isArray(book.tags) || !book.tags.length;
    book.bookFile = metadata.bookFile;
    book.title = book.title && book.title.toLowerCase() !== book.id ? book.title : metadata.title;
    book.wordCount = metadata.wordCount;
    book.readingMinutes = metadata.readingMinutes;
    book.readingLabel = metadata.readingLabel;
    book.chapterCount = metadata.chapterCount;
    if (wasEmptyDescription) book.description = makeDescription(book.title, metadata.text);
    if (wasUntagged) book.tags = inferTags({ title: book.title, text: metadata.text }, tagProfiles);
    if (book.status === "coming-soon") book.status = "ready";
    analyzed += 1;
  } catch (error) {
    book.wordCount = null;
    book.readingMinutes = null;
    book.readingLabel = "Unknown";
    book.chapterCount = null;
    failed += 1;
    failures.push(`${book.id}: ${error.message}`);
  }
}

await writeFile(BOOKS_JSON, `${JSON.stringify(Array.isArray(raw) ? books : { ...raw, books }, null, 2)}\n`);
console.log(`Added ${added} new books. Analyzed ${analyzed} books. ${failed} failed.`);
if (failures.length && process.env.VERBOSE_BOOK_SYNC === "1") {
  failures.forEach(item => console.warn(`Could not analyze ${item}`));
} else if (failures.length) {
  console.log("Skipped missing/unreadable EPUBs. Set VERBOSE_BOOK_SYNC=1 to list them.");
}
