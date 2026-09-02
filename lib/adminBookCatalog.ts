import "server-only";

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import {
  readBookCatalogSnapshot,
  saveBooksToSupabase,
} from "@/lib/bookCatalog";
import {
  assertAdminVersion,
  readGithubJson,
  readLocalJson,
  versionForBookCatalog,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";

export type AdminCatalogSource = "supabase" | "github" | "file";

export type AdminBookCatalogSnapshot = {
  books: Array<Record<string, unknown>>;
  source: AdminCatalogSource;
  version: string;
};

export type AdminBookCatalogSave = {
  books: Array<Record<string, unknown>>;
  target: "supabase" | "github" | "local";
  note: string;
  version: string;
};

function rawBooks(value: unknown, minimumCount = 1) {
  const books = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { books?: unknown }).books)
      ? (value as { books: unknown[] }).books
      : null;
  if (!books?.length || books.length < minimumCount) {
    throw new Error(`Books source is malformed or incomplete (${books?.length || 0}/${minimumCount} expected).`);
  }

  const ids = new Set<string>();
  return books.map((book, index) => {
    if (!book || typeof book !== "object") throw new Error(`Book ${index + 1} is not valid.`);
    const record = book as Record<string, unknown>;
    const id = String(record.id || "").trim().toLowerCase();
    if (!id) throw new Error(`Book ${index + 1} is missing a valid id.`);
    if (ids.has(id)) throw new Error(`Books source contains duplicate id: ${id}.`);
    ids.add(id);
    return record;
  });
}

function catalogVersion(books: unknown[], revision: string | null) {
  return versionForBookCatalog(books, revision ? `supabase-catalog:${revision}` : "supabase-unversioned");
}

function assertCurrentBookIdsPreserved(
  currentBooks: Array<Record<string, unknown>>,
  nextBooks: Array<Record<string, unknown>>,
) {
  const nextIds = new Set(nextBooks.map(book => String(book.id || "").trim().toLowerCase()));
  const missingIds = currentBooks
    .map(book => String(book.id || "").trim().toLowerCase())
    .filter(id => id && !nextIds.has(id));
  if (missingIds.length) {
    const sample = missingIds.slice(0, 5).join(", ");
    const suffix = missingIds.length > 5 ? ` and ${missingIds.length - 5} more` : "";
    throw new Error(`Refusing to remove current catalog book ids: ${sample}${suffix}.`);
  }
}

export function cleanBooksForSave(value: unknown, options: { preserveRows?: boolean } = {}) {
  if (!Array.isArray(value)) throw new Error("Expected a books array.");
  if (!value.length) throw new Error("Refusing to load or save an empty JJU catalog.");

  const seen = new Set<string>();
  return value.map((book, index) => {
    if (!book || typeof book !== "object" || Array.isArray(book)) {
      throw new Error(`Book ${index + 1} is not a valid catalog row.`);
    }
    const record = book as Record<string, unknown>;
    const id = String(record.id || "").trim().toLowerCase();
    if (!id) throw new Error(`Book ${index + 1} is missing an id.`);
    if (seen.has(id)) throw new Error(`Duplicate book id: ${id}.`);
    seen.add(id);
    if (options.preserveRows) return { ...record };
    const clean = { ...record };
    delete clean.gold;
    delete clean.goldCandidate;
    const visibility = clean.archive || String(clean.visibility || "main").trim().toLowerCase() === "archive"
      ? "archive"
      : "main";
    const archiveCategory = String(clean.archiveCategory || clean.category || "").trim();
    return {
      ...clean,
      id,
      title: String(clean.title || id || "Untitled").trim(),
      tags: Array.isArray(clean.tags) ? clean.tags.map(tag => String(tag)).filter(Boolean).sort() : [],
      hiddenShelves: Array.isArray(clean.hiddenShelves) ? clean.hiddenShelves.map(item => String(item)).filter(Boolean).sort() : [],
      hiddenCategories: Array.isArray(clean.hiddenCategories) ? clean.hiddenCategories.map(item => String(item)).filter(Boolean).sort() : [],
      status: String(clean.status || "ready").trim().toLowerCase(),
      visibility,
      archive: visibility === "archive",
      category: archiveCategory,
      archiveCategory,
    };
  });
}

export async function readAdminBookCatalog(): Promise<AdminBookCatalogSnapshot> {
  const booksPath = path.join(process.cwd(), "private", "catalog", "books.json");
  const local = await readLocalJson(booksPath);
  const baselineBooks = rawBooks(local.value);
  const supabaseSnapshot = await readBookCatalogSnapshot();
  if (supabaseSnapshot !== null) {
    const books = rawBooks(supabaseSnapshot.books, baselineBooks.length);
    return {
      books,
      source: "supabase",
      version: catalogVersion(books, supabaseSnapshot.revision),
    };
  }

  const github = await readGithubJson("private/catalog/books.json");
  if (github) {
    return {
      books: rawBooks(github.value, baselineBooks.length),
      source: "github",
      version: github.version,
    };
  }

  return { books: baselineBooks, source: "file", version: local.version };
}

export async function saveAdminBookCatalog(
  value: unknown,
  expectedVersion: string,
  message: string,
  options: { preserveRows?: boolean } = {},
): Promise<AdminBookCatalogSave> {
  const books = cleanBooksForSave(value, options);
  const content = `${JSON.stringify(books, null, 2)}\n`;
  const booksPath = path.join(process.cwd(), "private", "catalog", "books.json");
  const currentSupabase = await readBookCatalogSnapshot();

  if (currentSupabase !== null) {
    const currentBooks = rawBooks(currentSupabase.books);
    assertAdminVersion(expectedVersion, catalogVersion(currentBooks, currentSupabase.revision));
    if (books.length < currentBooks.length) throw new Error("Refusing to replace the current catalog with a truncated book list.");
    assertCurrentBookIdsPreserved(currentBooks, books);
    const supabaseSave = await saveBooksToSupabase(books, { expectedRevision: currentSupabase.revision });
    if (!supabaseSave.saved) throw new Error(supabaseSave.error || "Supabase did not save the catalog.");
    const savedBooks = (supabaseSave.books || books) as Array<Record<string, unknown>>;
    return {
      books: savedBooks,
      target: "supabase",
      note: "Saved library metadata to Supabase.",
      version: catalogVersion(savedBooks, supabaseSave.revision || null),
    };
  }

  const currentGithub = await readGithubJson("private/catalog/books.json");
  if (currentGithub) {
    const currentBooks = rawBooks(currentGithub.value);
    assertAdminVersion(expectedVersion, currentGithub.version);
    if (books.length < currentBooks.length) throw new Error("Refusing to replace the current catalog with a truncated book list.");
    assertCurrentBookIdsPreserved(currentBooks, books);
    const github = await writeGithubJson("private/catalog/books.json", content, message, expectedVersion);
    if (!github) throw new Error("GitHub catalog saving is not configured.");
    try {
      await writeFile(booksPath, content, "utf8");
    } catch {
      // GitHub is the canonical successful write on read-only deployments.
    }
    return {
      books,
      target: "github",
      note: "Saved library metadata to GitHub.",
      version: github.version,
    };
  }

  const currentLocal = await readLocalJson(booksPath);
  const currentBooks = rawBooks(currentLocal.value);
  assertAdminVersion(expectedVersion, currentLocal.version);
  if (books.length < currentBooks.length) throw new Error("Refusing to replace the current catalog with a truncated book list.");
  assertCurrentBookIdsPreserved(currentBooks, books);
  const local = await writeLocalJson(booksPath, content, expectedVersion);
  return {
    books,
    target: "local",
    note: "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    version: local.version,
  };
}

export function revalidateWorkshopBookCatalog(bookId?: string) {
  // A Workshop save changes the private editorial source, not the public
  // edition. Public pages and the sitemap move only with a reviewed edition
  // build and deployment.
  revalidatePath("/admin");
  revalidatePath("/admin/books");
  revalidatePath("/admin/books/[id]", "page");
  revalidatePath("/admin/books/[id]/publication", "page");
  if (bookId) revalidatePath(`/admin/books/${encodeURIComponent(bookId)}`);
}
