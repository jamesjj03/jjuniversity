import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

type ReviewBody = {
  notes?: unknown[];
  blocks?: unknown[];
};

function safeId(id: string) {
  return id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function reviewPath(id: string) {
  return path.join(process.cwd(), "public", "reviews", `${safeId(id)}.json`);
}

async function saveReviewToGithub(id: string, content: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo) return null;

  const repoPath = `public/reviews/${safeId(id)}.json`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(branch)}`;
  const current = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const currentData = current.ok ? await current.json() : null;
  if (!current.ok && current.status !== 404) throw new Error("Could not read review file from GitHub.");

  const updated = await fetch(`https://api.github.com/repos/${repo}/contents/${repoPath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message: `Save review queue for ${safeId(id)}`,
      branch,
      sha: currentData?.sha,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });

  if (!updated.ok) {
    const error = await updated.json().catch(() => ({}));
    throw new Error(error.message || "GitHub review save failed.");
  }

  return updated.json();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = JSON.parse(await readFile(reviewPath(id), "utf8"));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ notes: [], blocks: [] });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as ReviewBody;
    const payload = {
      bookId: safeId(id),
      savedAt: new Date().toISOString(),
      notes: Array.isArray(body.notes) ? body.notes : [],
      blocks: Array.isArray(body.blocks) ? body.blocks : [],
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    let localSaved = false;
    let localError = "";
    try {
      const dir = path.join(process.cwd(), "public", "reviews");
      await mkdir(dir, { recursive: true });
      await writeFile(reviewPath(id), content, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local review save failed.";
    }

    const github = await saveReviewToGithub(id, content);
    if (!localSaved && !github) throw new Error(localError || "Could not save review data.");

    return NextResponse.json({ saved: true, target: github ? "github" : "local", commit: github?.commit?.html_url, ...payload });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save review data." },
      { status: 500 },
    );
  }
}
