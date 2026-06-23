import { readdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { readBooksFromSupabase, saveBooksToSupabase } from "@/lib/bookCatalog";
import { listLiveBookContentIds } from "@/lib/bookContent";

type BookRecord = Record<string, unknown>;

function contentIdFor(book: BookRecord) {
  const id = String(book.id || "").trim();
  const fileStem = String(book.bookFile || book.epub || book.file || "").replace(/\.(epub|json)$/i, "");
  return fileStem || id;
}

async function saveToGithub(content: string, message: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) return null;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/books.json?ref=${encodeURIComponent(branch)}`;
  const current = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!current.ok) throw new Error("Could not read books.json from GitHub.");
  const currentData = await current.json();

  const updated = await fetch(`https://api.github.com/repos/${repo}/contents/public/books.json`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message,
      branch,
      sha: currentData.sha,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });

  if (!updated.ok) {
    const error = await updated.json().catch(() => ({}));
    throw new Error(error.message || "GitHub save failed.");
  }

  return updated.json();
}

async function readBooks() {
  const supabaseBooks = await readBooksFromSupabase().catch(() => null);
  if (supabaseBooks) return { books: supabaseBooks as BookRecord[], source: "supabase" as const };

  const booksPath = path.join(process.cwd(), "public", "books.json");
  const data = JSON.parse(await readFile(booksPath, "utf8"));
  return { books: (Array.isArray(data) ? data : data.books || []) as BookRecord[], source: "file" as const };
}

export async function POST() {
  try {
    const booksPath = path.join(process.cwd(), "public", "books.json");
    const contentDir = path.join(process.cwd(), "public", "book-content");
    const { books, source } = await readBooks();
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
    const supabaseSave = await saveBooksToSupabase(updated);
    if (supabaseSave.saved) {
      revalidatePath("/library");
      revalidatePath("/sitemap.xml");
      return NextResponse.json({
        books: supabaseSave.books || updated,
        comingSoon,
        ready,
        source,
        target: "supabase",
        note: "Saved availability to Supabase.",
      });
    }

    if (supabaseSave.error && !supabaseSave.tableMissing) {
      throw new Error(supabaseSave.error);
    }

    let localSaved = false;
    let localError = "";
    try {
      await writeFile(booksPath, content, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local books.json save failed.";
    }

    const github = await saveToGithub(content, "Update JJU book availability");

    if (!localSaved && !github) {
      throw new Error(localError || "Could not save availability locally, and GitHub saving is not configured.");
    }

    return NextResponse.json({
      books: updated,
      comingSoon,
      ready,
      source,
      target: github ? "github" : "local",
      commit: github?.commit?.html_url,
      note: github ? undefined : "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update availability." },
      { status: 500 },
    );
  }
}
