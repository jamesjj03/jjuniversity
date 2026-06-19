import { mkdir, writeFile } from "fs/promises";
import path from "path";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const root = process.cwd();

const DEFAULT_CATEGORIES = [
  "Category:Human brain (sagittal section)",
  "Category:Human brain (lateral view)",
  "Category:Brain lobes",
  "Category:SVG neuroanatomy of humans",
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataValue(metadata, key) {
  return metadata?.[key]?.value || "";
}

function licenseState(shortName) {
  const name = String(shortName || "").toLowerCase();
  if (!name) return { allowed: false, reason: "Missing license name." };
  if (name.includes("noncommercial") || name.includes("nc")) return { allowed: false, reason: "Non-commercial license is not allowed." };
  if (name.includes("no derivatives") || name.includes("nd")) return { allowed: false, reason: "No-derivatives license is not allowed." };
  if (name.includes("public domain") || name.includes("cc0")) return { allowed: true, reason: "Open public-domain style license." };
  if (name.startsWith("cc by")) return { allowed: true, reason: "Creative Commons attribution license." };
  return { allowed: false, reason: `Unreviewed license: ${shortName}` };
}

async function commonsQuery(params) {
  const url = new URL(COMMONS_API);
  Object.entries({ action: "query", format: "json", ...params }).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "JJU-Arena/0.1 (diagram candidate discovery; local educational asset review)",
      },
    });

    if (response.ok) {
      await sleep(350);
      return response.json();
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Commons request failed: ${response.status} ${response.statusText}`);
    }

    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await sleep(retryAfter ? retryAfter * 1000 : 1200 * (attempt + 1));
  }

  throw new Error("Commons request failed after retries.");
}

async function categoryMembers(category, limit) {
  const titles = [];
  let cmcontinue = "";

  while (titles.length < limit) {
    const data = await commonsQuery({
      list: "categorymembers",
      cmtitle: category,
      cmnamespace: 6,
      cmlimit: Math.min(50, limit - titles.length),
      cmcontinue: cmcontinue || undefined,
    });

    titles.push(...(data.query?.categorymembers || []).map(item => item.title));
    cmcontinue = data.continue?.cmcontinue || "";
    if (!cmcontinue) break;
  }

  return titles;
}

async function imageInfo(titles) {
  if (!titles.length) return [];
  const results = [];

  for (let index = 0; index < titles.length; index += 50) {
    const chunk = titles.slice(index, index + 50);
    const data = await commonsQuery({
      prop: "imageinfo|info",
      iiprop: "url|mime|size|extmetadata|sha1|user|timestamp",
      titles: chunk.join("|"),
    });

    results.push(...Object.values(data.query?.pages || {}));
  }

  return results;
}

function fileKind(title, mime) {
  const lower = `${title} ${mime}`.toLowerCase();
  if (lower.includes(".svg") || mime === "image/svg+xml") return "svg";
  if (lower.includes(".png") || mime === "image/png") return "png";
  if (lower.includes(".jpg") || lower.includes(".jpeg") || mime === "image/jpeg") return "jpg";
  if (lower.includes(".webp") || mime === "image/webp") return "webp";
  if (lower.includes(".gif") || mime === "image/gif") return "gif";
  return "other";
}

function scoreCandidate(candidate) {
  const text = `${candidate.title} ${candidate.description}`.toLowerCase();
  const title = candidate.title.toLowerCase();
  let score = 0;

  if (candidate.allowed) score += 30;
  if (candidate.kind === "svg") score += 26;
  if (candidate.kind === "png") score += 10;
  if (candidate.kind === "jpg") score += 8;
  if (candidate.width >= 900 || candidate.height >= 900) score += 12;
  if (candidate.width >= 1800 || candidate.height >= 1800) score += 8;
  if (text.includes("sagittal")) score += 16;
  if (text.includes("lateral")) score += 12;
  if (text.includes("lobe")) score += 9;
  if (text.includes("label")) score += 8;
  if (text.includes("section")) score += 6;
  if (title.includes("mri") || title.includes("ct ") || title.includes("animation") || title.includes(".gif")) score -= 18;
  if (text.includes("rat ") || text.includes("mouse") || text.includes("chimpanzee")) score -= 20;
  if (!candidate.allowed) score -= 80;
  if (candidate.kind === "gif") score -= 20;

  return score;
}

function normalizeCandidate(page, categories) {
  const info = page.imageinfo?.[0];
  if (!info?.url) return null;
  const metadata = info.extmetadata || {};
  const licenseShortName = stripHtml(metadataValue(metadata, "LicenseShortName"));
  const license = licenseState(licenseShortName);
  const title = page.title || "";
  const description = stripHtml(metadataValue(metadata, "ImageDescription"));
  const kind = fileKind(title, info.mime);
  const sourceUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(title).replace(/%3A/i, ":")}`;

  const candidate = {
    id: `commons-${page.pageid}`,
    title,
    sourceUrl,
    originalUrl: info.url,
    kind,
    mime: info.mime,
    width: info.width,
    height: info.height,
    byteLength: info.size,
    sha1: info.sha1,
    artist: stripHtml(metadataValue(metadata, "Artist")),
    credit: stripHtml(metadataValue(metadata, "Credit")),
    description,
    license: {
      shortName: licenseShortName,
      url: stripHtml(metadataValue(metadata, "LicenseUrl")),
      usageTerms: stripHtml(metadataValue(metadata, "UsageTerms")),
      attributionRequired: stripHtml(metadataValue(metadata, "AttributionRequired")) || "true",
    },
    allowed: license.allowed,
    licenseReason: license.reason,
    categories,
  };

  return {
    ...candidate,
    score: scoreCandidate(candidate),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const limitPerCategory = Number(args.limit || 80);
  const output = args.output || "recall/candidates/wikimedia-brain-candidates.json";
  const categories = args.category
    ? String(args.category).split(",").map(item => item.trim()).filter(Boolean)
    : DEFAULT_CATEGORIES;

  const categoryTitleMap = new Map();
  for (const category of categories) {
    const titles = await categoryMembers(category, limitPerCategory);
    for (const title of titles) {
      const found = categoryTitleMap.get(title) || [];
      categoryTitleMap.set(title, [...found, category]);
    }
  }

  const pages = await imageInfo([...categoryTitleMap.keys()]);
  const candidates = pages
    .map(page => normalizeCandidate(page, categoryTitleMap.get(page.title) || []))
    .filter(Boolean)
    .filter(candidate => ["svg", "png", "jpg", "webp"].includes(candidate.kind))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const payload = {
    generatedAt: new Date().toISOString(),
    provider: "wikimedia-commons",
    categories,
    count: candidates.length,
    allowedCount: candidates.filter(candidate => candidate.allowed).length,
    candidates,
  };

  const outputPath = path.join(root, output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    outputPath,
    count: payload.count,
    allowedCount: payload.allowedCount,
    top: candidates.slice(0, 12).map(candidate => ({
      score: candidate.score,
      title: candidate.title,
      kind: candidate.kind,
      size: `${candidate.width}x${candidate.height}`,
      license: candidate.license.shortName,
      allowed: candidate.allowed,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
