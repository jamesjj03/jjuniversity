import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "tmp", "manuscript-quality-audit", "20260818T212052Z", "report.json");
const REVIEW_DIR = path.join(ROOT, "tmp", "manuscript-case-review");
const DECISIONS_PATH = path.join(REVIEW_DIR, "decisions.json");
const apply = process.argv.includes("--apply");
const input = process.argv.find(argument => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1]);

if (!input) throw new Error("Pass a reviewed batch JSON path. This command is a dry run unless --apply is present.");

const report = JSON.parse(await fs.readFile(REPORT_PATH, "utf8"));
const rows = Array.isArray(report?.initialCaps?.sections) ? report.initialCaps.sections : [];
const sourceByKey = new Map(rows.map(row => [`${row.bookId}::${row.sectionId}`, row]));
const batch = JSON.parse(await fs.readFile(path.resolve(ROOT, input), "utf8"));
if (batch?.schemaVersion !== 1 || !Array.isArray(batch.entries)) throw new Error("Unsupported case-review batch format.");

const accepted = [];
const needsReview = [];
for (const entry of batch.entries) {
  const key = String(entry.key || "");
  const source = sourceByKey.get(key);
  if (!source || source.prefixText !== entry.original) throw new Error(`Source mismatch for ${key || "unknown row"}.`);
  if (entry.decision === "needs-review" || entry.decision === "unreviewed") {
    needsReview.push(key);
    continue;
  }
  if (entry.decision !== "accepted") throw new Error(`Unknown decision for ${key}.`);
  const replacement = String(entry.replacement || "").trim();
  if (!replacement) throw new Error(`Missing replacement for ${key}.`);
  if (replacement.toLocaleLowerCase("en-US") !== source.prefixText.toLocaleLowerCase("en-US")) {
    throw new Error(`Only capitalization may change for ${key}.`);
  }
  if (!source.safeCssOnly && replacement === source.prefixText) throw new Error(`All-caps source remains unchanged for ${key}.`);
  accepted.push({ key, source, replacement });
}

console.log(JSON.stringify({ input: path.resolve(ROOT, input), accepted: accepted.length, needsReview: needsReview.length, apply }, null, 2));
if (!apply) process.exit(0);

await fs.mkdir(REVIEW_DIR, { recursive: true });
const current = await readDecisions();
const updatedAt = new Date().toISOString();
for (const item of accepted) {
  current.decisions[item.key] = {
    bookId: item.source.bookId,
    sectionId: item.source.sectionId,
    original: item.source.prefixText,
    replacement: item.replacement,
    status: "accepted",
    updatedAt,
  };
}
current.updatedAt = updatedAt;

const temporaryPath = path.join(REVIEW_DIR, `decisions.${process.pid}.${randomUUID()}.tmp`);
await fs.writeFile(temporaryPath, `${JSON.stringify(current, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
try {
  try {
    await fs.copyFile(DECISIONS_PATH, path.join(REVIEW_DIR, `decisions.before-batch-${updatedAt.replace(/[:.]/g, "-")}.json`));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.rename(temporaryPath, DECISIONS_PATH);
} finally {
  await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
}

console.log(`Imported ${accepted.length} reviewed capitalization decisions. Manuscripts were not changed.`);

async function readDecisions() {
  try {
    const parsed = JSON.parse(await fs.readFile(DECISIONS_PATH, "utf8"));
    if (parsed?.schemaVersion !== 1 || typeof parsed.decisions !== "object") throw new Error("Unsupported decision file.");
    return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { schemaVersion: 1, updatedAt: "", decisions: {} };
  }
}
