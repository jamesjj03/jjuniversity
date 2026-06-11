import { readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const shouldUpdate = Boolean(body.update);
    const ids = Array.isArray(body.ids) ? new Set(body.ids.map((id: unknown) => String(id).toLowerCase())) : null;
    const booksPath = path.join(process.cwd(), "public", "books.json");
    const books: BookRecord[] = JSON.parse(await readFile(booksPath, "utf8"));
    const targets = ids ? books.filter(book => ids.has(String(book.id).toLowerCase())) : books;
    const results = [];

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
      await writeFile(booksPath, `${JSON.stringify(books, null, 2)}\n`, "utf8");
    }

    return NextResponse.json({
      changed: results.filter(result => result.changed).length,
      updated: shouldUpdate ? results.filter(result => result.changed).length : 0,
      results,
      books: shouldUpdate ? books : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Title scan failed." },
      { status: 500 },
    );
  }
}
