import { readFile } from "fs/promises";
import path from "path";

export type BookContentSection = {
  id: string;
  index: number;
  title: string;
  kind?: string;
  href?: string;
  html: string;
  text?: string;
  wordCount?: number;
};

export type BookContent = {
  id: string;
  slug?: string;
  sourceFile?: string;
  title: string;
  creator?: string;
  description?: string;
  language?: string;
  publisher?: string;
  generatedAt?: string;
  sectionCount?: number;
  wordCount?: number;
  sections: BookContentSection[];
};

export type ResolvedBookContent = {
  book: BookContent;
  fileName: string;
  absolutePath: string;
  publicPath: string;
};

function normalizeId(value: string) {
  return value.trim().replace(/\.json$/i, "");
}

function fallbackTitle(id: string) {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function fileStem(value: string) {
  return value.replace(/\.json$/i, "").replace(/\.epub$/i, "").toLowerCase();
}

export function textFromHtml(html: string) {
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

export function sanitizeBookHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(object|embed|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son[a-z]+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, "")
    .replace(/\s(href|src)=["']\s*data:text\/html[^"']*["']/gi, "");
}

export function wordCount(text: string) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function normalizeBookContent(value: unknown, fallbackId: string): BookContent {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = String(record.id || fallbackId).trim() || fallbackId;
  const rawSections = Array.isArray(record.sections) ? record.sections : [];
  const sections = rawSections
    .map((section, index): BookContentSection => {
      const item = section && typeof section === "object" ? section as Record<string, unknown> : {};
      const html = sanitizeBookHtml(String(item.html || ""));
      const text = String(item.text || textFromHtml(html));

      return {
        id: String(item.id || `section-${String(index + 1).padStart(3, "0")}`),
        index: Number.isFinite(Number(item.index)) ? Number(item.index) : index,
        title: String(item.title || `Section ${index + 1}`).trim(),
        kind: String(item.kind || "default").trim().toLowerCase(),
        href: item.href ? String(item.href) : undefined,
        html,
        text,
        wordCount: Number.isFinite(Number(item.wordCount)) ? Number(item.wordCount) : wordCount(text),
      };
    })
    .sort((a, b) => a.index - b.index);

  const totalWords = sections.reduce((sum, section) => sum + (section.wordCount || 0), 0);

  return {
    id,
    slug: record.slug ? String(record.slug) : undefined,
    sourceFile: record.sourceFile ? String(record.sourceFile) : undefined,
    title: String(record.title || fallbackTitle(id)).trim(),
    creator: record.creator ? String(record.creator) : undefined,
    description: record.description ? String(record.description) : "",
    language: record.language ? String(record.language) : undefined,
    publisher: record.publisher ? String(record.publisher) : undefined,
    generatedAt: record.generatedAt ? String(record.generatedAt) : undefined,
    sectionCount: sections.length,
    wordCount: totalWords,
    sections,
  };
}

export async function resolveBookContentFile(idOrFile: string): Promise<{ fileName: string; absolutePath: string; publicPath: string }> {
  const id = normalizeId(decodeURIComponent(idOrFile));
  if (!id) throw new Error("No book content id provided.");

  const contentDir = path.join(process.cwd(), "public", "book-content");
  const wanted = `${id}.json`;
  const manifestPath = path.join(contentDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    books?: Array<{ id?: string; slug?: string; sourceFile?: string; path?: string }>;
  };
  const record = (manifest.books || []).find(item => {
    const manifestFile = path.basename(String(item.path || ""));
    return manifestFile.toLowerCase() === wanted.toLowerCase()
      || fileStem(String(item.id || "")) === fileStem(id)
      || fileStem(String(item.slug || "")) === fileStem(id)
      || fileStem(String(item.sourceFile || "")) === fileStem(id);
  });
  const fileName = record?.path ? path.basename(record.path) : "";

  if (!fileName) throw new Error(`Book content unavailable for "${id}".`);

  return {
    fileName,
    absolutePath: path.join(contentDir, fileName),
    publicPath: `public/book-content/${fileName}`,
  };
}

export async function readBookContent(idOrFile: string): Promise<ResolvedBookContent> {
  const resolved = await resolveBookContentFile(idOrFile);
  const raw = JSON.parse(await readFile(resolved.absolutePath, "utf8"));
  const fallbackId = resolved.fileName.replace(/\.json$/i, "");

  return {
    ...resolved,
    book: normalizeBookContent(raw, fallbackId),
  };
}

export function prepareBookContentForSave(book: BookContent): BookContent {
  const sections = [...book.sections]
    .sort((a, b) => a.index - b.index)
    .map((section, index) => {
      const html = sanitizeBookHtml(String(section.html || ""));
      const text = String(section.text || textFromHtml(html));

      return {
        ...section,
        id: String(section.id || `section-${String(index + 1).padStart(3, "0")}`),
        index,
        title: String(section.title || `Section ${index + 1}`).trim(),
        kind: String(section.kind || "default").trim().toLowerCase(),
        html,
        text,
        wordCount: wordCount(text),
      };
    });

  return {
    ...book,
    title: String(book.title || book.id || "Untitled").trim(),
    creator: book.creator ? String(book.creator).trim() : "",
    description: book.description ? String(book.description).trim() : "",
    generatedAt: new Date().toISOString(),
    sectionCount: sections.length,
    wordCount: sections.reduce((sum, section) => sum + (section.wordCount || 0), 0),
    sections,
  };
}
