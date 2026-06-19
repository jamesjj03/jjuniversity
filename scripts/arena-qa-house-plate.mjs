import { mkdir, readFile, writeFile } from "fs/promises";
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

function normalizeSvgForSharp(svg) {
  const svgTag = svg.match(/<([A-Za-z_][\w.-]*):svg\b/i);
  if (!svgTag) return Buffer.from(svg);

  const prefix = svgTag[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalized = svg
    .replace(new RegExp(`<(/?)${prefix}:`, "g"), "<$1")
    .replace(new RegExp(`\\sxmlns:${prefix}=`, "g"), " xmlns=");
  return Buffer.from(normalized);
}

async function imageDataUrl(localImagePath, previewWidth) {
  const input = localImagePath.toLowerCase().endsWith(".svg")
    ? normalizeSvgForSharp(await readFile(localImagePath, "utf8"))
    : localImagePath;
  const png = await sharp(input, { density: 144 })
    .resize({ width: previewWidth, withoutEnlargement: true })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
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

function promptForDraft(draft) {
  const targets = (draft.targets || []).map(target => ({
    id: target.id,
    label: target.label,
    aliases: target.aliases || [],
    kind: target.kind,
    shape: target.shape,
    functions: target.functions || [],
  }));

  return [
    "You are QA reviewing an unlabeled sagittal brain diagram for an educational visual recall game.",
    "The image is a generated house-style plate. The target layer is generated from the same geometry, so focus on anatomy correctness, label choice, missing obvious structures, and fact wording.",
    "Return strict JSON only, with no markdown.",
    "Schema: {\"verdict\":\"usable-needs-review|needs-rework\",\"corrections\":[{\"targetId\":\"pons\",\"field\":\"target|label|fact|shape\",\"message\":\"short actionable issue\",\"severity\":\"low|medium|high\"}],\"suggestedTargets\":[{\"label\":\"structure\",\"reason\":\"why add it\"}],\"notes\":[\"short note\"]}",
    "Be conservative. Do not invent hidden structures if the drawing does not clearly support them. Human review remains required before publish.",
    `Draft title: ${draft.title}`,
    `Targets: ${JSON.stringify(targets)}`,
  ].join("\n\n");
}

async function callModel({ endpoint, model, prompt, imageUrl, timeoutMs, maxTokens }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: maxTokens,
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
      throw new Error(`QA model failed: ${response.status} ${response.statusText} ${await response.text()}`);
    }

    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("QA model returned no content.");
    return parseJsonResponse(content);
  } finally {
    clearTimeout(timer);
  }
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

function withoutPriorModelQa(items) {
  return items.filter(item => !String(item.message || "").startsWith("[model QA]"));
}

function cleanModelPlan(value) {
  const text = String(value || "").trim();
  return text
    .split(" Model QA attempted")[0]
    .split(" Model QA artifact")[0]
    .trim();
}

async function main() {
  const args = parseArgs(process.argv);
  const packId = args.pack || "brain-house-sagittal-v1";
  const draftPath = path.join(root, "recall", "drafts", `${packId}.json`);
  const draft = JSON.parse(await readFile(draftPath, "utf8"));
  if (!draft.diagram?.imageSrc) throw new Error(`Draft ${packId} is missing diagram.imageSrc.`);

  const endpoint = args.endpoint || DEFAULT_ENDPOINT;
  const model = args.model || DEFAULT_MODEL;
  const localImagePath = path.join(root, "public", draft.diagram.imageSrc.replace(/^\//, ""));
  const imageUrl = await imageDataUrl(localImagePath, Number(args["preview-width"] || 900));
  const now = new Date().toISOString();
  let qa;
  let modelError = "";

  try {
    qa = await callModel({
      endpoint,
      model,
      prompt: promptForDraft(draft),
      imageUrl,
      timeoutMs: Number(args.timeout || 180000),
      maxTokens: Number(args["max-tokens"] || 1000),
    });
  } catch (error) {
    modelError = error instanceof Error ? error.message : String(error);
    qa = {
      verdict: "model-unavailable",
      corrections: [
        {
          field: "target",
          message: `Model QA did not complete: ${modelError}`,
          severity: "medium",
        },
      ],
      suggestedTargets: [],
      notes: ["Human review is still required before publish."],
    };
  }

  const review = {
    packId,
    model,
    generatedAt: now,
    localImagePath,
    qa,
  };

  const reviewPath = path.join(root, "recall", "reviews", `${packId}-vision-qa.json`);
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");

  const modelCorrections = Array.isArray(qa.corrections) ? qa.corrections.map(item => ({
    targetId: item.targetId,
    field: ["source", "license", "attribution", "target", "shape", "fact", "label"].includes(item.field) ? item.field : "target",
    message: `[model QA] ${item.severity ? `${item.severity}: ` : ""}${item.message || "Review this target."}`,
    status: "open",
  })) : [];

  const next = {
    ...draft,
    updatedAt: now,
    automation: {
      ...(draft.automation || {}),
      status: "house-plate-qa-staged",
      modelPlan: modelError
        ? `${cleanModelPlan(draft.automation?.modelPlan)} Model QA attempted but did not complete: ${modelError}`.trim()
        : `${cleanModelPlan(draft.automation?.modelPlan)} Model QA artifact written with ${model}.`.trim(),
      stages: (draft.automation?.stages || []).map(stage => {
        if (stage.id === "review-pass") {
          return {
            ...stage,
            status: "active",
            owner: "review",
            detail: modelError
              ? "Human review required; model QA did not complete."
              : "Model QA completed; review target placement, labels, aliases, and facts.",
          };
        }
        return stage;
      }),
    },
    correctionQueue: uniqueQueue([...withoutPriorModelQa(draft.correctionQueue || []), ...modelCorrections]),
  };

  await writeFile(draftPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reviewed: true,
    packId,
    model,
    reviewPath,
    corrections: modelCorrections.length,
    modelError,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
