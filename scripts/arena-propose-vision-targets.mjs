import { readFile, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";

const root = process.cwd();
const DEFAULT_ENDPOINT = "http://127.0.0.1:1234/v1/chat/completions";
const DEFAULT_MODEL = "mistralai/mistral-small-3.2";

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

function attr(value, name) {
  const found = value.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return found?.[1] || "";
}

function svgViewBox(svg) {
  const svgOpen = svg.match(/<(?:(?:[A-Za-z_][\w.-]*):)?svg\b[^>]*>/i)?.[0] || "";
  const values = attr(svgOpen, "viewBox").split(/[\s,]+/).map(Number).filter(Number.isFinite);
  if (values.length !== 4 || values[2] <= 0 || values[3] <= 0) return null;
  return { width: values[2], height: values[3] };
}

async function diagramFrame(draft, localImagePath) {
  if (localImagePath.toLowerCase().endsWith(".svg")) {
    const viewBox = svgViewBox(await readFile(localImagePath, "utf8"));
    if (viewBox) {
      return {
        width: Number(viewBox.width.toFixed(2)),
        height: Number(viewBox.height.toFixed(2)),
      };
    }
  }

  return {
    width: Number(draft.diagram.width),
    height: Number(draft.diagram.height),
  };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

async function imageInput(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: {
        "User-Agent": "JJU-Arena/0.1 (local vision target proposal)",
      },
    });
    if (!response.ok) throw new Error(`Vision image download failed: ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  }

  return source.toLowerCase().endsWith(".svg") ? await readFile(source) : source;
}

async function imageDataUrl(source, previewWidth) {
  const input = await imageInput(source);
  const png = await sharp(input, { density: 144 })
    .resize({ width: previewWidth, withoutEnlargement: true })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function promptForDraft(draft, frame, limit) {
  return [
    "You are proposing candidate target dots for Arena, an educational visual recall game.",
    "The image is an unlabeled lateral view of a human brain. It will be used for clickable recall practice.",
    "Return strict JSON only, with no markdown:",
    "{\"targets\":[{\"label\":\"frontal lobe\",\"aliases\":[\"frontal cortex\"],\"xPct\":28,\"yPct\":36,\"confidence\":0.7,\"functions\":[\"planning and voluntary movement\"],\"reviewNote\":\"short note\"}]}",
    `Use percentage coordinates from the image: xPct 0 is left, 100 is right, yPct 0 is top, 100 is bottom. The overlay frame is ${frame.width} by ${frame.height}.`,
    `Return ${limit} or fewer targets.`,
    "Prefer broad visible structures only. Good examples if visually defensible: frontal lobe, parietal lobe, temporal lobe, occipital lobe, cerebellum, brainstem.",
    "Do not include hidden/internal structures that are not visible in a lateral exterior diagram, such as thalamus, hypothalamus, amygdala, hippocampus, pituitary gland, corpus callosum, or ventricles.",
    "Keep facts short and conservative. Every target will still require human review before publish.",
    `Draft: ${draft.id} / ${draft.title}`,
  ].join("\n\n");
}

function fallbackTargets(limit) {
  return [
    {
      label: "frontal lobe",
      aliases: ["frontal cortex"],
      xPct: 28,
      yPct: 38,
      confidence: 0.42,
      functions: ["planning and voluntary movement", "speech production support"],
      reviewNote: "Heuristic fallback placement after local vision did not complete.",
    },
    {
      label: "parietal lobe",
      aliases: ["parietal cortex"],
      xPct: 51,
      yPct: 26,
      confidence: 0.4,
      functions: ["body sensation and spatial attention"],
      reviewNote: "Heuristic fallback placement after local vision did not complete.",
    },
    {
      label: "temporal lobe",
      aliases: ["temporal cortex"],
      xPct: 49,
      yPct: 61,
      confidence: 0.42,
      functions: ["hearing and language comprehension", "memory support"],
      reviewNote: "Heuristic fallback placement after local vision did not complete.",
    },
    {
      label: "occipital lobe",
      aliases: ["visual cortex region"],
      xPct: 77,
      yPct: 39,
      confidence: 0.38,
      functions: ["visual processing"],
      reviewNote: "Heuristic fallback placement after local vision did not complete.",
    },
    {
      label: "cerebellum",
      aliases: [],
      xPct: 78,
      yPct: 75,
      confidence: 0.36,
      functions: ["coordination and balance"],
      reviewNote: "Heuristic fallback placement after local vision did not complete.",
    },
    {
      label: "brainstem",
      aliases: ["brain stem"],
      xPct: 66,
      yPct: 79,
      confidence: 0.34,
      functions: ["breathing, heart rate, and arousal control"],
      reviewNote: "Heuristic fallback placement after local vision did not complete.",
    },
  ].slice(0, limit);
}

async function callVisionModel({ endpoint, model, prompt, imageUrl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1800,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Vision model failed: ${response.status} ${response.statusText} ${await response.text()}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Vision model returned no content.");
    return parseJsonResponse(content);
  } finally {
    clearTimeout(timer);
  }
}

function targetFromModel(item, index, frame, radius) {
  const label = String(item.label || `Target ${index + 1}`).trim();
  const xPct = Number(item.xPct);
  const yPct = Number(item.yPct);
  const safeX = Number.isFinite(xPct) ? clamp(xPct, 0, 100) : 50;
  const safeY = Number.isFinite(yPct) ? clamp(yPct, 0, 100) : 50;
  const number = String(index + 1).padStart(2, "0");
  const id = `${slugify(label) || "vision-target"}-${number}`;
  const reviewNote = item.reviewNote ? String(item.reviewNote) : "";
  const firstReviewNote = reviewNote.toLowerCase().includes("heuristic fallback")
    ? "Heuristic fallback proposed this dot after local vision did not complete."
    : "Vision model proposed this dot from the source image.";

  return {
    id,
    label,
    aliases: Array.isArray(item.aliases) ? item.aliases.map(String).filter(Boolean).slice(0, 5) : [],
    kind: "dot",
    reviewStatus: "ai-suggested",
    difficulty: 2,
    color: "#d6b25e",
    confidence: Number.isFinite(Number(item.confidence)) ? clamp(Number(item.confidence), 0, 1) : 0.45,
    shape: {
      type: "circle",
      cx: Number(((safeX / 100) * frame.width).toFixed(2)),
      cy: Number(((safeY / 100) * frame.height).toFixed(2)),
      r: radius,
    },
    functions: Array.isArray(item.functions) ? item.functions.map(String).filter(Boolean).slice(0, 3) : [],
    reviewNotes: [
      firstReviewNote,
      reviewNote || "Needs human anatomy/source review before publish.",
    ],
  };
}

function queueKey(item) {
  return `${item.targetId || ""}::${item.field || ""}::${item.message || ""}`;
}

function uniqueQueue(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = queueKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const packId = args.pack;
  if (!packId) throw new Error("Usage: node scripts/arena-propose-vision-targets.mjs --pack brain-lateral-source-v1");

  const draftPath = path.join(root, "recall", "drafts", `${packId}.json`);
  const draft = JSON.parse(await readFile(draftPath, "utf8"));
  if (!draft.diagram?.imageSrc) throw new Error(`Draft ${packId} does not have a diagram imageSrc.`);

  const localImagePath = path.join(root, "public", draft.diagram.imageSrc.replace(/^\//, ""));
  const frame = await diagramFrame(draft, localImagePath);
  const limit = Number(args.limit || 8);
  const radius = Number(args.radius || Math.max(8, Math.round(Math.min(frame.width, frame.height) * 0.045)));
  const endpoint = args.endpoint || DEFAULT_ENDPOINT;
  const model = args.model || DEFAULT_MODEL;
  const visionImageSource = args["vision-image"] || localImagePath;
  const imageUrl = await imageDataUrl(visionImageSource, Number(args["preview-width"] || 900));
  let response = null;
  let modelError = "";

  try {
    response = await callVisionModel({
      endpoint,
      model,
      prompt: promptForDraft(draft, frame, limit),
      imageUrl,
      timeoutMs: Number(args.timeout || 120000),
    });
  } catch (error) {
    modelError = error instanceof Error ? error.message : String(error);
    if (!args["allow-fallback"]) throw error;
  }

  const rawTargets = Array.isArray(response?.targets) ? response.targets.slice(0, limit) : fallbackTargets(limit);
  if (!rawTargets.length) throw new Error("Vision model did not return any targets.");

  const targets = rawTargets.map((item, index) => targetFromModel(item, index, frame, radius));
  const now = new Date().toISOString();
  const existingQueue = Array.isArray(draft.correctionQueue) ? draft.correctionQueue : [];
  const proposedQueue = [
    ...targets.map(target => ({
      targetId: target.id,
      field: "target",
      message: `Review dot placement for ${target.label}.`,
      status: "open",
    })),
    ...targets.map(target => ({
      targetId: target.id,
      field: "fact",
      message: `Review fact prompts for ${target.label}.`,
      status: "open",
    })),
  ];

  const next = {
    ...draft,
    updatedAt: now,
    publishable: false,
    blockReasons: [
      ...new Set([
        ...(draft.blockReasons || []),
        "vision target placement requires review",
        "fact prompts required",
      ]),
    ],
    diagram: {
      ...draft.diagram,
      width: frame.width,
      height: frame.height,
      overlayMode: "dots",
    },
    approval: {
      ...(draft.approval || {}),
      targets: "needs-review",
      facts: "needs-review",
      publish: "blocked",
    },
    automation: {
      ...(draft.automation || {}),
      status: response ? "vision-targets-proposed" : "heuristic-targets-proposed",
      modelPlan: response
        ? `Vision anchors proposed by ${model}; human review remains required before publish.`
        : `Local vision did not complete (${modelError}); heuristic preview anchors were staged and require human review.`,
      stages: (draft.automation?.stages || []).map(stage => {
        if (stage.id === "vision-pass") {
          return {
            ...stage,
            status: "active",
            owner: response ? "local model" : "pipeline",
            detail: response
              ? `Proposed ${targets.length} visible target dots with ${model}.`
              : `Local vision did not complete; staged ${targets.length} heuristic preview dots.`,
          };
        }
        if (stage.id === "fact-pass") {
          return {
            ...stage,
            status: "active",
            owner: "local model",
            detail: "Initial fact prompts were generated with target proposals and need review.",
          };
        }
        if (stage.id === "review-pass") {
          return {
            ...stage,
            status: "active",
            owner: "review",
            detail: "Review target placement, labels, aliases, and facts.",
          };
        }
        return stage;
      }),
    },
    targets,
    correctionQueue: uniqueQueue([...existingQueue, ...proposedQueue]),
  };

  await writeFile(draftPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    packId,
    model,
    localImagePath,
    visionImageSource,
    proposedTargets: targets.length,
    fallbackUsed: !response,
    modelError,
    frame,
    draftPath,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
