import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { NextResponse } from "next/server";

export class AdminVersionConflictError extends Error {
  constructor(message = "This admin document changed after it was loaded. Reload before saving again.") {
    super(message);
    this.name = "AdminVersionConflictError";
  }
}

function cleanVersion(value: string | null | undefined) {
  return String(value || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

export function versionForContent(content: string, source = "local") {
  return `${source}:${createHash("sha256").update(content).digest("hex")}`;
}

export function versionForValue(value: unknown, source: string) {
  return versionForContent(JSON.stringify(value), source);
}

export function versionForBookCatalog(books: unknown[], source = "supabase") {
  const sorted = [...books].sort((left, right) => {
    const leftId = String((left as Record<string, unknown>)?.id || "");
    const rightId = String((right as Record<string, unknown>)?.id || "");
    return leftId.localeCompare(rightId);
  });
  return versionForValue(sorted, source);
}

export function expectedAdminVersion(request: Request) {
  const version = cleanVersion(request.headers.get("if-match"));
  if (!version) throw new AdminVersionConflictError("This save has no source version. Reload the Workshop before saving.");
  return version;
}

export function assertAdminVersion(expected: string, current: string) {
  if (cleanVersion(expected) !== cleanVersion(current)) throw new AdminVersionConflictError();
}

export function versionedJson(value: unknown, version: string, init?: { status?: number }) {
  return NextResponse.json(value, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ETag: `"${cleanVersion(version)}"`,
    },
  });
}

export function adminErrorResponse(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    {
      status: error instanceof AdminVersionConflictError ? 409 : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function githubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  return token && repo ? { token, repo, branch } : null;
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function readGithubJson<T = unknown>(repoPath: string): Promise<{ value: T; version: string } | null> {
  const config = githubConfig();
  if (!config) return null;
  const response = await fetch(`https://api.github.com/repos/${config.repo}/contents/${repoPath}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config.token),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Could not read ${repoPath} from GitHub.`);
  const data = await response.json() as { content?: string; encoding?: string; sha?: string };
  if (data.encoding !== "base64" || !data.content || !data.sha) throw new Error(`GitHub returned invalid content for ${repoPath}.`);
  const content = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
  return { value: JSON.parse(content) as T, version: `github:${data.sha}` };
}

export async function writeGithubJson(repoPath: string, content: string, message: string, expectedVersion: string) {
  const config = githubConfig();
  if (!config) return null;
  const apiUrl = `https://api.github.com/repos/${config.repo}/contents/${repoPath}`;
  const current = await fetch(`${apiUrl}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config.token),
    cache: "no-store",
  });
  if (!current.ok) throw new Error(`Could not read current ${repoPath} from GitHub.`);
  const currentData = await current.json() as { sha?: string };
  if (!currentData.sha) throw new Error(`GitHub returned no version for ${repoPath}.`);
  assertAdminVersion(expectedVersion, `github:${currentData.sha}`);

  const updated = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      ...githubHeaders(config.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      branch: config.branch,
      sha: currentData.sha,
      content: Buffer.from(content, "utf8").toString("base64"),
    }),
  });
  if (!updated.ok) {
    if (updated.status === 409 || updated.status === 422) throw new AdminVersionConflictError();
    const detail = await updated.json().catch(() => ({})) as { message?: string };
    throw new Error(detail.message || `GitHub save failed for ${repoPath}.`);
  }
  const data = await updated.json() as { content?: { sha?: string }; commit?: { html_url?: string } };
  const sha = data.content?.sha;
  if (!sha) throw new Error(`GitHub saved ${repoPath} but returned no new version.`);
  return { data, version: `github:${sha}` };
}

export async function readLocalJson<T = unknown>(filePath: string): Promise<{ value: T; content: string; version: string }> {
  const content = await readFile(filePath, "utf8");
  return { value: JSON.parse(content) as T, content, version: versionForContent(content) };
}

export async function writeLocalJson(filePath: string, content: string, expectedVersion: string) {
  const current = await readFile(filePath, "utf8");
  assertAdminVersion(expectedVersion, versionForContent(current));
  await writeFile(filePath, content, "utf8");
  return { version: versionForContent(content) };
}
