#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [notes, reviews, drafts, associations, associationSchema] = await Promise.all([
  readJson(path.join(root, "lib", "atlas-world", "data", "pattern-notes.v1.json")),
  readJson(path.join(root, "lib", "atlas-world", "annotations", "data", "review-authority.v1.json")),
  readJson(path.join(root, "lib", "atlas-world", "annotations", "data", "draft-authority.v1.json")),
  readJson(path.join(root, "lib", "atlas-world", "associations", "data", "authority.v1.json")),
  readJson(path.join(root, "lib", "atlas-world", "associations", "schema", "authority.v1.schema.json")),
]);

assert.equal(reviews.schemaVersion, "1.0.0");
assert.equal(reviews.sourceSnapshotId, notes.snapshotId, "Annotation review and source snapshots differ");
assert.equal(reviews.policy.requireHumanDecision, true);
assert.equal(reviews.policy.automatedPublication, false);
assert.equal(reviews.policy.legacySourceReviewedNotesRemainVisibleWhileProposed, true);

const noteById = new Map(notes.notes.map((note) => [note.id, note]));
const reviewById = new Map(reviews.records.map((review) => [review.noteId, review]));
assert.equal(noteById.size, notes.notes.length, "Pattern note IDs must be unique");
assert.equal(reviewById.size, reviews.records.length, "Annotation review IDs must be unique");
assert.deepEqual([...reviewById.keys()].sort(), [...noteById.keys()].sort(), "Every pattern note needs exactly one editorial review record");

const annotationStates = new Set(["proposed", "approved", "rejected", "retired", "superseded"]);
for (const review of reviews.records) {
  const note = noteById.get(review.noteId);
  assert.ok(annotationStates.has(review.state), `${review.noteId} has an invalid editorial state`);
  assert.ok(Number.isInteger(review.noteRevision) && review.noteRevision > 0, `${review.noteId} has an invalid source revision`);
  assert.ok(Number.isInteger(review.recordRevision) && review.recordRevision > 0, `${review.noteId} has an invalid record revision`);
  assert.ok(note, `${review.noteId} has no source annotation`);
  if (["approved", "rejected", "retired", "superseded"].includes(review.state)) {
    assert.equal(review.reviewerKind, "human", `${review.noteId} claims a decision without human review`);
    assert.ok(review.reviewedBy && review.reviewedAt && review.decisionNote, `${review.noteId} has incomplete human review metadata`);
  }
  if (review.state === "superseded") {
    assert.ok(review.supersededByNoteId && noteById.has(review.supersededByNoteId), `${review.noteId} has no valid replacement`);
  } else {
    assert.equal(review.supersededByNoteId, null, `${review.noteId} has a replacement outside the superseded state`);
  }
}

assert.equal(drafts.schemaVersion, "1.0.0");
assert.equal(drafts.authorityId, "jju-atlas-annotation-drafts");
assert.equal(drafts.policy.requireHumanApproval, true, "Draft approval must remain a human decision");
assert.equal(drafts.policy.automatedPublication, false, "Annotation drafts must never auto-publish");
assert.equal(drafts.policy.publicPatternNotesAreSeparate, true, "Drafts and public pattern notes must remain separate authorities");
assert.ok(Array.isArray(drafts.drafts), "Annotation drafts must be a list");
assert.equal(new Set(drafts.drafts.map((draft) => draft.id)).size, drafts.drafts.length, "Annotation draft IDs must be unique");
const draftStates = new Set(["draft", "proposed", "approved", "rejected", "retired"]);
for (const draft of drafts.drafts) {
  assert.ok(draftStates.has(draft.state), `${draft.id} has an invalid draft state`);
  assert.deepEqual(draft.promotion, {
    state: "not-promoted",
    targetPatternNoteId: null,
    promotedBy: null,
    promotedAt: null,
  }, `${draft.id} crossed the explicit public-promotion boundary`);
  assert.ok(!noteById.has(draft.id), `${draft.id} was written directly into public pattern notes`);
  if (["approved", "rejected", "retired"].includes(draft.state)) {
    assert.equal(draft.review.reviewerKind, "human", `${draft.id} claims a draft decision without a human`);
    assert.ok(draft.review.reviewedBy && draft.review.reviewedAt && draft.review.decisionNote, `${draft.id} has incomplete review metadata`);
  } else {
    assert.deepEqual(draft.review, { reviewerKind: null, reviewedBy: null, reviewedAt: null, decisionNote: null }, `${draft.id} is undecided but claims review metadata`);
  }
}

assert.equal(associations.policy.automatedPublication, false, "JJU links must never auto-publish");
assert.deepEqual(associations.policy.publicReviewStates, ["approved"]);
for (const association of associations.associations) {
  if (association.review.state !== "approved") continue;
  assert.equal(association.review.reviewerKind, "human", `${association.id} is approved without a human`);
  assert.ok(association.evidence.some((evidence) => evidence.supports.includes("relationship_semantics")), `${association.id} lacks relationship evidence`);
}
assert.equal(associationSchema.$defs.association.allOf[0].then.properties.review.properties.reviewerKind.const, "human");

const result = {
  annotations: notes.notes.length,
  humanApprovedAnnotations: reviews.records.filter((review) => review.state === "approved").length,
  privateAnnotationDrafts: drafts.drafts.length,
  approvedButUnpromotedDrafts: drafts.drafts.filter((draft) => draft.state === "approved" && draft.promotion.state === "not-promoted").length,
  associationProposals: associations.associations.filter((association) => association.review.state === "proposed").length,
  publicEligibleAssociations: associations.associations.filter((association) => association.review.state === "approved").length,
};

if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else console.log(`Atlas editorial authorities OK: ${result.privateAnnotationDrafts} private drafts, ${result.annotations} public-source explanations, and ${associations.associations.length} JJU links remain behind explicit review gates.`);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
