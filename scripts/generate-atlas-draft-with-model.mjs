import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { validateAtlasMapSpec } from "../lib/atlasMaps.ts";

const root = process.cwd();
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_LOCAL_MODEL = "mistralai/mistral-small-3.2";
const RELATION_KINDS = new Set(["opposes", "answers", "reframes", "borrows", "neighbors"]);

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
const maxChunks = Number(getOption("max-chunks") || 12);

if (!territorySlug || !branchSlug || !mapSlug || !topicPrompt) {
  console.error("Missing required Atlas model-generation inputs.");
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

const runId = `atlas-model-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const outputPath = resolveOutputPath(getOption("output", "out") || `${mapSlug}-atlas-map-spec.json`);
const outputDraftPath = normalizePath(relative(root, outputPath));
const modelConfig = readModelConfig();

let loadedSourcePacket = emptySourcePacket(sourceMapSlug);
let latestValidationErrors = [];
let latestProvenanceStats = null;
let repairNeeded = false;
let outputCounts = null;

try {
  loadedSourcePacket = await loadSourcePacket({
    territorySlug,
    branchSlug,
    mapSlug,
    sourceMapSlug,
    maxChunks,
  });

  if (!loadedSourcePacket.chunks.length) {
    throw new Error(`No Atlas source chunks found for ${territorySlug} / ${branchSlug} / ${sourceMapSlug || mapSlug}.`);
  }

  const first = await requestAtlasSpecFromModel({
    sourcePacket: loadedSourcePacket,
    modelConfig,
    repair: false,
  });

  let spec = normalizeReturnedSpec(first.spec);
  let validation = validateModelDraft(spec, loadedSourcePacket);
  if (first.parseError) validation.errors.unshift(`Model JSON parse failed: ${first.parseError}`);
  validation.ok = validation.errors.length === 0;
  latestValidationErrors = validation.errors;
  latestProvenanceStats = validation.provenanceStats;

  if (!validation.ok) {
    repairNeeded = true;
    const repaired = await requestAtlasSpecFromModel({
      sourcePacket: loadedSourcePacket,
      modelConfig,
      repair: true,
      previousJson: first.rawText,
      validationErrors: validation.errors,
    });
    spec = normalizeReturnedSpec(repaired.spec);
    validation = validateModelDraft(spec, loadedSourcePacket);
    if (repaired.parseError) validation.errors.unshift(`Repair JSON parse failed: ${repaired.parseError}`);
    validation.ok = validation.errors.length === 0;
    latestValidationErrors = validation.errors;
    latestProvenanceStats = validation.provenanceStats;
  }

  if (!validation.ok) {
    throw new Error(`Model returned invalid AtlasMapSpec after repair:\n${validation.errors.map(error => `- ${error}`).join("\n")}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  outputCounts = countGeneratedOutput(spec);

  await recordGenerationRun({
    runId,
    territorySlug,
    branchSlug,
    mapSlug,
    topicPrompt,
    sourcePacket: loadedSourcePacket,
    outputDraftPath,
    validationOk: true,
    validationErrors: [],
    repairNeeded,
    modelConfig,
    provenanceStats: latestProvenanceStats,
    outputCounts,
  });

  console.log("Generated model-assisted AtlasMapSpec draft.");
  console.log(`- run: ${runId}`);
  console.log(`- provider: ${modelConfig.provider}`);
  console.log(`- model: ${modelConfig.model}`);
  console.log(`- file: ${outputPath}`);
  console.log(`- source ids: ${loadedSourcePacket.sources.map(source => source.id).join(", ")}`);
  console.log(`- chunks used: ${loadedSourcePacket.chunks.length}`);
  console.log(`- chunk ids: ${loadedSourcePacket.chunks.map(chunk => chunk.chunkId).join(", ")}`);
  console.log(`- groups: ${outputCounts.groups}`);
  console.log(`- contributors: ${outputCounts.contributors}`);
  console.log(`- texts: ${outputCounts.texts}`);
  console.log(`- relations: ${outputCounts.relations}`);
  console.log(`- provenance refs: ${latestProvenanceStats?.refs || 0}`);
  console.log(`- repair needed: ${repairNeeded ? "yes" : "no"}`);
  console.log("Validation passed.");
  console.log("Not imported. Not published.");
} catch (error) {
  const message = error instanceof Error ? error.message : "Atlas model generation failed.";
  const validationErrors = latestValidationErrors.length ? latestValidationErrors : [message];

  try {
    await recordGenerationRun({
      runId,
      territorySlug,
      branchSlug,
      mapSlug,
      topicPrompt,
      sourcePacket: loadedSourcePacket,
      outputDraftPath: null,
      validationOk: false,
      validationErrors,
      repairNeeded,
      modelConfig,
      provenanceStats: latestProvenanceStats,
      outputCounts,
    });
  } catch (recordError) {
    console.error(`Could not record failed Atlas generation run: ${recordError instanceof Error ? recordError.message : String(recordError)}`);
  }

  console.error(message);
  process.exit(1);
}

async function requestAtlasSpecFromModel(input) {
  const system = input.repair ? repairSystemPrompt() : generationSystemPrompt();
  const user = input.repair
    ? repairUserPrompt(input.sourcePacket, input.previousJson, input.validationErrors)
    : generationUserPrompt(input.sourcePacket);
  const rawText = await callOpenAiCompatible({
    config: input.modelConfig,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  let spec = null;
  let parseError = "";
  try {
    spec = parseJsonResponse(rawText);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  return {
    rawText,
    spec,
    parseError,
  };
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
      throw new Error(`Model request timed out after ${config.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function postChatCompletion(config, headers, messages, signal) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages,
    }),
    signal,
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    bodyText: await response.text(),
  };
}

function combineAsUserMessage(messages) {
  return [
    {
      role: "user",
      content: messages.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n"),
    },
  ];
}

function extractMessageContent(bodyText) {
  const payload = JSON.parse(bodyText);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model returned no message content.");
  return Array.isArray(content)
    ? content.map(part => typeof part === "string" ? part : part?.text || "").join("\n")
    : String(content);
}

async function loadSourcePacket(input) {
  const exactSources = await loadSourcesForMapSlug(input.sourceMapSlug);
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

function generationSystemPrompt() {
  return [
    "You generate one JJ University AtlasMapSpec from grounded source chunks.",
    "Return strict JSON only. No markdown, no prose outside JSON.",
    "Top-level shape: schemaVersion, updatedAt, territories[].branches[].maps[].",
    "Map fields: id, slug, title, subtitle, question, summary, status, buildMode, groups, relations.",
    "Group fields: id, slug, title, shortTitle, family, stance, centralClaim, whyItMatters, contributors, objections, relatedGroupIds, keywords, provenance.",
    "Contributor fields: id, name, role, reason, texts, provenance. Text fields: id, title, kind, provenance.",
    "Relation fields: id, source, target, kind, note, provenance. Relation kind must be one of opposes, answers, reframes, borrows, neighbors.",
    "Provenance refs must be objects: {\"chunkId\":\"source#0\",\"sourceId\":\"source\",\"chunkIndex\":0,\"note\":\"short support note\"}.",
    "Use only chunk IDs from the allowed source chunk list.",
    "Keep output compact: exactly 5 groups, exactly 1 contributor per group, exactly 1 key text per contributor, exactly 2 objections per group, exactly 4 relations.",
    "Use exactly 1 provenance ref on each group, contributor, text, and relation.",
    "Keep every stance, claim, reason, note, objection, and summary under 120 characters.",
    "Every group, contributor, text, and relation must include at least one valid provenance reference.",
    "Use stable lowercase kebab-case IDs. Relation source/target must match group IDs.",
  ].join("\n\n");
}

function generationUserPrompt(sourcePacket) {
  return [
    `Requested territory: ${territorySlug}`,
    `Requested branch: ${branchSlug}`,
    `Requested map slug: ${mapSlug}`,
    `Source map slug: ${sourceMapSlug || mapSlug}`,
    `Topic prompt: ${topicPrompt}`,
    `Use these exact metadata constraints: territory.id=${territorySlug}, territory.slug=${territorySlug}, branch.id=${branchSlug}, branch.slug=${branchSlug}, map.id=${mapSlug}, map.slug=${mapSlug}, map.status=queued, map.buildMode=pipeline-ready.`,
    `Allowed source chunk IDs: ${sourcePacket.chunks.map(chunk => chunk.chunkId).join(", ")}`,
    "Source packet:",
    formatSourcePacket(sourcePacket),
    "Return only the AtlasMapSpec JSON object.",
  ].join("\n\n");
}

function repairSystemPrompt() {
  return [
    "You repair AtlasMapSpec JSON.",
    "Return strict JSON only. No markdown. No commentary.",
    "Do not add facts not supported by the source packet.",
    "Fix all validation errors, preserve the requested map slug, and keep provenance references valid.",
  ].join("\n\n");
}

function repairUserPrompt(sourcePacket, previousJson, validationErrors) {
  return [
    `Requested territory: ${territorySlug}`,
    `Requested branch: ${branchSlug}`,
    `Requested map slug: ${mapSlug}`,
    `Topic prompt: ${topicPrompt}`,
    `Allowed source chunk IDs: ${sourcePacket.chunks.map(chunk => chunk.chunkId).join(", ")}`,
    "Validation errors:",
    validationErrors.map(error => `- ${error}`).join("\n"),
    "Source packet:",
    formatSourcePacket(sourcePacket),
    "Previous model output:",
    previousJson,
    "Return only the repaired AtlasMapSpec JSON object.",
  ].join("\n\n");
}

function formatSourcePacket(sourcePacket) {
  const sourceLines = sourcePacket.sources.map(source => {
    const creator = source.creator ? ` by ${source.creator}` : "";
    return `- ${source.id}: ${source.title}${creator} (${source.sourceType})`;
  });

  const chunkLines = sourcePacket.chunks.map(chunk => [
    `[${chunk.chunkId}]`,
    chunk.heading ? `Heading: ${chunk.heading}` : "Heading: none",
    chunk.text.trim(),
  ].join("\n"));

  return [
    "Sources:",
    sourceLines.join("\n") || "- none",
    "Chunks:",
    chunkLines.join("\n\n---\n\n"),
  ].join("\n\n");
}

function normalizeReturnedSpec(value) {
  const spec = unwrapSpec(value);
  if (!spec || typeof spec !== "object") return spec;

  spec.schemaVersion = 1;
  spec.updatedAt = new Date().toISOString().slice(0, 10);

  if (!Array.isArray(spec.territories) || !spec.territories[0]) return spec;

  const territory = spec.territories[0];
  territory.id = territorySlug;
  territory.slug = territorySlug;
  territory.title = nonBlank(territory.title) || titleFromSlug(territorySlug);
  territory.summary = nonBlank(territory.summary) || `${titleFromSlug(territorySlug)} Atlas drafts.`;
  territory.branches = Array.isArray(territory.branches) ? territory.branches : [];
  if (!territory.branches[0]) return spec;

  const branch = territory.branches[0];
  branch.id = branchSlug;
  branch.slug = branchSlug;
  branch.title = nonBlank(branch.title) || titleFromSlug(branchSlug);
  branch.summary = nonBlank(branch.summary) || `${titleFromSlug(branchSlug)} Atlas drafts.`;
  branch.maps = Array.isArray(branch.maps) ? branch.maps : [];
  if (!branch.maps[0]) return spec;

  const map = branch.maps[0];
  map.id = mapSlug;
  map.slug = mapSlug;
  map.title = nonBlank(map.title) || titleFromSlug(sourceMapSlug || mapSlug);
  map.subtitle = nonBlank(map.subtitle) || "A model-assisted, source-grounded review draft.";
  map.question = nonBlank(map.question) || questionFor(map.title);
  map.summary = nonBlank(map.summary) || `Model-assisted draft generated from ${loadedSourcePacket.chunks.length} source chunks.`;
  map.status = "queued";
  map.buildMode = "pipeline-ready";
  map.groups = Array.isArray(map.groups) ? map.groups : [];
  map.relations = Array.isArray(map.relations) ? map.relations : [];

  map.groups.forEach((group, index) => {
    const title = nonBlank(group.title) || `Generated family ${index + 1}`;
    group.id = toSlug(group.id || group.slug || title) || `generated-family-${index + 1}`;
    group.slug = toSlug(group.slug || group.id || title) || group.id;
    group.title = title;
    group.shortTitle = nonBlank(group.shortTitle) || shortTitleFor(title);
    group.family = nonBlank(group.family) || `${title} family`;
    group.stance = nonBlank(group.stance) || `${title} requires review.`;
    group.centralClaim = nonBlank(group.centralClaim) || `${title} is one family in this source-grounded draft.`;
    group.whyItMatters = nonBlank(group.whyItMatters) || `${title} helps structure the map for review.`;
    group.contributors = Array.isArray(group.contributors) ? group.contributors : [];
    group.objections = stringList(group.objections);
    group.relatedGroupIds = stringList(group.relatedGroupIds);
    group.keywords = stringList(group.keywords);
    group.provenance = Array.isArray(group.provenance) ? group.provenance : [];

    group.contributors.forEach((contributor, contributorIndex) => {
      contributor.id = toSlug(contributor.id || contributor.name || `${group.id}-contributor-${contributorIndex + 1}`)
        || `${group.id}-contributor-${contributorIndex + 1}`;
      contributor.name = nonBlank(contributor.name) || titleFromSlug(contributor.id);
      contributor.role = nonBlank(contributor.role) || "source contributor";
      contributor.reason = nonBlank(contributor.reason) || `${contributor.name} appears in the source packet for ${group.title}.`;
      contributor.texts = Array.isArray(contributor.texts) ? contributor.texts : [];
      contributor.provenance = Array.isArray(contributor.provenance) ? contributor.provenance : [];

      contributor.texts.forEach((text, textIndex) => {
        text.title = nonBlank(text.title) || `Source text ${textIndex + 1}`;
        text.id = toSlug(text.id || text.title) || `${contributor.id}-text-${textIndex + 1}`;
        text.kind = ["book", "essay", "paper", "dialogue", "lecture", "other"].includes(text.kind) ? text.kind : "other";
        text.provenance = Array.isArray(text.provenance) ? text.provenance : [];
      });
    });
  });

  const groupIds = new Set(map.groups.map(group => group.id));
  map.groups.forEach(group => {
    group.relatedGroupIds = group.relatedGroupIds.filter(id => groupIds.has(id) && id !== group.id);
  });

  map.relations.forEach((relation, index) => {
    relation.source = String(relation.source || "");
    relation.target = String(relation.target || "");
    relation.id = toSlug(relation.id || `${relation.source}-to-${relation.target}`) || `relation-${index + 1}`;
    relation.kind = RELATION_KINDS.has(relation.kind) ? relation.kind : "neighbors";
    relation.note = nonBlank(relation.note) || "Model-generated relation requires review.";
    relation.provenance = Array.isArray(relation.provenance) ? relation.provenance : [];
  });

  return spec;
}

function validateModelDraft(spec, sourcePacket) {
  const errors = [];

  try {
    errors.push(...validateAtlasMapSpec(spec).map(issue => `${issue.path}: ${issue.message}`));
  } catch (error) {
    errors.push(`AtlasMapSpec validation crashed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const map = firstMap(spec);
  if (!map) {
    errors.push("AtlasMapSpec must contain one territory, one branch, and one map.");
    return { ok: false, errors, provenanceStats: emptyProvenanceStats() };
  }

  const groupCount = Array.isArray(map.groups) ? map.groups.length : 0;
  if (groupCount < 5 || groupCount > 10) {
    errors.push(`Map must include 5 to 10 groups; got ${groupCount}.`);
  }

  const provenance = validateProvenanceCoverage(map, sourcePacket);
  errors.push(...provenance.errors);

  return {
    ok: errors.length === 0,
    errors,
    provenanceStats: provenance.stats,
  };
}

function validateProvenanceCoverage(map, sourcePacket) {
  const allowedChunkIds = new Set(sourcePacket.chunks.map(chunk => chunk.chunkId));
  const errors = [];
  const stats = emptyProvenanceStats();

  const checkRefs = (refs, path, bucket) => {
    stats[bucket].total += 1;
    if (!Array.isArray(refs) || !refs.length) {
      errors.push(`${path}.provenance: at least one source chunk reference is required.`);
      return;
    }

    stats[bucket].withProvenance += 1;
    refs.forEach((ref, index) => {
      stats.refs += 1;
      if (!ref || typeof ref !== "object") {
        errors.push(`${path}.provenance[${index}]: reference must be an object.`);
        stats.invalidRefs += 1;
        return;
      }

      const sourceId = String(ref.sourceId || "");
      const chunkIndex = Number(ref.chunkIndex);
      const chunkId = String(ref.chunkId || (sourceId && Number.isInteger(chunkIndex) ? chunkIdFor(sourceId, chunkIndex) : ""));

      if (!sourceId || !Number.isInteger(chunkIndex) || chunkIndex < 0 || !chunkId) {
        errors.push(`${path}.provenance[${index}]: sourceId, chunkIndex, and chunkId are required.`);
        stats.invalidRefs += 1;
        return;
      }

      if (!allowedChunkIds.has(chunkId)) {
        errors.push(`${path}.provenance[${index}]: chunkId "${chunkId}" was not in the grounded source packet.`);
        stats.invalidRefs += 1;
      }
    });
  };

  (map.groups || []).forEach((group, groupIndex) => {
    const groupPath = `map.groups[${groupIndex}]`;
    checkRefs(group.provenance, groupPath, "groups");

    (group.contributors || []).forEach((contributor, contributorIndex) => {
      const contributorPath = `${groupPath}.contributors[${contributorIndex}]`;
      checkRefs(contributor.provenance, contributorPath, "contributors");

      (contributor.texts || []).forEach((text, textIndex) => {
        checkRefs(text.provenance, `${contributorPath}.texts[${textIndex}]`, "texts");
      });
    });
  });

  (map.relations || []).forEach((relation, relationIndex) => {
    checkRefs(relation.provenance, `map.relations[${relationIndex}]`, "relations");
  });

  return { errors, stats };
}

async function recordGenerationRun(input) {
  const { error } = await supabase.from("atlas_generation_runs").upsert({
    id: input.runId,
    requested_territory_slug: input.territorySlug,
    requested_branch_slug: input.branchSlug,
    requested_map_slug: input.mapSlug,
    topic_prompt: input.topicPrompt,
    source_ids: input.sourcePacket.sources.map(source => source.id),
    output_draft_path: input.outputDraftPath,
    draft_map_slug: input.mapSlug,
    provider: input.modelConfig.provider,
    model: input.modelConfig.model,
    validation_ok: input.validationOk,
    validation_errors: input.validationErrors,
    metadata: {
      generator: "atlas-model-generation-v1",
      sourceMapSlug: input.sourcePacket.sourceMapSlug,
      sourceCount: input.sourcePacket.sources.length,
      chunkCount: input.sourcePacket.chunks.length,
      sourcePacketHash: input.sourcePacket.packetHash || "",
      chunkIdsUsed: input.sourcePacket.chunks.map(chunk => chunk.chunkId),
      chunks: input.sourcePacket.chunks.map(chunk => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        charCount: chunk.charCount,
        tokenEstimate: chunk.tokenEstimate,
      })),
      provider: input.modelConfig.provider,
      model: input.modelConfig.model,
      endpoint: input.modelConfig.endpoint,
      repairNeeded: input.repairNeeded,
      provenanceStats: input.provenanceStats,
      outputCounts: input.outputCounts,
    },
  }, { onConflict: "id" });

  if (error) throw new Error(`Could not record Atlas generation run: ${error.message}`);
}

function readModelConfig() {
  const rawEndpoint = getOption("endpoint") || process.env.ATLAS_MODEL_ENDPOINT || process.env.LM_STUDIO_ENDPOINT || "";
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

  return {
    provider,
    baseUrl,
    endpoint,
    model: getOption("model") || process.env.ATLAS_MODEL_NAME || process.env.OPENAI_MODEL || process.env.LM_STUDIO_MODEL || DEFAULT_LOCAL_MODEL,
    apiKey: getOption("api-key") || process.env.ATLAS_MODEL_API_KEY || process.env.OPENAI_API_KEY || "",
    allowNoKey,
    temperature: Number(getOption("temperature") || 0.2),
    maxTokens: Number(getOption("max-tokens") || 6000),
    timeoutMs: Number(getOption("timeout-ms", "timeout") || 240000),
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

function unwrapSpec(value) {
  if (!value || typeof value !== "object") return value;
  return value.atlasMapSpec || value.spec || value.mapSpec || value;
}

function firstMap(spec) {
  return spec?.territories?.[0]?.branches?.[0]?.maps?.[0] || null;
}

function countGeneratedOutput(spec) {
  const map = firstMap(spec);
  const groups = Array.isArray(map?.groups) ? map.groups : [];
  const contributors = groups.flatMap(group => Array.isArray(group.contributors) ? group.contributors : []);
  const texts = contributors.flatMap(contributor => Array.isArray(contributor.texts) ? contributor.texts : []);
  const relations = Array.isArray(map?.relations) ? map.relations : [];
  return {
    groups: groups.length,
    contributors: contributors.length,
    texts: texts.length,
    relations: relations.length,
  };
}

function emptyProvenanceStats() {
  return {
    groups: { total: 0, withProvenance: 0 },
    contributors: { total: 0, withProvenance: 0 },
    texts: { total: 0, withProvenance: 0 },
    relations: { total: 0, withProvenance: 0 },
    refs: 0,
    invalidRefs: 0,
  };
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

function emptySourcePacket(inputSourceMapSlug) {
  return {
    sources: [],
    chunks: [],
    sourceMapSlug: inputSourceMapSlug,
    packetHash: "",
  };
}

function sourceSlugForDraft(value) {
  return value
    .replace(/-(grounded|generated|model)-v\d+$/i, "")
    .replace(/-v\d+$/i, "");
}

function questionFor(mapTitle) {
  return `What are the major families inside ${String(mapTitle || "").toLowerCase()}, and what does each family claim about reality?`;
}

function chunkIdFor(sourceId, chunkIndex) {
  return `${sourceId}#${chunkIndex}`;
}

function resolveOutputPath(value) {
  const normalized = value.replace(/\\/g, "/");
  const hasDirectory = normalized.includes("/");
  const path = hasDirectory ? value : join("atlas", "drafts", value);
  return isAbsolute(path) ? path : join(root, path);
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function nonBlank(value) {
  const text = String(value || "").trim();
  return text || "";
}

function stringList(value) {
  return Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : [];
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

function flagEnabled(name) {
  const value = options[name];
  return value === true || value === "true" || value === "1";
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
  npm run atlas:generate-with-model -- \\
    --territory-slug humanities \\
    --branch-slug philosophy \\
    --map-slug metaphysics-families-model-v1 \\
    --source-map-slug metaphysics-families \\
    --topic-prompt "Build a source-grounded map of metaphysical families." \\
    --max-chunks 8

Optional:
  --model qwen/qwen3-32b
  --base-url http://127.0.0.1:1234/v1
  --endpoint http://127.0.0.1:1234/v1/chat/completions
  --output atlas/drafts/custom-file.json
`);
}
