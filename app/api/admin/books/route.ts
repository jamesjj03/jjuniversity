import { readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

type SaveBody = {
  books?: unknown;
  message?: string;
};

function assertBooks(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Expected a books array.");

  return value.map((book, index) => {
    if (!book || typeof book !== "object") throw new Error(`Book ${index + 1} is not valid.`);
    const record = book as Record<string, unknown>;
    const id = String(record.id || "").trim().toLowerCase();
    const title = String(record.title || id || "Untitled").trim();
    if (!id) throw new Error(`Book ${index + 1} is missing an id.`);
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

export async function GET() {
  try {
    const booksPath = path.join(process.cwd(), "public", "books.json");
    const books = JSON.parse(await readFile(booksPath, "utf8"));
    return NextResponse.json({ books: Array.isArray(books) ? books : books.books || [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load books.json." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as SaveBody;
    const books = assertBooks(body.books);
    const content = `${JSON.stringify(books, null, 2)}\n`;
    const booksPath = path.join(process.cwd(), "public", "books.json");
    const message = body.message || `Update JJU library metadata (${new Date().toISOString().slice(0, 10)})`;

    let localSaved = false;
    let localError = "";
    try {
      await writeFile(booksPath, content, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local books.json save failed.";
    }

    const github = await saveToGithub(content, message);

    if (!localSaved && !github) {
      throw new Error(localError || "Could not save books.json locally, and GitHub saving is not configured.");
    }

    return NextResponse.json({
      saved: true,
      target: github ? "github" : "local",
      books,
      commit: github?.commit?.html_url,
      note: github ? undefined : "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save books.json." },
      { status: 500 },
    );
  }
}
