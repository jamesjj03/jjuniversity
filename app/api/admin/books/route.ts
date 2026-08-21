import { writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { readBookCatalogSnapshot, saveBooksToSupabase } from "@/lib/bookCatalog";
import {
  adminErrorResponse,
  assertAdminVersion,
  expectedAdminVersion,
  readGithubJson,
  readLocalJson,
  versionedJson,
  versionForBookCatalog,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";

type SaveBody = {
  books?: unknown;
  message?: string;
};

function assertBooks(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Expected a books array.");
  if (!value.length) throw new Error("Refusing to load or save an empty JJU catalog.");

  const seen = new Set<string>();
  return value.map((book, index) => {
    if (!book || typeof book !== "object") throw new Error(`Book ${index + 1} is not valid.`);
    const record = book as Record<string, unknown>;
    const id = String(record.id || "").trim().toLowerCase();
    const title = String(record.title || id || "Untitled").trim();
    if (!id) throw new Error(`Book ${index + 1} is missing an id.`);
    if (seen.has(id)) throw new Error(`Duplicate book id: ${id}.`);
    seen.add(id);
    delete record.goldCandidate;
    delete record.gold;

    return {
      ...record,
      id,
      title,
      tags: Array.isArray(record.tags) ? record.tags.map(tag => String(tag)).filter(Boolean).sort() : [],
      hiddenShelves: Array.isArray(record.hiddenShelves) ? record.hiddenShelves.map(item => String(item)).filter(Boolean).sort() : [],
      hiddenCategories: Array.isArray(record.hiddenCategories) ? record.hiddenCategories.map(item => String(item)).filter(Boolean).sort() : [],
      status: String(record.status || "ready").trim().toLowerCase(),
      visibility: record.archive || String(record.visibility || "main").trim().toLowerCase() === "archive" ? "archive" : "main",
      archive: Boolean(record.archive || String(record.visibility || "main").trim().toLowerCase() === "archive"),
      category: String(record.archiveCategory || record.category || "").trim(),
      archiveCategory: String(record.archiveCategory || record.category || "").trim(),
    };
  });
}

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
  books.forEach((book, index) => {
    const id = book && typeof book === "object" ? String((book as Record<string, unknown>).id || "").trim().toLowerCase() : "";
    if (!id) {
      throw new Error(`Book ${index + 1} is missing a valid id.`);
    }
    if (ids.has(id)) throw new Error(`Books source contains duplicate id: ${id}.`);
    ids.add(id);
  });
  return books;
}

function supabaseCatalogVersion(books: unknown[], revision: string | null) {
  return versionForBookCatalog(books, revision ? `supabase-catalog:${revision}` : "supabase-unversioned");
}

export async function GET() {
  try {
    const booksPath = path.join(process.cwd(), "public", "books.json");
    const local = await readLocalJson(booksPath);
    const baselineBooks = rawBooks(local.value);
    const supabaseSnapshot = await readBookCatalogSnapshot();
    if (supabaseSnapshot !== null) {
      const books = rawBooks(supabaseSnapshot.books, baselineBooks.length);
      return versionedJson({ books, source: "supabase" }, supabaseCatalogVersion(books, supabaseSnapshot.revision));
    }

    const github = await readGithubJson("public/books.json");
    if (github) return versionedJson({ books: rawBooks(github.value, baselineBooks.length), source: "github" }, github.version);

    return versionedJson({ books: baselineBooks, source: "file" }, local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load books.json.");
  }
}

export async function POST(request: Request) {
  try {
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({})) as SaveBody;
    const books = assertBooks(body.books);
    const content = `${JSON.stringify(books, null, 2)}\n`;
    const booksPath = path.join(process.cwd(), "public", "books.json");
    const message = body.message || `Update JJU library metadata (${new Date().toISOString().slice(0, 10)})`;
    const currentSupabase = await readBookCatalogSnapshot();

    if (currentSupabase !== null) {
      const currentBooks = rawBooks(currentSupabase.books);
      if (books.length < currentBooks.length) throw new Error("Refusing to replace the current catalog with a truncated book list.");
      assertAdminVersion(expectedVersion, supabaseCatalogVersion(currentBooks, currentSupabase.revision));
      const supabaseSave = await saveBooksToSupabase(books, { expectedRevision: currentSupabase.revision });
      if (!supabaseSave.saved) throw new Error(supabaseSave.error || "Supabase did not save the catalog.");
      revalidatePath("/library");
      revalidatePath("/sitemap.xml");

      const savedBooks = supabaseSave.books || books;
      return versionedJson({
        saved: true,
        target: "supabase",
        books: savedBooks,
        note: "Saved library metadata to Supabase.",
      }, supabaseCatalogVersion(savedBooks, supabaseSave.revision || null));
    }

    const currentGithub = await readGithubJson("public/books.json");
    if (currentGithub) {
      const currentBooks = rawBooks(currentGithub.value);
      if (books.length < currentBooks.length) throw new Error("Refusing to replace the current catalog with a truncated book list.");
      const github = await writeGithubJson("public/books.json", content, message, expectedVersion);
      if (!github) throw new Error("GitHub catalog saving is not configured.");
      try {
        await writeFile(booksPath, content, "utf8");
      } catch {
        // Deployment files may be read-only; GitHub is the canonical successful write.
      }
      return versionedJson({
        saved: true,
        target: "github",
        books,
        note: "Saved library metadata to GitHub.",
      }, github.version);
    }

    const currentLocal = await readLocalJson(booksPath);
    const currentBooks = rawBooks(currentLocal.value);
    if (books.length < currentBooks.length) throw new Error("Refusing to replace the current catalog with a truncated book list.");
    const local = await writeLocalJson(booksPath, content, expectedVersion);
    return versionedJson({
      saved: true,
      target: "local",
      books,
      note: "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    }, local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not save books.json.");
  }
}
