import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { AdminVersionConflictError } from "@/lib/adminVersionedJson";

export type CatalogBook = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  creator: string;
  author: string;
  series: string;
  tags: string[];
  description: string;
  status: string;
  visibility: string;
  archive: boolean;
  category: string;
  archiveCategory: string;
  primaryCategory: string;
  coverFile: string;
  bookFile: string;
  contentKey: string;
  wordCount: number;
  readingMinutes: number;
  readingLabel: string;
  chapterCount: number;
  slugAliases: string[];
  similar: string[];
  hiddenShelves: string[];
  hiddenCategories: string[];
};

type CatalogRow = {
  id: string;
  slug?: string | null;
  title?: string | null;
  subtitle?: string | null;
  creator?: string | null;
  description?: string | null;
  status?: string | null;
  visibility?: string | null;
  archive_category?: string | null;
  primary_category?: string | null;
  cover_file?: string | null;
  book_file?: string | null;
  content_key?: string | null;
  word_count?: number | null;
  reading_minutes?: number | null;
  reading_label?: string | null;
  chapter_count?: number | null;
  tags?: string[] | null;
  slug_aliases?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

const CATALOG_SELECT = "id,slug,title,subtitle,creator,description,status,visibility,archive_category,primary_category,cover_file,book_file,content_key,word_count,reading_minutes,reading_label,chapter_count,tags,slug_aliases,metadata";

export function slugifyCatalogValue(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isMissingSupabaseCatalogTable(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");
  return code === "42P01"
    || code === "PGRST205"
    || /relation .*book_catalog.* does not exist/i.test(message)
    || /could not find .*book_catalog/i.test(message);
}

export function catalogRowToBook(row: CatalogRow): CatalogBook {
  const metadata = row.metadata || {};
  const visibility = String(row.visibility || "main");
  const archiveCategory = String(row.archive_category || "");

  return {
    id: row.id,
    slug: String(row.slug || slugifyCatalogValue(row.title || row.id)),
    title: String(row.title || row.id || "Untitled"),
    subtitle: String(row.subtitle || ""),
    creator: String(row.creator || "James Johnson"),
    author: String(row.creator || "James Johnson"),
    series: String(metadata.series || ""),
    tags: Array.isArray(row.tags) ? row.tags : [],
    description: String(row.description || ""),
    status: String(row.status || "ready"),
    visibility,
    archive: visibility === "archive",
    category: archiveCategory,
    archiveCategory,
    primaryCategory: String(row.primary_category || "Library"),
    coverFile: String(row.cover_file || ""),
    bookFile: String(row.book_file || ""),
    contentKey: String(row.content_key || ""),
    wordCount: Number(row.word_count || 0),
    readingMinutes: Number(row.reading_minutes || 0),
    readingLabel: String(row.reading_label || ""),
    chapterCount: Number(row.chapter_count || 0),
    slugAliases: Array.isArray(row.slug_aliases) ? row.slug_aliases : [],
    similar: Array.isArray(metadata.similar) ? metadata.similar.map(String) : [],
    hiddenShelves: Array.isArray(metadata.hiddenShelves) ? metadata.hiddenShelves.map(String) : [],
    hiddenCategories: Array.isArray(metadata.hiddenCategories) ? metadata.hiddenCategories.map(String) : [],
  };
}

export function bookToCatalogRow(book: Record<string, unknown>) {
  const id = String(book.id || "").trim().toLowerCase();
  const title = String(book.title || id || "Untitled").trim();
  const tags = Array.isArray(book.tags) ? book.tags.map(tag => String(tag)).filter(Boolean) : [];
  const visibility = book.archive || String(book.visibility || "main").toLowerCase() === "archive" ? "archive" : "main";
  const slug = slugifyCatalogValue(String(book.slug || title || id));
  const slugAliases = [
    id,
    slugifyCatalogValue(String(book.title || "")),
    ...(Array.isArray(book.slugAliases) ? book.slugAliases.map(alias => slugifyCatalogValue(String(alias))) : []),
  ].filter(alias => alias && alias !== slug);

  return {
    id,
    slug,
    title,
    subtitle: String(book.subtitle || "").trim(),
    creator: String(book.creator || book.author || "James Johnson").trim(),
    description: String(book.description || "").trim(),
    status: String(book.status || "ready").trim().toLowerCase(),
    visibility,
    archive_category: String(book.archiveCategory || book.category || "").trim(),
    primary_category: String(book.primaryCategory || book.category || "Library").trim() || "Library",
    cover_file: String(book.coverFile || "").trim(),
    book_file: String(book.bookFile || "").trim(),
    content_key: String(book.contentKey || "").trim(),
    word_count: Number(book.wordCount || 0),
    reading_minutes: Number(book.readingMinutes || 0),
    reading_label: String(book.readingLabel || "").trim(),
    chapter_count: Number(book.chapterCount || 0),
    tags,
    slug_aliases: [...new Set(slugAliases)],
    metadata: {
      series: String(book.series || "").trim(),
      similar: Array.isArray(book.similar) ? book.similar.map(item => String(item).trim().toLowerCase()).filter(Boolean) : [],
      hiddenShelves: Array.isArray(book.hiddenShelves) ? book.hiddenShelves.map(String).filter(Boolean) : [],
      hiddenCategories: Array.isArray(book.hiddenCategories) ? book.hiddenCategories.map(String).filter(Boolean) : [],
    },
  };
}

export async function readBooksFromSupabase() {
  const snapshot = await readBookCatalogSnapshot();
  return snapshot?.books ?? null;
}

function isMissingRevisionTable(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");
  return code === "42P01"
    || code === "PGRST205"
    || /relation .*jju_admin_document_revisions.* does not exist/i.test(message)
    || /could not find .*jju_admin_document_revisions/i.test(message);
}

function isMissingAdminCatalogRpc(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");
  return code === "42883"
    || code === "PGRST202"
    || /jju_admin_(save_book_catalog|create_book_draft)/i.test(message) && /not find|does not exist/i.test(message);
}

export async function readBookCatalogSnapshot() {
  if (!hasSupabaseAdminConfig()) return null;

  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("book_catalog")
    .select(CATALOG_SELECT)
    .order("title", { ascending: true });

  if (result.error) {
    if (isMissingSupabaseCatalogTable(result.error)) return null;
    throw new Error(result.error.message);
  }

  const books = (result.data || []).map(row => catalogRowToBook(row as CatalogRow));
  const revisionResult = await supabase
    .from("jju_admin_document_revisions")
    .select("revision")
    .eq("document_key", "book_catalog")
    .limit(1);
  if (revisionResult.error) {
    if (isMissingRevisionTable(revisionResult.error)) return { books, revision: null as string | null };
    throw new Error(revisionResult.error.message);
  }
  const revision = String(revisionResult.data?.[0]?.revision || "").trim() || null;
  return { books, revision };
}

export async function saveBooksToSupabase(
  books: Array<Record<string, unknown>>,
  options: { expectedRevision: string | null },
) {
  if (!hasSupabaseAdminConfig()) return { saved: false };

  const supabase = createSupabaseAdminClient();
  const rows = books.map(bookToCatalogRow);
  if (!options.expectedRevision) {
    return {
      saved: false,
      setupRequired: true,
      error: "Supabase catalog editing is locked until supabase/jju_admin_catalog_cas_2026_08_21.sql is applied.",
    };
  }
  const atomicResult = await supabase.rpc("jju_admin_save_book_catalog", {
    p_expected_revision: options.expectedRevision,
    p_books: rows,
  });
  if (atomicResult.error) {
    if (String(atomicResult.error.code || "") === "40001") throw new AdminVersionConflictError();
    return {
      saved: false,
      setupRequired: isMissingAdminCatalogRpc(atomicResult.error),
      error: isMissingAdminCatalogRpc(atomicResult.error)
        ? "Supabase catalog editing is locked until supabase/jju_admin_catalog_cas_2026_08_21.sql is applied."
        : atomicResult.error.message,
    };
  }
  const revision = String(atomicResult.data || "").trim();
  if (!revision) return { saved: false, error: "Atomic Supabase catalog save returned no revision." };
  return { saved: true, books: rows.map(row => catalogRowToBook(row)), revision };
}

export async function createBookDraftInSupabase({
  book,
  content,
  fileName,
  publicPath,
  message,
  expectedRevision,
}: {
  book: Record<string, unknown>;
  content: Record<string, unknown>;
  fileName: string;
  publicPath: string;
  message: string;
  expectedRevision: string | null;
}) {
  if (!hasSupabaseAdminConfig()) return { saved: false };
  if (!expectedRevision) {
    return {
      saved: false,
      setupRequired: true,
      error: "Supabase draft creation is locked until supabase/jju_admin_catalog_cas_2026_08_21.sql is applied.",
    };
  }
  const supabase = createSupabaseAdminClient();
  const result = await supabase.rpc("jju_admin_create_book_draft", {
    p_expected_revision: expectedRevision,
    p_book: bookToCatalogRow(book),
    p_content: content,
    p_content_file: fileName,
    p_content_path: publicPath,
    p_message: message,
  });
  if (result.error) {
    if (String(result.error.code || "") === "40001") throw new AdminVersionConflictError();
    return {
      saved: false,
      setupRequired: isMissingAdminCatalogRpc(result.error),
      error: isMissingAdminCatalogRpc(result.error)
        ? "Supabase draft creation is locked until supabase/jju_admin_catalog_cas_2026_08_21.sql is applied."
        : result.error.message,
    };
  }
  const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
  const revision = String(data.revision || "").trim();
  const contentVersion = Number(data.contentVersion || 0);
  if (!revision || !contentVersion) return { saved: false, error: "Atomic Supabase draft creation returned an invalid result." };
  return { saved: true, revision, contentVersion };
}
