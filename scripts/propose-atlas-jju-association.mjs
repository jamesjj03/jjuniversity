#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.join(scriptDirectory, "..");
const options = parseOptions(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const required = [
  "subject-id",
  "place-id",
  "relationship",
  "evidence-field",
  "exact-text",
  "rationale",
  "confidence",
  "proposed-by",
];
for (const key of required) {
  if (!options[key]) fail(`Missing --${key}.`);
}

const subjectKind = options["subject-kind"] || "book";
if (subjectKind !== "book") {
  fail("The Phase 2 proposal helper currently resolves exact repository evidence for books only.");
}

const relationships = new Set(["primary_subject", "substantial_coverage", "contextual_coverage"]);
if (!relationships.has(options.relationship)) {
  fail(`Unsupported book relationship: ${options.relationship}`);
}

const evidenceField = options["evidence-field"];
if (!new Set(["title", "description"]).has(evidenceField)) {
  fail("--evidence-field must be title or description for the current book-catalog workflow.");
}

const confidence = Number(options.confidence);
if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
  fail("--confidence must be a number from 0 through 1.");
}

const [books, countrySnapshot, authority] = await Promise.all([
  readJson(path.join(repositoryRoot, "private", "catalog", "books.json")),
  readJson(path.join(repositoryRoot, "lib", "atlas-world", "data", "countries.v1.json")),
  readJson(path.join(repositoryRoot, "lib", "atlas-world", "associations", "data", "authority.v1.json")),
]);

const bookIndex = books.findIndex((book) => book.id === options["subject-id"]);
if (bookIndex < 0) fail(`Unknown book ID: ${options["subject-id"]}`);
const book = books[bookIndex];

const country = countrySnapshot.countries.find((item) => item.id === options["place-id"]);
if (!country) fail(`Unknown Atlas entity ID: ${options["place-id"]}`);

const exactText = options["exact-text"];
const sourceValue = String(book[evidenceField] || "");
if (!sourceValue.includes(exactText)) {
  fail(`The exact text does not occur in ${book.id}.${evidenceField}; proposals require verifiable evidence.`);
}

const sourceRevision = bookSourceRevision(book);
const associationId = options.id || [
  "atlas-jju",
  subjectKind,
  book.id,
  country.id,
  options.relationship,
].join(":");

if (authority.associations.some((association) => association.id === associationId)) {
  fail(`Association ID already exists: ${associationId}`);
}

const now = new Date().toISOString();
const proposal = {
  id: associationId,
  revision: 1,
  pilotCollectionId: options["pilot-collection"] || null,
  subject: {
    kind: "book",
    id: book.id,
    title: String(book.title || book.id),
    href: `/books/${slugify(book.slug || book.title || book.id)}`,
    sourceId: "jju-book-catalog",
    sourceRevision,
  },
  place: {
    entityId: country.id,
    name: country.names.common,
    slug: country.slug,
    featureId: options["feature-id"] || null,
  },
  relationship: options.relationship,
  salience: options.salience || salienceFor(options.relationship),
  temporal: {
    observedAt: now.slice(0, 10),
    validFrom: options["valid-from"] || null,
    validTo: options["valid-to"] || null,
    precision: options["time-precision"] || "unknown",
    note: options["temporal-note"] || "Proposed interval requires editorial review.",
  },
  evidence: [
    {
      sourceId: "jju-book-catalog",
      sourceRevision,
      locator: `/${bookIndex}/${evidenceField}`,
      exactText,
      exactTextSha256: sha256(exactText),
      supports: parseSupports(options.supports),
      note: options["evidence-note"] || null,
    },
  ],
  proposal: {
    method: "ai_assisted",
    proposedBy: options["proposed-by"],
    proposedAt: now,
    confidence,
    rationale: options.rationale,
  },
  review: {
    state: "proposed",
    reviewerKind: null,
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null,
  },
  supersedesAssociationId: options.supersedes || null,
};

// Deliberately stdout-only: a proposal cannot mutate or publish the authority.
console.log(JSON.stringify(proposal, null, 2));

function parseOptions(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}.`);
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function bookSourceRevision(book) {
  return sha256(JSON.stringify({
    id: String(book.id || ""),
    title: String(book.title || ""),
    description: String(book.description || ""),
    tags: Array.isArray(book.tags) ? book.tags.map(String) : [],
    status: String(book.status || ""),
    visibility: String(book.visibility || ""),
    slug: String(book.slug || ""),
  }));
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseSupports(value) {
  const supported = new Set(["subject_identity", "place_connection", "relationship_semantics"]);
  const requested = String(value || "place_connection")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!requested.includes("place_connection")) fail("Evidence must support place_connection.");
  for (const item of requested) {
    if (!supported.has(item)) fail(`Unsupported evidence claim: ${item}`);
  }
  return [...new Set(requested)];
}

function salienceFor(relationship) {
  if (relationship === "primary_subject") return "primary";
  if (relationship === "substantial_coverage") return "substantial";
  return "contextual";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`
Create a reviewable Atlas/JJU association proposal from exact book-catalog evidence.

This command prints a proposed JSON record. It never edits the authority and can
never mark a proposal approved.

Required:
  --subject-id <book-id>
  --place-id <atlas-entity-id>
  --relationship <primary_subject|substantial_coverage|contextual_coverage>
  --evidence-field <title|description>
  --exact-text <verbatim catalog excerpt>
  --rationale <why the evidence supports this relationship>
  --confidence <0..1>
  --proposed-by <agent or operator identity>

Optional:
  --pilot-collection <series-id>
  --supports <comma-separated evidence claims>
  --salience <primary|substantial|contextual>
  --feature-id <more precise Atlas feature>
  --valid-from <ISO date or year>
  --valid-to <ISO date or year>
  --time-precision <day|month|year|source_snapshot|unknown>
  --temporal-note <scope caveat>
  --evidence-note <evidence caveat>
  --supersedes <association-id>
  --id <explicit association-id>
`);
}
