import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { readBooksFromSupabase, saveBooksToSupabase } from "@/lib/bookCatalog";
import { prepareBookContentForSave, saveLiveBookContentToSupabase, textFromHtml, wordCount, type BookContent } from "@/lib/bookContent";

type BookRecord = Record<string, unknown>;

type DraftBody = {
  id?: unknown;
  title?: unknown;
  creator?: unknown;
  description?: unknown;
  tags?: unknown;
  status?: unknown;
  visibility?: unknown;
  archiveCategory?: unknown;
  text?: unknown;
  quick?: unknown;
};

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function fileSafe(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "book";
}

function untitledBookTitle() {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  return `Untitled Book ${stamp}`;
}

function uniqueSlug(base: string, existing: Set<string>) {
  const root = slug(base) || `untitled-book-${Date.now().toString(36)}`;
  let candidate = root;
  let index = 2;

  while (existing.has(candidate)) {
    candidate = `${root}-${index}`;
    index += 1;
  }

  return candidate;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function titleFromLine(value: string) {
  return value.replace(/^#{1,3}\s+/, "").replace(/^chapter\s+\d+\s*[:.-]?\s*/i, "").trim();
}

function splitDraftText(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const isHeading = /^(#{1,3}\s+|chapter\s+\d+\b|part\s+\d+\b)/i.test(line);

    if (isHeading) {
      if (current) sections.push(current);
      current = { title: titleFromLine(line) || `Section ${sections.length + 1}`, lines: [] };
      continue;
    }

    if (!current) current = { title: "Draft", lines: [] };
    current.lines.push(rawLine);
  }

  if (current) sections.push(current);
  return sections.filter(section => section.title || section.lines.some(line => line.trim()));
}

function paragraphsToHtml(lines: string[]) {
  return lines
    .join("\n")
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function buildContent(body: DraftBody, id: string, fileName: string): BookContent {
  const title = String(body.title || id).trim() || id;
  const creator = String(body.creator || "James Johnson").trim();
  const description = String(body.description || "").trim();
  const text = String(body.text || "").trim();
  const draftSections = splitDraftText(text);
  const contentSections = draftSections.length
    ? draftSections.map((section, index) => {
      const html = paragraphsToHtml(section.lines) || "<p>Start writing here.</p>";
      const plain = textFromHtml(html);
      return {
        id: `section-${String(index + 1).padStart(3, "0")}`,
        index,
        title: section.title || `Section ${index + 1}`,
        kind: index === 0 && section.title.toLowerCase() === title.toLowerCase() ? "title" : "chapter",
        html,
        text: plain,
        wordCount: wordCount(plain),
      };
    })
    : [
      {
        id: "section-001",
        index: 0,
        title,
        kind: "title",
        html: `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(creator)}</p>`,
        text: `${title} ${creator}`.trim(),
        wordCount: wordCount(`${title} ${creator}`.trim()),
      },
      {
        id: "section-002",
        index: 1,
        title: "Draft",
        kind: "chapter",
        html: "<p>Start writing here.</p>",
        text: "Start writing here.",
        wordCount: 3,
      },
    ];

  return prepareBookContentForSave({
    id,
    slug: slug(title),
    sourceFile: `${fileName}.json`,
    title,
    creator,
    description,
    sections: contentSections,
  });
}

function readingLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min read`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} hr ${mins} min read` : `${hours} hr read`;
}

async function saveJsonToGithub(repoPath: string, content: string, message: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) return null;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(branch)}`;
  const current = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const currentData = current.ok ? await current.json() : null;

  const updated = await fetch(`https://api.github.com/repos/${repo}/contents/${repoPath}`, {
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
      sha: currentData?.sha,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });

  if (!updated.ok) {
    const error = await updated.json().catch(() => ({}));
    throw new Error(error.message || `GitHub save failed for ${repoPath}.`);
  }

  return updated.json();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as DraftBody;
    const title = String(body.title || "").trim() || untitledBookTitle();
    const requestedId = slug(String(body.id || "").trim());

    const booksPath = path.join(process.cwd(), "public", "books.json");
    const contentDir = path.join(process.cwd(), "public", "book-content");
    const manifestPath = path.join(contentDir, "manifest.json");
    const supabaseBooks = await readBooksFromSupabase().catch(() => null);
    const booksData = supabaseBooks ? supabaseBooks : JSON.parse(await readFile(booksPath, "utf8"));
    const books = (Array.isArray(booksData) ? booksData : booksData.books || []) as BookRecord[];
    const existingIds = new Set(books.map(book => String(book.id || "").toLowerCase()).filter(Boolean));
    if (requestedId && existingIds.has(requestedId)) throw new Error(`A book with id "${requestedId}" already exists.`);

    const id = requestedId || uniqueSlug(title, existingIds);

    const fileName = fileSafe(id);
    const contentPath = path.join(contentDir, `${fileName}.json`);
    const contentBook = buildContent({ ...body, title }, id, fileName);
    const contentJson = `${JSON.stringify(contentBook, null, 2)}\n`;
    const minutes = Math.max(1, Math.round((contentBook.wordCount || 1) / 180));
    const tags = Array.isArray(body.tags)
      ? body.tags.map(tag => String(tag).trim()).filter(Boolean).sort()
      : String(body.tags || "").split(",").map(tag => tag.trim()).filter(Boolean).sort();
    const visibility = String(body.visibility || "main").trim().toLowerCase() === "archive" ? "archive" : "main";
    const book: BookRecord = {
      id,
      title: contentBook.title,
      creator: contentBook.creator || "James Johnson",
      author: contentBook.creator || "James Johnson",
      description: contentBook.description || `A JJ University book about ${contentBook.title}.`,
      tags,
      status: String(body.status || "hidden").trim().toLowerCase() || "hidden",
      visibility,
      archive: visibility === "archive",
      category: visibility === "archive" ? String(body.archiveCategory || "Unsorted Archive").trim() : "",
      archiveCategory: visibility === "archive" ? String(body.archiveCategory || "Unsorted Archive").trim() : "",
      coverFile: `${fileName}.jpg`,
      bookFile: `${fileName}.json`,
      contentKey: fileName,
      sourceKind: "admin-draft",
      wordCount: contentBook.wordCount,
      readingMinutes: minutes,
      readingLabel: readingLabel(minutes),
      chapterCount: contentBook.sections.filter(section => section.kind === "chapter").length || contentBook.sections.length,
    };
    const nextBooks = [...books, book].sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));

    const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "{\"books\":[]}"));
    const manifestBooks = Array.isArray(manifest.books) ? manifest.books : [];
    const nextManifest = {
      ...manifest,
      generatedAt: new Date().toISOString(),
      count: manifestBooks.length + 1,
      books: [
        ...manifestBooks,
        {
          id,
          slug: contentBook.slug || slug(contentBook.title),
          title: contentBook.title,
          sourceFile: `${fileName}.json`,
          sectionCount: contentBook.sectionCount,
          wordCount: contentBook.wordCount,
          path: `book-content/${fileName}.json`,
        },
      ].sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id))),
    };

    const booksJson = `${JSON.stringify(Array.isArray(booksData) ? nextBooks : { ...booksData, books: nextBooks }, null, 2)}\n`;
    const manifestJson = `${JSON.stringify(nextManifest, null, 2)}\n`;
    const message = `Create JJU draft book: ${contentBook.title}`;

    const supabaseCatalogSave = await saveBooksToSupabase(nextBooks);
    if (supabaseCatalogSave.saved) {
      const supabaseContentSave = await saveLiveBookContentToSupabase({
        book: contentBook,
        fileName: `${fileName}.json`,
        publicPath: `public/book-content/${fileName}.json`,
        message,
      });

      if (supabaseContentSave.saved) {
        revalidatePath("/library");
        revalidatePath("/sitemap.xml");
        return NextResponse.json({
          saved: true,
          target: "supabase",
          book,
          books: supabaseCatalogSave.books || nextBooks,
          content: contentBook,
          contentFile: `${fileName}.json`,
          versionNumber: supabaseContentSave.versionNumber,
          note: "Created draft catalog/content in Supabase.",
        });
      }

      if (supabaseContentSave.error && !supabaseContentSave.tableMissing) {
        throw new Error(supabaseContentSave.error);
      }
    } else if (supabaseCatalogSave.error && !supabaseCatalogSave.tableMissing) {
      throw new Error(supabaseCatalogSave.error);
    }

    await mkdir(contentDir, { recursive: true });

    let localSaved = false;
    let localError = "";
    try {
      await writeFile(contentPath, contentJson, "utf8");
      await writeFile(manifestPath, manifestJson, "utf8");
      await writeFile(booksPath, booksJson, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local draft save failed.";
    }

    let githubSaved = false;
    let githubError = "";
    try {
      const githubResults = await Promise.all([
        saveJsonToGithub(`public/book-content/${fileName}.json`, contentJson, message),
        saveJsonToGithub("public/book-content/manifest.json", manifestJson, message),
        saveJsonToGithub("public/books.json", booksJson, message),
      ]);
      githubSaved = githubResults.some(Boolean);
    } catch (error) {
      githubError = error instanceof Error ? error.message : "GitHub save failed.";
    }

    if (!localSaved && !githubSaved) {
      throw new Error(localError || githubError || "Could not create the draft locally, and GitHub saving is not configured.");
    }

    return NextResponse.json({
      saved: true,
      target: githubSaved ? "github" : "local",
      book,
      books: nextBooks,
      content: contentBook,
      contentFile: `${fileName}.json`,
      note: githubSaved
        ? undefined
        : githubError
          ? `Created locally, but GitHub did not save: ${githubError}`
          : "Created locally. Generated cover fallback will work until you add real cover art.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create book draft." },
      { status: 500 },
    );
  }
}
