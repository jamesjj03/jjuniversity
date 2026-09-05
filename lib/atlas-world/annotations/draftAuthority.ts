import { createHash } from "node:crypto";
import { AtlasEditorialValidationError } from "../editorialReview";
import type {
  AtlasAnnotationDraftAuthority,
  AtlasAnnotationDraftContent,
  AtlasAnnotationDraftEvidence,
  AtlasAnnotationDraftMutation,
  AtlasAnnotationDraftRecord,
  AtlasAnnotationDraftReferenceOptions,
  AtlasAnnotationDraftState,
} from "./draftTypes";

const STATES = new Set<AtlasAnnotationDraftState>(["draft", "proposed", "approved", "rejected", "retired"]);

function text(value: unknown, label: string, minimum: number, maximum: number) {
  const clean = String(value || "").trim();
  if (clean.length < minimum) throw new AtlasEditorialValidationError(`${label} must be at least ${minimum} characters.`);
  if (clean.length > maximum) throw new AtlasEditorialValidationError(`${label} must be ${maximum} characters or fewer.`);
  return clean;
}

function optionalDate(value: unknown, label: string) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  if (!/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(clean) || !Number.isFinite(Date.parse(clean.length === 4 ? `${clean}-01-01` : clean.length === 7 ? `${clean}-01` : clean))) {
    throw new AtlasEditorialValidationError(`${label} must be a year, month, or date.`);
  }
  return clean;
}

function finiteCoordinate(value: unknown, label: string, minimum: number, maximum: number) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    throw new AtlasEditorialValidationError(`${label} is required when that coordinate group is used.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new AtlasEditorialValidationError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return Math.round(number * 1_000_000) / 1_000_000;
}

function uniqueIds(value: unknown, allowed: ReadonlySet<string>, label: string, maximum = 20) {
  if (!Array.isArray(value)) throw new AtlasEditorialValidationError(`${label} must be a list.`);
  const ids = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  if (ids.length > maximum) throw new AtlasEditorialValidationError(`${label} contains too many items.`);
  const unknown = ids.filter((id) => !allowed.has(id));
  if (unknown.length) throw new AtlasEditorialValidationError(`${label} contains unknown IDs: ${unknown.slice(0, 4).join(", ")}.`);
  return ids.sort();
}

function shortId(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function canonicalEvidence(value: unknown, index: number, retrievedAt: string): AtlasAnnotationDraftEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AtlasEditorialValidationError(`Evidence ${index + 1} must be an object.`);
  }
  const source = value as Partial<AtlasAnnotationDraftEvidence>;
  const url = text(source.url, `Evidence ${index + 1} URL`, 8, 1_000);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AtlasEditorialValidationError(`Evidence ${index + 1} URL is invalid.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AtlasEditorialValidationError(`Evidence ${index + 1} URL must use HTTP or HTTPS.`);
  }
  const title = text(source.title, `Evidence ${index + 1} title`, 3, 240);
  const publisher = text(source.publisher, `Evidence ${index + 1} publisher`, 2, 160);
  const supports = text(source.supports, `Evidence ${index + 1} support statement`, 20, 700);
  return {
    id: `draft-source:${shortId(`${url}|${title}`)}`,
    title,
    publisher,
    url,
    publishedAt: optionalDate(source.publishedAt, `Evidence ${index + 1} publication date`),
    retrievedAt,
    supports,
  };
}

function canonicalStringList(value: unknown, label: string, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) throw new AtlasEditorialValidationError(`${label} must be a list.`);
  const result = [...new Set(value.map((item) => text(item, label, 3, maximumLength)))];
  if (result.length > maximumItems) throw new AtlasEditorialValidationError(`${label} contains too many items.`);
  return result;
}

function storedContentReferences(
  content: AtlasAnnotationDraftContent,
  version: string,
): AtlasAnnotationDraftReferenceOptions {
  const layerIds = [...new Set([
    ...(Array.isArray(content?.layerIds) ? content.layerIds : []),
    ...(Array.isArray(content?.relatedLayerIds) ? content.relatedLayerIds : []),
    ...(Array.isArray(content?.action?.layerIds) ? content.action.layerIds : []),
  ].map((id) => String(id || "").trim()).filter(Boolean))];
  const triggerLayerIds = Array.isArray(content?.layerIds)
    ? content.layerIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const viewPresetId = String(content?.viewPresetId || "").trim();
  const actionViewPresetId = String(content?.action?.viewPresetId || "").trim();
  const viewIds = [...new Set([viewPresetId, actionViewPresetId].filter(Boolean))];
  const entityIds = Array.isArray(content?.spatial?.entityIds) ? content.spatial.entityIds : [];
  const featureIds = Array.isArray(content?.spatial?.featureIds) ? content.spatial.featureIds : [];
  return {
    version,
    views: viewIds.map((id) => ({ id, name: id, layerIds: id === viewPresetId ? triggerLayerIds : layerIds })),
    layers: layerIds.map((id) => ({ id, name: id })),
    entities: entityIds.map((id) => ({ id, name: id })),
    features: featureIds.map((id) => ({ id, name: id, kind: "city" as const })),
  };
}

export function canonicalizeAtlasAnnotationDraftContent(
  value: unknown,
  references: AtlasAnnotationDraftReferenceOptions,
  retrievedAt: string,
): AtlasAnnotationDraftContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AtlasEditorialValidationError("The annotation draft must be an object.");
  }
  const input = value as Partial<AtlasAnnotationDraftContent>;
  const viewById = new Map(references.views.map((view) => [view.id, view]));
  const layerIds = new Set(references.layers.map((layer) => layer.id));
  const entityIds = new Set(references.entities.map((entity) => entity.id));
  const featureIds = new Set(references.features.map((feature) => feature.id));
  const viewPresetId = text(input.viewPresetId, "Scene", 1, 120);
  const view = viewById.get(viewPresetId);
  if (!view) throw new AtlasEditorialValidationError("Choose a current Atlas scene.");
  const triggerLayers = uniqueIds(input.layerIds, new Set(view.layerIds), "Trigger layers", 12);
  if (!triggerLayers.length) throw new AtlasEditorialValidationError("Choose at least one layer used by the selected scene.");

  const spatialInput = input.spatial;
  if (!spatialInput || typeof spatialInput !== "object") throw new AtlasEditorialValidationError("Geography is required.");
  const entities = uniqueIds(spatialInput.entityIds, entityIds, "Geographic entities", 16);
  const features = uniqueIds(spatialInput.featureIds, featureIds, "Geographic features", 30);
  const focus = spatialInput.focus ? {
    longitude: finiteCoordinate(spatialInput.focus.longitude, "Focus longitude", -180, 180),
    latitude: finiteCoordinate(spatialInput.focus.latitude, "Focus latitude", -85, 85),
  } : null;
  const bounds = spatialInput.boundsWgs84 ? [
    [
      finiteCoordinate(spatialInput.boundsWgs84[0]?.[0], "West bound", -180, 180),
      finiteCoordinate(spatialInput.boundsWgs84[0]?.[1], "South bound", -85, 85),
    ],
    [
      finiteCoordinate(spatialInput.boundsWgs84[1]?.[0], "East bound", -180, 180),
      finiteCoordinate(spatialInput.boundsWgs84[1]?.[1], "North bound", -85, 85),
    ],
  ] as [[number, number], [number, number]] : null;
  if (bounds && (bounds[0][0] >= bounds[1][0] || bounds[0][1] >= bounds[1][1])) {
    throw new AtlasEditorialValidationError("Viewing bounds must run west-to-east and south-to-north.");
  }
  if (focus && bounds && (focus.longitude < bounds[0][0] || focus.longitude > bounds[1][0] || focus.latitude < bounds[0][1] || focus.latitude > bounds[1][1])) {
    throw new AtlasEditorialValidationError("The focus point must fall inside the viewing bounds.");
  }
  if (!entities.length && !features.length && !focus && !bounds) {
    throw new AtlasEditorialValidationError("Choose an entity or feature, or provide a focus point or viewing bounds.");
  }
  const highlightKind = spatialInput.highlight?.kind;
  if (!highlightKind || !["bounds", "feature-reference", "point"].includes(highlightKind)) {
    throw new AtlasEditorialValidationError("Choose a highlight method.");
  }
  if (highlightKind === "bounds" && !bounds) throw new AtlasEditorialValidationError("A bounds highlight needs viewing bounds.");
  if (highlightKind === "feature-reference" && !features.length) throw new AtlasEditorialValidationError("A feature highlight needs at least one mapped feature.");
  if (highlightKind === "point" && !focus) throw new AtlasEditorialValidationError("A point highlight needs focus coordinates.");

  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 8) {
    throw new AtlasEditorialValidationError("Provide between one and eight evidence sources.");
  }
  const evidence = input.evidence.map((source, index) => canonicalEvidence(source, index, retrievedAt));
  const relatedLayerIds = uniqueIds(input.relatedLayerIds, layerIds, "Related layers", 12);
  const action = input.action ? {
    label: text(input.action.label, "Related action label", 3, 100),
    viewPresetId: input.action.viewPresetId ? text(input.action.viewPresetId, "Related action scene", 1, 120) : null,
    layerIds: uniqueIds(input.action.layerIds, layerIds, "Related action layers", 12),
  } : null;
  if (action?.viewPresetId && !viewById.has(action.viewPresetId)) throw new AtlasEditorialValidationError("The related action references an unknown scene.");

  return {
    headline: text(input.headline, "Headline", 5, 120),
    summary: text(input.summary, "Explanation", 40, 700),
    viewPresetId,
    layerIds: triggerLayers,
    spatial: { entityIds: entities, featureIds: features, focus, boundsWgs84: bounds, highlight: { kind: highlightKind } },
    evidence,
    relatedLayerIds,
    action,
    caveats: canonicalStringList(input.caveats, "Caveats", 12, 500),
  };
}

export function validateAtlasAnnotationDraftAuthority(
  value: unknown,
  references?: AtlasAnnotationDraftReferenceOptions,
): AtlasAnnotationDraftAuthority {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AtlasEditorialValidationError("The annotation draft authority must be an object.");
  const authority = value as AtlasAnnotationDraftAuthority;
  if (authority.schemaVersion !== "1.0.0" || authority.authorityId !== "jju-atlas-annotation-drafts") {
    throw new AtlasEditorialValidationError("The annotation draft authority has an unsupported identity or schema.");
  }
  if (!Number.isSafeInteger(authority.revision) || authority.revision < 1 || !Number.isFinite(Date.parse(authority.updatedAt))) {
    throw new AtlasEditorialValidationError("The annotation draft authority has invalid version metadata.");
  }
  if (authority.policy?.requireHumanApproval !== true || authority.policy?.automatedPublication !== false || authority.policy?.publicPatternNotesAreSeparate !== true) {
    throw new AtlasEditorialValidationError("The annotation draft promotion boundary is invalid.");
  }
  if (!Array.isArray(authority.drafts)) throw new AtlasEditorialValidationError("Annotation drafts must be a list.");
  const ids = new Set<string>();
  for (const draft of authority.drafts) {
    if (!draft.id || ids.has(draft.id)) throw new AtlasEditorialValidationError("Annotation draft IDs must be present and unique.");
    ids.add(draft.id);
    if (!Number.isSafeInteger(draft.revision) || draft.revision < 1 || !STATES.has(draft.state)) throw new AtlasEditorialValidationError(`${draft.id} has invalid state metadata.`);
    if (draft.origin !== "manual_editorial" && draft.origin !== "ai_assisted") throw new AtlasEditorialValidationError(`${draft.id} has an invalid authoring origin.`);
    if (!draft.createdBy || !draft.modifiedBy || !Number.isFinite(Date.parse(draft.createdAt)) || !Number.isFinite(Date.parse(draft.modifiedAt))) {
      throw new AtlasEditorialValidationError(`${draft.id} has incomplete authorship metadata.`);
    }
    if (!draft.referenceVersion) throw new AtlasEditorialValidationError(`${draft.id} has no reference version.`);
    if (draft.promotion?.state !== "not-promoted" || draft.promotion.targetPatternNoteId !== null || draft.promotion.promotedBy !== null || draft.promotion.promotedAt !== null) {
      throw new AtlasEditorialValidationError(`${draft.id} crossed the explicit public-promotion boundary.`);
    }
    if (["approved", "rejected", "retired"].includes(draft.state)) {
      if (draft.review?.reviewerKind !== "human" || !draft.review.reviewedBy || !draft.review.reviewedAt || !draft.review.decisionNote) {
        throw new AtlasEditorialValidationError(`${draft.id} claims a decision without complete human review.`);
      }
    } else if (draft.review?.reviewerKind !== null || draft.review.reviewedBy !== null || draft.review.reviewedAt !== null || draft.review.decisionNote !== null) {
      throw new AtlasEditorialValidationError(`${draft.id} is undecided but claims review metadata.`);
    }
    const evidence = Array.isArray(draft.content?.evidence) ? draft.content.evidence : [];
    for (const source of evidence) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(source.retrievedAt || "") || !Number.isFinite(Date.parse(source.retrievedAt))) {
        throw new AtlasEditorialValidationError(`${draft.id} has invalid evidence retrieval metadata.`);
      }
      if (source.id !== `draft-source:${shortId(`${source.url}|${source.title}`)}`) {
        throw new AtlasEditorialValidationError(`${draft.id} has evidence whose stable ID does not match its source.`);
      }
    }
    const validationReferences = references && draft.referenceVersion === references.version
      ? references
      : storedContentReferences(draft.content, draft.referenceVersion);
    canonicalizeAtlasAnnotationDraftContent(draft.content, validationReferences, evidence[0]?.retrievedAt || draft.modifiedAt.slice(0, 10));
  }
  return authority;
}

export function applyAtlasAnnotationDraftMutation(
  authority: AtlasAnnotationDraftAuthority,
  mutation: AtlasAnnotationDraftMutation,
  references: AtlasAnnotationDraftReferenceOptions,
  options: { now: string; newDraftId?: string },
): AtlasAnnotationDraftAuthority {
  const actor = text(mutation.actor, "Author or reviewer name", 2, 120);
  const now = new Date(options.now);
  if (!Number.isFinite(now.getTime())) throw new AtlasEditorialValidationError("The draft timestamp is invalid.");
  const timestamp = now.toISOString();
  const retrievedAt = timestamp.slice(0, 10);
  const drafts = [...authority.drafts];

  if (mutation.operation === "create") {
    if (!options.newDraftId || drafts.some((draft) => draft.id === options.newDraftId)) throw new AtlasEditorialValidationError("The new annotation draft has no safe unique id.");
    const content = canonicalizeAtlasAnnotationDraftContent(mutation.content, references, retrievedAt);
    const draft: AtlasAnnotationDraftRecord = {
      id: options.newDraftId,
      revision: 1,
      state: "draft",
      origin: mutation.origin === "ai_assisted" ? "ai_assisted" : "manual_editorial",
      createdBy: actor,
      createdAt: timestamp,
      modifiedBy: actor,
      modifiedAt: timestamp,
      referenceVersion: references.version,
      content,
      review: { reviewerKind: null, reviewedBy: null, reviewedAt: null, decisionNote: null },
      promotion: { state: "not-promoted", targetPatternNoteId: null, promotedBy: null, promotedAt: null },
    };
    drafts.push(draft);
  } else {
    const index = drafts.findIndex((draft) => draft.id === mutation.draftId);
    if (index < 0) throw new AtlasEditorialValidationError("That annotation draft no longer exists.");
    const current = drafts[index];
    if (mutation.operation === "save") {
      if (current.state !== "draft" && current.state !== "proposed") throw new AtlasEditorialValidationError("Return this decided annotation to draft before editing it.");
      drafts[index] = {
        ...current,
        revision: current.revision + 1,
        origin: mutation.origin === "ai_assisted" ? "ai_assisted" : "manual_editorial",
        modifiedBy: actor,
        modifiedAt: timestamp,
        referenceVersion: references.version,
        content: canonicalizeAtlasAnnotationDraftContent(mutation.content, references, retrievedAt),
      };
    } else {
      if (!mutation.state || !STATES.has(mutation.state)) throw new AtlasEditorialValidationError("Choose a valid draft decision.");
      if (mutation.state === "approved" && current.state !== "proposed") throw new AtlasEditorialValidationError("Submit the draft for review before approving it.");
      if (mutation.state === "approved" && current.referenceVersion !== references.version) throw new AtlasEditorialValidationError("This draft references an older Atlas build. Save and review it again before approval.");
      const decided = ["approved", "rejected", "retired"].includes(mutation.state);
      const decisionNote = decided ? text(mutation.decisionNote, "Decision note", 3, 1_000) : null;
      drafts[index] = {
        ...current,
        revision: current.revision + 1,
        state: mutation.state,
        modifiedBy: actor,
        modifiedAt: timestamp,
        review: decided ? {
          reviewerKind: "human",
          reviewedBy: actor,
          reviewedAt: timestamp,
          decisionNote,
        } : { reviewerKind: null, reviewedBy: null, reviewedAt: null, decisionNote: null },
        // Approval is an editorial decision, not a public pattern-note write.
        promotion: { state: "not-promoted", targetPatternNoteId: null, promotedBy: null, promotedAt: null },
      };
    }
  }

  return validateAtlasAnnotationDraftAuthority({
    ...authority,
    revision: authority.revision + 1,
    updatedAt: timestamp,
    drafts: drafts.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.id.localeCompare(right.id)),
  }, references);
}
