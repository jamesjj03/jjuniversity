import { readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { cleanPathsFile, generateFallbackPaths } from "@/lib/paths";

async function readBooks() {
  const booksPath = path.join(process.cwd(), "public", "books.json");
  const data = JSON.parse(await readFile(booksPath, "utf8"));
  return Array.isArray(data) ? data : data.books || [];
}

async function readPaths() {
  const pathsPath = path.join(process.cwd(), "public", "paths.json");
  try {
    return cleanPathsFile(JSON.parse(await readFile(pathsPath, "utf8")));
  } catch {
    return generateFallbackPaths(await readBooks(), 24);
  }
}

async function saveToGithub(content: string, message: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) return null;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/paths.json?ref=${encodeURIComponent(branch)}`;
  const current = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const currentData = current.ok ? await current.json() : null;

  const updated = await fetch(`https://api.github.com/repos/${repo}/contents/public/paths.json`, {
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
    throw new Error(error.message || "GitHub save failed.");
  }

  return updated.json();
}

export async function GET() {
  try {
    return NextResponse.json(await readPaths());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load paths.json." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const paths = cleanPathsFile(body.paths || body);
    const content = `${JSON.stringify(paths, null, 2)}\n`;
    const pathsPath = path.join(process.cwd(), "public", "paths.json");
    const message = body.message || `Update JJU reading paths (${new Date().toISOString().slice(0, 10)})`;

    let localSaved = false;
    let localError = "";
    try {
      await writeFile(pathsPath, content, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local paths.json save failed.";
    }

    const github = await saveToGithub(content, message);

    if (!localSaved && !github) {
      throw new Error(localError || "Could not save paths.json locally, and GitHub saving is not configured.");
    }

    return NextResponse.json({
      saved: true,
      target: github ? "github" : "local",
      paths,
      commit: github?.commit?.html_url,
      note: github ? undefined : "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save paths.json." },
      { status: 500 },
    );
  }
}
