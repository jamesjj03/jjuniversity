import { readFile, writeFile } from "fs/promises";
import path from "path";

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

function attr(value, name) {
  const found = value.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return found?.[1] || "";
}

function fillFromStyle(style) {
  return style.match(/fill\s*:\s*([^;]+)/i)?.[1]?.trim() || "";
}

function styleClassMap(svg) {
  const styles = [...svg.matchAll(/<(?:(?:[A-Za-z_][\w.-]*):)?style\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z_][\w.-]*):)?style>/gi)]
    .map(match => match[1])
    .join("\n");
  const fills = new Map();

  for (const match of styles.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const fill = fillFromStyle(match[2]);
    if (fill) fills.set(match[1], fill);
  }

  return fills;
}

function fillFromElement(element, classFills) {
  const styleFill = fillFromStyle(attr(element, "style"));
  if (styleFill) return styleFill;

  const directFill = attr(element, "fill");
  if (directFill && directFill.toLowerCase() !== "none") return directFill;

  const classNames = attr(element, "class").split(/\s+/).filter(Boolean);
  for (const className of classNames) {
    const fill = classFills.get(className);
    if (fill) return fill;
  }

  return "#d6b25e";
}

function numberPairs(d) {
  const values = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  const pairs = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    pairs.push([values[index], values[index + 1]]);
  }
  return pairs;
}

function boundsForPath(d) {
  const pairs = numberPairs(d);
  if (!pairs.length) return null;
  const xs = pairs.map(pair => pair[0]);
  const ys = pairs.map(pair => pair[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
    cx: minX + (maxX - minX) / 2,
    cy: minY + (maxY - minY) / 2,
  };
}

function svgViewBox(svg) {
  const svgOpen = svg.match(/<(?:(?:[A-Za-z_][\w.-]*):)?svg\b[^>]*>/i)?.[0] || "";
  const values = attr(svgOpen, "viewBox").split(/[\s,]+/).map(Number).filter(Number.isFinite);
  if (values.length !== 4 || values[2] <= 0 || values[3] <= 0) return null;
  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
    area: values[2] * values[3],
  };
}

function pathElements(svg) {
  return [...svg.matchAll(/<(?:(?:[A-Za-z_][\w.-]*):)?path\b[\s\S]*?(?:\/>|>\s*<\/(?:(?:[A-Za-z_][\w.-]*):)?path>)/gi)]
    .map(match => match[0]);
}

function colorFields(svg) {
  const group = svg.match(/<g[^>]*id="Color_Fields"[^>]*>([\s\S]*?)<\/g>/i)?.[1] || "";
  const classFills = styleClassMap(svg);
  return pathElements(group).map((element, index) => {
    const d = attr(element, "d");
    const bounds = boundsForPath(d);
    return {
      index,
      sourceShapeId: attr(element, "id") || `color-field-${index + 1}`,
      d,
      color: fillFromElement(element, classFills),
      bounds,
    };
  }).filter(item => item.d && item.bounds);
}

function allPathRegions(svg, viewBox) {
  const classFills = styleClassMap(svg);
  const maxArea = viewBox ? viewBox.area * 0.88 : Number.POSITIVE_INFINITY;

  return pathElements(svg).map((element, index) => {
    const d = attr(element, "d");
    const bounds = boundsForPath(d);
    return {
      index,
      sourceShapeId: attr(element, "id") || `path-${index + 1}`,
      d,
      color: fillFromElement(element, classFills),
      bounds,
    };
  }).filter(item => {
    if (!item.d || !item.bounds) return false;
    if (!Number.isFinite(item.bounds.area) || item.bounds.area <= 0) return false;
    return item.bounds.area <= maxArea;
  });
}

function targetFromRegion(region, index) {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `svg-region-${number}`,
    label: `Region ${number}`,
    aliases: [],
    kind: "polygon",
    reviewStatus: "ai-suggested",
    difficulty: 2,
    color: region.color,
    sourceShapeId: region.sourceShapeId,
    confidence: 0.46,
    bounds: {
      x: Number(region.bounds.minX.toFixed(2)),
      y: Number(region.bounds.minY.toFixed(2)),
      width: Number(region.bounds.width.toFixed(2)),
      height: Number(region.bounds.height.toFixed(2)),
      cx: Number(region.bounds.cx.toFixed(2)),
      cy: Number(region.bounds.cy.toFixed(2)),
    },
    shape: {
      type: "path",
      d: region.d,
    },
    functions: [],
    reviewNotes: [
      "SVG color region extracted automatically.",
      "Needs semantic label, aliases, and fact prompts before publish.",
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
  if (!packId) throw new Error("Usage: node scripts/arena-propose-svg-targets.mjs --pack brain-sagittal-source-v1 --limit 24");

  const draftPath = path.join(root, "recall", "drafts", `${packId}.json`);
  const draft = JSON.parse(await readFile(draftPath, "utf8"));
  if (!draft.diagram?.imageSrc) throw new Error(`Draft ${packId} does not have a diagram imageSrc.`);

  const localSvgPath = path.join(root, "public", draft.diagram.imageSrc.replace(/^\//, ""));
  const svg = await readFile(localSvgPath, "utf8");
  const viewBox = svgViewBox(svg);
  const minArea = Number(args["min-area"] || 70);
  const limit = Number(args.limit || 32);
  const colorFieldRegions = colorFields(svg);
  const sourceMode = colorFieldRegions.length ? "color-fields" : "all-svg-paths";
  const regions = (colorFieldRegions.length ? colorFieldRegions : allPathRegions(svg, viewBox))
    .filter(region => region.bounds.area >= minArea)
    .sort((a, b) => b.bounds.area - a.bounds.area)
    .slice(0, limit);

  const targets = regions.map(targetFromRegion);
  const now = new Date().toISOString();
  const existingQueue = Array.isArray(draft.correctionQueue) ? draft.correctionQueue : [];
  const proposedQueue = [
    ...targets.map(target => ({
      targetId: target.id,
      field: "label",
      message: `Name ${target.label} from source shape ${target.sourceShapeId}.`,
      status: "open",
    })),
    ...targets.map(target => ({
      targetId: target.id,
      field: "fact",
      message: `Add function prompts after ${target.label} is approved.`,
      status: "open",
    })),
  ];

  const next = {
    ...draft,
    updatedAt: now,
    publishable: false,
    diagram: {
      ...draft.diagram,
      ...(viewBox ? { width: Number(viewBox.width.toFixed(2)), height: Number(viewBox.height.toFixed(2)) } : {}),
      overlayMode: "mixed-dots-polygons",
    },
    blockReasons: [...new Set([...(draft.blockReasons || []), "semantic labels required", "fact prompts required"])],
    approval: {
      ...(draft.approval || {}),
      targets: "needs-review",
      facts: "needs-review",
      publish: "blocked",
    },
    automation: {
      ...(draft.automation || {}),
      status: "svg-regions-proposed",
      stages: (draft.automation?.stages || []).map(stage => {
        if (stage.id === "vision-pass") {
          return {
            ...stage,
            status: "active",
            owner: "pipeline",
            detail: `Extracted ${targets.length} ${sourceMode} regions as candidate hit zones.`,
          };
        }
        if (stage.id === "fact-pass") {
          return {
            ...stage,
            status: "queued",
            detail: "Waiting for semantic labels before fact prompts can be generated.",
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
    svg: localSvgPath,
    proposedTargets: targets.length,
    sourceMode,
    minArea,
    limit,
    viewBox,
    draftPath,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
