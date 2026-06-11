import { readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

type SiteConfig = {
  homeCards?: unknown;
  library?: {
    featuredPathIds?: unknown;
    newestIds?: unknown;
  };
  atlas?: {
    visible?: unknown;
  };
};

const DEFAULT_SITE = {
  homeCards: [
    { id: "science", displayTitle: "Science 101", why: "A clean entry point for how humans figured things out." },
    { id: "humans", displayTitle: "humanity.exe", why: "A doorway into people, systems, and the operating code underneath us." },
    { id: "caesar", displayTitle: "Caesar", why: "Power, ambition, collapse, and one of history's most useful warnings." },
    { id: "bible", displayTitle: "What the Bible Actually Says", why: "A direct route into Scripture and the roots of Western imagination." },
    { id: "edison", displayTitle: "Edison", why: "Invention, myth, business, genius, and the machine age waking up." },
  ],
  library: {
    featuredPathIds: [],
    newestIds: [],
  },
  atlas: {
    visible: false,
  },
};

function cleanConfig(value: SiteConfig | null | undefined) {
  const cards = Array.isArray(value?.homeCards) ? value.homeCards : DEFAULT_SITE.homeCards;
  const cleanIds = (ids: unknown) => Array.isArray(ids)
    ? ids.map(id => String(id).trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    homeCards: cards.map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: String(record.id || DEFAULT_SITE.homeCards[index]?.id || "").trim().toLowerCase(),
        displayTitle: String(record.displayTitle || record.title || DEFAULT_SITE.homeCards[index]?.displayTitle || "Untitled").trim(),
        why: String(record.why || record.description || DEFAULT_SITE.homeCards[index]?.why || "").trim(),
      };
    }).filter(card => card.id),
    library: {
      featuredPathIds: cleanIds(value?.library?.featuredPathIds),
      newestIds: cleanIds(value?.library?.newestIds),
    },
    atlas: {
      visible: Boolean(value?.atlas?.visible),
    },
  };
}

async function saveToGithub(content: string, message: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !repo) return null;

  const apiUrl = `https://api.github.com/repos/${repo}/contents/public/site.json?ref=${encodeURIComponent(branch)}`;
  const current = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const currentData = current.ok ? await current.json() : null;

  const updated = await fetch(`https://api.github.com/repos/${repo}/contents/public/site.json`, {
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
    const sitePath = path.join(process.cwd(), "public", "site.json");
    const config = cleanConfig(JSON.parse(await readFile(sitePath, "utf8")));
    return NextResponse.json(config);
  } catch {
    return NextResponse.json(DEFAULT_SITE);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const config = cleanConfig(body.site || body);
    const content = `${JSON.stringify(config, null, 2)}\n`;
    const sitePath = path.join(process.cwd(), "public", "site.json");
    const message = body.message || `Update JJU site settings (${new Date().toISOString().slice(0, 10)})`;

    let localSaved = false;
    let localError = "";
    try {
      await writeFile(sitePath, content, "utf8");
      localSaved = true;
    } catch (error) {
      localError = error instanceof Error ? error.message : "Local site.json save failed.";
    }

    const github = await saveToGithub(content, message);

    if (!localSaved && !github) {
      throw new Error(localError || "Could not save site.json locally, and GitHub saving is not configured.");
    }

    return NextResponse.json({
      saved: true,
      target: github ? "github" : "local",
      site: config,
      commit: github?.commit?.html_url,
      note: github ? undefined : "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save site settings." },
      { status: 500 },
    );
  }
}
