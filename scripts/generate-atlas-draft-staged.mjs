import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { validateAtlasMapSpec } from "../lib/atlasMaps.ts";

const root = process.cwd();
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_LOCAL_MODEL = "mistralai/mistral-7b-instruct-v0.3";
const ATLAS_RELATION_KINDS = new Set(["opposes", "answers", "reframes", "borrows", "neighbors"]);
const RELATION_KIND_ALIASES = new Map([
  ["influences", "borrows"],
  ["influence", "borrows"],
  ["draws", "borrows"],
  ["uses", "borrows"],
  ["depends_on", "answers"],
  ["depends-on", "answers"],
  ["depends", "answers"],
  ["enables", "answers"],
  ["supports", "answers"],
  ["support", "answers"],
  ["grounds", "answers"],
  ["contrasts", "opposes"],
  ["contrast", "opposes"],
  ["pressures", "opposes"],
  ["presses", "opposes"],
  ["challenge", "opposes"],
  ["challenges", "opposes"],
  ["reframe", "reframes"],
]);
const MODEL_PROFILES_PATH = join(root, "config", "atlas-model-profiles.json");

loadLocalEnv(".env.local");
loadLocalEnv(".env");

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}

const territorySlug = getOption("territory-slug", "territory");
const branchSlug = getOption("branch-slug", "branch");
const mapSlug = getOption("map-slug", "map");
const topicPrompt = getOption("topic-prompt", "prompt");
const sourceMapSlug = getOption("source-map-slug", "source-map") || sourceSlugForDraft(mapSlug);
const sourceIds = csvOption("source-ids", "sources");
const recipeId = getOption("recipe-id", "recipe");
const recipeFile = getOption("recipe-file");
const recipeJson = getOption("recipe-json");
const jobId = getOption("job-id");
const modelConfig = readModelConfig("default");
const maxChunks = numberOption("max-chunks", 12);
const chunkCharLimit = Math.max(160, numberOption("chunk-char-limit", modelConfig.defaultChunkCharLimit || 900));
const chunkBatchSize = Math.max(1, numberOption("chunk-batch-size", modelConfig.recommendedExtractionBatchSize || 1));
const concurrency = Math.max(1, numberOption("concurrency", modelConfig.concurrency || 1));
const retryCount = Math.max(0, numberOption("retry-count", 1));
const force = flagEnabled("force");
const importOnSuccess = flagEnabled("import-on-success");
const pauseAfterClustering = flagEnabled("pause-after-clustering") || flagEnabled("category-checkpoint");
const runId = getOption("run-id") || `atlas-staged-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const runDir = resolveRunDir(runId);
const finalDraftPath = resolveOutputPath(getOption("output", "out") || join(runDir, "06-final-draft.json"));
const outputDraftPath = normalizePath(relative(root, finalDraftPath));

if (!territorySlug || !branchSlug || !mapSlug || !topicPrompt) {
  console.error("Missing required staged Atlas generation inputs.");
  printUsage();
  process.exit(1);
}

if (!Number.isFinite(maxChunks) || maxChunks < 1) {
  console.error("--max-chunks must be a positive number.");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

let sourcePacket = emptySourcePacket(sourceMapSlug);
let currentStage = "starting";
const completedStages = new Set();
let repairAttempts = 0;
let validationErrors = [];
let outputCounts = null;
let provenanceStats = null;
let recipeDefinition = null;
let importResult = null;
const modelCallLog = [];

try {
  mkdirSync(runDir, { recursive: true });
  recipeDefinition = await loadRecipeDefinition();
  const preflight = await preflightModelConfigs();
  writeJson(join(runDir, "run-config.json"), {
    runId,
    generator: "atlas-staged-model-generation-v2",
    createdAt: new Date().toISOString(),
    territorySlug,
    branchSlug,
    mapSlug,
    sourceMapSlug,
    selectedSourceIds: sourceIds,
    topicPrompt,
    recipe: recipeDefinition,
    maxChunks,
    chunkCharLimit,
    chunkBatchSize,
    concurrency,
    retryCount,
    force,
    importOnSuccess,
    modelConfig: redactedModelConfig(modelConfig),
    stageModelConfigs: redactedStageModelConfigs(),
    preflight,
  });
  await updateFactoryJob("running", { started_at: new Date().toISOString(), run_id: runId });

  sourcePacket = await stageSourceManifest();
  const extraction = await stageExtraction(sourcePacket);
  const inventory = await stageNormalization(extraction, sourcePacket);
  const clusters = await stageClustering(inventory, sourcePacket);
  const enrichedGroups = await stageGroupEnrichment(clusters, inventory, sourcePacket);
  const relations = await stageRelations(enrichedGroups, inventory, sourcePacket);
  const spec = await stageAssembly(enrichedGroups, relations, sourcePacket);

  outputCounts = countGeneratedOutput(spec);
  if (importOnSuccess) {
    importResult = await importSpecAsReviewDraft(spec);
  }
  validationErrors = [];
  currentStage = "complete";
  completedStages.add("complete");
  writeRunSummary("complete", []);
  await recordGenerationRun({ validationOk: true, errors: [] });
  await updateFactoryJob(importOnSuccess ? "imported" : "draft_ready", {
    completed_at: new Date().toISOString(),
    output_draft_path: outputDraftPath,
    error_summary: null,
    metadataMerge: progressMetadata({
      currentStage,
      latestError: "",
    }),
  });

  console.log("Generated staged AtlasMapSpec draft.");
  console.log(`- run: ${runId}`);
  console.log(`- provider: ${modelConfig.provider}`);
  console.log(`- model: ${modelConfig.model}`);
  console.log(`- run dir: ${runDir}`);
  console.log(`- final draft: ${finalDraftPath}`);
  console.log(`- source ids: ${sourcePacket.sources.map(source => source.id).join(", ")}`);
  console.log(`- chunks used: ${sourcePacket.chunks.length}`);
  console.log(`- groups: ${outputCounts.groups}`);
  console.log(`- contributors: ${outputCounts.contributors}`);
  console.log(`- texts: ${outputCounts.texts}`);
  console.log(`- relations: ${outputCounts.relations}`);
  console.log(`- provenance refs: ${provenanceStats?.refs || 0}`);
  console.log(`- repair attempts: ${repairAttempts}`);
  console.log("Validation passed.");
  console.log(importOnSuccess ? "Imported as needs_review. Not published." : "Not imported. Not published.");
} catch (error) {
  const message = error instanceof Error ? error.message : "Staged Atlas generation failed.";
  validationErrors = validationErrors.length ? validationErrors : [message];
  writeRunSummary("failed", validationErrors);

  try {
    await recordGenerationRun({ validationOk: false, errors: validationErrors });
  } catch (recordError) {
    console.error(`Could not record failed Atlas staged generation run: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
  }
  await updateFactoryJob("failed", {
    completed_at: new Date().toISOString(),
    error_summary: message.slice(0, 1000),
    metadataMerge: progressMetadata({
      currentStage,
      latestError: message.slice(0, 1000),
    }),
  });

  console.error(message);
  process.exit(1);
}

async function stageSourceManifest() {
  currentStage = "source-manifest";
  const manifestPath = join(runDir, "source-packet-manifest.json");
  if (!force && existsSync(manifestPath)) {
    const cached = readJson(manifestPath);
    completedStages.add("source-manifest");
    sourcePacket = cached.sourcePacket;
    await recordGenerationRun({ validationOk: null, errors: [] });
    return cached.sourcePacket;
  }

  const packet = await loadSourcePacket({
    territorySlug,
    branchSlug,
    mapSlug,
    sourceMapSlug,
    sourceIds,
    maxChunks,
  });

  if (!packet.chunks.length) {
    throw new Error(`No Atlas source chunks found for ${territorySlug} / ${branchSlug} / ${sourceMapSlug || mapSlug}.`);
  }

  writeJson(manifestPath, {
    stage: "source-manifest",
    ok: true,
    recipe: recipeDefinition,
    sourcePacket: packet,
  });
  completedStages.add("source-manifest");
  sourcePacket = packet;
  writeRunSummary("running", []);
  await recordGenerationRun({ validationOk: null, errors: [] });
  return packet;
}

async function stageExtraction(packet) {
  currentStage = "extraction";
  const extractionDir = join(runDir, "01-extraction");
  mkdirSync(extractionDir, { recursive: true });
  const batches = buildExtractionUnits(packet.chunks);
  const results = [];

  await updateFactoryJob("running", {
    metadataMerge: progressMetadata({
      currentStage,
      totalBatches: batches.length,
      completedBatches: completedBatchCount(extractionDir),
    }),
  });

  await mapLimit(batches, concurrency, async (unit, batchIndex) => {
    const batchPath = join(extractionDir, `batch-${String(batchIndex).padStart(3, "0")}.json`);
    if (!force && existsSync(batchPath)) {
      results[batchIndex] = readJson(batchPath);
      return;
    }

    const extracted = await requestJsonStage({
      stageName: `extraction-batch-${batchIndex}`,
      system: extractionSystemPrompt(),
      user: extractionUserPrompt(unit.chunks, unit.charLimit),
      validate: value => validateExtractionResult(value, unit.chunks),
    });
    const normalized = normalizeExtractionResult(extracted, unit.chunks);
    writeJson(batchPath, {
      stage: "source-extraction",
      ok: true,
      batchIndex,
      chunkIds: unit.chunks.map(chunk => chunk.chunkId),
      charLimit: unit.charLimit,
      estimatedInputTokens: unit.estimatedInputTokens,
      splitDepth: unit.splitDepth,
      result: normalized,
    });
    results[batchIndex] = readJson(batchPath);
    await updateFactoryJob("running", {
      metadataMerge: progressMetadata({
        currentStage,
        totalBatches: batches.length,
        completedBatches: completedBatchCount(extractionDir),
      }),
    });
  });

  const ordered = results.filter(Boolean);
  if (ordered.length !== batches.length) {
    throw new Error(`Extraction completed ${ordered.length}/${batches.length} batches.`);
  }

  const combined = {
    stage: "source-extraction",
    ok: true,
    batches: ordered,
    chunkIds: packet.chunks.map(chunk => chunk.chunkId),
  };
  writeJson(join(runDir, "01-extraction-summary.json"), combined);
  completedStages.add("extraction");
  writeRunSummary("running", []);
  await recordGenerationRun({ validationOk: null, errors: [] });
  return combined;
}

async function stageNormalization(extraction, packet) {
  currentStage = "normalization";
  const normalizedPath = join(runDir, "02-normalized-candidates.json");
  if (!force && existsSync(normalizedPath)) {
    const cached = readJson(normalizedPath);
    completedStages.add("normalization");
    await recordGenerationRun({ validationOk: null, errors: [] });
    return cached;
  }

  const inventory = normalizeCandidateInventory(extraction, packet);
  const errors = validateInventoryProvenance(inventory, packet);
  if (errors.length) throw new Error(`Candidate normalization produced invalid provenance:\n${errors.map(error => `- ${error}`).join("\n")}`);

  writeJson(normalizedPath, inventory);
  completedStages.add("normalization");
  writeRunSummary("running", []);
  await recordGenerationRun({ validationOk: null, errors: [] });
  return inventory;
}

async function stageClustering(inventory, packet) {
  currentStage = "clustering";
  const clustersPath = join(runDir, "03-clusters.json");
  const approvedCheckpoint = await readApprovedCategoryCheckpoint();
  if (approvedCheckpoint) {
    writeJson(clustersPath, approvedCheckpoint);
    completedStages.add("clustering");
    await recordGenerationRun({ validationOk: null, errors: [] });
    return approvedCheckpoint;
  }

  if (!force && existsSync(clustersPath)) {
    const cached = readJson(clustersPath);
    completedStages.add("clustering");
    await recordGenerationRun({ validationOk: null, errors: [] });
    return cached;
  }

  const clusters = await requestJsonStage({
    stageName: "clustering",
    system: clusteringSystemPrompt(),
    user: clusteringUserPrompt(inventory),
    validate: value => validateClusters(value, inventory, packet),
  });
  const normalized = normalizeClusters(clusters, inventory, packet);
  writeJson(clustersPath, normalized);
  completedStages.add("clustering");
  writeRunSummary("running", []);
  await recordGenerationRun({ validationOk: null, errors: [] });

  if (pauseAfterClustering) {
    currentStage = "awaiting-category-review";
    await writeAwaitingCategoryCheckpoint(normalized);
    writeRunSummary("awaiting_category_review", []);
    await recordGenerationRun({ validationOk: null, errors: [] });
    await updateFactoryJob("awaiting_category_review", {
      metadataMerge: progressMetadata({
        currentStage,
        totalGroups: normalized.groups.length,
        completedGroups: 0,
        latestError: "",
      }),
    });
    console.log("Atlas staged generation paused after clustering for category review.");
    console.log(`- run: ${runId}`);
    console.log(`- job: ${jobId || "none"}`);
    console.log(`- checkpoint: atlas-category-checkpoint-${runId}`);
    process.exit(0);
  }

  return normalized;
}

async function readApprovedCategoryCheckpoint() {
  const row = await findCategoryCheckpoint("approved");
  if (!row) return null;
  const clusters = clustersFromCheckpointRow(row);
  if (!clusters.groups.length) return null;
  console.log(`Using approved Atlas category checkpoint ${row.id}.`);
  return clusters;
}

async function writeAwaitingCategoryCheckpoint(clusters) {
  const id = `atlas-category-checkpoint-${runId}`;
  const row = {
    id,
    run_id: runId,
    job_id: jobId || null,
    recipe_id: recipeDefinition?.id || recipeId || null,
    status: "awaiting_review",
    groups_json: clusters,
    reviewer_notes: "",
    metadata: {
      generator: "atlas-staged-model-generation-v2",
      territorySlug,
      branchSlug,
      mapSlug,
      sourceMapSlug,
      topicPrompt,
      sourceIds: sourcePacket.sources.map(source => source.id),
      chunkIds: sourcePacket.chunks.map(chunk => chunk.chunkId),
    },
  };

  const { error } = await supabase.from("atlas_category_checkpoints").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`Could not write Atlas category checkpoint: ${error.message}`);
}

async function findCategoryCheckpoint(status) {
  const filters = [
    jobId ? { field: "job_id", value: jobId } : null,
    runId ? { field: "run_id", value: runId } : null,
    mapSlug ? { field: "map_id", value: mapSlug } : null,
  ].filter(Boolean);

  for (const filter of filters) {
    const { data, error } = await supabase
      .from("atlas_category_checkpoints")
      .select("id,status,groups_json")
      .eq(filter.field, filter.value)
      .eq("status", status)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingCategoryCheckpointTable(error) && !pauseAfterClustering) return null;
      throw new Error(`Could not read Atlas category checkpoint: ${error.message}`);
    }
    if (data) return data;
  }

  return null;
}

function clustersFromCheckpointRow(row) {
  const payload = objectValue(row?.groups_json);
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  return {
    stage: "clustering",
    ok: true,
    groups: groups.map((group, index) => ({
      id: toSlug(group?.id || group?.title || `group-${index + 1}`),
      title: textField(group?.title || `Group ${index + 1}`),
      shortTitle: textField(group?.shortTitle || group?.short_title || group?.title) || `Group ${index + 1}`,
      description: textField(group?.description || group?.centralClaim || group?.central_claim || ""),
      memberCandidateIds: stringArray(group?.memberCandidateIds || group?.member_candidate_ids),
      relatedGroupIds: stringArray(group?.relatedGroupIds || group?.related_group_ids),
      provenance: normalizeRefs(group?.provenance, sourcePacket.chunks[0] ? [refForChunk(sourcePacket.chunks[0], "approved checkpoint support")] : []),
    })).filter(group => group.id && group.title),
  };
}

async function stageGroupEnrichment(clusters, inventory, packet) {
  currentStage = "group-enrichment";
  const groupsDir = join(runDir, "04-enriched-groups");
  mkdirSync(groupsDir, { recursive: true });
  const groups = [];
  await updateFactoryJob("running", {
    metadataMerge: progressMetadata({
      currentStage,
      totalGroups: clusters.groups.length,
      completedGroups: completedGroupCount(groupsDir),
    }),
  });

  await mapLimit(clusters.groups, concurrency, async (cluster, index) => {
    const groupPath = join(groupsDir, `${cluster.id}.json`);
    if (!force && existsSync(groupPath)) {
      groups[index] = readJson(groupPath);
      return;
    }

    const groupContext = budgetedGroupContextFor(cluster, inventory, clusters.groups);
    const stageName = `group-enrichment-${cluster.id}`;
    let enriched = null;
    try {
      enriched = await requestJsonStage({
        stageName,
        system: groupEnrichmentSystemPrompt(),
        user: groupEnrichmentUserPrompt(cluster, groupContext, clusters.groups),
        validate: value => validateEnrichedGroup(value, cluster, packet),
      });
    } catch (error) {
      const classified = classifyModelError(error);
      if (!["malformed_json", "validation_failure", "prompt_budget"].includes(classified.category)) throw error;
      repairAttempts += 1;
      enriched = deterministicEnrichedGroup(cluster, groupContext, clusters.groups, packet, classified);
      const fallbackErrors = validateEnrichedGroup(enriched, cluster, packet);
      if (fallbackErrors.length) throw error;
      writeJson(join(runDir, "errors", `${stageName}-deterministic-fallback.json`), {
        stageName,
        ok: true,
        fallback: "deterministic-enriched-group",
        reason: classified,
        createdAt: new Date().toISOString(),
      });
    }
    const normalized = normalizeEnrichedGroup(enriched, cluster, groupContext);
    writeJson(groupPath, normalized);
    groups[index] = normalized;
    await updateFactoryJob("running", {
      metadataMerge: progressMetadata({
        currentStage,
        totalGroups: clusters.groups.length,
        completedGroups: completedGroupCount(groupsDir),
      }),
    });
  });

  const ordered = groups.filter(Boolean);
  if (ordered.length !== clusters.groups.length) {
    throw new Error(`Group enrichment completed ${ordered.length}/${clusters.groups.length} groups.`);
  }

  const result = {
    stage: "group-enrichment",
    ok: true,
    groups: ordered,
  };
  writeJson(join(runDir, "04-enriched-groups.json"), result);
  completedStages.add("group-enrichment");
  writeRunSummary("running", []);
  await recordGenerationRun({ validationOk: null, errors: [] });
  return result;
}

async function stageRelations(enrichedGroups, inventory, packet) {
  currentStage = "relations";
  const relationsPath = join(runDir, "05-relations.json");
  if (!force && existsSync(relationsPath)) {
    const cached = readJson(relationsPath);
    completedStages.add("relations");
    await recordGenerationRun({ validationOk: null, errors: [] });
    return cached;
  }

  let relations = null;
  try {
    relations = await requestJsonStage({
      stageName: "relations",
      system: relationsSystemPrompt(),
      user: relationsUserPrompt(enrichedGroups.groups, inventory),
      validate: value => validateRelations(value, enrichedGroups.groups, packet),
    });
  } catch (error) {
    const classified = classifyModelError(error);
    if (!["malformed_json", "validation_failure", "prompt_budget"].includes(classified.category)) throw error;
    repairAttempts += 1;
    relations = deterministicRelations(enrichedGroups.groups, packet);
    const fallbackErrors = validateRelations(relations, enrichedGroups.groups, packet);
    if (fallbackErrors.length) throw error;
    writeJson(join(runDir, "errors", "relations-deterministic-fallback.json"), {
      stageName: "relations",
      ok: true,
      fallback: "deterministic-relations",
      reason: classified,
      createdAt: new Date().toISOString(),
    });
  }
  const normalized = normalizeRelations(relations, enrichedGroups.groups, packet);
  writeJson(relationsPath, normalized);
  completedStages.add("relations");
  writeRunSummary("running", []);
  await recordGenerationRun({ validationOk: null, errors: [] });
  return normalized;
}

async function stageAssembly(enrichedGroups, relations, packet) {
  currentStage = "assembly";
  if (!force && existsSync(finalDraftPath)) {
    const cached = readJson(finalDraftPath);
    validateFinalSpecOrThrow(cached, packet);
    provenanceStats = countProvenance(cached);
    completedStages.add("assembly");
    await recordGenerationRun({ validationOk: null, errors: [] });
    return cached;
  }

  let spec = assembleAtlasMapSpec(enrichedGroups.groups, relations.relations, packet);
  let errors = validateFinalSpec(spec, packet);

  if (errors.length) {
    const repaired = await attemptNarrowFinalRepair(errors, enrichedGroups, relations, packet);
    if (repaired) {
      spec = assembleAtlasMapSpec(repaired.groups, repaired.relations, packet);
      errors = validateFinalSpec(spec, packet);
    }
  }

  if (errors.length) {
    validationErrors = errors;
    throw new Error(`Staged AtlasMapSpec failed validation:\n${errors.map(error => `- ${error}`).join("\n")}`);
  }

  writeJson(finalDraftPath, spec);
  completedStages.add("assembly");
  provenanceStats = countProvenance(spec);
  writeRunSummary("running", []);
  await recordGenerationRun({ validationOk: null, errors: [] });
  return spec;
}

async function attemptNarrowFinalRepair(errors, enrichedGroups, relations, packet) {
  const groupMatch = errors.map(error => error.match(/groups\[(\d+)\]/)).find(Boolean);
  if (groupMatch) {
    const index = Number(groupMatch[1]);
    const group = enrichedGroups.groups[index];
    if (!group) return null;
    repairAttempts += 1;
    const repaired = await requestJsonStage({
      stageName: `final-group-repair-${group.id}`,
      system: groupRepairSystemPrompt(),
      user: groupRepairUserPrompt(group, errors),
      validate: value => validateEnrichedGroup(value, group, packet),
    });
    const nextGroups = [...enrichedGroups.groups];
    nextGroups[index] = normalizeEnrichedGroup(repaired, group, { candidates: [] });
    writeJson(join(runDir, "04-enriched-groups", `${group.id}.json`), nextGroups[index]);
    return { groups: nextGroups, relations: relations.relations };
  }

  if (errors.some(error => /relations\[\d+\]|map\.relations/i.test(error))) {
    repairAttempts += 1;
    const repaired = await requestJsonStage({
      stageName: "final-relations-repair",
      system: relationsSystemPrompt(),
      user: relationsRepairUserPrompt(enrichedGroups.groups, relations.relations, errors),
      validate: value => validateRelations(value, enrichedGroups.groups, packet),
    });
    const nextRelations = normalizeRelations(repaired, enrichedGroups.groups, packet);
    writeJson(join(runDir, "05-relations.json"), nextRelations);
    return { groups: enrichedGroups.groups, relations: nextRelations.relations };
  }

  return null;
}

async function requestJsonStage({ stageName, system, user, validate }) {
  let latestRaw = "";
  let latestErrors = [];
  let stageSystem = system;
  let stageUser = user;
  const config = modelConfigForStage(stageName);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    if (attempt > 0) repairAttempts += 1;
    const messages = [
      { role: "system", content: stageSystem },
      { role: "user", content: stageUser },
    ];
    const budget = ensurePromptBudget({ stageName, config, messages });

    let raw = "";
    try {
      raw = await callOpenAiCompatible({ config, messages, stageName, budget, attempt });
    } catch (error) {
      const classified = classifyModelError(error);
      latestErrors = [`${classified.category}: ${classified.message}`];
      logModelCall({
        stageName,
        config,
        budget,
        attempt,
        ok: false,
        errorCategory: classified.category,
        error: classified.message,
      });
      if (!shouldRetryModelError(classified.category) || attempt >= retryCount) {
        validationErrors = [`${stageName}: ${latestErrors.join("; ")}`];
        throw new Error(`${stageName} failed: ${latestErrors.join("; ")}`);
      }
      await backoff(attempt);
      continue;
    }
    latestRaw = raw;
    logModelCall({ stageName, config, budget, attempt, ok: true });

    let parsed = null;
    try {
      parsed = parseJsonResponse(raw);
    } catch (error) {
      latestErrors = [`JSON parse failed: ${error instanceof Error ? error.message : String(error)}`];
      if (stageName.startsWith("extraction-batch")) {
        parsed = salvageExtractionResult(raw);
        if (parsed) latestErrors = [];
      }
    }

    if (parsed) {
      latestErrors = validate(parsed);
      if (!latestErrors.length) return parsed;
    }

    if (attempt < retryCount) {
      stageSystem = repairJsonSystemPrompt();
      stageUser = repairJsonUserPrompt(stageName, stageUser, latestRaw, latestErrors);
      const repairMessages = [
        { role: "system", content: stageSystem },
        { role: "user", content: stageUser },
      ];
      const repairBudget = estimatePromptBudget(repairMessages, config);
      stageUser = trimRepairPromptToBudget(stageUser, repairBudget, config);
      await backoff(attempt);
    }
  }

  const errorPath = join(runDir, "errors", `${stageName}.json`);
  writeJson(errorPath, {
    stageName,
    ok: false,
    errors: latestErrors,
    rawExcerpt: latestRaw.slice(0, 4000),
    createdAt: new Date().toISOString(),
  });
  validationErrors = [`${stageName}: ${latestErrors.join("; ")}`];
  throw new Error(`${stageName} failed: ${latestErrors.join("; ")}`);
}

async function callOpenAiCompatible({ config, messages }) {
  if (!config.apiKey && !config.allowNoKey) {
    throw new Error(
      "Missing model credentials. Set ATLAS_MODEL_API_KEY or OPENAI_API_KEY, or use a local OpenAI-compatible endpoint with ATLAS_MODEL_ALLOW_NO_KEY=true.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const primary = await postChatCompletion(config, headers, messages, controller.signal);
    if (!primary.ok && primary.usedJsonMode && /response_format|json mode|json_object/i.test(primary.bodyText)) {
      const retry = await postChatCompletion({ ...config, jsonMode: false }, headers, messages, controller.signal);
      if (retry.ok) return extractMessageContent(retry.bodyText);
      throw new Error(`Model request failed: ${retry.status} ${retry.statusText} ${retry.bodyText}`);
    }

    if (!primary.ok && primary.status === 400 && /Only user and assistant roles are supported/i.test(primary.bodyText)) {
      const retry = await postChatCompletion(config, headers, combineAsUserMessage(messages), controller.signal);
      if (retry.ok) return extractMessageContent(retry.bodyText);
      throw new Error(`Model request failed: ${retry.status} ${retry.statusText} ${retry.bodyText}`);
    }

    if (!primary.ok) {
      throw new Error(`Model request failed: ${primary.status} ${primary.statusText} ${primary.bodyText}`);
    }

    return extractMessageContent(primary.bodyText);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error(`Model request timed out after ${config.timeoutMs}ms.`), { category: "timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function postChatCompletion(config, headers, messages, signal) {
  const body = {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages,
  };
  if (config.jsonMode) body.response_format = { type: "json_object" };

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    bodyText: await response.text(),
    usedJsonMode: Boolean(config.jsonMode),
  };
}

function estimatePromptBudget(messages, config) {
  const systemChars = messages
    .filter(message => message.role === "system")
    .reduce((total, message) => total + String(message.content || "").length, 0);
  const userChars = messages
    .filter(message => message.role === "user")
    .reduce((total, message) => total + String(message.content || "").length, 0);
  const estimatedInputTokens = estimateTokens(messages.map(message => message.content).join("\n\n"));
  return {
    systemChars,
    userChars,
    estimatedInputTokens,
    safeInputTokens: config.safeInputTokens,
    contextWindowTokens: config.contextWindowTokens,
    maxOutputTokens: config.maxTokens,
  };
}

function ensurePromptBudget({ stageName, config, messages }) {
  const budget = estimatePromptBudget(messages, config);
  if (budget.estimatedInputTokens > config.safeInputTokens) {
    const message = `${stageName} estimated ${budget.estimatedInputTokens} input tokens, over safe budget ${config.safeInputTokens} for ${config.model}.`;
    logModelCall({
      stageName,
      config,
      budget,
      attempt: 0,
      ok: false,
      errorCategory: "prompt_budget",
      error: message,
    });
    throw Object.assign(new Error(message), { category: "prompt_budget" });
  }
  return budget;
}

function estimateTokens(value) {
  return Math.ceil(String(value || "").length / 4);
}

function trimRepairPromptToBudget(value, budget, config) {
  if (budget.estimatedInputTokens <= config.safeInputTokens) return value;
  const maxChars = Math.max(800, Math.floor(config.safeInputTokens * 3.2));
  return `${String(value).slice(0, maxChars)}\n\n[trimmed to fit ${config.safeInputTokens} safe input tokens]`;
}

function logModelCall({ stageName, config, budget, attempt, ok, errorCategory = "", error = "" }) {
  const row = {
    stageName,
    attempt,
    ok,
    provider: config.provider,
    model: config.model,
    profileId: config.profileId,
    estimatedInputTokens: budget.estimatedInputTokens,
    safeInputTokens: budget.safeInputTokens,
    contextWindowTokens: budget.contextWindowTokens,
    maxOutputTokens: budget.maxOutputTokens,
    errorCategory,
    error,
    createdAt: new Date().toISOString(),
  };
  modelCallLog.push(row);
  appendFileSync(join(runDir, "model-call-log.jsonl"), `${JSON.stringify(row)}\n`, "utf8");
  console.log(`[${stageName}] prompt ${budget.estimatedInputTokens}/${budget.safeInputTokens} input tokens, output ${budget.maxOutputTokens}, model ${config.model}`);
  if (error) console.log(`[${stageName}] ${errorCategory}: ${error}`);
}

function classifyModelError(error) {
  const explicit = error && typeof error === "object" ? error.category : "";
  const message = error instanceof Error ? error.message : String(error || "Unknown model error.");
  if (explicit) return { category: String(explicit), message };
  if (/Failed to load model .*Operation canceled/i.test(message)) return { category: "model_load_canceled", message };
  if (/timed out|AbortError/i.test(message)) return { category: "timeout", message };
  if (/ECONNREFUSED|fetch failed|Failed to fetch|connect/i.test(message)) return { category: "connection_failure", message };
  if (/context size|context length|maximum context|too many tokens|prompt.*too long/i.test(message)) return { category: "context_overflow", message };
  if (/JSON parse failed|parseable JSON/i.test(message)) return { category: "malformed_json", message };
  if (/validation/i.test(message)) return { category: "validation_failure", message };
  if (/needs at least one contributor|needs at least one text|contributor.*text|group needs/i.test(message)) return { category: "validation_failure", message };
  if (/prompt_budget/i.test(message)) return { category: "prompt_budget", message };
  return { category: "model_runtime", message };
}

function isMissingCategoryCheckpointTable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "42P01"
    || code === "PGRST205"
    || /atlas_category_checkpoints/i.test(message)
    || /could not find .*atlas_category/i.test(message);
}

function shouldRetryModelError(category) {
  return ["timeout", "connection_failure", "model_runtime", "model_load_canceled", "malformed_json"].includes(category);
}

async function backoff(attempt) {
  const delayMs = Math.min(8000, 750 * (2 ** attempt));
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

async function loadSourcePacket(input) {
  const selectedSources = input.sourceIds?.length ? await loadSourcesByIds(input.sourceIds) : [];
  if (input.sourceIds?.length && selectedSources.length !== input.sourceIds.length) {
    const found = new Set(selectedSources.map(source => source.id));
    const missing = input.sourceIds.filter(id => !found.has(id));
    throw new Error(`Selected Atlas source IDs were not found: ${missing.join(", ")}`);
  }

  const exactSources = selectedSources.length ? selectedSources : await loadSourcesForMapSlug(input.sourceMapSlug);
  const fallbackSources = exactSources.length ? exactSources : await loadSourcesForMapSlug(input.mapSlug);
  const sources = fallbackSources.length ? fallbackSources : await loadSourcesForBranch();

  if (!sources.length) {
    return emptySourcePacket(input.sourceMapSlug);
  }

  const sourceIds = sources.map(source => source.id);
  const { data, error } = await supabase
    .from("atlas_source_chunks")
    .select("source_id,chunk_index,heading,chunk_text,char_count,token_estimate")
    .in("source_id", sourceIds)
    .order("source_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (error) throw new Error(`Could not load Atlas source chunks: ${error.message}`);

  const chunks = (data || [])
    .map(chunk => {
      const sourceId = String(chunk.source_id || "");
      const chunkIndex = Number(chunk.chunk_index || 0);
      return {
        sourceId,
        chunkIndex,
        chunkId: chunkIdFor(sourceId, chunkIndex),
        heading: String(chunk.heading || ""),
        text: String(chunk.chunk_text || ""),
        charCount: Number(chunk.char_count || 0),
        tokenEstimate: Number(chunk.token_estimate || 0),
      };
    })
    .filter(chunk => chunk.sourceId && chunk.text.trim())
    .slice(0, input.maxChunks);

  return {
    sources,
    chunks,
    sourceMapSlug: input.sourceMapSlug,
    packetHash: hashText(chunks.map(chunk => `${chunk.chunkId}\n${chunk.heading}\n${chunk.text}`).join("\n\n")),
  };

  async function loadSourcesForMapSlug(wantedMapSlug) {
    if (!wantedMapSlug) return [];
    const { data: directSources, error: directError } = await supabase
      .from("atlas_sources")
      .select("id,title,creator,source_type,territory_slug,branch_slug,map_slug,file_path,canonical_url")
      .eq("territory_slug", input.territorySlug)
      .eq("branch_slug", input.branchSlug)
      .eq("map_slug", wantedMapSlug)
      .order("updated_at", { ascending: false });

    if (directError) throw new Error(`Could not load Atlas sources: ${directError.message}`);
    if (directSources?.length) return directSources.map(rowToSource);

    const { data: linkedRows, error: linkedError } = await supabase
      .from("atlas_map_sources")
      .select("source_id,map_slug,territory_slug,branch_slug")
      .eq("territory_slug", input.territorySlug)
      .eq("branch_slug", input.branchSlug)
      .eq("map_slug", wantedMapSlug);

    if (linkedError) throw new Error(`Could not load Atlas source links: ${linkedError.message}`);
    const linkedSourceIds = (linkedRows || []).map(row => String(row.source_id || "")).filter(Boolean);
    if (!linkedSourceIds.length) return [];

    const { data: linkedSources, error: linkedSourceError } = await supabase
      .from("atlas_sources")
      .select("id,title,creator,source_type,territory_slug,branch_slug,map_slug,file_path,canonical_url")
      .in("id", linkedSourceIds);

    if (linkedSourceError) throw new Error(`Could not load linked Atlas sources: ${linkedSourceError.message}`);
    return (linkedSources || []).map(rowToSource);
  }

  async function loadSourcesByIds(ids) {
    const { data, error } = await supabase
      .from("atlas_sources")
      .select("id,title,creator,source_type,territory_slug,branch_slug,map_slug,file_path,canonical_url")
      .in("id", ids);

    if (error) throw new Error(`Could not load selected Atlas sources: ${error.message}`);
    return (data || []).map(rowToSource);
  }

  async function loadSourcesForBranch() {
    const { data, error } = await supabase
      .from("atlas_sources")
      .select("id,title,creator,source_type,territory_slug,branch_slug,map_slug,file_path,canonical_url")
      .eq("territory_slug", input.territorySlug)
      .eq("branch_slug", input.branchSlug)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(`Could not load branch Atlas sources: ${error.message}`);
    return (data || []).map(rowToSource);
  }
}

async function loadRecipeDefinition() {
  currentStage = "recipe-load";
  if (recipeJson) {
    try {
      return normalizeRecipeDefinition(JSON.parse(recipeJson), recipeId || "inline-recipe");
    } catch (error) {
      throw new Error(`Could not parse --recipe-json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (recipeFile) {
    return normalizeRecipeDefinition(readJson(resolveOutputPath(recipeFile)), recipeId || recipeFile);
  }

  if (recipeId) {
    const { data, error } = await supabase
      .from("atlas_map_recipes")
      .select("id,title,purpose,grouping_logic,preferred_group_fields,contributor_rules,expected_relation_types,recommended_group_count,generation_instructions,evaluation_criteria")
      .eq("id", recipeId)
      .single();

    if (error) throw new Error(`Could not load Atlas recipe "${recipeId}": ${error.message}`);
    return normalizeRecipeDefinition(data, recipeId);
  }

  return normalizeRecipeDefinition({
    id: "theory_family",
    title: "Theory Family",
    purpose: "Organize a field by major explanatory families or schools of thought.",
    groupingLogic: "Groups should be conceptual families with distinct explanatory stances.",
    preferredGroupFields: ["stance", "centralClaim", "whyItMatters", "objections", "contributors", "keyTexts"],
    contributorRules: "Contributors should be attached to the family they shaped, extended, or strongly challenged.",
    expectedRelationTypes: ["opposes", "answers", "reframes", "borrows", "neighbors"],
    recommendedGroupCount: { min: 5, max: 10 },
    generationInstructions: "Prioritize stable families, central claims, pressure points, and representative contributors.",
    evaluationCriteria: ["Groups are meaningful", "Claims are distinct", "Relations explain conceptual movement"],
  }, "theory_family");
}

function normalizeRecipeDefinition(value, fallbackId) {
  const record = objectValue(value);
  const count = objectValue(record.recommendedGroupCount || record.recommended_group_count);
  const min = Number(count.min || 5);
  const max = Number(count.max || 10);

  return {
    id: textField(record.id) || fallbackId,
    title: textField(record.title) || titleFromSlug(fallbackId),
    purpose: textField(record.purpose),
    groupingLogic: textField(record.groupingLogic || record.grouping_logic),
    preferredGroupFields: stringArray(record.preferredGroupFields || record.preferred_group_fields),
    contributorRules: textField(record.contributorRules || record.contributor_rules),
    expectedRelationTypes: stringArray(record.expectedRelationTypes || record.expected_relation_types),
    recommendedGroupCount: {
      min: Number.isFinite(min) && min > 0 ? Math.floor(min) : 5,
      max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
    },
    generationInstructions: textField(record.generationInstructions || record.generation_instructions),
    evaluationCriteria: stringArray(record.evaluationCriteria || record.evaluation_criteria),
  };
}

function recipePromptBlock() {
  const recipe = recipeDefinition || normalizeRecipeDefinition({}, "theory_family");
  return [
    `Recipe id: ${recipe.id}`,
    `Recipe title: ${recipe.title}`,
    recipe.purpose ? `Purpose: ${recipe.purpose}` : "",
    recipe.groupingLogic ? `Grouping logic: ${recipe.groupingLogic}` : "",
    recipe.preferredGroupFields.length ? `Preferred fields: ${recipe.preferredGroupFields.join(", ")}` : "",
    recipe.contributorRules ? `Contributor rules: ${recipe.contributorRules}` : "",
    recipe.expectedRelationTypes.length ? `Expected relation types: ${recipe.expectedRelationTypes.join(", ")}` : "",
    `Recommended groups: ${recipeGroupRange().min}-${recipeGroupRange().max}`,
    recipe.generationInstructions ? `Generation instructions: ${recipe.generationInstructions}` : "",
    recipe.evaluationCriteria.length ? `Evaluation criteria: ${recipe.evaluationCriteria.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function recipeGroupRange() {
  const count = recipeDefinition?.recommendedGroupCount || {};
  const min = Number(count.min || 5);
  const max = Number(count.max || 10);
  return {
    min: Number.isFinite(min) && min > 0 ? Math.floor(min) : 5,
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
  };
}

function recipeRelationKinds() {
  const recipeKinds = recipeDefinition?.expectedRelationTypes || [];
  const kinds = recipeKinds.length ? recipeKinds : [...ATLAS_RELATION_KINDS];
  return [...new Set(kinds.map(kind => relationKindFor(kind)))];
}

function extractionSystemPrompt() {
  return [
    "Extract compact Atlas candidates from source chunks.",
    "Use the map recipe to decide which candidates are worth extracting.",
    "Map recipe:",
    recipePromptBlock(),
    "Return strict JSON only.",
    "Schema: {\"people\":[],\"concepts\":[],\"claims\":[],\"texts\":[],\"objections\":[],\"relationships\":[]}.",
    "People: {\"name\":\"\",\"role\":\"\",\"reason\":\"\",\"provenance\":[ref]}.",
    "Concepts: {\"label\":\"\",\"summary\":\"\",\"provenance\":[ref]}.",
    "Claims/objections: {\"text\":\"\",\"subject\":\"\",\"provenance\":[ref]}.",
    "Texts: {\"title\":\"\",\"kind\":\"book|essay|paper|dialogue|lecture|other\",\"author\":\"\",\"provenance\":[ref]}.",
    "Relationships: {\"source\":\"\",\"target\":\"\",\"kind\":\"influences|contrasts|supports|pressures\",\"note\":\"\",\"provenance\":[ref]}.",
    "A provenance ref is {\"chunkId\":\"source#0\",\"sourceId\":\"source\",\"chunkIndex\":0,\"note\":\"short\"}. Use only the provided chunk IDs.",
    "Keep each array to 3 items or fewer. Use short phrases, not long sentences. The full JSON must be compact.",
  ].join("\n\n");
}

function extractionUserPrompt(chunks, charLimit = chunkCharLimit) {
  return [
    `Topic: ${topicPrompt}`,
    `Allowed chunk IDs: ${chunks.map(chunk => chunk.chunkId).join(", ")}`,
    "Chunks:",
    chunks.map(chunk => [
      `[${chunk.chunkId}]`,
      chunk.heading ? `Heading: ${chunk.heading}` : "Heading: none",
      truncateText(chunk.text, charLimit),
    ].join("\n")).join("\n\n---\n\n"),
  ].join("\n\n");
}

function buildExtractionUnits(chunks) {
  const config = modelConfigForStage("extraction-batch-0");
  const system = extractionSystemPrompt();
  const initial = batchChunks(chunks, chunkBatchSize);
  return initial.flatMap(batch => splitExtractionBatchToFit(batch, config, system, 0));
}

function splitExtractionBatchToFit(batch, config, system, splitDepth) {
  const fitted = fitExtractionBatch(batch, config, system, splitDepth);
  if (fitted) return [fitted];

  if (batch.length <= 1) {
    const chunkId = batch[0]?.chunkId || "unknown";
    throw Object.assign(
      new Error(`Extraction chunk ${chunkId} cannot fit safe prompt budget ${config.safeInputTokens} for ${config.model}.`),
      { category: "prompt_budget" },
    );
  }

  const midpoint = Math.ceil(batch.length / 2);
  return [
    ...splitExtractionBatchToFit(batch.slice(0, midpoint), config, system, splitDepth + 1),
    ...splitExtractionBatchToFit(batch.slice(midpoint), config, system, splitDepth + 1),
  ];
}

function fitExtractionBatch(batch, config, system, splitDepth) {
  let charLimit = chunkCharLimit;
  while (charLimit >= 160) {
    const user = extractionUserPrompt(batch, charLimit);
    const budget = estimatePromptBudget([
      { role: "system", content: system },
      { role: "user", content: user },
    ], config);
    if (budget.estimatedInputTokens <= config.safeInputTokens) {
      return {
        chunks: batch,
        charLimit,
        estimatedInputTokens: budget.estimatedInputTokens,
        splitDepth,
      };
    }
    if (batch.length > 1) return null;
    charLimit = Math.floor(charLimit * 0.65);
  }
  return null;
}

function clusteringSystemPrompt() {
  const groupRange = recipeGroupRange();
  return [
    "Cluster normalized Atlas candidates into recipe-shaped Atlas groups.",
    "Map recipe:",
    recipePromptBlock(),
    "Return strict JSON only.",
    "Schema: {\"groups\":[{\"id\":\"kebab-id\",\"title\":\"\",\"shortTitle\":\"\",\"description\":\"\",\"memberCandidateIds\":[\"candidate-id\"],\"provenance\":[ref]}]}.",
    `Return ${groupRange.min} to ${groupRange.max} groups. Prefer the low end unless candidates require more.`,
    "Every memberCandidateId must come from the inventory.",
  ].join("\n\n");
}

function clusteringUserPrompt(inventory) {
  const config = modelConfigForStage("clustering");
  const system = clusteringSystemPrompt();
  const compactInventory = compactInventoryForBudget(inventory, config, system);
  return [
    `Topic: ${topicPrompt}`,
    "Normalized candidate inventory:",
    JSON.stringify(compactInventory, null, 2),
  ].join("\n\n");
}

function groupEnrichmentSystemPrompt() {
  return [
    "Enrich one Atlas group from its candidate evidence and the map recipe.",
    "Map recipe:",
    recipePromptBlock(),
    "Return strict JSON only.",
    "Schema: {\"id\":\"\",\"title\":\"\",\"shortTitle\":\"\",\"family\":\"\",\"stance\":\"\",\"centralClaim\":\"\",\"whyItMatters\":\"\",\"contributors\":[{\"id\":\"\",\"name\":\"\",\"role\":\"\",\"reason\":\"\",\"texts\":[{\"id\":\"\",\"title\":\"\",\"kind\":\"book|essay|paper|dialogue|lecture|other\",\"provenance\":[ref]}],\"provenance\":[ref]}],\"objections\":[\"\"],\"relatedGroupIds\":[\"\"],\"keywords\":[\"\"],\"provenance\":[ref]}.",
    "Use only provided candidates and provenance. Keep fields concise.",
    "Include 1 to 4 contributors, at least one text per contributor, 2 to 4 objections, and relatedGroupIds from the provided group list.",
  ].join("\n\n");
}

function groupEnrichmentUserPrompt(cluster, context, allGroups) {
  return [
    `Topic: ${topicPrompt}`,
    `Group to enrich: ${JSON.stringify(cluster)}`,
    `Available group IDs: ${allGroups.map(group => group.id).join(", ")}`,
    "Evidence candidates for this group:",
    JSON.stringify(context, null, 2),
  ].join("\n\n");
}

function relationsSystemPrompt() {
  const kinds = recipeRelationKinds();
  return [
    "Generate Atlas relations between completed groups.",
    "Map recipe:",
    recipePromptBlock(),
    "Return strict JSON only.",
    `Schema: {"relations":[{"id":"source-target","source":"group-id","target":"group-id","kind":"${kinds.join("|")}","note":"","provenance":[ref]}]}.`,
    "Return 3 to 8 relations. Source and target must be group IDs.",
  ].join("\n\n");
}

function relationsUserPrompt(groups, inventory) {
  void inventory;
  return [
    `Topic: ${topicPrompt}`,
    "Use only these exact group IDs as relation source/target values:",
    groups.map(group => `- ${group.id}: ${group.title}`).join("\n"),
    "Groups:",
    JSON.stringify(groups.map(group => ({
      id: group.id,
      title: group.title,
      stance: group.stance,
      centralClaim: group.centralClaim,
      provenance: group.provenance,
      relatedGroupIds: group.relatedGroupIds,
    })), null, 2),
    "Do not use person names, concept names, or candidate labels as source/target. Use group IDs only.",
  ].join("\n\n");
}

function relationsRepairUserPrompt(groups, currentRelations, errors) {
  return [
    "Repair only the relations JSON.",
    `Errors: ${errors.join("; ")}`,
    "Groups:",
    JSON.stringify(groups.map(group => ({ id: group.id, title: group.title, provenance: group.provenance })), null, 2),
    "Current relations:",
    JSON.stringify({ relations: currentRelations }, null, 2),
  ].join("\n\n");
}

function groupRepairSystemPrompt() {
  return [
    "Repair one enriched Atlas group JSON.",
    "Return strict JSON only. Do not change the group id.",
  ].join("\n\n");
}

function groupRepairUserPrompt(group, errors) {
  return [
    `Errors: ${errors.join("; ")}`,
    "Current group:",
    JSON.stringify(group, null, 2),
  ].join("\n\n");
}

function repairJsonSystemPrompt() {
  return [
    "Repair the previous stage JSON only.",
    "Return strict parseable JSON. No markdown. No comments.",
    "Preserve the requested schema and do not add unsupported facts.",
  ].join("\n\n");
}

function repairJsonUserPrompt(stageName, originalPrompt, raw, errors) {
  return [
    `Stage: ${stageName}`,
    `Errors: ${errors.join("; ")}`,
    "Original task:",
    originalPrompt,
    "Previous raw output:",
    raw,
  ].join("\n\n");
}

function validateExtractionResult(value, chunks) {
  const errors = [];
  if (!value || typeof value !== "object") return ["Extraction result must be an object."];
  ["people", "concepts", "claims", "texts", "objections", "relationships"].forEach(key => {
    if (value[key] !== undefined && !Array.isArray(value[key])) errors.push(`${key} must be an array when present.`);
  });
  const allowed = new Set(chunks.map(chunk => chunk.chunkId));
  collectRefs(value).forEach(ref => {
    if (!allowed.has(ref.chunkId)) errors.push(`Invalid extraction provenance chunkId "${ref.chunkId}".`);
  });
  return errors;
}

function validateClusters(value, inventory) {
  const errors = [];
  if (!value || typeof value !== "object" || !Array.isArray(value.groups)) return ["Clusters must include groups array."];
  const groupRange = recipeGroupRange();
  if (value.groups.length < 1 || value.groups.length > groupRange.max) {
    errors.push(`Expected 1 to ${groupRange.max} proposed groups for recipe ${recipeDefinition?.id || "default"}; got ${value.groups.length}.`);
  }
  const candidateIds = new Set(allCandidateIds(inventory));
  value.groups.forEach((group, index) => {
    if (!group.id && !group.title) errors.push(`groups[${index}] needs id or title.`);
    if (!Array.isArray(group.memberCandidateIds) || !group.memberCandidateIds.length) {
      errors.push(`groups[${index}].memberCandidateIds must not be empty.`);
    } else {
      group.memberCandidateIds.forEach(id => {
        if (!candidateIds.has(String(id))) errors.push(`groups[${index}] memberCandidateId "${id}" does not exist.`);
      });
    }
  });
  return errors;
}

function validateEnrichedGroup(value, cluster, packet) {
  const errors = [];
  const group = normalizeEnrichedGroup(value, cluster, { candidates: [] });
  if (!group.id) errors.push("Group id is required.");
  if (!group.title) errors.push("Group title is required.");
  if (!group.stance) errors.push("Group stance is required.");
  if (!group.centralClaim) errors.push("Group centralClaim is required.");
  if (!group.whyItMatters) errors.push("Group whyItMatters is required.");
  if (!group.contributors.length) errors.push("Group needs at least one contributor.");
  group.contributors.forEach((contributor, index) => {
    if (!contributor.texts.length) errors.push(`contributors[${index}] needs at least one text.`);
  });
  errors.push(...validateRefsAgainstPacket(group.provenance, packet, "group.provenance"));
  return errors;
}

function validateRelations(value, groups, packet) {
  const errors = [];
  if (!value || typeof value !== "object" || !Array.isArray(value.relations)) return ["Relations must include relations array."];
  const normalized = normalizeRelations(value, groups, packet);
  const minimum = Math.min(3, Math.max(1, groups.length - 1));
  if (normalized.relations.length < minimum) {
    errors.push(`Relations stage must produce at least ${minimum} usable group relations; got ${normalized.relations.length}.`);
  }
  normalized.relations.forEach((relation, index) => {
    errors.push(...validateRefsAgainstPacket(relation.provenance, packet, `relations[${index}].provenance`));
  });
  return errors;
}

function normalizeExtractionResult(value, chunks) {
  const fallbackRefs = chunks.map(chunk => refForChunk(chunk, "extracted from this chunk"));
  const normalizeArray = key => Array.isArray(value?.[key]) ? value[key] : [];

  return {
    people: normalizeArray("people").map(item => ({
      name: textField(item.name || item.label),
      role: textField(item.role),
      reason: textField(item.reason || item.summary),
      provenance: normalizeRefs(item.provenance, fallbackRefs),
    })).filter(item => item.name),
    concepts: normalizeArray("concepts").map(item => ({
      label: textField(item.label || item.name || item.title),
      summary: textField(item.summary || item.description),
      provenance: normalizeRefs(item.provenance, fallbackRefs),
    })).filter(item => item.label),
    claims: normalizeArray("claims").map(item => ({
      text: textField(item.text || item.claim || item.summary),
      subject: textField(item.subject || item.label),
      provenance: normalizeRefs(item.provenance, fallbackRefs),
    })).filter(item => item.text),
    texts: normalizeArray("texts").map(item => ({
      title: textField(item.title),
      kind: textKind(item.kind),
      author: textField(item.author || item.creator),
      provenance: normalizeRefs(item.provenance, fallbackRefs),
    })).filter(item => item.title),
    objections: normalizeArray("objections").map(item => ({
      text: textField(item.text || item.objection || item.summary),
      subject: textField(item.subject || item.label),
      provenance: normalizeRefs(item.provenance, fallbackRefs),
    })).filter(item => item.text),
    relationships: normalizeArray("relationships").map(item => ({
      source: textField(item.source),
      target: textField(item.target),
      kind: textField(item.kind),
      note: textField(item.note || item.summary),
      provenance: normalizeRefs(item.provenance, fallbackRefs),
    })).filter(item => item.source && item.target),
  };
}

function normalizeCandidateInventory(extraction, packet) {
  const inventory = {
    stage: "normalization",
    ok: true,
    people: [],
    concepts: [],
    claims: [],
    texts: [],
    objections: [],
    relationships: [],
  };
  const maps = {
    people: new Map(),
    concepts: new Map(),
    claims: new Map(),
    texts: new Map(),
    objections: new Map(),
  };

  extraction.batches.forEach(batch => {
    const result = batch.result || {};
    mergeItems(maps.people, result.people || [], "person", item => item.name, item => ({
      name: item.name,
      role: item.role,
      reason: item.reason,
      provenance: item.provenance,
    }));
    mergeItems(maps.concepts, result.concepts || [], "concept", item => item.label, item => ({
      label: item.label,
      summary: item.summary,
      provenance: item.provenance,
    }));
    mergeItems(maps.claims, result.claims || [], "claim", item => item.text, item => ({
      text: item.text,
      subject: item.subject,
      provenance: item.provenance,
    }));
    mergeItems(maps.texts, result.texts || [], "text", item => item.title, item => ({
      title: item.title,
      kind: item.kind,
      author: item.author,
      provenance: item.provenance,
    }));
    mergeItems(maps.objections, result.objections || [], "objection", item => item.text, item => ({
      text: item.text,
      subject: item.subject,
      provenance: item.provenance,
    }));

    (result.relationships || []).forEach(item => {
      const id = `relcand-${toSlug(item.source)}-${toSlug(item.target)}-${hashText(`${item.kind}:${item.note}`).slice(0, 8)}`;
      inventory.relationships.push({
        id,
        source: item.source,
        target: item.target,
        kind: item.kind,
        note: item.note,
        provenance: uniqueRefs(item.provenance),
      });
    });
  });

  inventory.people = [...maps.people.values()];
  inventory.concepts = [...maps.concepts.values()];
  inventory.claims = [...maps.claims.values()];
  inventory.texts = [...maps.texts.values()];
  inventory.objections = [...maps.objections.values()];
  inventory.chunkIds = packet.chunks.map(chunk => chunk.chunkId);
  inventory.counts = {
    people: inventory.people.length,
    concepts: inventory.concepts.length,
    claims: inventory.claims.length,
    texts: inventory.texts.length,
    objections: inventory.objections.length,
    relationships: inventory.relationships.length,
  };
  return inventory;
}

function mergeItems(map, items, prefix, keyFor, rowFor) {
  items.forEach(item => {
    const key = normalizedKey(keyFor(item));
    if (!key) return;
    const id = `${prefix}-${toSlug(key).slice(0, 72)}`;
    const row = rowFor(item);
    const existing = map.get(id);
    if (existing) {
      existing.provenance = uniqueRefs([...(existing.provenance || []), ...(row.provenance || [])]);
      Object.entries(row).forEach(([field, value]) => {
        if (field !== "provenance" && !existing[field] && value) existing[field] = value;
      });
    } else {
      map.set(id, { id, ...row, provenance: uniqueRefs(row.provenance || []) });
    }
  });
}

function normalizeClusters(value, inventory, packet) {
  const candidateIds = new Set(allCandidateIds(inventory));
  const groups = value.groups.map((group, index) => {
    const title = textField(group.title || group.name || `Group ${index + 1}`);
    const id = toSlug(group.id || title) || `group-${index + 1}`;
    const memberCandidateIds = stringArray(group.memberCandidateIds).filter(idValue => candidateIds.has(idValue));
    const refs = normalizeRefs(group.provenance, provenanceForCandidateIds(memberCandidateIds, inventory));
    return {
      id,
      title,
      shortTitle: textField(group.shortTitle) || shortTitleFor(title),
      description: textField(group.description || group.summary),
      memberCandidateIds,
      provenance: refs.length ? refs : [refForChunk(packet.chunks[index % packet.chunks.length], "cluster support")],
    };
  });
  const groupRange = recipeGroupRange();
  const usedCandidateIds = new Set(groups.flatMap(group => group.memberCandidateIds));
  const candidatePool = allCandidates(inventory).filter(candidate => !usedCandidateIds.has(candidate.id));
  while (groups.length < groupRange.min && candidatePool.length) {
    const candidate = candidatePool.shift();
    const title = titleFromSlug(candidate.label || candidate.name || candidate.title || candidate.id);
    const id = toSlug(`${candidate.type}-${candidate.label || candidate.id}`) || `supplemental-group-${groups.length + 1}`;
    if (groups.some(group => group.id === id)) continue;
    groups.push({
      id,
      title,
      shortTitle: shortTitleFor(title),
      description: truncateText(candidate.summary || candidate.reason || candidate.text || "", 120),
      memberCandidateIds: [candidate.id],
      provenance: uniqueRefs(candidate.provenance || [refForChunk(packet.chunks[groups.length % packet.chunks.length], "supplemented cluster support")]),
    });
  }

  return {
    stage: "clustering",
    ok: true,
    groups,
  };
}

function deterministicEnrichedGroup(cluster, context, allGroups, packet, reason) {
  const title = textField(cluster.title) || titleFromSlug(cluster.id || "source-grounded group");
  const fallbackRefs = sourceRefsForGroup(cluster, context, packet);
  const concept = firstUseful(context?.concepts);
  const claim = firstUseful(context?.claims);
  const objections = (context?.objections || [])
    .map(item => textField(item.summary || item.label))
    .filter(Boolean)
    .slice(0, 4);
  const people = (context?.people || []).filter(item => textField(item.label));
  const texts = (context?.texts || []).filter(item => textField(item.title || item.label));
  const contributors = people.length
    ? people.slice(0, 4).map((person, index) => fallbackContributorForCandidate(person, texts, index, title, fallbackRefs))
    : [fallbackContributorForGroup(cluster, texts, title, fallbackRefs)];

  return {
    id: cluster.id,
    title,
    shortTitle: cluster.shortTitle || shortTitleFor(title),
    family: `${cluster.shortTitle || shortTitleFor(title) || title} family`,
    stance: textField(concept?.summary || concept?.label || cluster.description || title),
    centralClaim: textField(claim?.summary || claim?.label || cluster.description || `${title} treats this source-grounded cluster as a distinct metaphysical family.`),
    whyItMatters: `This family organizes source-backed claims about ${String(topicPrompt).toLowerCase()} for admin review.`,
    contributors,
    objections: objections.length
      ? objections
      : [`The source packet requires review before treating ${title} as a complete family.`],
    relatedGroupIds: allGroups
      .filter(group => group.id !== cluster.id)
      .slice(0, 3)
      .map(group => group.id),
    keywords: fallbackKeywords(context, title),
    provenance: fallbackRefs,
    metadata: {
      deterministicFallback: true,
      fallbackReason: reason?.category || "model_stage_recovery",
    },
  };
}

function sourceRefsForGroup(cluster, context, packet) {
  return uniqueRefs([
    ...(cluster?.provenance || []),
    ...((context?.candidates || []).flatMap(candidate => candidate.provenance || [])),
    ...(packet?.chunks?.[0] ? [refForChunk(packet.chunks[0], "deterministic fallback source support")] : []),
  ]).slice(0, 5);
}

function firstUseful(items) {
  return (items || []).find(item => textField(item.summary || item.label || item.title)) || null;
}

function fallbackContributorForCandidate(person, texts, index, groupTitle, fallbackRefs) {
  const name = textField(person.label || person.name) || `${groupTitle} contributor`;
  const refs = normalizeRefs(person.provenance, fallbackRefs);
  return {
    id: toSlug(person.id || name) || `fallback-contributor-${index + 1}`,
    name,
    role: textField(person.summary) ? "source contributor" : "source-mentioned contributor",
    reason: textField(person.summary) || `${name} appears in the source evidence for ${groupTitle}.`,
    texts: [fallbackTextForContributor(texts[index % Math.max(1, texts.length)], refs, index, name)],
    provenance: refs,
  };
}

function fallbackContributorForGroup(cluster, texts, groupTitle, fallbackRefs) {
  return {
    id: toSlug(`${cluster.id || groupTitle}-source-synthesis`),
    name: `${groupTitle} source synthesis`,
    role: "source-grounded synthesis",
    reason: `No clean person candidate survived model enrichment for ${groupTitle}; this review draft preserves the source-backed group for admin review.`,
    texts: [fallbackTextForContributor(texts[0], fallbackRefs, 0, groupTitle)],
    provenance: fallbackRefs,
  };
}

function fallbackTextForContributor(text, refs, index, ownerName) {
  const title = textField(text?.title || text?.label) || `Source evidence for ${ownerName}`;
  return {
    id: toSlug(text?.id || title) || `fallback-text-${index + 1}`,
    title,
    kind: textKind(text?.kind),
    provenance: normalizeRefs(text?.provenance, refs),
  };
}

function fallbackKeywords(context, title) {
  const words = title
    .split(/\s+/)
    .map(word => textField(word).toLowerCase())
    .filter(word => word.length > 3);
  const concepts = (context?.concepts || [])
    .map(item => textField(item.label))
    .filter(Boolean);
  return [...new Set([...concepts, ...words])].slice(0, 10);
}

function normalizeEnrichedGroup(value, cluster, context) {
  const title = textField(value?.title || cluster.title);
  const id = toSlug(value?.id || cluster.id || title);
  const fallbackRefs = uniqueRefs([
    ...(cluster.provenance || []),
    ...((context?.candidates || []).flatMap(candidate => candidate.provenance || [])),
  ]);
  const contributors = Array.isArray(value?.contributors) ? value.contributors : [];
  const textCandidates = (context?.candidates || []).filter(candidate => candidate.type === "text");

  return {
    id,
    slug: id,
    title,
    shortTitle: textField(value?.shortTitle) || cluster.shortTitle || shortTitleFor(title),
    family: textField(value?.family) || `${title} family`,
    stance: textField(value?.stance),
    centralClaim: textField(value?.centralClaim),
    whyItMatters: textField(value?.whyItMatters),
    contributors: contributors.map((contributor, index) => normalizeContributor(contributor, id, fallbackRefs, textCandidates, index)).filter(Boolean),
    objections: stringArray(value?.objections).slice(0, 5),
    relatedGroupIds: stringArray(value?.relatedGroupIds).filter(relatedId => relatedId !== id),
    keywords: stringArray(value?.keywords).slice(0, 10),
    provenance: normalizeRefs(value?.provenance, fallbackRefs),
  };
}

function normalizeContributor(contributor, groupId, fallbackRefs, textCandidates, index) {
  const name = textField(contributor?.name);
  if (!name) return null;
  let texts = Array.isArray(contributor?.texts) ? contributor.texts : [];
  if (!texts.length && textCandidates.length) {
    texts = [textCandidates[index % textCandidates.length]];
  }

  return {
    id: toSlug(contributor.id || name) || `${groupId}-contributor-${index + 1}`,
    name,
    role: textField(contributor.role) || "source contributor",
    reason: textField(contributor.reason) || `${name} is linked to this source-grounded family.`,
    texts: texts.map((text, textIndex) => ({
      id: toSlug(text.id || text.title) || `${groupId}-text-${textIndex + 1}`,
      title: textField(text.title) || `Source text ${textIndex + 1}`,
      kind: textKind(text.kind),
      provenance: normalizeRefs(text.provenance, fallbackRefs),
    })).filter(text => text.title),
    provenance: normalizeRefs(contributor.provenance, fallbackRefs),
  };
}

function normalizeRelations(value, groups, packet) {
  const groupIds = new Set(groups.map(group => group.id));
  const relations = (Array.isArray(value.relations) ? value.relations : [])
    .map((relation, index) => {
      const source = resolveGroupId(relation.source, groups);
      const target = resolveGroupId(relation.target, groups);
      if (!groupIds.has(source) || !groupIds.has(target) || source === target) return null;
      const kind = relationKindFor(relation.kind);
      const fallbackRefs = uniqueRefs([
        ...(groups.find(group => group.id === source)?.provenance || []),
        ...(groups.find(group => group.id === target)?.provenance || []),
      ]);
      return {
        id: toSlug(relation.id || `${source}-${target}`) || `relation-${index + 1}`,
        source,
        target,
        kind,
        note: textField(relation.note) || `${source} and ${target} are related in the source-grounded draft.`,
        provenance: normalizeRefs(relation.provenance, fallbackRefs.length ? fallbackRefs : [refForChunk(packet.chunks[index % packet.chunks.length], "relation support")]),
      };
    })
    .filter(Boolean);
  const supplemented = supplementRelations(relations, groups, packet);

  return {
    stage: "relations",
    ok: true,
    relations: supplemented,
  };
}

function supplementRelations(relations, groups, packet) {
  const seen = new Set(relations.map(relation => `${relation.source}:${relation.target}`));
  const next = [...relations];
  const minimum = Math.min(4, Math.max(1, groups.length - 1));

  for (const group of groups) {
    for (const relatedId of group.relatedGroupIds || []) {
      if (next.length >= minimum) return next;
      const target = groups.find(candidate => candidate.id === relatedId);
      if (!target || target.id === group.id) continue;
      const key = `${group.id}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({
        id: toSlug(`${group.id}-${target.id}`),
        source: group.id,
        target: target.id,
        kind: "neighbors",
        note: `${group.shortTitle || group.title} and ${target.shortTitle || target.title} are related by the enriched group review.`,
        provenance: uniqueRefs([...(group.provenance || []), ...(target.provenance || [])])
          .slice(0, 3)
          .concat(next.length ? [] : [refForChunk(packet.chunks[0], "supplemented relation support")])
          .slice(0, 3),
      });
    }
  }

  for (let index = 0; index < groups.length - 1 && next.length < minimum; index += 1) {
    const source = groups[index];
    const target = groups[index + 1];
    const key = `${source.id}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({
      id: toSlug(`${source.id}-${target.id}`),
      source: source.id,
      target: target.id,
      kind: "neighbors",
      note: `${source.shortTitle || source.title} and ${target.shortTitle || target.title} sit next to each other in the source-grounded review draft.`,
      provenance: uniqueRefs([...(source.provenance || []), ...(target.provenance || [])])
        .slice(0, 3)
        .concat(next.length ? [] : [refForChunk(packet.chunks[0], "supplemented relation support")])
        .slice(0, 3),
    });
  }

  return next;
}

function deterministicRelations(groups, packet) {
  return {
    relations: supplementRelations([], groups, packet),
  };
}

function resolveGroupId(value, groups) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const slug = toSlug(raw);
  const exact = groups.find(group => group.id === raw || group.id === slug);
  if (exact) return exact.id;
  const byTitle = groups.find(group => toSlug(group.title) === slug || toSlug(group.shortTitle) === slug);
  if (byTitle) return byTitle.id;
  const contains = groups.find(group => slug.includes(group.id) || group.id.includes(slug));
  return contains?.id || raw;
}

function relationKindFor(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (ATLAS_RELATION_KINDS.has(raw)) return raw;
  if (RELATION_KIND_ALIASES.has(raw)) return RELATION_KIND_ALIASES.get(raw);
  return "neighbors";
}

function assembleAtlasMapSpec(groups, relations, packet) {
  const territoryTitle = titleFromSlug(territorySlug);
  const branchTitle = titleFromSlug(branchSlug);
  const mapTitle = titleFromSlug(sourceMapSlug || mapSlug);
  const groupIds = new Set(groups.map(group => group.id));
  const cleanedGroups = groups.map(group => ({
    id: group.id,
    slug: group.slug || group.id,
    title: group.title,
    shortTitle: group.shortTitle,
    family: group.family,
    stance: group.stance,
    centralClaim: group.centralClaim,
    whyItMatters: group.whyItMatters,
    contributors: group.contributors,
    objections: group.objections,
    relatedGroupIds: group.relatedGroupIds.filter(id => groupIds.has(id)),
    keywords: group.keywords,
    provenance: group.provenance,
  }));
  const cleanedRelations = relations.filter(relation => groupIds.has(relation.source) && groupIds.has(relation.target));

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    territories: [
      {
        id: territorySlug,
        slug: territorySlug,
        title: territoryTitle,
        summary: `${territoryTitle} staged Atlas drafts and review material.`,
        branches: [
          {
            id: branchSlug,
            slug: branchSlug,
            title: branchTitle,
            summary: `${branchTitle} staged drafts built from grounded Atlas source chunks.`,
            maps: [
              {
                id: mapSlug,
                slug: mapSlug,
                title: mapTitle,
                subtitle: "A staged, model-assisted, source-grounded review draft.",
                question: questionFor(mapTitle),
                summary: `Staged draft assembled from ${packet.chunks.length} source chunks. Prompt: ${topicPrompt}`,
                status: "queued",
                buildMode: "pipeline-ready",
                groups: cleanedGroups,
                relations: cleanedRelations,
              },
            ],
          },
        ],
      },
    ],
  };
}

function validateFinalSpecOrThrow(spec, packet) {
  const errors = validateFinalSpec(spec, packet);
  if (errors.length) throw new Error(`Cached final draft is invalid:\n${errors.map(error => `- ${error}`).join("\n")}`);
}

function validateFinalSpec(spec, packet) {
  const errors = [];
  try {
    errors.push(...validateAtlasMapSpec(spec).map(issue => `${issue.path}: ${issue.message}`));
  } catch (error) {
    errors.push(`AtlasMapSpec validation crashed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const map = spec?.territories?.[0]?.branches?.[0]?.maps?.[0];
  if (!map) return [...errors, "AtlasMapSpec must contain one map."];
  const groupRange = recipeGroupRange();
  if (!Array.isArray(map.groups) || map.groups.length < groupRange.min || map.groups.length > groupRange.max) {
    errors.push(`Final draft must include ${groupRange.min} to ${groupRange.max} groups for recipe ${recipeDefinition?.id || "default"}; got ${map.groups?.length || 0}.`);
  }
  map.groups?.forEach((group, groupIndex) => {
    errors.push(...validateRefsAgainstPacket(group.provenance, packet, `map.groups[${groupIndex}].provenance`));
    group.contributors?.forEach((contributor, contributorIndex) => {
      errors.push(...validateRefsAgainstPacket(contributor.provenance, packet, `map.groups[${groupIndex}].contributors[${contributorIndex}].provenance`));
      contributor.texts?.forEach((text, textIndex) => {
        errors.push(...validateRefsAgainstPacket(text.provenance, packet, `map.groups[${groupIndex}].contributors[${contributorIndex}].texts[${textIndex}].provenance`));
      });
    });
  });
  map.relations?.forEach((relation, relationIndex) => {
    errors.push(...validateRefsAgainstPacket(relation.provenance, packet, `map.relations[${relationIndex}].provenance`));
  });

  return errors;
}

async function importSpecAsReviewDraft(spec) {
  const rows = atlasMapSpecToReviewRows(spec);
  const counts = {
    territories: rows.territories.length,
    branches: rows.branches.length,
    maps: rows.maps.length,
    groups: rows.groups.length,
    contributors: rows.contributors.length,
    texts: rows.texts.length,
    relations: rows.relations.length,
  };

  await upsertGeneratedRows("atlas_territories", rows.territories, "id");
  await upsertGeneratedRows("atlas_branches", rows.branches, "id");
  await upsertGeneratedRows("atlas_maps", rows.maps, "id");
  await upsertGeneratedRows("atlas_groups", rows.groups, "map_id,id");
  await upsertGeneratedRows("atlas_contributors", rows.contributors, "map_id,group_id,id");
  await upsertGeneratedRows("atlas_texts", rows.texts, "map_id,group_id,contributor_id,id");
  await upsertGeneratedRows("atlas_relations", rows.relations, "map_id,id");

  await supabase
    .from("atlas_planned_maps")
    .update({ status: "needs_review" })
    .eq("territory_slug", territorySlug)
    .eq("branch_slug", branchSlug)
    .eq("map_slug", sourceMapSlug || mapSlug);

  return {
    mapIds: rows.maps.map(row => row.id),
    counts,
    reviewStatus: "needs_review",
    published: false,
  };
}

function atlasMapSpecToReviewRows(spec) {
  const now = new Date().toISOString();
  const rows = {
    territories: [],
    branches: [],
    maps: [],
    groups: [],
    contributors: [],
    texts: [],
    relations: [],
  };

  spec.territories.forEach((territory, territoryIndex) => {
    rows.territories.push({
      id: territory.id,
      slug: territory.slug,
      title: territory.title,
      summary: territory.summary,
      display_order: territoryIndex,
      published: true,
      metadata: generatedImportMetadata(spec, now),
    });

    territory.branches.forEach((branch, branchIndex) => {
      rows.branches.push({
        id: branch.id,
        territory_id: territory.id,
        slug: branch.slug,
        title: branch.title,
        summary: branch.summary,
        display_order: branchIndex,
        published: true,
        metadata: generatedImportMetadata(spec, now),
      });

      branch.maps.forEach((map, mapIndex) => {
        rows.maps.push({
          id: map.id,
          branch_id: branch.id,
          slug: map.slug,
          title: map.title,
          subtitle: map.subtitle,
          question: map.question,
          summary: map.summary,
          status: map.status,
          build_mode: map.buildMode,
          review_status: "needs_review",
          schema_version: spec.schemaVersion,
          display_order: mapIndex,
          published: false,
          metadata: generatedImportMetadata(spec, now),
        });

        map.groups.forEach((group, groupIndex) => {
          rows.groups.push({
            map_id: map.id,
            id: group.id,
            slug: group.slug,
            title: group.title,
            short_title: group.shortTitle,
            family: group.family,
            stance: group.stance,
            central_claim: group.centralClaim,
            why_it_matters: group.whyItMatters,
            objections: group.objections,
            related_group_ids: group.relatedGroupIds,
            keywords: group.keywords,
            provenance: group.provenance || [],
            display_order: groupIndex,
            metadata: generatedImportMetadata(spec, now),
          });

          group.contributors.forEach((contributor, contributorIndex) => {
            rows.contributors.push({
              map_id: map.id,
              group_id: group.id,
              id: contributor.id,
              name: contributor.name,
              role: contributor.role,
              reason: contributor.reason,
              provenance: contributor.provenance || [],
              display_order: contributorIndex,
              metadata: generatedImportMetadata(spec, now),
            });

            contributor.texts.forEach((text, textIndex) => {
              rows.texts.push({
                map_id: map.id,
                group_id: group.id,
                contributor_id: contributor.id,
                id: text.id,
                title: text.title,
                kind: text.kind || "other",
                provenance: text.provenance || [],
                display_order: textIndex,
                metadata: generatedImportMetadata(spec, now),
              });
            });
          });
        });

        map.relations.forEach((relation, relationIndex) => {
          rows.relations.push({
            map_id: map.id,
            id: relation.id,
            source_id: relation.source,
            target_id: relation.target,
            kind: relation.kind,
            note: relation.note,
            provenance: relation.provenance || [],
            display_order: relationIndex,
            metadata: generatedImportMetadata(spec, now),
          });
        });
      });
    });
  });

  return rows;
}

function generatedImportMetadata(spec, importedAt) {
  return {
    source: "atlas-factory-staged-generator",
    runId,
    jobId,
    specUpdatedAt: spec.updatedAt,
    importedAt,
  };
}

async function upsertGeneratedRows(table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`Could not upsert ${table}: ${error.message}`);
}

async function recordGenerationRun({ validationOk, errors }) {
  const { error } = await supabase.from("atlas_generation_runs").upsert({
    id: runId,
    requested_territory_slug: territorySlug,
    requested_branch_slug: branchSlug,
    requested_map_slug: mapSlug,
    topic_prompt: topicPrompt,
    source_ids: sourcePacket.sources.map(source => source.id),
    output_draft_path: validationOk ? outputDraftPath : null,
    draft_map_slug: mapSlug,
    provider: modelConfig.provider,
    model: modelConfig.model,
    validation_ok: validationOk,
    validation_errors: errors,
    metadata: {
      generator: "atlas-staged-model-generation-v2",
      jobId,
      sourceMapSlug,
      runDir: normalizePath(relative(root, runDir)),
      currentStage,
      completedStages: [...completedStages],
      selectedSourceIds: sourceIds,
      recipe: recipeDefinition,
      repairAttempts,
      sourceCount: sourcePacket.sources.length,
      chunkCount: sourcePacket.chunks.length,
      sourcePacketHash: sourcePacket.packetHash || "",
      chunkIdsUsed: sourcePacket.chunks.map(chunk => chunk.chunkId),
      chunkBatchSize,
      concurrency,
      retryCount,
      provider: modelConfig.provider,
      model: modelConfig.model,
      endpoint: modelConfig.endpoint,
      chunkCharLimit,
      modelCallLog,
      importResult,
      outputCounts,
      provenanceStats,
      failureDetails: errors,
    },
  }, { onConflict: "id" });

  if (error) throw new Error(`Could not record Atlas staged generation run: ${error.message}`);
}

async function updateFactoryJob(status, patch = {}) {
  if (!jobId) return;
  const metadataMerge = patch.metadataMerge;
  delete patch.metadataMerge;

  let metadata = undefined;
  if (metadataMerge) {
    const { data } = await supabase
      .from("atlas_generation_jobs")
      .select("metadata")
      .eq("id", jobId)
      .single();
    const existingMetadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
    const existingProgress = existingMetadata.progress && typeof existingMetadata.progress === "object" ? existingMetadata.progress : {};
    const mergedProgress = metadataMerge.progress
      ? { ...existingProgress, ...metadataMerge.progress }
      : existingProgress;
    metadata = {
      ...existingMetadata,
      ...metadataMerge,
      ...(metadataMerge.progress ? { progress: mergedProgress } : {}),
    };
  }

  const { error } = await supabase
    .from("atlas_generation_jobs")
    .update({
      status,
      run_id: runId,
      ...(metadata ? { metadata } : {}),
      ...patch,
    })
    .eq("id", jobId);

  if (error) {
    console.warn(`Could not update Atlas factory job ${jobId}: ${error.message}`);
  }
}

function progressMetadata(progress) {
  const next = {
    currentStage: progress.currentStage || currentStage,
    resumeAvailable: true,
    selectedModel: modelConfig.model,
    safeInputTokens: modelConfig.safeInputTokens,
    contextWindowTokens: modelConfig.contextWindowTokens,
    updatedAt: new Date().toISOString(),
  };
  if (progress.completedBatches !== undefined) next.completedBatches = Number(progress.completedBatches || 0);
  if (progress.totalBatches !== undefined) next.totalBatches = Number(progress.totalBatches || 0);
  if (progress.completedGroups !== undefined) next.completedGroups = Number(progress.completedGroups || 0);
  if (progress.totalGroups !== undefined) next.totalGroups = Number(progress.totalGroups || 0);
  if (progress.latestError !== undefined) next.latestError = progress.latestError || "";

  return {
    progress: next,
  };
}

function completedBatchCount(extractionDir) {
  if (!existsSync(extractionDir)) return 0;
  return readDirJsonCount(extractionDir);
}

function completedGroupCount(groupsDir) {
  if (!existsSync(groupsDir)) return 0;
  return readDirJsonCount(groupsDir);
}

function readDirJsonCount(dir) {
  try {
    return readdirSync(dir).filter(name => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function writeRunSummary(status, errors) {
  writeJson(join(runDir, "summary.json"), {
    runId,
    jobId,
    status,
    currentStage,
    completedStages: [...completedStages],
    recipe: recipeDefinition,
    errors,
    repairAttempts,
    outputDraftPath: status === "complete" ? outputDraftPath : null,
    updatedAt: new Date().toISOString(),
  });
}

function compactInventoryForBudget(inventory, config, system) {
  const attempts = [
    { people: 8, concepts: 8, claims: 6, texts: 4, objections: 4, relationships: 4, textMax: 80 },
    { people: 5, concepts: 6, claims: 4, texts: 3, objections: 3, relationships: 3, textMax: 64 },
    { people: 3, concepts: 4, claims: 3, texts: 2, objections: 2, relationships: 2, textMax: 48 },
    { people: 2, concepts: 3, claims: 2, texts: 1, objections: 1, relationships: 1, textMax: 36 },
  ];

  for (const limits of attempts) {
    const compact = compactInventoryForPrompt(inventory, limits);
    const user = [
      `Topic: ${topicPrompt}`,
      "Normalized candidate inventory:",
      JSON.stringify(compact, null, 2),
    ].join("\n\n");
    const budget = estimatePromptBudget([
      { role: "system", content: system },
      { role: "user", content: user },
    ], config);
    if (budget.estimatedInputTokens <= config.safeInputTokens) return compact;
  }

  return compactInventoryForPrompt(inventory, attempts[attempts.length - 1]);
}

function compactInventoryForPrompt(inventory, limits = { people: 10, concepts: 12, claims: 8, texts: 5, objections: 5, relationships: 5, textMax: 100 }) {
  const compact = item => compactCandidateForPrompt(item, limits.textMax);
  return {
    people: inventory.people.slice(0, limits.people).map(item => compact({ ...item, type: "person" })),
    concepts: inventory.concepts.slice(0, limits.concepts).map(item => compact({ ...item, type: "concept" })),
    claims: inventory.claims.slice(0, limits.claims).map(item => compact({ ...item, type: "claim" })),
    texts: inventory.texts.slice(0, limits.texts).map(item => compact({ ...item, type: "text" })),
    objections: inventory.objections.slice(0, limits.objections).map(item => compact({ ...item, type: "objection" })),
    relationships: inventory.relationships.slice(0, limits.relationships).map(item => compact({ ...item, type: "relationship" })),
  };
}

function budgetedGroupContextFor(cluster, inventory, allGroups) {
  const config = modelConfigForStage(`group-enrichment-${cluster.id}`);
  const system = groupEnrichmentSystemPrompt();
  const attempts = [
    { maxCandidates: 10, textMax: 80 },
    { maxCandidates: 6, textMax: 64 },
    { maxCandidates: 4, textMax: 48 },
    { maxCandidates: 2, textMax: 36 },
  ];

  for (const attempt of attempts) {
    const context = groupContextFor(cluster, inventory, attempt.maxCandidates, attempt.textMax);
    const user = groupEnrichmentUserPrompt(cluster, context, allGroups);
    const budget = estimatePromptBudget([
      { role: "system", content: system },
      { role: "user", content: user },
    ], config);
    if (budget.estimatedInputTokens <= config.safeInputTokens) return context;
  }

  return groupContextFor(cluster, inventory, 1, 32);
}

function groupContextFor(cluster, inventory, maxCandidates = 12, textMax = 100) {
  const candidatesById = new Map(allCandidates(inventory).map(candidate => [candidate.id, candidate]));
  const candidates = cluster.memberCandidateIds
    .map(id => candidatesById.get(id))
    .filter(Boolean)
    .slice(0, maxCandidates)
    .map(candidate => compactCandidateForPrompt(candidate, textMax));
  const people = candidates.filter(candidate => candidate.type === "person");
  const texts = candidates.filter(candidate => candidate.type === "text");
  const concepts = candidates.filter(candidate => candidate.type === "concept");
  const claims = candidates.filter(candidate => candidate.type === "claim");
  const objections = candidates.filter(candidate => candidate.type === "objection");
  return { candidates, people, texts, concepts, claims, objections };
}

function compactCandidateForPrompt(item, maxLength = 100) {
  return {
    id: item.id,
    type: item.type,
    label: truncateText(item.name || item.label || item.title || item.subject || item.text, Math.min(80, maxLength)),
    summary: truncateText(item.summary || item.reason || item.text || item.note || "", maxLength),
    title: item.title ? truncateText(item.title, Math.min(80, maxLength)) : undefined,
    kind: item.kind,
    provenance: (item.provenance || []).slice(0, 3).map(ref => ({
      chunkId: ref.chunkId,
      sourceId: ref.sourceId,
      chunkIndex: ref.chunkIndex,
    })),
  };
}

function allCandidates(inventory) {
  return [
    ...inventory.people.map(item => ({ ...item, type: "person", label: item.name })),
    ...inventory.concepts.map(item => ({ ...item, type: "concept", label: item.label })),
    ...inventory.claims.map(item => ({ ...item, type: "claim", label: item.subject || item.text })),
    ...inventory.texts.map(item => ({ ...item, type: "text", label: item.title })),
    ...inventory.objections.map(item => ({ ...item, type: "objection", label: item.subject || item.text })),
  ];
}

function allCandidateIds(inventory) {
  return allCandidates(inventory).map(candidate => candidate.id);
}

function provenanceForCandidateIds(ids, inventory) {
  const candidatesById = new Map(allCandidates(inventory).map(candidate => [candidate.id, candidate]));
  return uniqueRefs(ids.flatMap(id => candidatesById.get(id)?.provenance || []));
}

function validateInventoryProvenance(inventory, packet) {
  const errors = [];
  allCandidates(inventory).forEach(candidate => {
    errors.push(...validateRefsAgainstPacket(candidate.provenance, packet, `${candidate.id}.provenance`));
  });
  inventory.relationships.forEach(candidate => {
    errors.push(...validateRefsAgainstPacket(candidate.provenance, packet, `${candidate.id}.provenance`));
  });
  return errors;
}

function validateRefsAgainstPacket(refs, packet, path) {
  const allowed = new Set(packet.chunks.map(chunk => chunk.chunkId));
  const errors = [];
  if (!Array.isArray(refs) || !refs.length) {
    errors.push(`${path}: at least one provenance ref is required.`);
    return errors;
  }
  refs.forEach((ref, index) => {
    const chunkId = String(ref?.chunkId || "");
    if (!chunkId || !allowed.has(chunkId)) errors.push(`${path}[${index}]: invalid chunkId "${chunkId}".`);
  });
  return errors;
}

function collectRefs(value) {
  const refs = [];
  const visit = item => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item.provenance)) refs.push(...normalizeRefs(item.provenance, []));
    Object.values(item).forEach(visit);
  };
  visit(value);
  return refs;
}

function normalizeRefs(value, fallbackRefs) {
  const list = Array.isArray(value) ? value : [];
  const refs = list.map(ref => {
    if (!ref || typeof ref !== "object") return null;
    const parsed = parseChunkId(ref.chunkId);
    const sourceId = parsed?.sourceId || String(ref.sourceId || "");
    const chunkIndex = parsed?.chunkIndex ?? Number(ref.chunkIndex);
    const chunkId = parsed ? parsed.chunkId : String(ref.chunkId || (sourceId && Number.isInteger(chunkIndex) ? chunkIdFor(sourceId, chunkIndex) : ""));
    if (!sourceId || !Number.isInteger(chunkIndex) || chunkIndex < 0 || !chunkId) return null;
    const note = textField(ref.note);
    return {
      chunkId,
      sourceId,
      chunkIndex,
      ...(note ? { note } : {}),
    };
  }).filter(Boolean);

  return uniqueRefs(refs.length ? refs : fallbackRefs);
}

function parseChunkId(value) {
  const chunkId = String(value || "").trim();
  const separator = chunkId.lastIndexOf("#");
  if (separator <= 0) return null;
  const sourceId = chunkId.slice(0, separator);
  const chunkIndex = Number(chunkId.slice(separator + 1));
  if (!sourceId || !Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
  return { chunkId, sourceId, chunkIndex };
}

function uniqueRefs(refs) {
  const seen = new Set();
  return (refs || []).filter(ref => {
    if (!ref?.chunkId) return false;
    const key = `${ref.chunkId}:${ref.note || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function refForChunk(chunk, note) {
  return {
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    chunkIndex: chunk.chunkIndex,
    note,
  };
}

function parseJsonResponse(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced || trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("Model did not return parseable JSON.");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

function salvageExtractionResult(raw) {
  const text = String(raw || "").replace(/```(?:json)?|```/gi, "");
  const result = {
    people: salvageArrayObjects(text, "people"),
    concepts: salvageArrayObjects(text, "concepts"),
    claims: salvageArrayObjects(text, "claims"),
    texts: salvageArrayObjects(text, "texts"),
    objections: salvageArrayObjects(text, "objections"),
    relationships: salvageArrayObjects(text, "relationships"),
  };
  return Object.values(result).some(items => items.length) ? result : null;
}

function salvageArrayObjects(text, key) {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex < 0) return [];
  const arrayStart = text.indexOf("[", keyIndex);
  if (arrayStart < 0) return [];

  const objects = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      if (depth === 0) objectStart = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        const objectText = text.slice(objectStart, index + 1);
        try {
          objects.push(JSON.parse(objectText));
        } catch {
          // Ignore incomplete salvaged objects.
        }
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) {
      break;
    }
  }

  return objects;
}

function extractMessageContent(bodyText) {
  const payload = JSON.parse(bodyText);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model returned no message content.");
  return Array.isArray(content)
    ? content.map(part => typeof part === "string" ? part : part?.text || "").join("\n")
    : String(content);
}

function combineAsUserMessage(messages) {
  return [
    {
      role: "user",
      content: messages.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n"),
    },
  ];
}

async function mapLimit(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function batchChunks(chunks, size) {
  const batches = [];
  for (let index = 0; index < chunks.length; index += size) {
    batches.push(chunks.slice(index, index + size));
  }
  return batches;
}

function countGeneratedOutput(spec) {
  const map = spec.territories[0].branches[0].maps[0];
  const contributors = map.groups.flatMap(group => group.contributors);
  const texts = contributors.flatMap(contributor => contributor.texts);
  return {
    groups: map.groups.length,
    contributors: contributors.length,
    texts: texts.length,
    relations: map.relations.length,
  };
}

function countProvenance(spec) {
  const map = spec.territories[0].branches[0].maps[0];
  const stats = { groups: 0, contributors: 0, texts: 0, relations: 0, refs: 0 };
  map.groups.forEach(group => {
    stats.groups += group.provenance?.length ? 1 : 0;
    stats.refs += group.provenance?.length || 0;
    group.contributors.forEach(contributor => {
      stats.contributors += contributor.provenance?.length ? 1 : 0;
      stats.refs += contributor.provenance?.length || 0;
      contributor.texts.forEach(text => {
        stats.texts += text.provenance?.length ? 1 : 0;
        stats.refs += text.provenance?.length || 0;
      });
    });
  });
  map.relations.forEach(relation => {
    stats.relations += relation.provenance?.length ? 1 : 0;
    stats.refs += relation.provenance?.length || 0;
  });
  return stats;
}

function rowToSource(row) {
  return {
    id: String(row.id || ""),
    title: String(row.title || ""),
    creator: String(row.creator || ""),
    sourceType: String(row.source_type || "other"),
    territorySlug: String(row.territory_slug || ""),
    branchSlug: String(row.branch_slug || ""),
    mapSlug: String(row.map_slug || ""),
    filePath: String(row.file_path || ""),
    canonicalUrl: String(row.canonical_url || ""),
  };
}

function readModelConfig(stageKey = "default") {
  const stagePrefix = stageKey === "default" ? "" : `${stageKey}-`;
  const rawEndpoint = getOption(`${stagePrefix}endpoint`) || getOption("endpoint") || process.env.ATLAS_MODEL_ENDPOINT || process.env.LM_STUDIO_ENDPOINT || "";
  const rawBaseUrl = getOption("base-url")
    || process.env.ATLAS_MODEL_BASE_URL
    || process.env.OPENAI_BASE_URL
    || (rawEndpoint ? endpointToBaseUrl(rawEndpoint) : "")
    || (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : DEFAULT_LOCAL_BASE_URL);
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const endpoint = rawEndpoint && rawEndpoint.includes("/chat/completions")
    ? rawEndpoint
    : `${baseUrl}/chat/completions`;
  const localEndpoint = isLocalUrl(endpoint);
  const allowNoKey = flagEnabled("allow-no-key")
    || process.env.ATLAS_MODEL_ALLOW_NO_KEY === "true"
    || localEndpoint;
  const provider = getOption("provider")
    || process.env.ATLAS_MODEL_PROVIDER
    || (localEndpoint ? "local-openai-compatible" : "openai-compatible");
  const model = getOption(`${stagePrefix}model`) || getOption("model") || process.env.ATLAS_MODEL_NAME || process.env.OPENAI_MODEL || process.env.LM_STUDIO_MODEL || DEFAULT_LOCAL_MODEL;
  const profile = modelProfileFor(model);

  return {
    provider,
    baseUrl,
    endpoint,
    model,
    profileId: profile.id,
    contextWindowTokens: numberOption(`${stagePrefix}context-window`, profile.contextWindowTokens),
    safeInputTokens: numberOption(`${stagePrefix}safe-input-tokens`, profile.safeInputTokens),
    recommendedExtractionBatchSize: Math.max(1, numberOption(`${stagePrefix}extraction-batch-size`, profile.recommendedExtractionBatchSize)),
    defaultChunkCharLimit: Math.max(160, numberOption(`${stagePrefix}chunk-char-limit`, profile.defaultChunkCharLimit || 900)),
    apiKey: getOption(`${stagePrefix}api-key`) || getOption("api-key") || process.env.ATLAS_MODEL_API_KEY || process.env.OPENAI_API_KEY || "",
    allowNoKey,
    temperature: Number(getOption(`${stagePrefix}temperature`) || getOption("temperature") || 0.1),
    maxTokens: numberOption(`${stagePrefix}max-tokens`, numberOption("max-tokens", profile.maxOutputTokens)),
    timeoutMs: numberOption(`${stagePrefix}timeout-ms`, numberOption("timeout-ms", profile.timeoutMs)),
    concurrency: Math.max(1, numberOption(`${stagePrefix}concurrency`, profile.concurrency)),
    jsonMode: process.env.ATLAS_MODEL_JSON_MODE !== "false" && !flagEnabled("no-json-mode") && profile.jsonMode !== false,
    profile,
    stageKey,
  };
}

function redactedModelConfig(config) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    endpoint: config.endpoint,
    model: config.model,
    profileId: config.profileId,
    contextWindowTokens: config.contextWindowTokens,
    safeInputTokens: config.safeInputTokens,
    allowNoKey: config.allowNoKey,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency,
    jsonMode: config.jsonMode,
  };
}

function readModelProfiles() {
  const fallback = {
    default: {
      provider: "openai-compatible",
      model: "",
      contextWindowTokens: 8192,
      maxOutputTokens: 700,
      safeInputTokens: 2600,
      recommendedExtractionBatchSize: 1,
      timeoutMs: 90000,
      concurrency: 1,
      jsonMode: true,
    },
  };

  if (!existsSync(MODEL_PROFILES_PATH)) return fallback;

  try {
    return { ...fallback, ...readJson(MODEL_PROFILES_PATH) };
  } catch (error) {
    console.warn(`Could not read Atlas model profiles: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

function modelProfileFor(model) {
  const profiles = readModelProfiles();
  const base = profiles.default || {};
  const exact = profiles[model] || {};
  return normalizeModelProfile({ ...base, ...exact, id: exact.id || model || "default" });
}

function normalizeModelProfile(profile) {
  return {
    id: textField(profile.id || profile.model || "default"),
    provider: textField(profile.provider || "openai-compatible"),
    model: textField(profile.model || ""),
    contextWindowTokens: Math.max(512, Number(profile.contextWindowTokens || 8192)),
    maxOutputTokens: Math.max(128, Number(profile.maxOutputTokens || 700)),
    safeInputTokens: Math.max(256, Number(profile.safeInputTokens || 2600)),
    recommendedExtractionBatchSize: Math.max(1, Number(profile.recommendedExtractionBatchSize || 1)),
    timeoutMs: Math.max(10000, Number(profile.timeoutMs || 90000)),
    concurrency: Math.max(1, Number(profile.concurrency || 1)),
    jsonMode: profile.jsonMode !== false,
    defaultChunkCharLimit: Math.max(160, Number(profile.defaultChunkCharLimit || 900)),
  };
}

function stageKeyFor(stageName) {
  if (/^extraction/.test(stageName)) return "extraction";
  if (/^clustering/.test(stageName)) return "clustering";
  if (/^group-enrichment|final-group-repair/.test(stageName)) return "enrichment";
  if (/^relations|final-relations-repair/.test(stageName)) return "relations";
  return "default";
}

function modelConfigForStage(stageName) {
  const stageKey = stageKeyFor(stageName);
  return stageKey === "default" ? modelConfig : readModelConfig(stageKey);
}

function redactedStageModelConfigs() {
  return Object.fromEntries(
    ["extraction", "clustering", "enrichment", "relations"].map(stage => [stage, redactedModelConfig(readModelConfig(stage))]),
  );
}

async function preflightModelConfigs() {
  const configs = [modelConfig, readModelConfig("extraction"), readModelConfig("clustering"), readModelConfig("enrichment"), readModelConfig("relations")];
  const unique = new Map(configs.map(config => [`${config.endpoint}\u0000${config.model}`, config]));
  const results = [];

  for (const config of unique.values()) {
    results.push(await preflightModelConfig(config));
  }

  return results;
}

async function preflightModelConfig(config) {
  const modelsUrl = `${normalizeBaseUrl(config.baseUrl)}/models`;
  const result = {
    provider: config.provider,
    model: config.model,
    endpoint: config.endpoint,
    modelsUrl,
    ok: false,
    available: false,
    loaded: false,
    detectedContextWindowTokens: null,
    configuredSafeInputTokens: config.safeInputTokens,
    configuredMaxOutputTokens: config.maxTokens,
    error: "",
  };

  try {
    const response = await fetch(modelsUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Model list failed: ${response.status} ${response.statusText} ${await response.text()}`);
    const payload = await response.json();
    const listedModels = Array.isArray(payload.data) ? payload.data : [];
    result.available = listedModels.some(model => model.id === config.model);
    if (!result.available) throw new Error(`Model "${config.model}" is not listed by ${modelsUrl}.`);

    const lmStudio = await readLmStudioModelMetadata(config).catch(() => null);
    if (lmStudio) {
      result.loaded = lmStudio.state === "loaded";
      result.detectedContextWindowTokens = Number(lmStudio.loaded_context_length || lmStudio.max_context_length || 0) || null;
    } else {
      result.loaded = true;
    }

    result.ok = true;
    return result;
  } catch (error) {
    result.error = classifyModelError(error).message;
    throw Object.assign(new Error(`Preflight failed for ${config.model}: ${result.error}`), { preflight: result });
  }
}

async function readLmStudioModelMetadata(config) {
  if (!isLocalUrl(config.endpoint)) return null;
  const response = await fetch(`${normalizeBaseUrl(config.baseUrl).replace(/\/v1$/i, "")}/api/v0/models`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.find(row => row.id === config.model) || null;
}

function resolveRunDir(value) {
  const dir = value.includes("/") || value.includes("\\") ? value : join("atlas", "generation-runs", value);
  return isAbsolute(dir) ? dir : join(root, dir);
}

function resolveOutputPath(value) {
  return isAbsolute(value) ? value : join(root, value);
}

function sourceSlugForDraft(value) {
  return value
    .replace(/-(grounded|generated|model|staged)-v\d+$/i, "")
    .replace(/-v\d+$/i, "");
}

function questionFor(mapTitle) {
  return `What are the major families inside ${String(mapTitle || "").toLowerCase()}, and what does each family claim about reality?`;
}

function chunkIdFor(sourceId, chunkIndex) {
  return `${sourceId}#${chunkIndex}`;
}

function emptySourcePacket(inputSourceMapSlug) {
  return {
    sources: [],
    chunks: [],
    sourceMapSlug: inputSourceMapSlug,
    packetHash: "",
  };
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_LOCAL_BASE_URL)
    .trim()
    .replace(/\/chat\/completions\/?$/i, "")
    .replace(/\/$/, "");
}

function endpointToBaseUrl(value) {
  return normalizeBaseUrl(value);
}

function isLocalUrl(value) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(String(value || ""));
}

function textField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const text = textField(value);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3).replace(/\s+\S*$/, "").trimEnd() + "...";
}

function textKind(value) {
  return ["book", "essay", "paper", "dialogue", "lecture", "other"].includes(value) ? value : "other";
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map(item => textField(item)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map(item => textField(item))
      .filter(Boolean);
  }
  return [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedKey(value) {
  return textField(value).toLowerCase();
}

function shortTitleFor(title) {
  return String(title || "")
    .replace(/\s+metaphysics$/i, "")
    .split(/\s+and\s+|,\s*/)
    .filter(Boolean)[0]
    .trim();
}

function titleFromSlug(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function flagEnabled(name) {
  const value = options[name];
  return value === true || value === "true" || value === "1";
}

function numberOption(name, fallback) {
  const raw = getOption(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function csvOption(...names) {
  const value = getOption(...names);
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function getOption(...names) {
  for (const name of names) {
    const value = options[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith("--")) continue;

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = args[index + 1];
    if (inlineValue !== undefined) parsed[rawName] = inlineValue;
    else if (nextValue && !nextValue.startsWith("--")) {
      parsed[rawName] = nextValue;
      index += 1;
    } else {
      parsed[rawName] = "true";
    }
  }
  return parsed;
}

function loadLocalEnv(fileName) {
  const filePath = join(root, fileName);
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function printUsage() {
  console.log(`
Usage:
  npm run atlas:generate-staged -- \\
    --territory-slug humanities \\
    --branch-slug philosophy \\
    --map-slug metaphysics-families-staged-v2 \\
    --source-map-slug metaphysics-families \\
    --topic-prompt "Build a staged source-grounded map of metaphysical families." \\
    --max-chunks 8 \\
    --model mistralai/mistral-7b-instruct-v0.3

Resume:
  npm run atlas:generate-staged -- --run-id atlas-staged-... [same inputs]

Options:
  --provider local-openai-compatible
  --base-url http://127.0.0.1:1234/v1
  --endpoint http://127.0.0.1:1234/v1/chat/completions
  --timeout-ms 90000
  --retry-count 1
  --chunk-batch-size 1
  --chunk-char-limit 900
  --concurrency 1
  --recipe-id theory_family
  --recipe-file atlas/recipes/custom.json
  --source-ids source-a,source-b
  --job-id atlas-job-...
  --force
`);
}
