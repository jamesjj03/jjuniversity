import { readFile, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { readBooksFromSupabase, saveBooksToSupabase } from "@/lib/bookCatalog";
import { readBookContent } from "@/lib/bookContent";

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
  const supabaseBooks = await readBooksFromSupabase().catch(() => null);
  if (supabaseBooks) return { books: supabaseBooks as BookRecord[], source: "supabase" as const };

  const booksPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "books.json");
  const data = JSON.parse(await readFile(booksPath, "utf8"));
  return { books: (Array.isArray(data) ? data : data.books || []) as BookRecord[], source: "file" as const };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const shouldUpdate = Boolean(body.update);
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map((id: unknown) => String(id).toLowerCase())) : null;
    const { books, source } = await readBooks();
    const targets = ids ? books.filter(book => ids.has(String(book.id).toLowerCase())) : books;
    const results = [];
    let target = "";

    for (const book of targets) {
      try {
        const { book: content } = await readBookContent(contentIdFor(book));
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
      const supabaseSave = await saveBooksToSupabase(books as unknown as Array<Record<string, unknown>>);
      if (supabaseSave.saved) {
        revalidatePath("/library");
        revalidatePath("/sitemap.xml");
        target = "supabase";
      } else {
        if (supabaseSave.error && !supabaseSave.tableMissing) throw new Error(supabaseSave.error);
        const booksPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "books.json");
        await writeFile(booksPath, `${JSON.stringify(books, null, 2)}\n`, "utf8");
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
