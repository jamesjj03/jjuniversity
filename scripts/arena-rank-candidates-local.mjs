import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

const root = process.cwd();
const DEFAULT_MODEL = "mistralai/mistral-small-3.2";
const DEFAULT_ENDPOINT = "http://127.0.0.1:1234/v1/chat/completions";

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function candidateText(candidate) {
  return `${candidate.title} ${candidate.description || ""} ${candidate.artist || ""} ${candidate.credit || ""}`.toLowerCase();
}

function heuristicQuality(candidate) {
  const text = candidateText(candidate);
  const title = String(candidate.title || "").toLowerCase();
  let score = candidate.score || 0;

  if (!candidate.allowed) score -= 100;
  if (candidate.kind === "svg") score += 18;
  if (candidate.width >= 900 && candidate.height >= 600) score += 10;
  if (text.includes("no text") || text.includes("unlabeled") || text.includes("without labels")) score += 30;
  if (text.includes("diagram")) score += 14;
  if (text.includes("sagittal")) score += 12;
  if (text.includes("lateral")) score += 8;
  if (text.includes("label")) score -= 55;
  if (text.includes("highlighted")) score -= 30;
  if (text.includes("head") || text.includes("face") || text.includes("skull")) score -= 30;
  if (text.includes("mri") || text.includes("ct ") || text.includes("autopsy") || text.includes("photograph")) score -= 45;
  if (text.includes("watercolour") || text.includes("engraving") || text.includes("wellcome")) score -= 80;
  if (text.includes("cognitive science") || text.includes("heptagram")) score -= 80;
  if (text.includes("embryo") || text.includes("fetal") || text.includes("foetal")) score -= 70;
  if (text.includes("broca") || text.includes("wernicke")) score -= 48;
  if (text.includes("vascular territory") || text.includes("vascular territories")) score -= 34;
  if (text.includes("blausen")) score -= 60;
  if (text.includes("3d print") || text.includes("3dprinted") || text.includes("printed brain")) score -= 90;
  if (text.includes("dog") || text.includes("rat ") || text.includes("mouse")) score -= 90;
  if (text.includes("retina") || text.includes("sitnici") || text.includes("neuron")) score -= 70;
  if (text.includes("amentia") || text.includes("pathology")) score -= 70;
  if (title.includes("brain anatomy (sagittal)") || title.includes("capts") || title.includes("-en.")) score -= 72;

  return score;
}

function hardReject(candidate) {
  const text = candidateText(candidate);
  const title = String(candidate.title || "").toLowerCase();
  return [
    "blausen",
    "wellcome",
    "watercolour",
    "engraving",
    "embryo",
    "broca",
    "wernicke",
    "heptagram",
    "cognitive science",
    "mri",
    "autopsy",
    "3d print",
    "3dprinted",
    "printed brain",
    "dog",
    "retina",
    "sitnici",
    "amentia",
    "pathology",
  ].some(term => text.includes(term))
    || title.includes("brain anatomy (sagittal)")
    || title.includes("capts")
    || title.includes("-en.");
}

function prefilter(candidates, limit) {
  return candidates
    .filter(candidate => candidate.allowed)
    .filter(candidate => /brain|cerebr|lobe|sagittal|lateral|cortex|gyri|neuro/i.test(`${candidate.title} ${candidate.description || ""}`))
    .filter(candidate => !hardReject(candidate))
    .map(candidate => ({ ...candidate, heuristicQuality: heuristicQuality(candidate) }))
    .sort((a, b) => b.heuristicQuality - a.heuristicQuality || a.title.localeCompare(b.title))
    .slice(0, limit);
}

function modelPrompt(candidates) {
  const compact = candidates.map((candidate, index) => ({
    index: candidate.globalIndex ?? index,
    title: candidate.title,
    kind: candidate.kind,
    size: `${candidate.width}x${candidate.height}`,
    license: candidate.license?.shortName,
    description: String(candidate.description || "").slice(0, 220),
    artist: String(candidate.artist || "").slice(0, 120),
    heuristicQuality: candidate.heuristicQuality,
  }));

  return [
    "You are selecting source diagrams for a visual recall game called Arena.",
    "Pick diagrams that are best for clickable hit zones and student recall.",
    "Strongly prefer: unlabeled or label-removable, diagrammatic/clean, anatomically useful, not photoreal/fleshy, no face/head background unless unavoidable, enough detail for targets, open license.",
    "Strongly reject: already-labeled quiz answers, photos/MRI/autopsy, historical engraving/watercolor, cognitive-science diagrams, decorative/irrelevant files, overly basic blob diagrams.",
    "Return strict JSON only with this shape:",
    "{\"ranked\":[{\"index\":0,\"verdict\":\"promote|maybe|reject\",\"score\":0,\"reason\":\"short reason\",\"useCase\":\"short use case\"}]}",
    "Use the provided metadata only. If metadata suggests labels are present, mark maybe or reject unless it could be used only as a teacher key.",
    JSON.stringify(compact),
  ].join("\n\n");
}

function visualPrompt(candidates) {
  const compact = candidates.map((candidate, index) => ({
    index: candidate.globalIndex ?? index,
    title: candidate.title,
    kind: candidate.kind,
    size: `${candidate.width}x${candidate.height}`,
    license: candidate.license?.shortName,
    description: String(candidate.description || "").slice(0, 180),
    heuristicQuality: candidate.heuristicQuality,
  }));

  return [
    "You are selecting source diagrams for a clickable visual recall game called Arena.",
    "You can see a contact sheet. Each tile is marked with its exact candidate index.",
    "Judge by the image first and metadata second.",
    "Promote clean unlabeled diagrams that would make good hit-zone games.",
    "Reject images that are already labeled, too fleshy/photographic, ugly, irrelevant, too specialized for the base pack, or only useful as an answer key.",
    "Return strict JSON only with this shape:",
    "{\"ranked\":[{\"index\":0,\"verdict\":\"promote|maybe|reject\",\"score\":0,\"reason\":\"short reason\",\"useCase\":\"short use case\"}]}",
    JSON.stringify(compact),
  ].join("\n\n");
}

function heuristicReview(candidate, index, shortlistSize) {
  const text = candidateText(candidate);
  const title = String(candidate.title || "").toLowerCase();

  if (title.includes("brain lateral (nih bioart 60)")) {
    return {
      index,
      verdict: "promote",
      score: candidate.heuristicQuality + (candidate.kind === "svg" ? 8 : 4),
      reason: "Clean unlabeled lateral base with open public-domain source.",
      useCase: "Use as the first lateral-view Arena source.",
    };
  }

  if (title.includes("gyri of lateral cortex")) {
    return {
      index,
      verdict: "reject",
      score: candidate.heuristicQuality - 45,
      reason: "Already labeled; useful as a fact/key reference, not as the playable diagram.",
      useCase: "Teacher key only.",
    };
  }

  if (text.includes("highlighted") || text.includes("names the") || text.includes("description")) {
    return {
      index,
      verdict: "reject",
      score: candidate.heuristicQuality - 36,
      reason: "The image appears to reveal answers through labels or highlighted structures.",
      useCase: "Reference only.",
    };
  }

  if (text.includes("vascular territor") || title.includes("- es.") || title.includes("sulci") || title.includes("insula")) {
    return {
      index,
      verdict: "reject",
      score: candidate.heuristicQuality - 28,
      reason: "Too specialized or likely pre-labeled for the base brain pack.",
      useCase: "Possible later specialist pack.",
    };
  }

  if (title.includes("midsagital") || title.includes("midsagittal")) {
    return {
      index,
      verdict: "maybe",
      score: candidate.heuristicQuality + 8,
      reason: "Potential sagittal base, but needs visual inspection before promotion.",
      useCase: "Candidate replacement for the current sagittal source.",
    };
  }

  if (title.includes("lobes of the brain")) {
    return {
      index,
      verdict: "maybe",
      score: candidate.heuristicQuality + 3,
      reason: "May work for a lobe-category pack if it is not already labeled.",
      useCase: "Later lobe pack candidate.",
    };
  }

  return {
    index,
    verdict: index < shortlistSize ? "maybe" : "reject",
    score: candidate.heuristicQuality,
    reason: "Passed hard metadata filters; needs visual review before promotion.",
    useCase: "Needs visual review.",
  };
}

function parseJsonResponse(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return JSON.parse(match[0]);
  }
}

async function postChatWithTimeout(endpoint, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImageBuffer(url) {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "JJU-Arena/0.1 (local visual diagram review)",
        },
      });

      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = new Error(`${response.status} ${response.statusText}`);

      if (response.status === 429 || response.status >= 500) {
        await sleep(900 * (attempt + 1));
        continue;
      }

      break;
    } catch (error) {
      lastError = error;
      await sleep(900 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Image download failed.");
}

async function previewForCandidate(candidate) {
  try {
    const input = await fetchImageBuffer(candidate.originalUrl);
    return await sharp(input, { density: 144 })
      .resize(300, 210, { fit: "inside", background: "#fff" })
      .flatten({ background: "#fff" })
      .png()
      .toBuffer();
  } catch {
    return Buffer.from(
      `<svg width="300" height="210" xmlns="http://www.w3.org/2000/svg">
        <rect width="300" height="210" fill="#fff"/>
        <text x="150" y="94" text-anchor="middle" font-family="Arial" font-size="15" fill="#6b4e14">preview unavailable</text>
        <text x="150" y="118" text-anchor="middle" font-family="Arial" font-size="12" fill="#6b4e14">${escapeXml(candidate.kind)}</text>
      </svg>`,
    );
  }
}

async function makeContactSheet(candidates, args) {
  const tileWidth = 360;
  const tileHeight = 300;
  const columns = Math.min(3, Math.max(1, candidates.length));
  const rows = Math.ceil(candidates.length / columns);
  const composites = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const preview = await previewForCandidate(candidate);
    const metadata = await sharp(preview).metadata();
    const left = (index % columns) * tileWidth;
    const top = Math.floor(index / columns) * tileHeight;
    const globalIndex = candidate.globalIndex ?? index;
    const title = candidate.title.replace(/^File:/, "").slice(0, 42);
    const label = Buffer.from(
      `<svg width="${tileWidth}" height="82" xmlns="http://www.w3.org/2000/svg">
        <style>
          text { font-family: Arial, sans-serif; fill: #1d160d; }
          .n { font-size: 21px; font-weight: 700; }
          .t { font-size: 13px; }
        </style>
        <text class="n" x="14" y="26">#${globalIndex}</text>
        <text class="t" x="58" y="26">${escapeXml(title)}</text>
        <text class="t" x="58" y="49">${escapeXml(candidate.kind)} ${candidate.width}x${candidate.height}</text>
      </svg>`,
    );

    composites.push({
      input: await sharp({
        create: {
          width: tileWidth,
          height: tileHeight,
          channels: 4,
          background: "#f7f3e8",
        },
      })
        .composite([
          {
            input: preview,
            left: Math.round((tileWidth - (metadata.width || 300)) / 2),
            top: 10,
          },
          { input: label, left: 0, top: 218 },
        ])
        .png()
        .toBuffer(),
      left,
      top,
    });
  }

  const sheet = await sharp({
    create: {
      width: tileWidth * columns,
      height: tileHeight * rows,
      channels: 4,
      background: "#201a12",
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  if (args["sheet-dir"]) {
    const sheetDir = path.join(root, args["sheet-dir"]);
    await mkdir(sheetDir, { recursive: true });
    const firstIndex = candidates[0]?.globalIndex ?? 0;
    await writeFile(path.join(sheetDir, `arena-candidates-${firstIndex}.png`), sheet);
  }

  return `data:image/png;base64,${sheet.toString("base64")}`;
}

async function rankChunkWithModel(candidates, args) {
  const endpoint = args.endpoint || process.env.LM_STUDIO_ENDPOINT || DEFAULT_ENDPOINT;
  const model = args.model || process.env.LM_STUDIO_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number(args["timeout-ms"] || process.env.LM_STUDIO_TIMEOUT_MS || 60000);
  const userContent = args.visual
    ? [
        { type: "text", text: visualPrompt(candidates) },
        { type: "image_url", image_url: { url: await makeContactSheet(candidates, args) } },
      ]
    : modelPrompt(candidates);

  const response = await postChatWithTimeout(endpoint, {
      model,
      temperature: 0.1,
      max_tokens: Number(args["max-tokens"] || 900),
      messages: [
        {
          role: "system",
          content: "You are a strict educational diagram curator. Return valid JSON only. No markdown fences.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    },
    timeoutMs,
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`LM Studio ranking failed: ${response.status} ${response.statusText}${errorText ? ` ${errorText}` : ""}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "";
  return parseJsonResponse(text);
}

async function rankWithModel(candidates, args, shortlistSize) {
  const chunkSize = Number(args["chunk-size"] || 6);
  const ranked = [];
  const errors = [];

  for (let start = 0; start < candidates.length; start += chunkSize) {
    const chunk = candidates.slice(start, start + chunkSize).map((candidate, offset) => ({
      ...candidate,
      globalIndex: start + offset,
    }));

    try {
      const result = await rankChunkWithModel(chunk, args);
      ranked.push(...(result.ranked || []));
    } catch (error) {
      errors.push(`chunk ${start}-${start + chunk.length - 1}: ${error instanceof Error ? error.message : error}`);
      ranked.push(...chunk.map((candidate, offset) => heuristicReview(candidate, start + offset, shortlistSize)));
    }
  }

  return { ranked, errors };
}

async function main() {
  const args = parseArgs(process.argv);
  const input = path.join(root, args.input || "recall/candidates/wikimedia-brain-candidates.json");
  const output = path.join(root, args.output || "recall/candidates/wikimedia-brain-shortlist.json");
  const limit = Number(args.limit || 36);
  const shortlistSize = Number(args["shortlist-size"] || 12);
  const data = JSON.parse(await readFile(input, "utf8"));
  const candidates = prefilter(data.candidates || [], limit);

  let ranking;
  let modelUsed = "heuristic-only";

  if (args["no-model"]) {
    ranking = {
      ranked: candidates.map((candidate, index) => heuristicReview(candidate, index, shortlistSize)),
    };
  } else {
    ranking = await rankWithModel(candidates, args, shortlistSize);
    modelUsed = args.model || process.env.LM_STUDIO_MODEL || DEFAULT_MODEL;
    if (args.visual) modelUsed = `${modelUsed}+vision`;
    if (ranking.errors?.length) modelUsed = `${modelUsed}+heuristic-fallback`;
  }

  const byIndex = new Map((ranking.ranked || []).map(item => [Number(item.index), item]));
  const ranked = candidates
    .map((candidate, index) => {
      const model = byIndex.get(index) || {};
      return {
        ...candidate,
        curator: {
          verdict: model.verdict || "maybe",
          score: Number(model.score ?? candidate.heuristicQuality),
          reason: model.reason || "No model reason returned.",
          useCase: model.useCase || "Needs visual review.",
        },
      };
    })
    .sort((a, b) => {
      const verdictWeight = { promote: 3, maybe: 2, reject: 1 };
      return (verdictWeight[b.curator.verdict] || 0) - (verdictWeight[a.curator.verdict] || 0)
        || b.curator.score - a.curator.score
        || b.heuristicQuality - a.heuristicQuality
        || a.title.localeCompare(b.title);
    });

  const shortlist = args["include-rejects"]
    ? ranked.slice(0, shortlistSize)
    : ranked.filter(candidate => candidate.curator.verdict !== "reject").slice(0, shortlistSize);

  const payload = {
    generatedAt: new Date().toISOString(),
    model: modelUsed,
    criteria: [
      "unlabeled or label-removable",
      "diagrammatic and clean",
      "not photoreal/fleshy",
      "no face/head background unless useful",
      "enough anatomical detail for hit zones",
      "open license and clear attribution",
    ],
    sourceCount: data.candidates?.length || 0,
    reviewedCount: candidates.length,
    rejectedCount: ranked.filter(candidate => candidate.curator.verdict === "reject").length,
    rankingMode: args.visual ? "visual-contact-sheet" : "metadata",
    modelErrors: ranking.errors || [],
    shortlist,
  };

  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output,
    model: modelUsed,
    reviewedCount: payload.reviewedCount,
    shortlist: payload.shortlist.map(candidate => ({
      verdict: candidate.curator.verdict,
      score: candidate.curator.score,
      title: candidate.title,
      reason: candidate.curator.reason,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
