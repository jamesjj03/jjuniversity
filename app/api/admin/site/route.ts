import { writeFile } from "fs/promises";
import path from "path";
import {
  adminErrorResponse,
  expectedAdminVersion,
  readGithubJson,
  readLocalJson,
  versionedJson,
  writeGithubJson,
  writeLocalJson,
} from "@/lib/adminVersionedJson";

type SiteConfig = {
  homeCards?: unknown;
  library?: {
    featuredPathIds?: unknown;
    newestIds?: unknown;
  };
  fiber?: {
    visible?: unknown;
  };
  social?: {
    instagramUrl?: unknown;
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
  fiber: {
    visible: false,
  },
  social: {
    instagramUrl: "https://www.instagram.com/jj_james.johnson/",
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
    fiber: {
      visible: Boolean(value?.fiber?.visible),
    },
    social: {
      instagramUrl: typeof value?.social?.instagramUrl === "string"
        ? value.social.instagramUrl.trim()
        : DEFAULT_SITE.social.instagramUrl,
    },
  };
}

function assertRawSite(value: unknown): SiteConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Site settings source is not an object.");
  const data = value as Record<string, unknown>;
  const library = data.library as Record<string, unknown> | undefined;
  const fiber = data.fiber as Record<string, unknown> | undefined;
  if (!Array.isArray(data.homeCards) || !data.homeCards.length) throw new Error("Site settings must include homepage cards.");
  data.homeCards.forEach((card, index) => {
    const record = card && typeof card === "object" ? card as Record<string, unknown> : null;
    if (!record || !String(record.id || "").trim() || !String(record.displayTitle || record.title || "").trim() || !String(record.why || record.description || "").trim()) {
      throw new Error(`Homepage card ${index + 1} is invalid.`);
    }
  });
  if (!library || typeof library !== "object" || !Array.isArray(library.featuredPathIds) || !Array.isArray(library.newestIds)) {
    throw new Error("Site settings must include both library arrays.");
  }
  if (!fiber || typeof fiber.visible !== "boolean") {
    throw new Error("Site settings must include the Fiber visibility flag.");
  }
  if (!data.social || typeof data.social !== "object" || typeof (data.social as Record<string, unknown>).instagramUrl !== "string") {
    throw new Error("Site settings must include the Instagram URL.");
  }
  return value as SiteConfig;
}

export async function GET() {
  try {
    const sitePath = path.join(process.cwd(), "public", "site.json");
    const github = await readGithubJson("public/site.json");
    if (github) return versionedJson(cleanConfig(assertRawSite(github.value)), github.version);
    const local = await readLocalJson(sitePath);
    return versionedJson(cleanConfig(assertRawSite(local.value)), local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load site settings.");
  }
}

export async function POST(request: Request) {
  try {
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({}));
    const config = cleanConfig(assertRawSite(body.site || body));
    const content = `${JSON.stringify(config, null, 2)}\n`;
    const sitePath = path.join(process.cwd(), "public", "site.json");
    const message = body.message || `Update JJU site settings (${new Date().toISOString().slice(0, 10)})`;

    const github = await writeGithubJson("public/site.json", content, message, expectedVersion);
    if (github) {
      try {
        await writeFile(sitePath, content, "utf8");
      } catch {
        // Deployment files may be read-only; GitHub is the canonical successful write.
      }
      return versionedJson({ saved: true, target: "github", site: config }, github.version);
    }

    const local = await writeLocalJson(sitePath, content, expectedVersion);
    return versionedJson({
      saved: true,
      target: "local",
      site: config,
      note: "Saved locally. Add GITHUB_TOKEN and GITHUB_REPO to save live through GitHub.",
    }, local.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not save site settings.");
  }
}
