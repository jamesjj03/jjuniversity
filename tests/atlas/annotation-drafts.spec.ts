import { expect, test } from "@playwright/test";
import {
  applyAtlasAnnotationDraftMutation,
  canonicalizeAtlasAnnotationDraftContent,
  validateAtlasAnnotationDraftAuthority,
} from "../../lib/atlas-world/annotations/draftAuthority";
import type {
  AtlasAnnotationDraftAuthority,
  AtlasAnnotationDraftContent,
  AtlasAnnotationDraftReferenceOptions,
} from "../../lib/atlas-world/annotations/draftTypes";

const references: AtlasAnnotationDraftReferenceOptions = {
  version: "sha256:test-reference-v1",
  views: [
    { id: "where-people-live", name: "Where People Live", layerIds: ["population-density", "major-rivers"] },
    { id: "gdp-per-capita", name: "GDP per capita", layerIds: ["gdp-per-capita"] },
  ],
  layers: [
    { id: "population-density", name: "Population density" },
    { id: "major-rivers", name: "Major rivers" },
    { id: "gdp-per-capita", name: "GDP per capita" },
  ],
  entities: [{ id: "country:EGY", name: "Egypt" }],
  features: [{ id: "river:nile", name: "Nile", kind: "river" }],
};

const baseAuthority: AtlasAnnotationDraftAuthority = {
  schemaVersion: "1.0.0",
  authorityId: "jju-atlas-annotation-drafts",
  revision: 1,
  updatedAt: "2026-09-05T00:00:00.000Z",
  policy: {
    requireHumanApproval: true,
    automatedPublication: false,
    publicPatternNotesAreSeparate: true,
  },
  drafts: [],
};

const content: AtlasAnnotationDraftContent = {
  headline: "The Nile makes a narrow population corridor",
  summary: "Settlement is concentrated along the Nile because reliable water and fertile floodplain sharply contrast with the surrounding desert.",
  viewPresetId: "where-people-live",
  layerIds: ["population-density", "major-rivers"],
  spatial: {
    entityIds: ["country:EGY"],
    featureIds: ["river:nile"],
    focus: { longitude: 31.2, latitude: 26.8 },
    boundsWgs84: [[28, 21], [34, 32]],
    highlight: { kind: "feature-reference" },
  },
  evidence: [{
    id: "pending",
    title: "Nile River",
    publisher: "Encyclopaedia Britannica",
    url: "https://www.britannica.com/place/Nile-River",
    publishedAt: "2026",
    retrievedAt: "pending",
    supports: "The river supplies water through an otherwise arid region and supports intensive settlement along its corridor.",
  }],
  relatedLayerIds: ["population-density", "major-rivers"],
  action: {
    label: "Show the river and settlement pattern",
    viewPresetId: "where-people-live",
    layerIds: ["population-density", "major-rivers"],
  },
  caveats: ["This explanation describes a broad spatial pattern rather than every local settlement decision."],
};

function createDraft(origin: "manual_editorial" | "ai_assisted" = "manual_editorial") {
  return applyAtlasAnnotationDraftMutation(baseAuthority, {
    operation: "create",
    actor: "Test editor",
    origin,
    content,
    sourceVersion: references.version,
  }, references, {
    now: "2026-09-05T12:00:00.000Z",
    newDraftId: "annotation-draft:nile:test0001",
  });
}

test("authoring creates a private draft with canonical evidence and no public promotion", () => {
  const authority = createDraft("ai_assisted");
  const draft = authority.drafts[0];
  expect(draft).toMatchObject({
    state: "draft",
    origin: "ai_assisted",
    createdBy: "Test editor",
    referenceVersion: references.version,
    review: { reviewerKind: null, reviewedBy: null, reviewedAt: null, decisionNote: null },
    promotion: { state: "not-promoted", targetPatternNoteId: null, promotedBy: null, promotedAt: null },
  });
  expect(draft.content.evidence[0].id).toMatch(/^draft-source:[a-f0-9]{16}$/);
  expect(draft.content.evidence[0].retrievedAt).toBe("2026-09-05");
  expect(() => validateAtlasAnnotationDraftAuthority(authority, references)).not.toThrow();
});

test("human approval requires review submission and still does not publish", () => {
  const draftAuthority = createDraft();
  expect(() => applyAtlasAnnotationDraftMutation(draftAuthority, {
    operation: "transition",
    draftId: draftAuthority.drafts[0].id,
    actor: "Human reviewer",
    state: "approved",
    decisionNote: "Checked the cited claim.",
    sourceVersion: references.version,
  }, references, { now: "2026-09-05T12:05:00.000Z" })).toThrow(/Submit the draft for review/);

  const proposed = applyAtlasAnnotationDraftMutation(draftAuthority, {
    operation: "transition",
    draftId: draftAuthority.drafts[0].id,
    actor: "Test editor",
    state: "proposed",
    sourceVersion: references.version,
  }, references, { now: "2026-09-05T12:05:00.000Z" });
  expect(proposed.drafts[0].review.reviewerKind).toBeNull();

  const approved = applyAtlasAnnotationDraftMutation(proposed, {
    operation: "transition",
    draftId: proposed.drafts[0].id,
    actor: "Human reviewer",
    state: "approved",
    decisionNote: "Reviewed the evidence and bounded wording.",
    sourceVersion: references.version,
  }, references, { now: "2026-09-05T12:10:00.000Z" });
  expect(approved.drafts[0]).toMatchObject({
    state: "approved",
    review: { reviewerKind: "human", reviewedBy: "Human reviewer" },
    promotion: { state: "not-promoted", targetPatternNoteId: null, promotedBy: null, promotedAt: null },
  });
});

test("stale references remain readable but block approval until the proposal is refreshed", () => {
  const proposed = applyAtlasAnnotationDraftMutation(createDraft(), {
    operation: "transition",
    draftId: "annotation-draft:nile:test0001",
    actor: "Test editor",
    state: "proposed",
    sourceVersion: references.version,
  }, references, { now: "2026-09-05T12:05:00.000Z" });
  const changedReferences = { ...references, version: "sha256:test-reference-v2" };

  expect(() => validateAtlasAnnotationDraftAuthority(proposed, changedReferences)).not.toThrow();
  expect(() => applyAtlasAnnotationDraftMutation(proposed, {
    operation: "transition",
    draftId: proposed.drafts[0].id,
    actor: "Human reviewer",
    state: "approved",
    decisionNote: "Reviewed after a source change.",
    sourceVersion: changedReferences.version,
  }, changedReferences, { now: "2026-09-05T12:10:00.000Z" })).toThrow(/older Atlas build/);

  const refreshed = applyAtlasAnnotationDraftMutation(proposed, {
    operation: "save",
    draftId: proposed.drafts[0].id,
    actor: "Test editor",
    origin: proposed.drafts[0].origin,
    content: proposed.drafts[0].content,
    sourceVersion: changedReferences.version,
  }, changedReferences, { now: "2026-09-05T12:15:00.000Z" });
  expect(refreshed.drafts[0].referenceVersion).toBe(changedReferences.version);
});

test("validation rejects incomplete geography, unknown references, weak evidence, and crossed promotion", () => {
  expect(() => canonicalizeAtlasAnnotationDraftContent({
    ...content,
    layerIds: ["not-a-layer"],
  }, references, "2026-09-05")).toThrow(/unknown IDs/);

  expect(() => canonicalizeAtlasAnnotationDraftContent({
    ...content,
    spatial: { ...content.spatial, focus: { longitude: 31, latitude: Number.NaN } },
  }, references, "2026-09-05")).toThrow(/Focus latitude/);

  expect(() => canonicalizeAtlasAnnotationDraftContent({
    ...content,
    evidence: [{ ...content.evidence[0], supports: "Too vague" }],
  }, references, "2026-09-05")).toThrow(/support statement/);

  const crossed = structuredClone(createDraft());
  (crossed.drafts[0].promotion as unknown as { state: string }).state = "promoted";
  expect(() => validateAtlasAnnotationDraftAuthority(crossed, references)).toThrow(/public-promotion boundary/);
});
