import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { bookToCatalogRow, catalogRowToBook, createBookDraftInSupabase, readBookCatalogSnapshot } from "@/lib/bookCatalog";
import { prepareBookContentForSave, textFromHtml, wordCount, type BookContent } from "@/lib/bookContent";
import {
  AdminVersionConflictError,
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

function supabaseCatalogVersion(books: unknown[], revision: string | null) {
  return versionForBookCatalog(books, revision ? `supabase-catalog:${revision}` : "supabase-unversioned");
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
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({})) as DraftBody;
    const title = String(body.title || "").trim() || untitledBookTitle();
    const requestedId = slug(String(body.id || "").trim());

    const booksPath = path.join(process.cwd(), "private", "catalog", "books.json");
    const contentDir = path.join(process.cwd(), "private", "book-content");
    const manifestPath = path.join(contentDir, "manifest.json");
    const localCatalog = await readLocalJson(booksPath);
    const supabaseSnapshot = await readBookCatalogSnapshot();
    const supabaseBooks = supabaseSnapshot?.books ?? null;
    const githubCatalog = supabaseBooks === null ? await readGithubJson("private/catalog/books.json") : null;
    const booksData: unknown = supabaseBooks !== null ? supabaseBooks : githubCatalog?.value ?? localCatalog.value;
    const catalogTarget = supabaseBooks !== null ? "supabase" : githubCatalog ? "github" : "local";
    const booksEnvelope = booksData && typeof booksData === "object" && !Array.isArray(booksData) ? booksData as Record<string, unknown> : {};
    const books = (Array.isArray(booksData) ? booksData : Array.isArray(booksEnvelope.books) ? booksEnvelope.books : []) as BookRecord[];
    if (!books.length || books.some(book => !String(book.id || "").trim())) throw new Error("The current catalog is malformed or empty.");
    if (new Set(books.map(book => String(book.id).trim().toLowerCase())).size !== books.length) throw new Error("The current catalog has duplicate ids.");
    assertAdminVersion(
      expectedVersion,
      catalogTarget === "supabase"
        ? supabaseCatalogVersion(books, supabaseSnapshot?.revision || null)
        : githubCatalog?.version || localCatalog.version,
    );
    const existingIds = new Set(books.map(book => String(book.id || "").toLowerCase()).filter(Boolean));
    if (requestedId && existingIds.has(requestedId)) throw new Error(`A book with id "${requestedId}" already exists.`);

    const id = requestedId || uniqueSlug(title, existingIds);

    const fileName = fileSafe(id);
    const contentPath = path.join(contentDir, `${fileName}.json`);
    const contentBook = buildContent({ ...body, title }, id, fileName);
    const contentJson = `${JSON.stringify(contentBook, null, 2)}\n`;
    const minutes = Math.max(1, Math.round((contentBook.wordCount || 1) / 180));
    const status = String(body.status || "hidden").trim().toLowerCase() || "hidden";
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
      status,
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
    const message = `Create JJU draft book: ${contentBook.title}`;

    if (catalogTarget === "github" && status !== "ready") {
      throw new Error("Private draft manuscripts require Supabase or local storage; they are never written to the public GitHub repository.");
    }

    if (catalogTarget === "supabase") {
      const canonicalBook = catalogRowToBook(bookToCatalogRow(book));
      const savedBooks = [...books, canonicalBook].sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)));
      const supabaseDraft = await createBookDraftInSupabase({
        book,
        content: contentBook as unknown as Record<string, unknown>,
        fileName: `${fileName}.json`,
        publicPath: `private/book-content/${fileName}.json`,
        message,
        expectedRevision: supabaseSnapshot?.revision || null,
      });
      if (!supabaseDraft.saved) throw new Error(supabaseDraft.error || "Supabase did not create the draft book.");
      revalidatePath("/books");
      revalidatePath("/books/index");
      revalidatePath("/books/[slug]", "page");
      revalidatePath("/books/[slug]/[sectionSlug]", "page");
      revalidatePath("/site-v2/books/[slug]", "page");
      revalidatePath("/library");
      revalidatePath("/sitemap.xml");
      return versionedJson({
        saved: true,
        target: "supabase",
        book: canonicalBook,
        books: savedBooks,
        content: contentBook,
        contentFile: `${fileName}.json`,
        versionNumber: supabaseDraft.contentVersion,
        note: "Created draft catalog/content atomically in Supabase.",
      }, supabaseCatalogVersion(savedBooks, supabaseDraft.revision || null));
    }

    const localManifest = await readLocalJson(manifestPath);
    const githubManifest = catalogTarget === "github" ? await readGithubJson("private/book-content/manifest.json") : null;
    const manifestValue = githubManifest?.value || localManifest.value;
    if (!manifestValue || typeof manifestValue !== "object" || Array.isArray(manifestValue)) throw new Error("Book-content manifest is malformed.");
    const manifest = manifestValue as Record<string, unknown>;
    const manifestBooks = Array.isArray(manifest.books)
      ? (manifest.books as Array<Record<string, unknown>>).filter(item => String(item.id || "").trim().toLowerCase() !== id)
      : [];
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

    const booksJson = `${JSON.stringify(Array.isArray(booksData) ? nextBooks : { ...booksEnvelope, books: nextBooks }, null, 2)}\n`;
    const manifestJson = `${JSON.stringify(nextManifest, null, 2)}\n`;
    await mkdir(contentDir, { recursive: true });

    let savedTarget: "github" | "local";
    let nextCatalogVersion: string;
    if (catalogTarget === "github") {
      try {
        await Promise.all([
          saveJsonToGithub(`private/book-content/${fileName}.json`, contentJson, message),
        ]);
        if (!githubManifest) throw new Error("GitHub manifest version is unavailable.");
        await writeGithubJson("private/book-content/manifest.json", manifestJson, message, githubManifest.version);
        const githubBooks = await writeGithubJson("private/catalog/books.json", booksJson, message, expectedVersion);
        if (!githubBooks) throw new Error("GitHub catalog saving is not configured.");
        nextCatalogVersion = githubBooks.version;
        savedTarget = "github";
        try {
          await writeFile(contentPath, contentJson, "utf8");
          await writeFile(manifestPath, manifestJson, "utf8");
          await writeFile(booksPath, booksJson, "utf8");
        } catch {
          // Deployment files may be read-only; GitHub is the canonical successful write.
        }
      } catch (error) {
        if (error instanceof AdminVersionConflictError) {
          throw new AdminVersionConflictError("The catalog changed while the draft was being staged. Reload before retrying; a retry replaces the staged manifest entry by book id.");
        }
        throw new Error(error instanceof Error ? error.message : "GitHub draft save failed.");
      }
    } else {
      await writeFile(contentPath, contentJson, "utf8");
      await writeLocalJson(manifestPath, manifestJson, localManifest.version);
      const localBooks = await writeLocalJson(booksPath, booksJson, expectedVersion);
      nextCatalogVersion = localBooks.version;
      savedTarget = "local";
    }

    return versionedJson({
      saved: true,
      target: savedTarget,
      book,
      books: nextBooks,
      content: contentBook,
      contentFile: `${fileName}.json`,
      note: savedTarget === "local" ? "Created locally. Generated cover fallback will work until you add real cover art." : undefined,
    }, nextCatalogVersion);
  } catch (error) {
    return adminErrorResponse(error, "Could not create book draft.");
  }
}
