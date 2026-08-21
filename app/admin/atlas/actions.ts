"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  attachAtlasCorpusSourcesToPlannedMap,
  applyAtlasCategoryOperation as applyAtlasCategoryOperationToSupabase,
  approveAtlasCategoryCheckpoint as approveAtlasCategoryCheckpointInSupabase,
  importAtlasDraftSpecToSupabase,
  queueAtlasFactoryGenerationJob,
  saveAtlasAdminContributor,
  saveAtlasAdminGroup,
  saveAtlasAdminMap,
  saveAtlasAdminRelation,
  saveAtlasCategoryGroupReview,
  saveAtlasQualityScorecard,
  saveAtlasMapRecipe,
  saveAtlasPlannedMapFactorySettings,
  saveAtlasRecipeFeedback,
  saveAtlasReviewCorrection,
  textToLines,
} from "@/lib/atlasAdmin";
import type { AtlasMapSpec } from "@/lib/atlasMaps";
import { getAdminHref } from "@/lib/adminPath";

export type AtlasDraftImportActionState = {
  ok: boolean;
  message: string;
  errors: string[];
  mapIds: string[];
};

const INITIAL_IMPORT_STATE: AtlasDraftImportActionState = {
  ok: false,
  message: "",
  errors: [],
  mapIds: [],
};

export async function importAtlasDraft(
  _state: AtlasDraftImportActionState = INITIAL_IMPORT_STATE,
  formData: FormData,
): Promise<AtlasDraftImportActionState> {
  void _state;
  await assertAdminAccess();

  const rawJson = formValue(formData, "draftJson");
  if (!rawJson) {
    return {
      ok: false,
      message: "Paste an AtlasMapSpec JSON draft before importing.",
      errors: ["draftJson: JSON payload is required."],
      mapIds: [],
    };
  }

  let parsed: AtlasMapSpec;
  try {
    parsed = JSON.parse(rawJson) as AtlasMapSpec;
  } catch (error) {
    return {
      ok: false,
      message: "Draft JSON could not be parsed.",
      errors: [error instanceof Error ? error.message : "Invalid JSON."],
      mapIds: [],
    };
  }

  const result = await importAtlasDraftSpecToSupabase(parsed);
  if (!result.ok) {
    return {
      ok: false,
      message: "Draft validation failed.",
      errors: result.errors,
      mapIds: result.mapIds,
    };
  }

  revalidatePath("/admin/atlas");
  revalidatePath("/atlas");

  return {
    ok: true,
    message: `Imported ${result.counts?.maps || result.mapIds.length} map draft(s) for review.`,
    errors: [],
    mapIds: result.mapIds,
  };
}

export async function updateAtlasMap(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  await saveAtlasAdminMap({
    mapId,
    title: formValue(formData, "title"),
    summary: formValue(formData, "summary"),
    reviewStatus: formValue(formData, "reviewStatus"),
  });

  refreshAtlas(mapId, "map");
}

export async function updateAtlasGroup(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  await saveAtlasAdminGroup({
    mapId,
    groupId: formValue(formData, "groupId"),
    stance: formValue(formData, "stance"),
    centralClaim: formValue(formData, "centralClaim"),
    whyItMatters: formValue(formData, "whyItMatters"),
    objections: textToLines(formValue(formData, "objections")),
  });

  refreshAtlas(mapId, "group");
}

export async function updateAtlasContributor(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  await saveAtlasAdminContributor({
    mapId,
    groupId: formValue(formData, "groupId"),
    contributorId: formValue(formData, "contributorId"),
    reason: formValue(formData, "reason"),
  });

  refreshAtlas(mapId, "contributor");
}

export async function updateAtlasRelation(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  await saveAtlasAdminRelation({
    mapId,
    relationId: formValue(formData, "relationId"),
    note: formValue(formData, "note"),
  });

  refreshAtlas(mapId, "relation");
}

export async function updateAtlasCategoryGroup(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  const referenceMapId = formValue(formData, "referenceMapId");
  await saveAtlasCategoryGroupReview({
    mapId,
    referenceMapId,
    groupId: formValue(formData, "groupId"),
    title: formValue(formData, "title"),
    shortTitle: formValue(formData, "shortTitle"),
    centralClaim: formValue(formData, "centralClaim"),
    relatedGroupIds: textToLines(formValue(formData, "relatedGroupIds")),
    groupStatus: formValue(formData, "groupStatus"),
    notes: formValue(formData, "notes"),
  });

  refreshAtlasCategory(mapId, referenceMapId, "category");
}

export async function applyAtlasCategoryOperation(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  const referenceMapId = formValue(formData, "referenceMapId");
  await applyAtlasCategoryOperationToSupabase({
    mapId,
    referenceMapId,
    operation: formValue(formData, "operation"),
    groupId: formValue(formData, "groupId"),
    targetGroupId: formValue(formData, "targetGroupId"),
    newGroupTitle: formValue(formData, "newGroupTitle"),
    memberType: formValue(formData, "memberType"),
    memberId: formValue(formData, "memberId"),
    memberIds: textToLines(formValue(formData, "memberIds")),
    direction: formValue(formData, "direction"),
    reason: formValue(formData, "reason"),
  });

  refreshAtlasCategory(mapId, referenceMapId, "category-operation");
}

export async function updateAtlasQualityScorecard(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  const referenceMapId = formValue(formData, "referenceMapId");
  await saveAtlasQualityScorecard({
    mapId,
    referenceMapId,
    categoryQuality: numberValue(formData, "categoryQuality", 3),
    fieldCoverage: numberValue(formData, "fieldCoverage", 3),
    factualAccuracy: numberValue(formData, "factualAccuracy", 3),
    contributorPlacement: numberValue(formData, "contributorPlacement", 3),
    keyTextSelection: numberValue(formData, "keyTextSelection", 3),
    objectionQuality: numberValue(formData, "objectionQuality", 3),
    relationQuality: numberValue(formData, "relationQuality", 3),
    explanatoryUsefulness: numberValue(formData, "explanatoryUsefulness", 3),
    redundancyNoise: numberValue(formData, "redundancyNoise", 3),
    provenanceSupport: numberValue(formData, "provenanceSupport", 3),
    notes: formValue(formData, "notes"),
  });

  refreshAtlasCategory(mapId, referenceMapId, "scorecard");
}

export async function addAtlasReviewCorrection(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  const referenceMapId = formValue(formData, "referenceMapId");
  await saveAtlasReviewCorrection({
    mapId,
    referenceMapId,
    entityType: formValue(formData, "entityType"),
    entityId: formValue(formData, "entityId"),
    fieldName: formValue(formData, "fieldName"),
    correctionType: formValue(formData, "correctionType"),
    originalValue: formValue(formData, "originalValue"),
    revisedValue: formValue(formData, "revisedValue"),
    reason: formValue(formData, "reason"),
    reviewerStatus: formValue(formData, "reviewerStatus"),
  });

  refreshAtlasCategory(mapId, referenceMapId, "correction");
}

export async function updateAtlasRecipeFeedback(formData: FormData) {
  await assertAdminAccess();

  await saveAtlasRecipeFeedback({
    feedbackId: formValue(formData, "feedbackId"),
    recipeId: formValue(formData, "recipeId"),
    correctionType: formValue(formData, "correctionType"),
    summary: formValue(formData, "summary"),
    recommendation: formValue(formData, "recommendation"),
    status: formValue(formData, "status"),
  });

  refreshAtlasFactory("recipe-feedback");
}

export async function approveAtlasCategoryCheckpoint(formData: FormData) {
  await assertAdminAccess();

  const mapId = formValue(formData, "mapId");
  const referenceMapId = formValue(formData, "referenceMapId");
  await approveAtlasCategoryCheckpointInSupabase({
    mapId,
    referenceMapId,
    reviewerNotes: formValue(formData, "reviewerNotes"),
  });

  refreshAtlasCategory(mapId, referenceMapId, "category-checkpoint");
}

export async function updateAtlasRecipe(formData: FormData) {
  await assertAdminAccess();

  await saveAtlasMapRecipe({
    recipeId: formValue(formData, "recipeId"),
    title: formValue(formData, "title"),
    purpose: formValue(formData, "purpose"),
    groupingLogic: formValue(formData, "groupingLogic"),
    preferredGroupFields: textToLines(formValue(formData, "preferredGroupFields")),
    contributorRules: formValue(formData, "contributorRules"),
    expectedRelationTypes: textToLines(formValue(formData, "expectedRelationTypes")),
    recommendedMin: numberValue(formData, "recommendedMin", 5),
    recommendedMax: numberValue(formData, "recommendedMax", 10),
    generationInstructions: formValue(formData, "generationInstructions"),
    evaluationCriteria: textToLines(formValue(formData, "evaluationCriteria")),
  });

  refreshAtlasFactory("recipe");
}

export async function updateAtlasPlannedMapFactory(formData: FormData) {
  await assertAdminAccess();

  await saveAtlasPlannedMapFactorySettings({
    plannedMapId: formValue(formData, "plannedMapId"),
    recipeId: formValue(formData, "recipeId"),
    status: formValue(formData, "status"),
  });

  refreshAtlasFactory("planned-map");
}

export async function attachAtlasCorpusSources(formData: FormData) {
  await assertAdminAccess();

  await attachAtlasCorpusSourcesToPlannedMap({
    plannedMapId: formValue(formData, "plannedMapId"),
    corpusSourceIds: formData.getAll("corpusSourceIds").map(value => String(value).trim()).filter(Boolean),
    corpusBridgeOptions: {
      focusPlannedMapId: formValue(formData, "plannedMapId"),
      humanKeywords: textToLines(formValue(formData, "corpusKeywords")),
      includeLaneIds: formData.getAll("corpusIncludeLaneIds").map(value => String(value).trim()).filter(Boolean),
      excludeLaneIds: formData.getAll("corpusExcludeLaneIds").map(value => String(value).trim()).filter(Boolean),
    },
  });

  refreshAtlasFactory("corpus-sources");
}

export async function queueAtlasFactoryJob(formData: FormData) {
  await assertAdminAccess();

  await queueAtlasFactoryGenerationJob({
    plannedMapId: formValue(formData, "plannedMapId"),
    recipeId: formValue(formData, "recipeId"),
    topicPrompt: formValue(formData, "topicPrompt"),
    selectedSourceIds: formData.getAll("sourceIds").map(value => String(value).trim()).filter(Boolean),
    provider: formValue(formData, "provider"),
    model: formValue(formData, "model"),
    endpoint: formValue(formData, "endpoint"),
  });

  refreshAtlasFactory("job");
}

async function assertAdminAccess() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === "development") return;
    throw new Error("Admin access is not configured.");
  }

  const headerStore = await headers();
  const auth = headerStore.get("authorization") || "";
  if (!auth.startsWith("Basic ")) throw new Error("Admin access required.");

  const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const provided = separator >= 0 ? decoded.slice(separator + 1) : decoded;
  const requiredUser = process.env.ADMIN_USERNAME;

  if (requiredUser && username !== requiredUser) throw new Error("Admin access required.");
  if (provided !== password) throw new Error("Admin access required.");
}

function formValue(formData: FormData, key: string) {
  return String(formData.get(key) || "").trim();
}

function numberValue(formData: FormData, key: string, fallback: number) {
  const value = Number(formValue(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

function refreshAtlas(mapId: string, saved: string): never {
  revalidatePath("/admin/atlas");
  revalidatePath("/atlas");
  redirect(getAdminHref(`/admin/atlas?map=${encodeURIComponent(mapId)}&saved=${encodeURIComponent(saved)}`));
}

function refreshAtlasFactory(saved: string): never {
  revalidatePath("/admin/atlas");
  redirect(getAdminHref(`/admin/atlas?saved=${encodeURIComponent(saved)}`));
}

function refreshAtlasCategory(mapId: string, referenceMapId: string, saved: string): never {
  revalidatePath("/admin/atlas");
  revalidatePath("/atlas");
  const referencePart = referenceMapId ? `&reference=${encodeURIComponent(referenceMapId)}` : "";
  redirect(getAdminHref(`/admin/atlas?map=${encodeURIComponent(mapId)}${referencePart}&saved=${encodeURIComponent(saved)}`));
}
