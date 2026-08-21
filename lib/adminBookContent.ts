import path from "path";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import {
  normalizeBookContent,
  type ResolvedBookContent,
} from "@/lib/bookContent";
import {
  readGithubJson,
  readLocalJson,
} from "@/lib/adminVersionedJson";

type ManifestBook = {
  id?: string;
  slug?: string;
  sourceFile?: string;
  path?: string;
};

type ContentRow = {
  book_id?: string | null;
  version_number?: number | null;
  content_file?: string | null;
  content_path?: string | null;
  content?: unknown;
};

export type AdminResolvedBookContent = Omit<ResolvedBookContent, "source"> & {
  source: "supabase" | "github" | "local";
  version: string;
  writeVersion: string;
  manifestVersion?: string;
  supabaseAvailable: boolean;
};

function normalizeId(value: string) {
  return decodeURIComponent(value).trim().replace(/\.json$/i, "");
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

function assertEditableBookContent(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not a valid book-content document.`);
  }
  const record = value as Record<string, unknown>;
  if (!String(record.id || "").trim() || !String(record.title || "").trim()) {
    throw new Error(`${label} is missing its book id or title.`);
  }
  if (!Array.isArray(record.sections) || record.sections.length === 0) {
    throw new Error(`${label} has no editable sections.`);
  }
  const ids = new Set<string>();
  for (const rawSection of record.sections) {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) {
      throw new Error(`${label} contains a malformed section.`);
    }
    const section = rawSection as Record<string, unknown>;
    const id = String(section.id || "").trim();
    if (!id || typeof section.html !== "string") {
      throw new Error(`${label} contains a section without an id or HTML body.`);
    }
    if (ids.has(id)) throw new Error(`${label} contains duplicate section id "${id}".`);
    ids.add(id);
  }
}

function manifestRecord(value: unknown, id: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Book-content manifest is malformed.");
  }
  const books = (value as { books?: unknown }).books;
  if (!Array.isArray(books) || books.length === 0) {
    throw new Error("Book-content manifest has no books.");
  }
  const wanted = fileStem(id);
  const record = books.find(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const item = raw as ManifestBook;
    const manifestFile = path.basename(String(item.path || ""));
    return fileStem(manifestFile) === wanted
      || fileStem(String(item.id || "")) === wanted
      || fileStem(String(item.slug || "")) === wanted
      || fileStem(String(item.sourceFile || "")) === wanted;
  }) as ManifestBook | undefined;
  const manifestPath = String(record?.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!manifestPath) throw new Error(`Book content unavailable for "${id}".`);
  const fileName = path.basename(manifestPath);
  return {
    fileName,
    publicPath: manifestPath.startsWith("public/") ? manifestPath : `public/${manifestPath}`,
  };
}

async function readSupabaseContent(id: string) {
  if (!hasSupabaseAdminConfig()) return { resolved: null, available: false };
  const supabase = createSupabaseAdminClient();
  const select = "book_id,version_number,content_file,content_path,content";
  const idCandidates = uniqueStrings([id, fileStem(id)]);
  const fileCandidates = uniqueStrings([id, `${id}.json`, `${fileStem(id)}.json`]);
  const byId = await supabase
    .from("book_content_live")
    .select(select)
    .in("book_id", idCandidates)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (byId.error) {
    if (isMissingSupabaseTable(byId.error)) return { resolved: null, available: false };
    throw new Error(`Could not read live manuscript data: ${byId.error.message}`);
  }

  let row = (byId.data?.[0] || null) as ContentRow | null;
  if (!row) {
    const byFile = await supabase
      .from("book_content_live")
      .select(select)
      .in("content_file", fileCandidates)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (byFile.error) {
      if (isMissingSupabaseTable(byFile.error)) return { resolved: null, available: false };
      throw new Error(`Could not read live manuscript data: ${byFile.error.message}`);
    }
    row = (byFile.data?.[0] || null) as ContentRow | null;
  }

  if (!row) return { resolved: null, available: true };
  if (!row.content) throw new Error(`Live manuscript data for "${id}" has no content document.`);
  assertEditableBookContent(row.content, `Live manuscript data for "${id}"`);
  const bookId = String(row.book_id || id);
  const fileName = String(row.content_file || `${bookId}.json`);
  const version = `supabase:${Math.max(0, Number(row.version_number || 0))}`;
  const resolved: AdminResolvedBookContent = {
    book: normalizeBookContent(row.content, bookId),
    fileName,
    absolutePath: path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "book-content", fileName),
    publicPath: String(row.content_path || `public/book-content/${fileName}`).replace(/\\/g, "/"),
    source: "supabase",
    version,
    writeVersion: version,
    supabaseAvailable: true,
  };
  return { resolved, available: true };
}

export async function readAdminBookContent(idOrFile: string): Promise<AdminResolvedBookContent> {
  const id = normalizeId(idOrFile);
  if (!id) throw new Error("No book content id provided.");

  const live = await readSupabaseContent(id);
  if (live.resolved) return live.resolved;

  const githubManifest = await readGithubJson("public/book-content/manifest.json");
  if (githubManifest) {
    const resolvedPath = manifestRecord(githubManifest.value, id);
    const githubContent = await readGithubJson(resolvedPath.publicPath);
    if (!githubContent) throw new Error("GitHub manuscript content is not configured.");
    assertEditableBookContent(githubContent.value, `GitHub manuscript ${resolvedPath.publicPath}`);
    const version = `${githubManifest.version}|${githubContent.version}`;
    return {
      book: normalizeBookContent(githubContent.value, fileStem(resolvedPath.fileName)),
      fileName: resolvedPath.fileName,
      absolutePath: path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "book-content", resolvedPath.fileName),
      publicPath: resolvedPath.publicPath,
      source: "github",
      version,
      writeVersion: githubContent.version,
      manifestVersion: githubManifest.version,
      supabaseAvailable: live.available,
    };
  }

  const manifestPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "book-content", "manifest.json");
  const localManifest = await readLocalJson(manifestPath);
  const resolvedPath = manifestRecord(localManifest.value, id);
  const absolutePath = path.join(/*turbopackIgnore: true*/ process.cwd(), resolvedPath.publicPath);
  const localContent = await readLocalJson(absolutePath);
  assertEditableBookContent(localContent.value, `Local manuscript ${resolvedPath.publicPath}`);
  const version = `${localManifest.version}|${localContent.version}`;
  return {
    book: normalizeBookContent(localContent.value, fileStem(resolvedPath.fileName)),
    fileName: resolvedPath.fileName,
    absolutePath,
    publicPath: resolvedPath.publicPath,
    source: "local",
    version,
    writeVersion: localContent.version,
    manifestVersion: localManifest.version,
    supabaseAvailable: live.available,
  };
}

export function versionAfterContentWrite(current: AdminResolvedBookContent, nextWriteVersion: string) {
  if (current.source === "supabase") return nextWriteVersion;
  if (!current.manifestVersion) {
    return nextWriteVersion;
  }
  return `${current.manifestVersion}|${nextWriteVersion}`;
}
