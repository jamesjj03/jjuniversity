import { readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { DEFAULT_FIBER_CONFIG, FiberConfig, normalizeFiberConfig } from "@/lib/fiberConfig";

async function saveToGithub(content: string, message: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) return null;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/fiber.json?ref=${encodeURIComponent(branch)}`;
  const current = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const currentData = current.ok ? await current.json() : null;

  const updated = await fetch(`https://api.github.com/repos/${repo}/contents/public/fiber.json`, {
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
    const fiberPath = path.join(process.cwd(), "public", "fiber.json");
    const config = normalizeFiberConfig(JSON.parse(await readFile(fiberPath, "utf8")));
    return NextResponse.json(config);
  } catch {
    return NextResponse.json(DEFAULT_FIBER_CONFIG);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const config = normalizeFiberConfig((body.fiber || body) as Partial<FiberConfig>);
    const content = `${JSON.stringify(config, null, 2)}\n`;
    const fiberPath = path.join(process.cwd(), "public", "fiber.json");
    const message = body.message || `Update fiber page settings (${new Date().toISOString().slice(0, 10)})`;

    let localSaved = false;
    let localError = "";
    try {
      await writeFile(fiberPath, content, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local fiber.json save failed.";
    }

    const github = await saveToGithub(content, message);

    if (!localSaved && !github) {
      throw new Error(localError || "Could not save fiber.json locally, and GitHub saving is not configured.");
    }

    return NextResponse.json({
      saved: true,
      target: github ? "github" : "local",
      fiber: config,
      commit: github?.commit?.html_url,
      note: github ? undefined : "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save fiber settings." },
      { status: 500 },
    );
  }
}
