import { writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import { prepareBookContentForSave, readBookContent, type BookContent } from "@/lib/bookContent";

type SaveBody = {
  sectionId?: string;
  html?: string;
  title?: string;
  kind?: string;
  book?: Partial<BookContent>;
  message?: string;
};

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

  if (!current.ok) throw new Error(`Could not read ${repoPath} from GitHub.`);
  const currentData = await current.json();

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
      sha: currentData.sha,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });

  if (!updated.ok) {
    const error = await updated.json().catch(() => ({}));
    throw new Error(error.message || "GitHub content save failed.");
  }

  return updated.json();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { book, fileName, publicPath } = await readBookContent(id);

    return NextResponse.json({
      ...book,
      contentFile: fileName,
      contentPath: publicPath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load book content." },
      { status: 404 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as SaveBody;
    const { book, fileName, publicPath, absolutePath } = await readBookContent(id);
    const bodySections = Array.isArray(body.book?.sections) ? body.book.sections : null;
    const nextBook = prepareBookContentForSave({
      ...book,
      ...body.book,
      id: book.id,
      sections: (bodySections || book.sections).map(section => {
        if (section.id !== body.sectionId) return section;
        return {
          ...section,
          html: typeof body.html === "string" ? body.html : section.html,
          title: typeof body.title === "string" ? body.title : section.title,
          kind: typeof body.kind === "string" ? body.kind : section.kind,
        };
      }),
    });
    const content = `${JSON.stringify(nextBook, null, 2)}\n`;
    const message = body.message || `Update ${nextBook.title || nextBook.id} content (${new Date().toISOString().slice(0, 10)})`;

    let localSaved = false;
    let localError = "";

    try {
      await writeFile(absolutePath, content, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local content save failed.";
    }

    const github = await saveJsonToGithub(publicPath, content, message);

    if (!localSaved && !github) {
      throw new Error(
        localError.includes("EROFS")
          ? "This deployment is read-only, so book content edits must save through GitHub. Add GITHUB_TOKEN and GITHUB_REPO in the hosting environment."
          : localError || "Could not save book content.",
      );
    }

    return NextResponse.json({
      saved: true,
      target: github ? "github" : "local",
      commit: github?.commit?.html_url,
      note: github ? undefined : "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
      contentFile: fileName,
      contentPath: publicPath,
      ...nextBook,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save book content." },
      { status: 500 },
    );
  }
}
