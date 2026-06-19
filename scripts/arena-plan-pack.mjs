import { mkdir, readFile, writeFile } from "fs/promises";
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

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function categoryFromCatalog(catalog, categoryId) {
  return (catalog.categories || []).find(item => item.id === categoryId) || null;
}

function profileFor(pipeline, categoryId) {
  return pipeline.categoryProfiles?.[categoryId] || pipeline.categoryProfiles?.default || {};
}

function commonsCategories(categoryId, title) {
  const lower = `${categoryId} ${title}`.toLowerCase();
  if (lower.includes("brain")) {
    return [
      "Category:Human brain (sagittal section)",
      "Category:Human brain (lateral view)",
      "Category:Brain lobes",
      "Category:SVG neuroanatomy of humans",
    ];
  }
  if (categoryId === "anatomy") return ["Category:SVG anatomy"];
  if (categoryId === "biology") return ["Category:SVG biology diagrams"];
  return [];
}

function commandsFor({ packId, title, categoryId, sourceMode, candidate }) {
  const candidatesPath = `recall/candidates/${packId}-candidates.json`;
  const shortlistPath = `recall/candidates/${packId}-shortlist.json`;
  const categories = commonsCategories(categoryId, title);
  const commands = [];

  if (sourceMode !== "original-house-plate" && categories.length) {
    commands.push({
      stage: "source-hunt",
      command: `npm run arena:discover-wikimedia -- --category "${categories.join(",")}" --limit 80 --output ${candidatesPath}`,
    });
    commands.push({
      stage: "rank",
      command: `npm run arena:rank-candidates -- --input ${candidatesPath} --output ${shortlistPath} --visual --sheet-dir recall/candidates/sheets`,
    });
    commands.push({
      stage: "promote",
      command: candidate
        ? `npm run arena:promote-candidate -- --candidates ${shortlistPath} --title "${candidate}" --pack ${packId} --pack-title "${title}"`
        : `npm run arena:promote-candidate -- --candidates ${shortlistPath} --title "<candidate title>" --pack ${packId} --pack-title "${title}"`,
    });
  }

  if (sourceMode === "original-house-plate") {
    commands.push({
      stage: "plate-pass",
      command: `Create or import the unlabeled house-style plate at public/arena/diagrams/${packId}/plate.svg, then register references in recall/sources/ and recall/source-ledger.json.`,
    });
  }

  commands.push({
    stage: "target-pass",
    command: `npm run arena:propose-vision-targets -- --pack ${packId} --limit 8 --timeout 120000 --max-tokens 900`,
  });
  commands.push({
    stage: "stage-preview",
    command: `npm run arena:stage-preview -- --pack ${packId}`,
  });

  return commands;
}

async function main() {
  const args = parseArgs(process.argv);
  const title = args.title || args.name;
  if (!title) throw new Error("Usage: node scripts/arena-plan-pack.mjs --title \"Brain Lateral\" --category anatomy --pack brain-lateral");

  const categoryId = args.category || "anatomy";
  const packId = slugify(args.pack || title);
  const sourceMode = args["source-mode"] || "open-source";
  const now = new Date().toISOString();
  const catalog = await readJson(path.join(root, "recall", "catalog.json"), { categories: [] });
  const pipeline = await readJson(path.join(root, "recall", "pipeline.json"), {});
  const profile = profileFor(pipeline, categoryId);
  const category = categoryFromCatalog(catalog, categoryId);

  const plan = {
    id: packId,
    title,
    category: categoryId,
    categoryTitle: category?.title || categoryId,
    status: "planned",
    sourceMode,
    createdAt: now,
    updatedAt: now,
    profile,
    requiredArtifacts: pipeline.artifactContract || {},
    approval: pipeline.approvalGates || {},
    stages: (pipeline.stageOrder || []).map(stage => ({
      id: stage,
      status: stage === "intake" ? "complete" : stage === "publish-pack" ? "blocked" : "queued",
    })),
    commands: commandsFor({
      packId,
      title,
      categoryId,
      sourceMode,
      candidate: args.candidate,
    }),
    notes: [
      "The visible plate and the semantic hit zone layer are separate artifacts.",
      "Model output is proposal-only until review approves source, target placement, labels, aliases, and facts.",
      "Publish remains blocked until every approval gate is approved.",
    ],
  };

  const outputPath = path.join(root, "recall", "plans", `${packId}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    planned: true,
    packId,
    outputPath,
    commands: plan.commands,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
