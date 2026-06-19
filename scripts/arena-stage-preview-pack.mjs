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

async function main() {
  const args = parseArgs(process.argv);
  const packId = args.pack;
  if (!packId) throw new Error("Usage: node scripts/arena-stage-preview-pack.mjs --pack brain-lateral-source-v1");

  const draftPath = path.join(root, "recall", "drafts", `${packId}.json`);
  const packPath = path.join(root, "recall", "packs", `${packId}.json`);
  const draft = JSON.parse(await readFile(draftPath, "utf8"));
  if (!draft.diagram?.imageSrc) throw new Error(`Draft ${packId} is missing a source diagram.`);
  if (!Array.isArray(draft.targets) || !draft.targets.length) throw new Error(`Draft ${packId} has no targets to preview.`);

  const now = new Date().toISOString();
  const preview = {
    ...draft,
    status: "preview",
    publishable: false,
    previewOnly: true,
    updatedAt: now,
    blockReasons: [
      ...new Set([
        ...(draft.blockReasons || []),
        "preview pack is not published",
        "human approval required before publish",
      ]),
    ],
    approval: {
      ...(draft.approval || {}),
      publish: "blocked",
    },
    automation: {
      ...(draft.automation || {}),
      status: "playable-preview-staged",
      stages: (draft.automation?.stages || []).map(stage => {
        if (stage.id === "publish-pack") {
          return {
            ...stage,
            status: "blocked",
            owner: "review",
            detail: "Playable preview is staged, but publish is blocked until review gates pass.",
          };
        }
        return stage;
      }),
    },
  };

  await mkdir(path.dirname(packPath), { recursive: true });
  await writeFile(packPath, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    staged: true,
    packId,
    targets: preview.targets.length,
    packPath,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
