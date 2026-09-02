import { readdir } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { readBookCatalogSnapshot, saveBooksToSupabase } from "@/lib/bookCatalog";
import { revalidateWorkshopBookCatalog } from "@/lib/adminBookCatalog";
import { listLiveBookContentIds } from "@/lib/bookContent";
import { readGithubJson, readLocalJson, writeGithubJson, writeLocalJson } from "@/lib/adminVersionedJson";

type BookRecord = Record<string, unknown>;

function contentIdFor(book: BookRecord) {
  const id = String(book.id || "").trim();
  const fileStem = String(book.bookFile || book.epub || book.file || "").replace(/\.(epub|json)$/i, "");
  return fileStem || id;
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

export async function POST() {
  try {
    const booksPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "private", "catalog", "books.json");
    const contentDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "private", "book-content");
    const loaded = await readBooks();
    const { books, source } = loaded;
    if (!books.length) throw new Error("Availability update is locked because the catalog source is empty.");
    const liveContentIds = await listLiveBookContentIds();
    const files = new Set((await readdir(contentDir)).filter(file => file.toLowerCase().endsWith(".json")).map(file => file.toLowerCase()));

    let comingSoon = 0;
    let ready = 0;

    const updated = books.map(book => {
      const contentId = contentIdFor(book).toLowerCase();
      const contentFile = `${contentId}.json`;
      const status = String(book.status || "ready").trim().toLowerCase();
      const hasContent = files.has(contentFile) || Boolean(liveContentIds?.has(contentId));
      if (!hasContent && !["hidden", "unavailable"].includes(status)) {
        comingSoon += 1;
        return { ...book, status: "coming-soon" };
      }
      if (hasContent && status === "coming-soon") {
        ready += 1;
        return { ...book, status: "ready" };
      }
      return book;
    });

    const content = `${JSON.stringify(updated, null, 2)}\n`;
    if (source === "supabase") {
      const supabaseSave = await saveBooksToSupabase(updated, { expectedRevision: loaded.revision });
      if (!supabaseSave.saved) throw new Error(supabaseSave.error || "Supabase did not save availability.");
      revalidateWorkshopBookCatalog();
      return NextResponse.json({
        books: supabaseSave.books || updated,
        comingSoon,
        ready,
        source,
        target: "supabase",
        note: "Saved availability to Supabase.",
      });
    }
    if (source === "github") {
      const github = await writeGithubJson("private/catalog/books.json", content, "Update JJU book availability", loaded.version);
      if (!github) throw new Error("GitHub availability saving is not configured.");
      revalidateWorkshopBookCatalog();
      return NextResponse.json({
        books: updated,
        comingSoon,
        ready,
        source,
        target: "github",
        commit: github.data.commit?.html_url,
      });
    }

    await writeLocalJson(booksPath, content, loaded.version);
    revalidateWorkshopBookCatalog();

    return NextResponse.json({
      books: updated,
      comingSoon,
      ready,
      source,
      target: "local",
      note: "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update availability." },
      { status: 500 },
    );
  }
}
