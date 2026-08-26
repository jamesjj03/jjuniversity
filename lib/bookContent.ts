import "server-only";

import { readFile } from "fs/promises";
import path from "path";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { AdminVersionConflictError } from "@/lib/adminVersionedJson";

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
  source?: "supabase" | "file";
};

type SupabaseBookContentRow = {
  book_id: string;
  version_number?: number | null;
  title?: string | null;
  content_file?: string | null;
  content_path?: string | null;
  content?: unknown;
};

type SaveSupabaseBookContentResult = {
  saved: boolean;
  versionNumber?: number;
  tableMissing?: boolean;
  error?: string;
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

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function isMissingSupabaseTable(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");
  return code === "42P01"
    || code === "PGRST205"
    || /relation .*book_content_live.* does not exist/i.test(message)
    || /could not find .*book_content_live/i.test(message);
}

function bookContentPath(fileName: string) {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "private", "book-content", fileName);
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

  const wanted = `${id}.json`;
  const manifestPath = bookContentPath("manifest.json");
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
    absolutePath: bookContentPath(fileName),
    publicPath: `private/book-content/${fileName}`,
  };
}

export async function readBookContent(idOrFile: string): Promise<ResolvedBookContent> {
  const live = await readSupabaseBookContent(idOrFile);
  if (live) return live;

  return readFileBookContent(idOrFile);
}

export async function readFileBookContent(idOrFile: string): Promise<ResolvedBookContent> {

  const resolved = await resolveBookContentFile(idOrFile);
  const raw = JSON.parse(await readFile(bookContentPath(resolved.fileName), "utf8"));
  const fallbackId = resolved.fileName.replace(/\.json$/i, "");

  return {
    ...resolved,
    book: normalizeBookContent(raw, fallbackId),
    source: "file",
  };
}

export async function listLiveBookContentIds() {
  if (!hasSupabaseAdminConfig()) return null;

  try {
    const supabase = createSupabaseAdminClient();
    const result = await supabase
      .from("book_content_live")
      .select("book_id,content_file");

    if (result.error) {
      if (isMissingSupabaseTable(result.error)) return null;
      throw new Error(result.error.message);
    }

    const ids = new Set<string>();
    for (const row of result.data || []) {
      const bookId = String(row.book_id || "").trim().toLowerCase();
      const contentFile = fileStem(String(row.content_file || "")).trim().toLowerCase();
      if (bookId) ids.add(bookId);
      if (contentFile) ids.add(contentFile);
    }
    return ids;
  } catch {
    return null;
  }
}

async function readSupabaseBookContent(idOrFile: string): Promise<ResolvedBookContent | null> {
  if (!hasSupabaseAdminConfig()) return null;

  const id = normalizeId(decodeURIComponent(idOrFile));
  if (!id) return null;

  try {
    const supabase = createSupabaseAdminClient();
    const idCandidates = uniqueStrings([id, fileStem(id)]);
    const fileCandidates = uniqueStrings([id, `${id}.json`, `${fileStem(id)}.json`]);
    const select = "book_id,version_number,title,content_file,content_path,content";
    const byId = await supabase
      .from("book_content_live")
      .select(select)
      .in("book_id", idCandidates)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (byId.error) {
      if (isMissingSupabaseTable(byId.error)) return null;
      return null;
    }

    let row = (byId.data?.[0] || null) as SupabaseBookContentRow | null;
    if (!row) {
      const byFile = await supabase
        .from("book_content_live")
        .select(select)
        .in("content_file", fileCandidates)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (byFile.error) {
        if (isMissingSupabaseTable(byFile.error)) return null;
        return null;
      }
      row = (byFile.data?.[0] || null) as SupabaseBookContentRow | null;
    }

    if (!row?.content) return null;

    const fileName = String(row.content_file || `${row.book_id}.json`);
    return {
      book: normalizeBookContent(row.content, row.book_id),
      fileName,
      absolutePath: bookContentPath(fileName),
      publicPath: `private/book-content/${fileName}`,
      source: "supabase",
    };
  } catch {
    return null;
  }
}

export async function saveLiveBookContentToSupabase({
  book,
  fileName,
  publicPath,
  message,
  expectedVersion,
}: {
  book: BookContent;
  fileName: string;
  publicPath: string;
  message: string;
  expectedVersion?: string;
}): Promise<SaveSupabaseBookContentResult> {
  if (!hasSupabaseAdminConfig()) return { saved: false };

  try {
    const versionMatch = /^supabase:(\d+)$/.exec(String(expectedVersion || "").trim());
    if (!versionMatch) {
      return {
        saved: false,
        error: "Live manuscript saving is locked because no exact Supabase version was supplied.",
      };
    }

    const supabase = createSupabaseAdminClient();
    const result = await supabase.rpc("jju_admin_save_book_content", {
      p_expected_version: Number(versionMatch[1]),
      p_book_id: book.id,
      p_content: book,
      p_content_file: fileName,
      p_content_path: publicPath,
      p_message: message,
    });

    if (result.error) {
      if (String(result.error.code || "") === "40001") throw new AdminVersionConflictError();
      const missingRpc = String(result.error.code || "") === "42883"
        || String(result.error.code || "") === "PGRST202";
      return {
        saved: false,
        tableMissing: missingRpc,
        error: missingRpc
          ? "Live manuscript saving is locked until the final Workshop security migration is applied."
          : result.error.message,
      };
    }

    const versionNumber = Number(result.data);
    if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
      return { saved: false, error: "Atomic manuscript save returned no trustworthy version." };
    }
    return { saved: true, versionNumber };
  } catch (error) {
    if (error instanceof AdminVersionConflictError) throw error;
    return { saved: false, error: error instanceof Error ? error.message : "Supabase content save failed." };
  }
}

export function prepareBookContentForSave(book: BookContent): BookContent {
  if (!Array.isArray(book.sections) || book.sections.length === 0) {
    throw new Error("A manuscript must keep at least one section.");
  }
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
