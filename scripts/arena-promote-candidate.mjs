import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const WORKING_NAME = "Arena";

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

function extFrom(candidate, localFile) {
  const found = String(localFile || candidate.originalUrl || candidate.title || "").match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1];
  if (found) return found.toLowerCase();
  if (candidate.mime === "image/svg+xml") return "svg";
  if (candidate.mime === "image/png") return "png";
  if (candidate.mime === "image/jpeg") return "jpg";
  if (candidate.mime === "image/webp") return "webp";
  return "bin";
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

async function downloadFile(url, destination) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "JJU-Arena/0.1 (candidate promotion; local educational asset review)",
      },
    });

    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      return bytes.length;
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Candidate download failed: ${response.status} ${response.statusText}`);
    }

    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await new Promise(resolve => setTimeout(resolve, retryAfter ? retryAfter * 1000 : 1500 * (attempt + 1)));
  }

  throw new Error("Candidate download failed after retries.");
}

async function stageMedia(candidate, packId, sourceId, localFile) {
  const ext = extFrom(candidate, localFile);
  const publicPath = `/arena/diagrams/${packId}/${sourceId}.${ext}`;
  const relativeLocalPath = path.join("public", "arena", "diagrams", packId, `${sourceId}.${ext}`);
  const absoluteLocalPath = path.join(root, relativeLocalPath);

  await mkdir(path.dirname(absoluteLocalPath), { recursive: true });

  let byteLength = 0;
  if (localFile) {
    const absoluteInput = path.isAbsolute(localFile) ? localFile : path.join(root, localFile);
    await copyFile(absoluteInput, absoluteLocalPath);
    byteLength = Buffer.byteLength(await readFile(absoluteLocalPath));
  } else {
    byteLength = await downloadFile(candidate.originalUrl, absoluteLocalPath);
  }

  return { publicPath, relativeLocalPath, byteLength };
}

function sourceRecord(candidate, sourceId, media) {
  return {
    id: sourceId,
    provider: "wikimedia-commons",
    importedAt: new Date().toISOString(),
    title: candidate.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
    fileTitle: candidate.title,
    sourceUrl: candidate.sourceUrl,
    originalUrl: candidate.originalUrl,
    description: candidate.description || "",
    artist: candidate.artist || "",
    artistHtml: candidate.artist || "",
    credit: candidate.credit || "",
    creditHtml: candidate.credit || "",
    license: {
      shortName: candidate.license?.shortName || "",
      url: candidate.license?.url || "",
      usageTerms: candidate.license?.usageTerms || "",
      attributionRequired: candidate.license?.attributionRequired || "true",
      allowedByImporter: Boolean(candidate.allowed),
      importerReason: candidate.licenseReason || "Candidate promoted from discovery list.",
    },
    media: {
      mime: candidate.mime,
      width: candidate.width,
      height: candidate.height,
      sha1: candidate.sha1,
      byteLength: media.byteLength,
      publicPath: media.publicPath,
      localPath: media.relativeLocalPath,
    },
    review: {
      source: "needs-review",
      license: candidate.allowed ? "needs-review" : "blocked",
      attribution: "needs-review",
    },
  };
}

function draftPack({ args, packId, source }) {
  const title = args["pack-title"] || source.title || packId;
  const blockReasons = [
    "source review required",
    "target review required",
    "fact review required",
    "image target detection required",
  ];

  return {
    id: packId,
    title,
    workingName: WORKING_NAME,
    category: args.category || "anatomy",
    domain: args.domain || "neuroscience",
    status: "draft",
    publishable: false,
    blockReasons,
    version: 0,
    summary: args.summary || `Candidate Arena draft promoted from ${source.fileTitle}.`,
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
      status: "candidate-promoted",
      modelPlan: "Use local vision plus review to identify label anchors, target zones, aliases, and facts before publish.",
      stages: [
        {
          id: "source-hunt",
          label: "Pull candidate diagram",
          status: "complete",
          owner: "pipeline",
          detail: `Promoted ${source.fileTitle} from Wikimedia candidate discovery.`,
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
          detail: "Raster diagram needs label/arrow detection before targets can be proposed.",
        },
        {
          id: "fact-pass",
          label: "Generate fact prompts",
          status: "queued",
          owner: "local model",
          detail: "Waiting for approved target labels.",
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
    correctionQueue: [
      {
        field: "target",
        message: "Run raster label/arrow detection and propose target hit zones.",
        status: "open",
      },
      {
        field: "fact",
        message: "Generate function prompts after target labels are approved.",
        status: "open",
      },
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const candidateTitle = args.title || args.candidate;
  if (!candidateTitle) {
    throw new Error("Usage: node scripts/arena-promote-candidate.mjs --title \"File:Example.png\" --pack pack-id --local-file tmp/example.png");
  }

  const candidatesPath = path.join(root, args.candidates || "recall/candidates/wikimedia-brain-candidates.json");
  const candidates = await readJson(candidatesPath, { candidates: [] });
  const candidate = candidates.candidates.find(item => item.title === candidateTitle || item.id === candidateTitle);
  if (!candidate) throw new Error(`Candidate not found: ${candidateTitle}`);
  if (!candidate.allowed && !args["allow-blocked-license"]) throw new Error(`Blocked candidate: ${candidate.licenseReason}`);

  const packId = slugify(args.pack || candidate.title);
  const pageId = candidate.id?.replace(/^commons-/, "") || slugify(candidate.title);
  const sourceId = `wikimedia-${pageId}-${String(candidate.sha1 || "").slice(0, 10) || slugify(candidate.title)}`;
  const media = await stageMedia(candidate, packId, sourceId, args["local-file"]);
  const source = sourceRecord(candidate, sourceId, media);

  await writeJson(path.join(root, "recall", "sources", `${sourceId}.json`), source);

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
    promoted: true,
    packId,
    sourceId,
    draftPath,
    publicPath: media.publicPath,
    title: candidate.title,
    license: source.license.shortName,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
