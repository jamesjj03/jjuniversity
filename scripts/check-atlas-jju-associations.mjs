#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.join(scriptDirectory, "..");

const paths = {
  authority: path.join(repositoryRoot, "lib", "atlas-world", "associations", "data", "authority.v1.json"),
  schema: path.join(repositoryRoot, "lib", "atlas-world", "associations", "schema", "authority.v1.schema.json"),
  countries: path.join(repositoryRoot, "lib", "atlas-world", "data", "countries.v1.json"),
  books: path.join(repositoryRoot, "private", "catalog", "books.json"),
  series: path.join(repositoryRoot, "lib", "seriesCatalog.ts"),
};

const [authority, schema, countrySnapshot, books, seriesSource] = await Promise.all([
  readJson(paths.authority),
  readJson(paths.schema),
  readJson(paths.countries),
  readJson(paths.books),
  readFile(paths.series, "utf8"),
]);

const relationKinds = {
  book: new Set(["primary_subject", "substantial_coverage", "contextual_coverage"]),
  series: new Set(["primary_subject", "substantial_coverage", "contextual_coverage"]),
  person: new Set(["born_in", "died_in", "lived_in", "active_in", "governed_in"]),
  event: new Set(["occurred_in", "began_in", "ended_in", "affected"]),
  concept: new Set(["originated_in", "institutionally_centered", "historically_prominent"]),
};
const reviewStates = new Set(["proposed", "approved", "rejected", "superseded"]);
const salienceValues = new Set(["primary", "substantial", "contextual"]);
const sourceIds = new Set(authority.sources.map((source) => source.id));
const countryById = new Map(countrySnapshot.countries.map((country) => [country.id, country]));
const bookById = new Map(books.map((book, index) => [book.id, { book, index }]));
const seenAssociationIds = new Set();
const seenTuples = new Set();

assert.equal(authority.schemaVersion, "1.0.0", "Association authority schema version changed unexpectedly");
assert.equal(schema.properties?.schemaVersion?.const, authority.schemaVersion, "Schema and authority versions differ");
assert.deepEqual(authority.policy.publicReviewStates, ["approved"], "Only approved associations may be public");
assert.equal(authority.policy.requireExactEvidence, true, "Exact evidence must remain mandatory");
assert.equal(authority.policy.automatedPublication, false, "AI proposals must never auto-publish");
assert.equal(authority.policy.staleWhenSubjectRevisionChanges, true, "Source changes must stale reviewed links");
assert.equal(sourceIds.size, authority.sources.length, "Association source IDs must be unique");
for (const source of authority.sources) {
  assert.ok(source.snapshotRevision, `${source.id} is missing its inspected snapshot revision`);
  assert.ok(source.capturedAt, `${source.id} is missing its source capture time`);
}

const mapmakersBookIds = parseMapmakersBookIds(seriesSource);
const compiledPublic = [];
const stateCounts = { proposed: 0, approved: 0, rejected: 0, superseded: 0 };

for (const association of authority.associations) {
  assert.ok(association.id, "Every association needs an ID");
  assert.ok(!seenAssociationIds.has(association.id), `Duplicate association ID: ${association.id}`);
  seenAssociationIds.add(association.id);

  assert.ok(Number.isInteger(association.revision) && association.revision >= 1, `${association.id} has an invalid revision`);
  assert.ok(reviewStates.has(association.review?.state), `${association.id} has an invalid review state`);
  stateCounts[association.review.state] += 1;
  assert.ok(salienceValues.has(association.salience), `${association.id} has invalid salience`);
  assert.ok(relationKinds[association.subject?.kind]?.has(association.relationship), `${association.id} uses ${association.relationship} for ${association.subject?.kind}`);
  assert.ok(sourceIds.has(association.subject.sourceId), `${association.id} references an unknown subject source`);
  assert.match(association.subject.sourceRevision, /^sha256:[a-f0-9]{64}$/, `${association.id} needs a SHA-256 subject revision`);

  const tuple = [
    association.subject.kind,
    association.subject.id,
    association.place.entityId,
    association.relationship,
    association.temporal.validFrom || "",
    association.temporal.validTo || "",
  ].join("|");
  assert.ok(!seenTuples.has(tuple), `${association.id} duplicates an existing subject/place/relationship interval`);
  seenTuples.add(tuple);

  const country = countryById.get(association.place.entityId);
  assert.ok(country, `${association.id} references missing Atlas entity ${association.place.entityId}`);
  assert.equal(association.place.name, country.names.common, `${association.id} place name drifted from Atlas`);
  assert.equal(association.place.slug, country.slug, `${association.id} place slug drifted from Atlas`);

  if (association.pilotCollectionId === "the-mapmakers") {
    assert.ok(mapmakersBookIds.has(association.subject.id), `${association.id} is outside The Mapmakers pilot`);
  }

  let currentSubjectRevision = association.subject.sourceRevision;
  let subjectIsReadable = true;
  if (association.subject.kind === "book") {
    const current = bookById.get(association.subject.id);
    assert.ok(current, `${association.id} references missing book ${association.subject.id}`);
    const { book, index } = current;
    currentSubjectRevision = bookSourceRevision(book);
    subjectIsReadable = String(book.status || "ready").toLowerCase() === "ready"
      && ["main", "archive"].includes(String(book.visibility || "main").toLowerCase());
    assert.equal(association.subject.title, String(book.title || ""), `${association.id} title drifted from the catalog`);
    assert.equal(association.subject.href, `/books/${slugify(book.slug || book.title || book.id)}`, `${association.id} href drifted from the catalog`);

    for (const evidence of association.evidence) {
      assert.ok(sourceIds.has(evidence.sourceId), `${association.id} evidence references an unknown source`);
      assert.match(evidence.exactTextSha256, /^sha256:[a-f0-9]{64}$/, `${association.id} evidence needs a SHA-256 hash`);
      assert.equal(evidence.exactTextSha256, sha256(evidence.exactText), `${association.id} evidence hash is wrong`);
      assert.ok(evidence.supports.includes("place_connection"), `${association.id} evidence does not support the place connection`);

      if (evidence.sourceId === association.subject.sourceId) {
        assert.equal(evidence.sourceRevision, association.subject.sourceRevision, `${association.id} evidence and subject revisions differ`);
      }
      if (evidence.sourceId === "jju-book-catalog") {
        const locatorMatch = evidence.locator.match(/^\/(\d+)\/(title|description)$/);
        assert.ok(locatorMatch, `${association.id} has an unsupported catalog evidence locator`);
        assert.equal(Number(locatorMatch[1]), index, `${association.id} evidence locator points at the wrong book`);
        const sourceValue = String(book[locatorMatch[2]] || "");
        assert.ok(sourceValue.includes(evidence.exactText), `${association.id} exact evidence no longer exists at ${evidence.locator}`);
      }
    }
  }

  assert.ok(Array.isArray(association.evidence) && association.evidence.length > 0, `${association.id} needs evidence`);
  assert.ok(association.proposal?.rationale, `${association.id} needs proposal rationale`);
  assert.ok(Number.isFinite(association.proposal?.confidence), `${association.id} needs numeric confidence`);
  assert.ok(association.proposal.confidence >= 0 && association.proposal.confidence <= 1, `${association.id} confidence is out of range`);

  if (association.review.state === "approved") {
    assert.equal(association.review.reviewerKind, "human", `${association.id} is approved without human review`);
    assert.ok(association.review.reviewedBy, `${association.id} is approved without reviewer identity`);
    assert.ok(association.review.reviewedAt, `${association.id} is approved without review time`);
    assert.ok(association.review.decisionNote, `${association.id} is approved without a decision note`);
    assert.ok(
      association.evidence.some((evidence) => evidence.supports.includes("relationship_semantics")),
      `${association.id} is approved without evidence for its relationship strength`,
    );
    assert.equal(currentSubjectRevision, association.subject.sourceRevision, `${association.id} is stale and must leave public output until re-reviewed`);
    if (subjectIsReadable) {
      compiledPublic.push({
        associationId: association.id,
        entityId: association.place.entityId,
        title: association.subject.title,
        href: association.subject.href,
        kind: association.subject.kind,
        relationship: association.relationship,
        salience: association.salience,
      });
    }
  } else if (association.review.state === "proposed") {
    assert.equal(association.review.reviewerKind, null, `${association.id} proposal must not claim a reviewer`);
    assert.equal(association.review.reviewedBy, null, `${association.id} proposal must not claim review identity`);
    assert.equal(association.review.reviewedAt, null, `${association.id} proposal must not claim review time`);
    assert.equal(association.review.decisionNote, null, `${association.id} proposal must not claim a review decision`);
  }
}

assert.ok(compiledPublic.length <= stateCounts.approved, "Public output cannot exceed approved records");
const proposedAssociationIds = new Set(authority.associations
  .filter((association) => association.review.state === "proposed")
  .map((association) => association.id));
assert.ok(!compiledPublic.some((link) => proposedAssociationIds.has(link.associationId)), "A proposed association leaked into public output");
assert.ok(compiledPublic.every((link) => link.relationship), "Compiled links lost relationship semantics");

const result = {
  authorityId: authority.authorityId,
  authorityRevision: authority.revision,
  total: authority.associations.length,
  ...stateCounts,
  publicLinks: compiledPublic.length,
  entitiesWithPublicLinks: new Set(compiledPublic.map((link) => link.entityId)).size,
  mapmakersBooksConsidered: mapmakersBookIds.size,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(
    `Atlas/JJU associations OK: ${result.publicLinks} human-reviewed public links across `
      + `${result.entitiesWithPublicLinks} places; ${result.proposed} proposals remain private.`,
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function bookSourceRevision(book) {
  const canonical = {
    id: String(book.id || ""),
    title: String(book.title || ""),
    description: String(book.description || ""),
    tags: Array.isArray(book.tags) ? book.tags.map(String) : [],
    status: String(book.status || ""),
    visibility: String(book.visibility || ""),
    slug: String(book.slug || ""),
  };
  return sha256(JSON.stringify(canonical));
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

function parseMapmakersBookIds(source) {
  const match = source.match(/\{\s*id:\s*"the-mapmakers"[\s\S]*?bookIds:\s*(\[[^\]]*\])/);
  assert.ok(match, "Could not find The Mapmakers in lib/seriesCatalog.ts");
  return new Set(JSON.parse(match[1]));
}
