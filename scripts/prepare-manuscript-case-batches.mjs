import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REPORT_PATH = path.join(
  ROOT,
  "tmp",
  "manuscript-quality-audit",
  "20260818T212052Z",
  "report.json",
);

const batchSizeArgument = process.argv.find(argument => argument.startsWith("--batch-size="));
const batchSize = boundedInteger(batchSizeArgument?.split("=")[1], 100, 25, 500);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputArgument = process.argv.find(argument => argument.startsWith("--output="));
const outputDirectory = path.resolve(
  ROOT,
  outputArgument?.slice("--output=".length) || path.join("tmp", "manuscript-case-review", `proposal-${stamp}`),
);

const reportRaw = await fs.readFile(REPORT_PATH, "utf8");
const report = JSON.parse(reportRaw);
const rows = Array.isArray(report?.initialCaps?.sections) ? report.initialCaps.sections : [];
if (!rows.length) throw new Error("The manuscript quality audit contains no case-review rows.");

await fs.mkdir(path.dirname(outputDirectory), { recursive: true });
await fs.mkdir(outputDirectory, { recursive: false });

const prepared = rows.map(row => {
  const classification = classify(row);
  return {
    key: `${row.bookId}::${row.sectionId}`,
    bookId: row.bookId,
    bookTitle: row.bookTitle,
    sectionId: row.sectionId,
    sectionTitle: row.sectionTitle,
    original: row.prefixText,
    proposal: makeProposal(row),
    firstParagraphText: row.firstParagraphText,
    confidence: classification.confidence,
    reasons: classification.reasons,
    acronymTokens: row.acronymTokens,
    unresolvedTokens: row.unresolvedTokens,
    referenceSuggestions: row.referenceSuggestions,
  };
});

const groups = [
  ["high", prepared.filter(row => row.confidence === "high" || row.confidence === "css-only")],
  ["assisted", prepared.filter(row => row.confidence === "assisted")],
];
const files = [];

for (const [name, entries] of groups) {
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batch = entries.slice(offset, offset + batchSize);
    const filename = `${name}-${String(Math.floor(offset / batchSize) + 1).padStart(3, "0")}.json`;
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceReportSha256: sha256(reportRaw),
      confidence: name,
      instructions: [
        "Review only capitalization. Do not add, remove, reorder, or re-punctuate characters.",
        "Use the complete opening sentence for names, acronyms, brands, and historical terms.",
        "Set decision to accepted when replacement is correct, or needs-review when context is genuinely insufficient.",
      ],
      entries: batch.map(entry => ({ ...entry, decision: "unreviewed", replacement: entry.proposal })),
    };
    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    await fs.writeFile(path.join(outputDirectory, filename), raw, { encoding: "utf8", flag: "wx" });
    files.push({ filename, rows: batch.length, sha256: sha256(raw) });
  }
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: path.relative(ROOT, REPORT_PATH).replaceAll("\\", "/"),
  sourceReportSha256: sha256(reportRaw),
  total: prepared.length,
  cssOnly: prepared.filter(row => row.confidence === "css-only").length,
  highConfidence: prepared.filter(row => row.confidence === "high").length,
  assistedReview: prepared.filter(row => row.confidence === "assisted").length,
  batchSize,
  files,
};
const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
await fs.writeFile(path.join(outputDirectory, "manifest.json"), manifestRaw, { encoding: "utf8", flag: "wx" });

console.log(JSON.stringify({
  outputDirectory,
  manifestSha256: sha256(manifestRaw),
  ...manifest,
}, null, 2));

function classify(row) {
  if (row.safeCssOnly) return { confidence: "css-only", reasons: ["underlying-case-preserved"] };

  const blockedFlags = new Set([
    "known-acronym",
    "mixed-case-name-risk",
    "no-lowercase-reference",
    "roman-numeral-candidate",
  ]);
  const reasons = row.riskFlags.filter(flag => blockedFlags.has(flag));
  const referencesAreDecisive = row.referenceSuggestions.every(reference => {
    const variants = Array.isArray(reference.variants) ? reference.variants : [];
    const total = variants.reduce((sum, variant) => sum + Number(variant.count || 0), 0);
    const top = variants[0];
    if (!top || total <= 0) return false;
    const share = Number(top.count || 0) / total;
    if (reference.position === 0) return share >= 0.8;
    return top.value === top.value.toLocaleLowerCase("en-US") && share >= 0.97;
  });

  if (!reasons.length && referencesAreDecisive) {
    return { confidence: "high", reasons: ["dominant-corpus-case"] };
  }
  if (!referencesAreDecisive) reasons.push("ambiguous-corpus-case");
  return { confidence: "assisted", reasons: [...new Set(reasons)] };
}

function makeProposal(row) {
  if (row.safeCssOnly) return row.prefixText;

  const matches = [...row.prefixText.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*(?:[-–—][\p{L}\p{N}]+)*/gu)];
  const references = new Map(row.referenceSuggestions.map(reference => [reference.position, reference]));
  const acronyms = new Set(row.acronymTokens.map(token => token.toLocaleUpperCase("en-US")));
  let cursor = 0;
  let proposal = "";

  matches.forEach((match, position) => {
    const start = match.index ?? cursor;
    const original = match[0];
    proposal += row.prefixText.slice(cursor, start).toLocaleLowerCase("en-US");
    const reference = references.get(position);
    const variants = Array.isArray(reference?.variants) ? reference.variants : [];
    const total = variants.reduce((sum, variant) => sum + Number(variant.count || 0), 0);
    const top = variants[0];
    const share = top && total ? Number(top.count || 0) / total : 0;

    let value = original.toLocaleLowerCase("en-US");
    if (acronyms.has(original.toLocaleUpperCase("en-US"))) {
      value = original.toLocaleUpperCase("en-US");
    } else if (top && share >= 0.8) {
      value = top.value;
    }
    if (position === 0 && value === value.toLocaleLowerCase("en-US")) value = capitalizeFirstLetter(value);
    proposal += value;
    cursor = start + original.length;
  });

  proposal += row.prefixText.slice(cursor).toLocaleLowerCase("en-US");
  return proposal;
}

function capitalizeFirstLetter(value) {
  return value.replace(/\p{L}/u, character => character.toLocaleUpperCase("en-US"));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
