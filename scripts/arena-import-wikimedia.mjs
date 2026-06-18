import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const WORKING_NAME = "Arena";
const root = process.cwd();

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

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^file:/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extFrom(url, mime) {
  const pathname = new URL(url).pathname;
  const found = pathname.match(/\.([a-z0-9]+)$/i)?.[1];
  if (found) return found.toLowerCase();
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
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

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function getCommonsFile(title) {
  const normalizedTitle = title.startsWith("File:") ? title : `File:${title}`;
  const url = new URL(COMMONS_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "imageinfo|info");
  url.searchParams.set("iiprop", "url|mime|size|extmetadata|sha1|user|timestamp");
  url.searchParams.set("titles", normalizedTitle);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Commons metadata failed: ${response.status} ${response.statusText}`);
  const data = await response.json();
  const page = Object.values(data.query?.pages || {})[0];
  if (!page || page.missing) throw new Error(`Wikimedia file not found: ${normalizedTitle}`);
  const imageInfo = page.imageinfo?.[0];
  if (!imageInfo?.url) throw new Error(`No downloadable image URL for ${normalizedTitle}`);
  return { page, imageInfo, normalizedTitle };
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return bytes.length;
}

function sourceRecord({ page, imageInfo, normalizedTitle, sourceId, publicPath, localPath, byteLength }) {
  const metadata = imageInfo.extmetadata || {};
  const licenseShortName = stripHtml(metadataValue(metadata, "LicenseShortName"));
  const license = licenseState(licenseShortName);
  const sourceUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(normalizedTitle).replace(/%3A/i, ":")}`;

  return {
    id: sourceId,
    provider: "wikimedia-commons",
    importedAt: new Date().toISOString(),
    title: stripHtml(metadataValue(metadata, "ObjectName")) || page.title || normalizedTitle,
    fileTitle: normalizedTitle,
    sourceUrl,
    originalUrl: imageInfo.url,
    description: stripHtml(metadataValue(metadata, "ImageDescription")),
    artist: stripHtml(metadataValue(metadata, "Artist")),
    artistHtml: metadataValue(metadata, "Artist"),
    credit: stripHtml(metadataValue(metadata, "Credit")),
    creditHtml: metadataValue(metadata, "Credit"),
    license: {
      shortName: licenseShortName,
      url: stripHtml(metadataValue(metadata, "LicenseUrl")),
      usageTerms: stripHtml(metadataValue(metadata, "UsageTerms")),
      attributionRequired: stripHtml(metadataValue(metadata, "AttributionRequired")) || "true",
      allowedByImporter: license.allowed,
      importerReason: license.reason,
    },
    media: {
      mime: imageInfo.mime,
      width: imageInfo.width,
      height: imageInfo.height,
      sha1: imageInfo.sha1,
      byteLength,
      publicPath,
      localPath,
    },
    review: {
      source: "needs-review",
      license: license.allowed ? "needs-review" : "blocked",
      attribution: "needs-review",
    },
  };
}

function draftPack({ args, packId, source }) {
  const title = args["pack-title"] || source.title || packId;
  const category = args.category || "anatomy";
  const domain = args.domain || "uncategorized";

  return {
    id: packId,
    title,
    workingName: WORKING_NAME,
    category,
    domain,
    status: "draft",
    publishable: false,
    blockReasons: [
      "source review required",
      "target review required",
      "fact review required",
    ],
    version: 0,
    summary: args.summary || `Draft Arena pack generated from ${source.fileTitle}.`,
    modes: ["find", "function", "review"],
    diagram: {
      sourceId: source.id,
      imageSrc: source.media.publicPath,
      width: source.media.width,
      height: source.media.height,
      mime: source.media.mime,
      overlayMode: "mixed-dots-polygons",
      hitStyle: {
        idleOpacity: 0.02,
        hoverOpacity: 0.14,
        revealOpacity: 0.24,
        stroke: "rgba(255,255,255,.32)",
      },
    },
    approval: {
      source: "needs-review",
      license: source.license.allowedByImporter ? "needs-review" : "blocked",
      attribution: "needs-review",
      targets: "needs-review",
      facts: "needs-review",
      publish: "blocked",
    },
    automation: {
      status: "source-imported",
      modelPlan: "Local-first diagram labeling. AI suggests labels, hit zones, and facts; review edits them before publish.",
      stages: [
        {
          id: "source-hunt",
          label: "Pull candidate diagram",
          status: "complete",
          owner: "pipeline",
          detail: `Imported ${source.fileTitle} from Wikimedia Commons.`,
        },
        {
          id: "license-pass",
          label: "Check source, license, attribution",
          status: source.license.allowedByImporter ? "active" : "blocked",
          owner: "review",
          detail: source.license.importerReason,
        },
        {
          id: "vision-pass",
          label: "Suggest targets",
          status: "queued",
          owner: "local model",
          detail: "Detect diagram labels, dots, and candidate click regions.",
        },
        {
          id: "fact-pass",
          label: "Generate fact prompts",
          status: "queued",
          owner: "local model",
          detail: "Create short function prompts and aliases for each target.",
        },
        {
          id: "review-pass",
          label: "Approve edits",
          status: "queued",
          owner: "review",
          detail: "Human approval is required for source, targets, facts, and final publish.",
        },
        {
          id: "publish-pack",
          label: "Publish pack",
          status: "blocked",
          owner: "system",
          detail: "Blocked until every approval gate passes.",
        },
      ],
    },
    assetLedger: [
      {
        id: source.id,
        type: "diagram-source",
        source: source.sourceUrl,
        license: source.license.shortName,
        licenseUrl: source.license.url,
        attribution: source.artist || source.credit || source.fileTitle,
        status: "needs-review",
        notes: source.license.importerReason,
      },
    ],
    targets: [],
    correctionQueue: [],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.title && !args.file) {
    throw new Error("Usage: node scripts/arena-import-wikimedia.mjs --title \"File:Example.svg\" --pack my-pack --category anatomy --domain neuroscience");
  }

  const commonsTitle = String(args.file || args.title);
  const packId = slugify(args.pack || commonsTitle);
  const { page, imageInfo, normalizedTitle } = await getCommonsFile(commonsTitle);
  const ext = extFrom(imageInfo.url, imageInfo.mime);
  const sourceId = `wikimedia-${page.pageid}-${String(imageInfo.sha1 || "").slice(0, 10) || slugify(normalizedTitle)}`;
  const publicPath = `/arena/diagrams/${packId}/${sourceId}.${ext}`;
  const localPath = path.join("public", "arena", "diagrams", packId, `${sourceId}.${ext}`);
  const byteLength = await downloadFile(imageInfo.url, path.join(root, localPath));
  const source = sourceRecord({ page, imageInfo, normalizedTitle, sourceId, publicPath, localPath, byteLength });

  if (!source.license.allowedByImporter && !args["allow-unknown-license"]) {
    await writeJson(path.join(root, "recall", "sources", `${sourceId}.json`), source);
    throw new Error(`Blocked import after metadata save: ${source.license.importerReason}`);
  }

  const sourceFile = path.join(root, "recall", "sources", `${sourceId}.json`);
  await writeJson(sourceFile, source);

  const ledgerPath = path.join(root, "recall", "source-ledger.json");
  const ledger = await readJson(ledgerPath, { generatedAt: "", sources: [] });
  const others = Array.isArray(ledger.sources) ? ledger.sources.filter(item => item.id !== source.id) : [];
  await writeJson(ledgerPath, {
    generatedAt: new Date().toISOString(),
    sources: [...others, source].sort((a, b) => a.id.localeCompare(b.id)),
  });

  const draft = draftPack({ args, packId, source });
  const draftPath = path.join(root, "recall", "drafts", `${packId}.json`);
  await writeJson(draftPath, draft);

  console.log(JSON.stringify({
    imported: true,
    packId,
    sourceId,
    sourceFile,
    draftPath,
    publicPath,
    license: source.license,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
