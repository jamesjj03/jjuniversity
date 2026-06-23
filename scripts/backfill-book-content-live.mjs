import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
loadLocalEnv(".env.local");
loadLocalEnv(".env");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const limit = Number(getArgValue("--limit") || 0);
const only = (getArgValue("--only") || "")
  .split(",")
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

const manifestPath = join(root, "public", "book-content", "manifest.json");
const booksPath = join(root, "public", "books.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const books = JSON.parse(readFileSync(booksPath, "utf8"));
const catalog = new Map(books.map(book => [String(book.id || "").toLowerCase(), book]));
const catalogBySource = new Map(books.map(book => [fileStem(String(book.bookFile || book.file || book.epub || book.id || "")), book]));
const entries = (manifest.books || [])
  .map(entry => {
    const fileName = basename(String(entry.path || ""));
    const localPath = join(root, "public", "book-content", fileName);
    const catalogBook = catalog.get(String(entry.id || "").toLowerCase())
      || catalogBySource.get(fileStem(String(entry.sourceFile || entry.path || entry.id || "")))
      || catalogBySource.get(fileStem(fileName));

    return {
      entry,
      fileName,
      localPath,
      bookId: String(catalogBook?.id || entry.id || "").trim().toLowerCase(),
      catalogBook,
    };
  })
  .filter(item => item.bookId && item.fileName && existsSync(item.localPath))
  .filter(item => !only.length || only.includes(item.bookId) || only.includes(fileStem(item.fileName)))
  .slice(0, limit > 0 ? limit : undefined);

if (!entries.length) {
  console.log("No book content entries matched.");
  process.exit(0);
}

console.log(`${dryRun ? "Dry run:" : "Backfill:"} ${entries.length} book content file(s).`);

if (dryRun) {
  entries.slice(0, 20).forEach(item => {
    console.log(`- ${item.bookId} <- ${item.fileName}`);
  });
  if (entries.length > 20) console.log(`...and ${entries.length - 20} more.`);
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const tableCheck = await supabase.from("book_content_live").select("book_id").limit(1);
if (tableCheck.error) {
  console.error(`book_content_live is not ready: ${tableCheck.error.message}`);
  console.error("Apply supabase/jju_book_content_live_schema.sql first, then run this script again.");
  process.exit(1);
}

let uploaded = 0;
let skipped = 0;

for (const item of entries) {
  const raw = JSON.parse(readFileSync(item.localPath, "utf8"));
  const content = normalizeContent(raw, item);
  const existing = await supabase
    .from("book_content_live")
    .select("book_id")
    .eq("book_id", item.bookId)
    .limit(1);

  if (existing.error) throw new Error(`Could not check ${item.bookId}: ${existing.error.message}`);
  if (existing.data?.length) {
    skipped += 1;
    continue;
  }

  const result = await supabase.from("book_content_live").insert({
    book_id: item.bookId,
    version_number: 1,
    title: content.title,
    creator: content.creator || "James Johnson",
    description: content.description || "",
    content_file: item.fileName,
    content_path: `public/book-content/${item.fileName}`,
    section_count: Number(content.sectionCount || content.sections.length || 0),
    word_count: Number(content.wordCount || 0),
    content,
    edit_message: "Initial backfill from public/book-content JSON",
  });

  if (result.error) throw new Error(`Could not backfill ${item.bookId}: ${result.error.message}`);
  uploaded += 1;
  if (uploaded % 25 === 0) console.log(`Uploaded ${uploaded}...`);
}

console.log(`Done. Uploaded ${uploaded}; skipped existing ${skipped}.`);

function normalizeContent(raw, item) {
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const catalogBook = item.catalogBook || {};
  const normalizedSections = sections
    .map((section, index) => {
      const html = sanitizeBookHtml(String(section.html || ""));
      const text = String(section.text || textFromHtml(html));
      return {
        ...section,
        id: String(section.id || `section-${String(index + 1).padStart(3, "0")}`),
        index: Number.isFinite(Number(section.index)) ? Number(section.index) : index,
        title: String(section.title || `Section ${index + 1}`).trim(),
        kind: String(section.kind || "default").trim().toLowerCase(),
        html,
        text,
        wordCount: Number.isFinite(Number(section.wordCount)) ? Number(section.wordCount) : wordCount(text),
      };
    })
    .sort((a, b) => a.index - b.index);
  const totalWords = normalizedSections.reduce((sum, section) => sum + Number(section.wordCount || 0), 0);

  return {
    ...raw,
    id: item.bookId,
    slug: String(catalogBook.slug || raw.slug || item.entry.slug || item.bookId),
    sourceFile: String(raw.sourceFile || item.entry.sourceFile || ""),
    title: String(catalogBook.title || raw.title || item.entry.title || item.bookId).trim(),
    creator: String(raw.creator || catalogBook.creator || catalogBook.author || "James Johnson").trim(),
    description: String(catalogBook.description || raw.description || "").trim(),
    generatedAt: raw.generatedAt || new Date().toISOString(),
    sectionCount: normalizedSections.length,
    wordCount: totalWords,
    sections: normalizedSections,
  };
}

function sanitizeBookHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(object|embed|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son[a-z]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, "")
    .replace(/\s(href|src)=["']\s*data:text\/html[^"']*["']/gi, "");
}

function textFromHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function fileStem(value) {
  return value.replace(/\.(epub|json)$/i, "").toLowerCase();
}

function getArgValue(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function loadLocalEnv(fileName) {
  const filePath = join(root, fileName);
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
