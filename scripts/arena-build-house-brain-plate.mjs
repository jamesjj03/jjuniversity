import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const packId = "brain-house-sagittal-v1";
const sourceId = "jju-original-brain-house-sagittal-v1";
const diagramDir = path.join(root, "public", "arena", "diagrams", packId);
const platePath = path.join(diagramDir, "plate.svg");
const draftPath = path.join(root, "recall", "drafts", `${packId}.json`);
const sourcePath = path.join(root, "recall", "sources", `${sourceId}.json`);
const ledgerPath = path.join(root, "recall", "source-ledger.json");

const width = 760;
const height = 520;

function nowIso() {
  return new Date().toISOString();
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

function target(id, label, aliases, kind, shape, functions, difficulty = 2) {
  return {
    id,
    label,
    aliases,
    kind,
    reviewStatus: "ai-suggested",
    difficulty,
    color: "#d6b25e",
    confidence: 0.78,
    shape,
    functions,
    reviewNotes: [
      "Generated from the JJU house-plate geometry manifest.",
      "Needs human anatomy review before publish.",
    ],
  };
}

function boundsFromShape(shape) {
  if (shape.type === "circle") {
    return {
      x: shape.cx - shape.r,
      y: shape.cy - shape.r,
      width: shape.r * 2,
      height: shape.r * 2,
      cx: shape.cx,
      cy: shape.cy,
    };
  }
  if (shape.type === "ellipse") {
    return {
      x: shape.cx - shape.rx,
      y: shape.cy - shape.ry,
      width: shape.rx * 2,
      height: shape.ry * 2,
      cx: shape.cx,
      cy: shape.cy,
    };
  }
  const numbers = shape.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: Number(minX.toFixed(2)),
    y: Number(minY.toFixed(2)),
    width: Number((maxX - minX).toFixed(2)),
    height: Number((maxY - minY).toFixed(2)),
    cx: Number(((minX + maxX) / 2).toFixed(2)),
    cy: Number(((minY + maxY) / 2).toFixed(2)),
  };
}

const shapes = {
  frontalLobe: {
    type: "path",
    d: "M132 239 C126 180 156 120 215 92 C266 68 322 76 371 112 C340 148 314 190 300 246 C251 229 191 231 132 239 Z",
  },
  parietalLobe: {
    type: "path",
    d: "M365 111 C418 66 514 76 572 137 C617 184 630 240 608 292 C555 267 497 252 438 252 C397 252 354 250 300 246 C314 188 338 148 365 111 Z",
  },
  occipitalLobe: {
    type: "path",
    d: "M607 292 C619 335 599 381 562 411 C523 442 468 448 421 426 C444 383 455 332 438 252 C497 252 555 267 607 292 Z",
  },
  temporalLobe: {
    type: "path",
    d: "M132 239 C190 232 251 231 300 246 C323 304 309 371 260 405 C220 432 166 423 135 383 C104 342 99 287 132 239 Z",
  },
  corpusCallosum: {
    type: "path",
    d: "M240 226 C283 169 385 149 474 193 C489 201 500 212 506 224 C478 213 439 204 393 207 C334 211 282 229 245 260 C237 251 235 239 240 226 Z",
  },
  thalamus: { type: "ellipse", cx: 398, cy: 271, rx: 47, ry: 31 },
  hypothalamus: { type: "ellipse", cx: 392, cy: 319, rx: 31, ry: 19 },
  pituitaryGland: { type: "circle", cx: 386, cy: 359, r: 16 },
  midbrain: {
    type: "path",
    d: "M448 314 C483 304 515 317 530 347 C514 365 488 373 461 362 C450 349 444 333 448 314 Z",
  },
  pons: { type: "ellipse", cx: 528, cy: 386, rx: 40, ry: 28 },
  medulla: {
    type: "path",
    d: "M540 410 C566 421 579 449 570 482 C555 488 535 479 523 458 C512 438 517 418 540 410 Z",
  },
  cerebellum: {
    type: "path",
    d: "M548 340 C610 323 675 360 688 420 C653 477 562 477 520 426 C501 392 514 354 548 340 Z",
  },
};

const targets = [
  target("frontal-lobe", "frontal lobe", ["frontal cortex"], "polygon", shapes.frontalLobe, [
    "planning, judgment, and voluntary movement",
    "helps organize speech production",
  ]),
  target("parietal-lobe", "parietal lobe", ["parietal cortex"], "polygon", shapes.parietalLobe, [
    "body sensation and spatial attention",
    "integrates touch and position information",
  ]),
  target("temporal-lobe", "temporal lobe", ["temporal cortex"], "polygon", shapes.temporalLobe, [
    "hearing, memory, and language comprehension",
  ]),
  target("occipital-lobe", "occipital lobe", ["visual cortex region"], "polygon", shapes.occipitalLobe, [
    "visual processing",
  ]),
  target("corpus-callosum", "corpus callosum", ["callosal fibers"], "polygon", shapes.corpusCallosum, [
    "connects the left and right cerebral hemispheres",
  ]),
  target("thalamus", "thalamus", [], "dot", shapes.thalamus, [
    "major relay for sensory and motor signals",
  ]),
  target("hypothalamus", "hypothalamus", [], "dot", shapes.hypothalamus, [
    "regulates homeostasis, hunger, thirst, and body temperature",
  ]),
  target("pituitary-gland", "pituitary gland", ["hypophysis"], "dot", shapes.pituitaryGland, [
    "releases hormones under hypothalamic control",
  ], 3),
  target("midbrain", "midbrain", ["mesencephalon"], "polygon", shapes.midbrain, [
    "supports eye movement, arousal, and motor pathways",
  ]),
  target("pons", "pons", [], "dot", shapes.pons, [
    "bridge between cerebrum, cerebellum, and lower brainstem",
  ]),
  target("medulla", "medulla", ["medulla oblongata"], "polygon", shapes.medulla, [
    "helps control breathing, heart rate, and reflexes",
  ]),
  target("cerebellum", "cerebellum", [], "polygon", shapes.cerebellum, [
    "coordination, balance, and motor learning",
  ]),
].map(item => ({ ...item, bounds: boundsFromShape(item.shape), sourceShapeId: item.id }));

function plateSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">JJU house-style sagittal brain plate</title>
  <desc id="desc">Unlabeled stylized sagittal section of the human brain for Arena recall practice.</desc>
  <metadata>
    <source>JJU original educational plate</source>
    <references>Patrick J. Lynch sagittal brain section, CC BY 2.5; NIAID NIH BioArt Brain Lateral, public domain.</references>
    <generated>${nowIso()}</generated>
  </metadata>
  <defs>
    <linearGradient id="brainShell" x1="103" x2="670" y1="82" y2="454" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f2d9c9"/>
      <stop offset="0.54" stop-color="#d7c8b8"/>
      <stop offset="1" stop-color="#bfc7bd"/>
    </linearGradient>
    <linearGradient id="deepGold" x1="242" x2="559" y1="184" y2="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ddc579"/>
      <stop offset="1" stop-color="#b68a57"/>
    </linearGradient>
    <filter id="softShadow" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#12100d" flood-opacity=".16"/>
    </filter>
    <style>
      .plate-bg{fill:#f7f1e8}
      .grid{fill:none;stroke:#3e514c;stroke-width:.75;stroke-opacity:.08}
      .outer{fill:url(#brainShell);stroke:#2e342f;stroke-width:4;stroke-linejoin:round}
      .region{stroke:#2f342e;stroke-width:2.4;stroke-linejoin:round}
      .lobe-a{fill:#e9c5b3}.lobe-b{fill:#d7c8b4}.lobe-c{fill:#b9c5b5}.lobe-d{fill:#cbb0a3}
      .deep{fill:url(#deepGold)}.stem{fill:#a9b79d}.stem2{fill:#93a989}.cerebellum{fill:#b7b99b}
      .ridge{fill:none;stroke:#2e342f;stroke-width:2.1;stroke-linecap:round;stroke-opacity:.35}
      .fine{fill:none;stroke:#2e342f;stroke-width:1.35;stroke-linecap:round;stroke-opacity:.26}
      .ventricle{fill:none;stroke:#fff8eb;stroke-width:10;stroke-linecap:round;stroke-linejoin:round;stroke-opacity:.6}
      .target-source{fill:none;stroke:none;opacity:0}
    </style>
  </defs>
  <rect class="plate-bg" x="0" y="0" width="${width}" height="${height}" rx="18"/>
  <path class="grid" d="M70 80H690M70 140H690M70 200H690M70 260H690M70 320H690M70 380H690M70 440H690M100 58V464M180 58V464M260 58V464M340 58V464M420 58V464M500 58V464M580 58V464M660 58V464"/>
  <g filter="url(#softShadow)">
    <path class="outer" d="M132 239 C115 170 153 105 219 78 C276 55 329 72 365 111 C421 65 521 76 579 143 C633 205 632 281 607 327 C666 331 707 377 697 431 C686 488 608 502 560 466 C516 454 459 449 421 426 C366 463 296 461 248 430 C193 442 133 413 111 359 C93 315 101 272 132 239 Z"/>
    <path class="region lobe-a" d="${shapes.frontalLobe.d}"/>
    <path class="region lobe-b" d="${shapes.parietalLobe.d}"/>
    <path class="region lobe-c" d="${shapes.occipitalLobe.d}"/>
    <path class="region lobe-d" d="${shapes.temporalLobe.d}"/>
    <path class="region cerebellum" d="${shapes.cerebellum.d}"/>
    <path class="region deep" d="${shapes.corpusCallosum.d}"/>
    <ellipse class="region deep" cx="${shapes.thalamus.cx}" cy="${shapes.thalamus.cy}" rx="${shapes.thalamus.rx}" ry="${shapes.thalamus.ry}"/>
    <ellipse class="region deep" cx="${shapes.hypothalamus.cx}" cy="${shapes.hypothalamus.cy}" rx="${shapes.hypothalamus.rx}" ry="${shapes.hypothalamus.ry}"/>
    <circle class="region deep" cx="${shapes.pituitaryGland.cx}" cy="${shapes.pituitaryGland.cy}" r="${shapes.pituitaryGland.r}"/>
    <path class="region stem" d="${shapes.midbrain.d}"/>
    <ellipse class="region stem2" cx="${shapes.pons.cx}" cy="${shapes.pons.cy}" rx="${shapes.pons.rx}" ry="${shapes.pons.ry}"/>
    <path class="region stem" d="${shapes.medulla.d}"/>
    <path class="ventricle" d="M287 238 C340 208 422 211 487 232"/>
    <path class="ridge" d="M157 202 C194 155 248 122 305 105M196 229 C237 189 284 164 339 153M361 116 C407 117 454 135 497 169M444 253 C504 259 555 275 602 302M154 318 C196 296 241 298 291 327M526 371 C573 350 627 372 662 418"/>
    <path class="fine" d="M558 360 C575 381 576 409 557 432M585 358 C602 383 601 424 578 450M617 369 C632 397 626 432 601 458"/>
  </g>
  <g id="target-geometry" aria-hidden="true">
    ${targets.map(item => {
      if (item.shape.type === "path") return `<path id="${item.id}" class="target-source" d="${item.shape.d}"/>`;
      if (item.shape.type === "circle") return `<circle id="${item.id}" class="target-source" cx="${item.shape.cx}" cy="${item.shape.cy}" r="${item.shape.r}"/>`;
      return `<ellipse id="${item.id}" class="target-source" cx="${item.shape.cx}" cy="${item.shape.cy}" rx="${item.shape.rx}" ry="${item.shape.ry}"/>`;
    }).join("\n    ")}
  </g>
</svg>
`;
}

function stages() {
  return [
    {
      id: "source-hunt",
      label: "Select references",
      status: "complete",
      owner: "pipeline",
      detail: "Used reviewed open references instead of an unlabeled web image grab.",
    },
    {
      id: "license-pass",
      label: "Check source, license, attribution",
      status: "active",
      owner: "review",
      detail: "JJU original plate with cited CC BY and public-domain references.",
    },
    {
      id: "plate-pass",
      label: "Build house plate",
      status: "complete",
      owner: "pipeline",
      detail: "Generated an unlabeled SVG plate and editable geometry manifest.",
    },
    {
      id: "vision-pass",
      label: "Suggest targets",
      status: "complete",
      owner: "pipeline",
      detail: `Generated ${targets.length} aligned hit zones from the same geometry as the plate.`,
    },
    {
      id: "fact-pass",
      label: "Generate fact prompts",
      status: "active",
      owner: "pipeline",
      detail: "Seeded short conservative prompts; review still required.",
    },
    {
      id: "review-pass",
      label: "Approve edits",
      status: "active",
      owner: "review",
      detail: "Review labels, target placement, aliases, and facts in Factory.",
    },
    {
      id: "publish-pack",
      label: "Publish pack",
      status: "blocked",
      owner: "review",
      detail: "Blocked until every approval gate passes.",
    },
  ];
}

async function main() {
  const now = nowIso();
  await mkdir(diagramDir, { recursive: true });
  await writeFile(platePath, plateSvg(), "utf8");

  const source = {
    id: sourceId,
    provider: "jju-original",
    importedAt: now,
    title: "JJU House Brain Sagittal Plate",
    fileTitle: "plate.svg",
    sourceUrl: "/arena/diagrams/brain-house-sagittal-v1/plate.svg",
    originalUrl: "/arena/diagrams/brain-house-sagittal-v1/plate.svg",
    description: "Original unlabeled sagittal brain plate generated for Arena recall practice.",
    artist: "JJ University",
    artistHtml: "JJ University",
    credit: "JJ University; anatomical references cited in metadata.",
    creditHtml: "JJ University; anatomical references cited in metadata.",
    license: {
      shortName: "JJU original",
      url: "",
      usageTerms: "Original JJ University site asset; reference materials cited separately.",
      attributionRequired: "false",
      allowedByImporter: true,
      importerReason: "Original diagram created for JJU from open anatomical references.",
    },
    references: [
      {
        id: "wikimedia-1496657-dc7862b831",
        title: "Brain human sagittal section",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Brain_human_sagittal_section.svg",
        license: "CC BY 2.5",
        attribution: "Patrick J. Lynch, medical illustrator",
        use: "Sagittal anatomy reference; not directly embedded as the visible plate.",
      },
      {
        id: "wikimedia-178931371-cbc9f694f3",
        title: "Brain Lateral (NIH BioArt 60)",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Brain_Lateral_(NIH_BioArt_60).svg",
        license: "Public domain",
        attribution: "Courtesy of NIAID Ryan Kissinger",
        use: "General brain silhouette and style reference; not directly embedded as the visible plate.",
      },
    ],
    media: {
      mime: "image/svg+xml",
      width,
      height,
      publicPath: "/arena/diagrams/brain-house-sagittal-v1/plate.svg",
      localPath: "public\\arena\\diagrams\\brain-house-sagittal-v1\\plate.svg",
    },
    review: {
      source: "needs-review",
      license: "needs-review",
      attribution: "needs-review",
    },
  };

  const draft = {
    id: packId,
    title: "Brain House Sagittal",
    workingName: "Arena",
    category: "anatomy",
    domain: "neuroscience",
    status: "draft",
    publishable: false,
    blockReasons: [
      "source review required",
      "target review required",
      "fact review required",
      "house plate needs anatomy review",
      "human approval required before publish",
    ],
    version: 0,
    summary: "Original JJU house-style sagittal brain plate with generated hit zones.",
    modes: ["find", "function", "review"],
    diagram: {
      sourceId,
      imageSrc: "/arena/diagrams/brain-house-sagittal-v1/plate.svg",
      width,
      height,
      mime: "image/svg+xml",
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
      license: "needs-review",
      attribution: "needs-review",
      targets: "needs-review",
      facts: "needs-review",
      publish: "blocked",
    },
    automation: {
      status: "house-plate-generated",
      modelPlan: "House plate generated from structured geometry; target zones are generated from the same manifest and must be reviewed before publish.",
      stages: stages(),
    },
    assetLedger: [
      {
        id: sourceId,
        type: "diagram-source",
        source: "/arena/diagrams/brain-house-sagittal-v1/plate.svg",
        license: "JJU original",
        attribution: "JJ University; anatomical references cited in source record.",
        status: "needs-review",
        notes: "Original editable SVG plate generated for Arena.",
      },
      {
        id: "wikimedia-1496657-dc7862b831",
        type: "reference",
        source: "https://commons.wikimedia.org/wiki/File:Brain_human_sagittal_section.svg",
        license: "CC BY 2.5",
        licenseUrl: "https://creativecommons.org/licenses/by/2.5",
        attribution: "Patrick J. Lynch, medical illustrator",
        status: "needs-review",
        notes: "Reference for sagittal anatomy; not embedded as the visible plate.",
      },
      {
        id: "wikimedia-178931371-cbc9f694f3",
        type: "reference",
        source: "https://commons.wikimedia.org/wiki/File:Brain_Lateral_(NIH_BioArt_60).svg",
        license: "Public domain",
        attribution: "Courtesy of NIAID Ryan Kissinger",
        status: "needs-review",
        notes: "Reference for external brain form; not embedded as the visible plate.",
      },
    ],
    targets,
    correctionQueue: [
      {
        field: "source",
        message: "Confirm the house plate is sufficiently original and references are cited correctly.",
        status: "open",
      },
      ...targets.map(item => ({
        targetId: item.id,
        field: "target",
        message: `Review ${item.label} hit zone placement on the house sagittal plate.`,
        status: "open",
      })),
      ...targets.map(item => ({
        targetId: item.id,
        field: "fact",
        message: `Review fact prompt(s) for ${item.label}.`,
        status: "open",
      })),
    ],
  };

  await writeJson(sourcePath, source);
  const ledger = await readJson(ledgerPath, { generatedAt: "", sources: [] });
  const sources = Array.isArray(ledger.sources) ? ledger.sources.filter(item => item.id !== source.id) : [];
  await writeJson(ledgerPath, {
    generatedAt: now,
    sources: [...sources, source].sort((a, b) => a.id.localeCompare(b.id)),
  });
  await writeJson(draftPath, draft);

  console.log(JSON.stringify({
    built: true,
    packId,
    sourceId,
    platePath,
    draftPath,
    targets: targets.length,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
