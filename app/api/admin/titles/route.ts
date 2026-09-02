import path from "path";
import { NextResponse } from "next/server";
import { readBookCatalogSnapshot, saveBooksToSupabase } from "@/lib/bookCatalog";
import { revalidateWorkshopBookCatalog } from "@/lib/adminBookCatalog";
import { readAdminBookContent } from "@/lib/adminBookContent";
import { readGithubJson, readLocalJson, writeGithubJson, writeLocalJson } from "@/lib/adminVersionedJson";

type BookRecord = {
  id: string;
  title?: string;
  bookFile?: string;
  epub?: string;
  file?: string;
};

function contentIdFor(book: BookRecord) {
  const fileStem = String(book.bookFile || book.epub || book.file || "").replace(/\.(epub|json)$/i, "");
  return fileStem || book.id;
}

async function readBooks() {
  const supabase = await readBookCatalogSnapshot();
  if (supabase) return { books: supabase.books as BookRecord[], source: "supabase" as const, revision: supabase.revision };

  const booksPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "private", "catalog", "books.json");
  const github = await readGithubJson("private/catalog/books.json");
  if (github) {
    const value = github.value as { books?: unknown };
    return { books: (Array.isArray(value) ? value : value.books || []) as BookRecord[], source: "github" as const, version: github.version };
  }
  const local = await readLocalJson(booksPath);
  const value = local.value as { books?: unknown };
  return { books: (Array.isArray(value) ? value : value.books || []) as BookRecord[], source: "file" as const, version: local.version };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const shouldUpdate = Boolean(body.update);
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map((id: unknown) => String(id).toLowerCase())) : null;
    const loaded = await readBooks();
    const { books, source } = loaded;
    if (!books.length) throw new Error("Catalog title scan is locked because its source is empty.");
    const targets = ids ? books.filter(book => ids.has(String(book.id).toLowerCase())) : books;
    const results = [];
    let target = "";

    for (const book of targets) {
      try {
        const { book: content } = await readAdminBookContent(contentIdFor(book));
        const title = content.title || book.title || book.id;
        const oldTitle = book.title || book.id;
        const changed = title.trim() !== oldTitle.trim();
        if (shouldUpdate && changed) book.title = title;
        results.push({ id: book.id, oldTitle, title, changed });
      } catch (error) {
        results.push({
          id: book.id,
          oldTitle: book.title || book.id,
          title: book.title || book.id,
          changed: false,
          error: error instanceof Error ? error.message : "Could not read book content.",
        });
      }
    }

    if (shouldUpdate) {
      const content = `${JSON.stringify(books, null, 2)}\n`;
      if (source === "supabase") {
        const supabaseSave = await saveBooksToSupabase(books as unknown as Array<Record<string, unknown>>, { expectedRevision: loaded.revision });
        if (!supabaseSave.saved) throw new Error(supabaseSave.error || "Supabase did not save the title updates.");
        revalidateWorkshopBookCatalog();
        target = "supabase";
      } else if (source === "github") {
        const github = await writeGithubJson("private/catalog/books.json", content, "Update JJU titles from manuscript content", loaded.version);
        if (!github) throw new Error("GitHub title saving is not configured.");
        revalidateWorkshopBookCatalog();
        target = "github";
      } else {
        const booksPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "private", "catalog", "books.json");
        await writeLocalJson(booksPath, content, loaded.version);
        revalidateWorkshopBookCatalog();
        target = "file";
      }
    }

    return NextResponse.json({
      changed: results.filter(result => result.changed).length,
      updated: shouldUpdate ? results.filter(result => result.changed).length : 0,
      results,
      books: shouldUpdate ? books : undefined,
      source,
      target: target || undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Title scan failed." },
      { status: 500 },
    );
  }
}
