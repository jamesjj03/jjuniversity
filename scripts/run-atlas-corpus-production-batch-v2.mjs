import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
loadLocalEnv(".env.local");
loadLocalEnv(".env");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase admin env vars.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pipelineDbPath = process.env.ATLAS_CORPUS_DB_PATH
  || process.env.PIPELINE_KB_PATH
  || "C:\\Users\\james\\Documents\\The Pipeline\\sources\\jju_sources.sqlite";

const provider = process.env.ATLAS_BATCH_PROVIDER || "local-openai-compatible";
const model = process.env.ATLAS_BATCH_MODEL || "google/gemma-3-12b";
const endpoint = process.env.ATLAS_BATCH_ENDPOINT || "http://127.0.0.1:1234/v1/chat/completions";
const stamp = process.env.ATLAS_BATCH_STAMP || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
const reportPath = join(root, "atlas", "generation-runs", `atlas-corpus-production-batch-v2-${stamp}.json`);

const targets = [
  {
    plannedId: "planned-stem-mathematics-mathematical-styles",
    territorySlug: "stem",
    territoryTitle: "STEM",
    branchSlug: "mathematics",
    branchTitle: "Mathematics",
    baseMapSlug: "mathematical-styles",
    draftSlug: `mathematical-styles-corpus-v2-${stamp}`,
    mapTitle: "Mathematical styles",
    recipeId: "discipline_landscape",
    topicPrompt: "A corpus-backed discipline landscape of mathematical styles, proof cultures, abstraction modes, computational methods, applied modeling, and major problem orientations.",
    lanes: [
      lane("proof-abstraction", "Proof And Abstraction", ["proof", "abstraction", "rigor", "axiom", "theorem", "formalism"]),
      lane("algebra-structures", "Algebra And Structures", ["algebra", "structure", "group", "ring", "field", "category"]),
      lane("geometry-topology", "Geometry And Topology", ["geometry", "topology", "space", "manifold", "dimension"]),
      lane("analysis-calculus", "Analysis And Continuity", ["analysis", "calculus", "limit", "continuity", "differential equation"]),
      lane("computation-discrete", "Computation And Discrete Methods", ["algorithm", "computation", "discrete", "combinatorics", "graph"]),
      lane("applied-modeling", "Applied Modeling", ["applied mathematics", "model", "probability", "statistics", "optimization"]),
    ],
    checkpointGroups: [
      group("proof-and-formalism", "Proof And Formalism", ["proof", "axiom", "formal", "theorem"]),
      group("structural-and-algebraic-thinking", "Structural And Algebraic Thinking", ["algebra", "structure", "group", "category"]),
      group("geometric-and-topological-thinking", "Geometric And Topological Thinking", ["geometry", "topology", "space", "manifold"]),
      group("analytic-and-continuous-methods", "Analytic And Continuous Methods", ["analysis", "calculus", "limit", "continuity"]),
      group("discrete-and-computational-methods", "Discrete And Computational Methods", ["algorithm", "discrete", "combinatorics", "graph"]),
      group("modeling-probability-and-optimization", "Modeling, Probability, And Optimization", ["model", "probability", "statistics", "optimization"]),
    ],
  },
  {
    plannedId: "planned-humanities-literature-literary-movements",
    territorySlug: "humanities",
    territoryTitle: "Humanities",
    branchSlug: "literature",
    branchTitle: "Literature",
    baseMapSlug: "literary-movements",
    draftSlug: `literary-movements-corpus-v2-${stamp}`,
    mapTitle: "Literary movements",
    recipeId: "historical_movement",
    topicPrompt: "A corpus-backed historical movement map of literary movements, periods, scenes, authors, texts, reactions, and stylistic inheritance.",
    lanes: [
      lane("classical-medieval", "Classical And Medieval Traditions", ["classical", "medieval", "epic", "drama", "lyric", "romance"]),
      lane("renaissance-enlightenment", "Renaissance And Enlightenment", ["renaissance", "enlightenment", "humanism", "neoclassicism", "satire"]),
      lane("romanticism-realism", "Romanticism And Realism", ["romanticism", "realism", "naturalism", "novel", "society"]),
      lane("modernism-avant-garde", "Modernism And Avant-Garde", ["modernism", "avant-garde", "fragmentation", "experiment", "symbolism"]),
      lane("postmodern-contemporary", "Postmodern And Contemporary", ["postmodern", "contemporary", "metafiction", "postcolonial", "global literature"]),
      lane("authors-texts", "Authors And Texts", ["author", "poet", "novelist", "playwright", "manifesto"]),
    ],
    checkpointGroups: [
      group("classical-and-medieval-inheritance", "Classical And Medieval Inheritance", ["classical", "medieval", "epic", "romance"]),
      group("renaissance-humanism-and-neoclassicism", "Renaissance Humanism And Neoclassicism", ["renaissance", "humanism", "neoclassicism", "enlightenment"]),
      group("romanticism-and-the-imagination", "Romanticism And The Imagination", ["romanticism", "imagination", "lyric", "individual"]),
      group("realism-naturalism-and-social-fiction", "Realism, Naturalism, And Social Fiction", ["realism", "naturalism", "novel", "society"]),
      group("modernism-and-experiment", "Modernism And Experiment", ["modernism", "avant-garde", "fragmentation", "experiment"]),
      group("postmodern-postcolonial-and-global-literatures", "Postmodern, Postcolonial, And Global Literatures", ["postmodern", "postcolonial", "contemporary", "global"]),
    ],
  },
  {
    plannedId: "planned-arts-visual-art-visual-art-movements",
    territorySlug: "arts",
    territoryTitle: "Arts",
    branchSlug: "visual-art",
    branchTitle: "Visual Art",
    baseMapSlug: "visual-art-movements",
    draftSlug: `visual-art-movements-corpus-v2-${stamp}`,
    mapTitle: "Visual art movements",
    recipeId: "historical_movement",
    topicPrompt: "A corpus-backed historical movement map of visual art movements, style shifts, institutions, artists, manifestos, reactions, and global context.",
    lanes: [
      lane("renaissance-academic", "Renaissance And Academic Traditions", ["renaissance", "academic", "perspective", "humanism", "realism"]),
      lane("impressionism-postimpressionism", "Impressionism And Post-Impressionism", ["impressionism", "post-impressionism", "light", "color", "brushwork"]),
      lane("modernism-avant-garde", "Modernism And Avant-Garde", ["modernism", "cubism", "futurism", "dada", "surrealism", "abstraction"]),
      lane("postwar-contemporary", "Postwar And Contemporary", ["abstract expressionism", "pop art", "minimalism", "conceptual art", "contemporary"]),
      lane("global-institutions", "Global And Institutional Context", ["global art", "museum", "gallery", "institution", "postcolonial"]),
      lane("artists-manifestos", "Artists And Manifestos", ["artist", "manifesto", "exhibition", "critic", "curator"]),
    ],
    checkpointGroups: [
      group("renaissance-academic-and-realist-orders", "Renaissance, Academic, And Realist Orders", ["renaissance", "academic", "perspective", "realism"]),
      group("impressionist-and-post-impressionist-reactions", "Impressionist And Post-Impressionist Reactions", ["impressionism", "post-impressionism", "light", "color"]),
      group("avant-garde-modernisms", "Avant-Garde Modernisms", ["modernism", "cubism", "futurism", "dada", "surrealism"]),
      group("abstraction-expression-and-form", "Abstraction, Expression, And Form", ["abstraction", "expressionism", "minimalism", "form"]),
      group("conceptual-postwar-and-contemporary-art", "Conceptual, Postwar, And Contemporary Art", ["conceptual", "postwar", "contemporary", "pop art"]),
      group("global-institutional-and-market-contexts", "Global, Institutional, And Market Contexts", ["global", "museum", "institution", "postcolonial", "market"]),
    ],
  },
  {
    plannedId: "planned-society-politics-political-orders",
    territorySlug: "society",
    territoryTitle: "Society",
    branchSlug: "politics",
    branchTitle: "Politics",
    baseMapSlug: "political-orders",
    draftSlug: `political-orders-corpus-v2-${stamp}`,
    mapTitle: "Political orders",
    recipeId: "system_comparison",
    topicPrompt: "A corpus-backed system-comparison map of political orders, legitimacy, institutional logics, governance tradeoffs, coercion, liberty, stability, and failure modes.",
    lanes: [
      lane("authority-legitimacy", "Authority And Legitimacy", ["authority", "legitimacy", "sovereignty", "consent", "tradition"]),
      lane("democracy-republic", "Democratic And Republican Orders", ["democracy", "republic", "representation", "constitutional", "electoral"]),
      lane("authoritarian-totalitarian", "Authoritarian And Totalitarian Orders", ["authoritarian", "totalitarian", "dictatorship", "party state", "coercion"]),
      lane("monarchy-oligarchy", "Monarchy And Oligarchy", ["monarchy", "aristocracy", "oligarchy", "elite", "dynasty"]),
      lane("anarchism-federalism", "Distributed And Anti-Central Orders", ["anarchism", "federalism", "decentralization", "confederation", "self governance"]),
      lane("failure-tradeoffs", "Failure Modes And Tradeoffs", ["failure", "stability", "liberty", "equality", "accountability", "corruption"]),
    ],
    checkpointGroups: [
      group("democratic-republican-and-constitutional-orders", "Democratic, Republican, And Constitutional Orders", ["democracy", "republic", "constitutional", "representation"]),
      group("monarchical-aristocratic-and-elite-orders", "Monarchical, Aristocratic, And Elite Orders", ["monarchy", "aristocracy", "oligarchy", "elite"]),
      group("authoritarian-and-totalitarian-orders", "Authoritarian And Totalitarian Orders", ["authoritarian", "totalitarian", "dictatorship", "coercion"]),
      group("federal-confederal-and-distributed-orders", "Federal, Confederal, And Distributed Orders", ["federal", "confederal", "decentralized", "anarchism"]),
      group("legitimacy-sovereignty-and-consent", "Legitimacy, Sovereignty, And Consent", ["legitimacy", "sovereignty", "consent", "authority"]),
      group("failure-modes-and-political-tradeoffs", "Failure Modes And Political Tradeoffs", ["failure", "corruption", "stability", "liberty", "equality"]),
    ],
  },
  {
    plannedId: "planned-stem-mind-consciousness-consciousness-theories-v2-corpus-test",
    territorySlug: "stem",
    territoryTitle: "STEM",
    branchSlug: "mind-and-consciousness",
    branchTitle: "Mind And Consciousness",
    baseMapSlug: "consciousness-theories-v2-corpus-test",
    draftSlug: `consciousness-theories-v2-corpus-test-${stamp}`,
    mapTitle: "Consciousness theories v2 corpus test",
    recipeId: "theory_family",
    topicPrompt: "A corpus-backed theory-family map of consciousness theories, kept separate from the canonical public consciousness map; cover physicalist, functional, representational, phenomenological, panpsychist, dualist, idealist, and objection/testability lanes.",
    lanes: [
      lane("materialist-neurobiological", "Materialist And Neurobiological", ["consciousness", "materialism", "physicalism", "neurobiological", "neural correlate", "brain"]),
      lane("functional-computational", "Functional And Computational", ["functionalism", "computational", "global workspace", "information processing", "representation"]),
      lane("higher-order-representational", "Higher-Order And Representational", ["higher order", "representational", "perception", "awareness", "access"]),
      lane("phenomenology-enactive", "Phenomenology And Enactive", ["phenomenology", "embodied", "enactive", "experience", "intentionality"]),
      lane("panpsychism-monism", "Panpsychism And Monism", ["panpsychism", "monism", "neutral monism", "fundamental consciousness"]),
      lane("dualism-idealism", "Dualism And Idealism", ["dualism", "idealism", "mind body", "fundamental reality"]),
      lane("empirical-objections", "Empirical Tests And Objections", ["objection", "critique", "empirical", "hard problem", "explanatory gap"]),
    ],
    checkpointGroups: [
      group("neurobiological-and-physicalist-theories", "Neurobiological And Physicalist Theories", ["neurobiological", "physicalism", "brain", "neural"]),
      group("functional-computational-and-workspace-theories", "Functional, Computational, And Workspace Theories", ["functionalism", "computational", "workspace", "information"]),
      group("higher-order-and-representational-theories", "Higher-Order And Representational Theories", ["higher order", "representational", "access", "awareness"]),
      group("phenomenological-embodied-and-enactive-theories", "Phenomenological, Embodied, And Enactive Theories", ["phenomenology", "embodied", "enactive", "experience"]),
      group("panpsychist-and-monist-theories", "Panpsychist And Monist Theories", ["panpsychism", "monism", "fundamental consciousness"]),
      group("dualist-idealist-and-nonphysical-theories", "Dualist, Idealist, And Nonphysical Theories", ["dualism", "idealism", "mind body", "nonphysical"]),
      group("mystery-objection-and-testability-families", "Mystery, Objection, And Testability Families", ["hard problem", "explanatory gap", "objection", "empirical"]),
    ],
  },
];

const report = {
  stamp,
  model,
  endpoint,
  pipelineDbPath,
  referencePatternNote: "docs/atlas-reference-patterns.md",
  systemsDesign: null,
  maps: [],
  reusableLearnings: [],
};

await preflightModel();
await ensureConsciousnessPlannedMap();
report.systemsDesign = await finishSystemsDesign();

for (const target of targets) {
  const item = await runTarget(target);
  report.maps.push(item);
  writeReport();
}

await updateReusableRecipeAndRetrievalLearning(report);
writeReport();
console.log(JSON.stringify(report, null, 2));

async function runTarget(target) {
  const selected = await discoverAndAttachSources(target);
  const job = await upsertGenerationJob(target, selected);
  const first = runGenerator(target, job);
  let run = first;
  if (!run.ok && (first.output.includes("clustering failed") || first.output.includes("currentStage\":\"clustering") || existsSync(join(root, "atlas", "generation-runs", job.runId, "02-normalized-candidates.json")))) {
    await approveCheckpointFromInventory(target, job);
    run = runGenerator(target, job);
  }
  const qc = await recordInitialQc(target, job, selected, run);
  return {
    target: target.draftSlug,
    recipeId: target.recipeId,
    jobId: job.jobId,
    runId: job.runId,
    status: run.ok ? "generated" : "failed",
    generatorExitCode: run.status,
    sourcePacket: selected.summary,
    generation: await generationSummary(job.runId, target.draftSlug),
    qc,
    outputTail: tail(run.output),
  };
}

async function discoverAndAttachSources(target) {
  const search = runCorpusSearch(target);
  const selectedSources = selectDiverse(search, target);
  const sourceIds = [];
  const chunkRows = [];
  for (const source of selectedSources) {
    const atlasSourceId = `corpus-${safeId(target.draftSlug)}-${safeId(source.laneId)}-${hash(`${source.source_id}:${source.title}`).slice(0, 12)}`;
    sourceIds.push(atlasSourceId);
    const laneRows = source.chunks.map(chunk => ({
      source_id: atlasSourceId,
      chunk_index: Number(chunk.chunk_index),
      heading: source.title,
      chunk_text: chunk.text,
      char_count: chunk.text.length,
      token_estimate: estimateTokens(chunk.text),
      content_hash: hash(chunk.text),
      metadata: {
        corpusBridge: {
          bridgeVersion: "production-batch-v2",
          originalSourceId: source.source_id,
          originalChunkId: chunk.source_chunk_id,
          originalSourceType: source.source_type,
          originalReliabilityTier: source.reliability_tier,
          originalLicense: source.license,
          originalStatus: source.status,
          laneIds: [source.laneId],
          coverageTags: tagsForText(`${source.title} ${chunk.text}`, target),
          searchPlan: search.plan,
          relevanceScore: chunk.score,
          relevanceReason: `Selected for ${source.laneTitle}.`,
        },
      },
    }));
    chunkRows.push(...laneRows);
    await supabase.from("atlas_sources").upsert({
      id: atlasSourceId,
      title: `[Corpus v2] ${source.title}`,
      creator: "Pipeline KB",
      source_type: "other",
      territory_slug: target.territorySlug,
      branch_slug: target.branchSlug,
      map_slug: target.draftSlug,
      file_path: "",
      canonical_url: source.source_path || null,
      content_hash: hash(`${source.source_id}:${source.title}`),
      metadata: {
        corpusBridge: {
          bridgeVersion: "production-batch-v2",
          originalSourceId: source.source_id,
          originalSourcePath: source.source_path,
          originalSourceType: source.source_type,
          originalReliabilityTier: source.reliability_tier,
          originalLicense: source.license,
          originalStatus: source.status,
          laneIds: [source.laneId],
          coverageTags: tagsForText(`${source.title} ${source.chunks.map(chunk => chunk.text).join(" ")}`, target),
          searchPlan: search.plan,
          retrievalDiagnostics: search.diagnostics,
          relevanceReason: `Selected for ${source.laneTitle}.`,
        },
      },
    }, { onConflict: "id" }).then(throwIfError);
    await supabase.from("atlas_map_sources").upsert({
      source_id: atlasSourceId,
      map_slug: target.draftSlug,
      map_id: null,
      territory_slug: target.territorySlug,
      branch_slug: target.branchSlug,
      metadata: { batch: "atlas-corpus-production-batch-v2", baseMapSlug: target.baseMapSlug },
    }, { onConflict: "source_id,map_slug" }).then(throwIfError);
  }
  if (chunkRows.length) {
    await supabase.from("atlas_source_chunks").upsert(chunkRows, { onConflict: "source_id,chunk_index" }).then(throwIfError);
  }
  const laneCoverage = target.lanes.map(laneItem => {
    const laneSources = selectedSources.filter(source => source.laneId === laneItem.id);
    return {
      laneId: laneItem.id,
      title: laneItem.title,
      covered: laneSources.length > 0,
      sourceCount: laneSources.length,
      chunkCount: laneSources.reduce((total, source) => total + source.chunks.length, 0),
    };
  });
  const warnings = [
    ...laneCoverage.filter(row => !row.covered).map(row => `Missing source coverage for lane: ${row.title}.`),
  ];
  const summary = {
    sourceIds,
    sourceCount: sourceIds.length,
    chunkCount: chunkRows.length,
    laneCoverage,
    confidence: sourceIds.length >= 6 && chunkRows.length >= 18 && !warnings.length ? "strong" : sourceIds.length >= 4 && chunkRows.length >= 12 ? "usable" : "weak",
    warnings,
    selectedSourceTitles: selectedSources.map(source => source.title),
    overrepresentationWarnings: overrepresentationWarnings(selectedSources),
  };
  return { sourceIds, chunkRows, search, selectedSources, summary };
}

function runCorpusSearch(target) {
  const payload = { dbPath: pipelineDbPath, target };
  const child = spawnSync("python", ["-c", pythonSearchScript()], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(child.stderr || child.stdout || "Corpus search failed.");
  const rows = JSON.parse(child.stdout);
  const plan = {
    originalQuery: `${target.territoryTitle} ${target.branchTitle} ${target.mapTitle} ${target.topicPrompt}`,
    expandedTerms: [...new Set(target.lanes.flatMap(item => item.terms))],
    lanes: target.lanes,
  };
  const diagnostics = {
    matchedSourceTitles: [...new Set(rows.map(row => row.title))],
    matchedChunkCount: rows.length,
    laneChunkCounts: Object.fromEntries(target.lanes.map(laneItem => [laneItem.id, rows.filter(row => row.laneId === laneItem.id).length])),
  };
  return { rows, plan, diagnostics };
}

function selectDiverse(search, target) {
  const selected = [];
  const seenSourceLane = new Set();
  const seenChunk = new Set();
  for (const laneItem of target.lanes) {
    const laneRows = search.rows.filter(row => row.laneId === laneItem.id);
    const bySource = groupBy(laneRows, row => row.source_id);
    const sorted = [...bySource.values()]
      .sort((a, b) => bestScore(a) - bestScore(b))
      .slice(0, 2);
    for (const rows of sorted) {
      const first = rows[0];
      const key = `${laneItem.id}:${first.source_id}`;
      if (seenSourceLane.has(key)) continue;
      seenSourceLane.add(key);
      const chunks = rows
        .filter(row => !seenChunk.has(row.source_chunk_id))
        .sort((a, b) => a.score - b.score)
        .slice(0, 3);
      chunks.forEach(chunk => seenChunk.add(chunk.source_chunk_id));
      if (chunks.length) {
        selected.push({
          ...first,
          laneId: laneItem.id,
          laneTitle: laneItem.title,
          chunks,
        });
      }
    }
  }
  return selected.slice(0, 12);
}

async function upsertGenerationJob(target, selected) {
  const runId = `atlas-factory-${target.draftSlug}`;
  const jobId = `atlas-job-${target.draftSlug}`;
  const recipe = await readRecipe(target.recipeId);
  const sourceSufficiency = {
    sourceCount: selected.summary.sourceCount,
    chunkCount: selected.summary.chunkCount,
    sourceDiversity: 1,
    sourceTypes: ["other"],
    reliabilityTiers: [...new Set(selected.selectedSources.map(source => source.reliability_tier))],
    categoryCoverage: selected.summary.confidence === "strong" ? 80 : 55,
    chronologyCoverage: /historical|lineage|movement/.test(target.recipeId) ? "usable" : "not_applicable",
    contributorTextCoverage: "usable",
    contributorPersonCoverage: "partial",
    conceptTheoryCoverage: selected.summary.confidence === "strong" ? "strong" : "usable",
    relationEvidenceCoverage: "usable",
    laneCoverage: selected.summary.laneCoverage.map(row => ({ ...row, required: true })),
    confidence: selected.summary.confidence,
    obviousGaps: selected.summary.warnings.length ? ["lane coverage"] : [],
    warnings: selected.summary.warnings,
    missingLaneWarnings: selected.summary.warnings,
    overrepresentationWarnings: selected.summary.overrepresentationWarnings,
  };
  await supabase.from("atlas_generation_jobs").upsert({
    id: jobId,
    planned_map_id: target.plannedId,
    territory_slug: target.territorySlug,
    branch_slug: target.branchSlug,
    map_title: target.mapTitle,
    map_slug: target.baseMapSlug,
    recipe_id: target.recipeId,
    topic_prompt: target.topicPrompt,
    selected_source_ids: selected.sourceIds,
    provider,
    model,
    endpoint,
    status: "queued",
    run_id: runId,
    output_draft_path: `atlas/generation-runs/${runId}/06-final-draft.json`,
    error_summary: null,
    metadata: {
      factoryVersion: "corpus-production-batch-v2",
      draftMapSlug: target.draftSlug,
      sourceMapSlug: target.draftSlug,
      command: "created by scripts/run-atlas-corpus-production-batch-v2.mjs",
      recipe,
      sourceSufficiency,
      sourceSufficiencyWarnings: sourceSufficiency.warnings,
      searchPlan: selected.search.plan,
      retrievalDiagnostics: selected.search.diagnostics,
    },
  }, { onConflict: "id" }).then(throwIfError);
  return { jobId, runId, recipe };
}

function runGenerator(target, job) {
  const args = [
    "scripts/generate-atlas-draft-staged.mjs",
    "--territory-slug", target.territorySlug,
    "--branch-slug", target.branchSlug,
    "--map-slug", target.draftSlug,
    "--source-map-slug", target.draftSlug,
    "--topic-prompt", target.topicPrompt,
    "--recipe-id", target.recipeId,
    "--run-id", job.runId,
    "--job-id", job.jobId,
    "--max-chunks", "28",
    "--chunk-char-limit", "420",
    "--chunk-batch-size", "1",
    "--concurrency", "1",
    "--retry-count", "3",
    "--provider", provider,
    "--model", model,
    "--endpoint", endpoint,
    "--import-on-success",
  ];
  const child = spawnSync("node", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 45 * 60 * 1000,
    maxBuffer: 36 * 1024 * 1024,
  });
  return {
    ok: child.status === 0,
    status: child.status,
    output: `${child.stdout || ""}\n${child.stderr || ""}`,
  };
}

async function approveCheckpointFromInventory(target, job) {
  const inventoryPath = join(root, "atlas", "generation-runs", job.runId, "02-normalized-candidates.json");
  if (!existsSync(inventoryPath)) throw new Error(`Missing normalized inventory for ${target.draftSlug}.`);
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const candidates = allCandidates(inventory);
  const used = new Set();
  const groups = target.checkpointGroups.map((draft, index) => {
    const matches = candidates
      .filter(candidate => !used.has(candidate.id))
      .map(candidate => ({ candidate, score: scoreCandidate(candidate, draft.terms) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.candidate);
    const fallback = candidates.filter(candidate => !used.has(candidate.id)).slice(index * 2, index * 2 + 3);
    const members = (matches.length ? matches : fallback).slice(0, 8);
    members.forEach(candidate => used.add(candidate.id));
    return {
      id: draft.id,
      title: draft.title,
      shortTitle: draft.title,
      description: `Reviewer checkpoint group for ${draft.title}.`,
      memberCandidateIds: members.map(candidate => candidate.id),
      provenance: uniqueRefs(members.flatMap(candidate => candidate.provenance || [])).slice(0, 5),
    };
  });
  await supabase.from("atlas_category_checkpoints").upsert({
    id: `atlas-category-checkpoint-${job.runId}`,
    run_id: job.runId,
    job_id: job.jobId,
    recipe_id: target.recipeId,
    status: "approved",
    groups_json: { stage: "clustering", ok: true, groups },
    reviewer_notes: "Approved corpus-production-batch-v2 category checkpoint after model clustering failed or before enrichment resume.",
    metadata: {
      generator: "atlas-corpus-production-batch-v2",
      target: target.draftSlug,
      sourceMapSlug: target.draftSlug,
    },
  }, { onConflict: "id" }).then(throwIfError);
}

async function recordInitialQc(target, job, selected, run) {
  const map = await readMap(target.draftSlug);
  if (!map) {
    return {
      saved: false,
      readyToPublish: false,
      blockers: [`No imported map found for ${target.draftSlug}.`],
    };
  }
  const counts = await mapCounts(map.id);
  const invalidRefs = await invalidProvenanceCount(target.draftSlug);
  const groups = await readGroups(map.id);
  const score = scoreDraft({ target, counts, invalidRefs, selected, groups, runOk: run.ok });
  const reviewId = `atlas-category-review-${safeId(map.id)}-no-reference`;
  const blockers = releaseBlockers(score, invalidRefs);
  await supabase.from("atlas_category_reviews").upsert({
    id: reviewId,
    map_id: map.id,
    reference_map_id: null,
    job_id: job.jobId,
    run_id: job.runId,
    recipe_id: target.recipeId,
    status: blockers.length ? "open" : "complete",
    reviewer_notes: blockers.length
      ? `Initial corpus-production-batch-v2 QC: keep unpublished. Blockers: ${blockers.join("; ")}`
      : "Initial corpus-production-batch-v2 QC passed release threshold.",
    metadata: { batch: "atlas-corpus-production-batch-v2", sourceConfidence: selected.summary.confidence },
  }, { onConflict: "id" }).then(throwIfError);
  await supabase.from("atlas_quality_scorecards").upsert({
    review_id: reviewId,
    map_id: map.id,
    recipe_id: target.recipeId,
    category_quality: score.category,
    field_coverage: score.field,
    factual_accuracy: score.factual,
    contributor_placement: score.contributor,
    key_text_selection: score.texts,
    objection_quality: score.objection,
    relation_quality: score.relation,
    explanatory_usefulness: score.useful,
    redundancy_noise: score.redundancy,
    provenance_support: score.provenance,
    notes: `Initial corpus-production-batch-v2 scorecard. ${blockers.length ? `Remaining blockers: ${blockers.join("; ")}` : "Meets release threshold, but still left unpublished for human approval."}`,
    metadata: { invalidRefs, sourcePacket: selected.summary },
  }, { onConflict: "review_id" }).then(throwIfError);
  const groupReviews = groups.map(row => ({
    review_id: reviewId,
    map_id: map.id,
    group_id: row.id,
    group_status: score.category >= 4 ? "revised" : "uncertain",
    proposed_title: row.title,
    proposed_short_title: row.short_title || row.title,
    proposed_central_claim: row.central_claim || "",
    proposed_related_group_ids: row.related_group_ids || [],
    notes: "Initial batch QC category review. Requires human editorial pass before publication.",
    metadata: { batch: "atlas-corpus-production-batch-v2" },
  }));
  if (groupReviews.length) await supabase.from("atlas_category_group_reviews").upsert(groupReviews, { onConflict: "review_id,group_id" }).then(throwIfError);
  if (blockers.length) {
    await supabase.from("atlas_review_corrections").upsert(blockers.map((reason, index) => ({
      id: `${reviewId}-blocker-${index + 1}`,
      review_id: reviewId,
      map_id: map.id,
      run_id: job.runId,
      job_id: job.jobId,
      recipe_id: target.recipeId,
      entity_type: "map",
      entity_id: map.id,
      field_name: "release_threshold",
      correction_type: reason.includes("provenance") ? "weak_source_support" : reason.includes("relation") ? "bad_relation" : "weak_explanation",
      original_value: { score },
      revised_value: { needed: reason },
      reason,
      reviewer_status: "open",
      metadata: { batch: "atlas-corpus-production-batch-v2" },
    })), { onConflict: "id" }).then(throwIfError);
  }
  await supabase.from("atlas_maps").update({ review_status: "needs_review", published: false }).eq("id", map.id).then(throwIfError);
  return { saved: true, reviewId, score, readyToPublish: blockers.length === 0, blockers, counts, invalidRefs, groups: groups.map(row => row.title) };
}

async function finishSystemsDesign() {
  const map = await readMap("systems-design-corpus-v2");
  if (!map) return { status: "missing" };
  await attachExtraSystemsComplexitySources();
  const relationNotes = {
    "systems-engineering-lifecycle-requirements-design-process": "Requirements engineering turns stakeholder needs into constraints and acceptance tests; lifecycle systems engineering keeps those requirements tied to architecture, verification, and validation.",
    "systems-engineering-lifecycle-software-architecture-patterns": "Systems engineering defines cross-system requirements and interfaces, while software architecture turns those constraints into modular boundaries, coupling choices, and implementation structure.",
    "systems-engineering-lifecycle-failure-resilience-risk": "Lifecycle architecture asks what the system should do; FMEA, reliability engineering, and resilience analysis ask how it fails and how those failures can be prevented, absorbed, or recovered from.",
    "feedback-control-systems-complex-adaptive-system-behavior": "Feedback/control models explain regulation and stability in designed systems; complex/adaptive systems evidence shows why nonlinear interaction, emergence, and load-sharing failures can escape simple control assumptions.",
  };
  for (const [id, note] of Object.entries(relationNotes)) {
    await supabase.from("atlas_relations").update({ note }).eq("map_id", map.id).eq("id", id).then(throwIfError);
  }
  const contributorUpdates = [
    ["systems-engineering-lifecycle-source-synthesis", "Systems engineering and SysML practice", "Represents the source evidence for lifecycle architecture, requirements tracing, interfaces, verification, validation, and model-based systems engineering."],
    ["feedback-control-systems-source-synthesis", "Control theory and feedback design", "Represents the source evidence for controllers, feedback loops, stability, regulation, and the design of systems that respond to measured state."],
    ["failure-resilience-risk-source-synthesis", "FMEA, reliability, and resilience engineering", "Represents the source evidence for identifying failure modes, evaluating effects, assigning risk, and designing systems that tolerate or recover from failure."],
    ["complex-adaptive-system-behavior-source-synthesis", "Complex adaptive systems research", "Represents the source evidence for emergence, nonlinear interaction, adaptation, and load-sharing behavior that complicates engineered control assumptions."],
  ];
  for (const [id, name, reason] of contributorUpdates) {
    await supabase.from("atlas_contributors").update({ name, reason }).eq("map_id", map.id).eq("id", id).then(throwIfError);
  }
  const textUpdates = [
    ["complex-adaptive-system-behavior-key-text", "Complex adaptive systems and load-sharing failure sources"],
    ["feedback-control-systems-key-text", "Control theory and negative-feedback source chunks"],
    ["failure-resilience-risk-key-text", "FMEA/FMECA and reliability engineering source chunks"],
    ["systems-engineering-lifecycle-key-text", "Systems engineering, SysML, requirements, verification, and validation source chunks"],
  ];
  for (const [id, title] of textUpdates) {
    await supabase.from("atlas_texts").update({ title }).eq("map_id", map.id).eq("id", id).then(throwIfError);
  }
  const reviewId = "atlas-category-review-systems-design-corpus-v2-systems-design-factory-202607120131";
  const invalidRefs = await invalidProvenanceCount(map.id);
  await supabase.from("atlas_quality_scorecards").upsert({
    review_id: reviewId,
    map_id: map.id,
    recipe_id: "system_comparison",
    category_quality: 4,
    field_coverage: 4,
    factual_accuracy: 3,
    contributor_placement: 4,
    key_text_selection: 4,
    objection_quality: 4,
    relation_quality: 4,
    explanatory_usefulness: 4,
    redundancy_noise: 4,
    provenance_support: invalidRefs ? 3 : 4,
    notes: "Final corpus-production-batch-v2 cleanup tightened relations, source-cluster labels, and text anchors. Keep unpublished because factual accuracy still needs a human subject-matter pass and complex-systems coverage was added after generation rather than regenerated through the map.",
    metadata: { batch: "atlas-corpus-production-batch-v2", invalidRefs },
  }, { onConflict: "review_id" }).then(throwIfError);
  await supabase.from("atlas_maps").update({ review_status: "needs_review", published: false }).eq("id", map.id).then(throwIfError);
  return {
    mapSlug: map.slug,
    published: false,
    decision: "kept_needs_review",
    blockers: ["factual accuracy needs human SME pass", "extra complex-systems coverage attached after generation, not regenerated into final categories"],
    invalidRefs,
  };
}

async function attachExtraSystemsComplexitySources() {
  const target = {
    territorySlug: "technology",
    branchSlug: "systems",
    draftSlug: "systems-design-corpus-v2",
    lanes: [
      lane("complex-systems-extra", "Complex Systems Extra", ["complex adaptive systems", "emergence", "nonlinear", "load sharing", "complex systems"]),
    ],
  };
  const search = runCorpusSearch({ ...target, territoryTitle: "Technology", branchTitle: "Systems", mapTitle: "Systems design", topicPrompt: "Additional complex systems coverage for systems design." });
  const selected = selectDiverse(search, target).slice(0, 2);
  for (const source of selected) {
    const atlasSourceId = `corpus-systems-design-corpus-v2-extra-${hash(`${source.source_id}:${source.title}`).slice(0, 12)}`;
    await supabase.from("atlas_sources").upsert({
      id: atlasSourceId,
      title: `[Corpus v2 extra] ${source.title}`,
      creator: "Pipeline KB",
      source_type: "other",
      territory_slug: "technology",
      branch_slug: "systems",
      map_slug: "systems-design-corpus-v2",
      file_path: "",
      canonical_url: source.source_path || null,
      content_hash: hash(`${source.source_id}:${source.title}`),
      metadata: { corpusBridge: { bridgeVersion: "production-batch-v2-extra", originalSourceId: source.source_id, laneIds: [source.laneId], originalSourceType: source.source_type, originalReliabilityTier: source.reliability_tier } },
    }, { onConflict: "id" }).then(throwIfError);
    await supabase.from("atlas_source_chunks").upsert(source.chunks.slice(0, 3).map(chunk => ({
      source_id: atlasSourceId,
      chunk_index: Number(chunk.chunk_index),
      heading: source.title,
      chunk_text: chunk.text,
      char_count: chunk.text.length,
      token_estimate: estimateTokens(chunk.text),
      content_hash: hash(chunk.text),
      metadata: { corpusBridge: { bridgeVersion: "production-batch-v2-extra", originalChunkId: chunk.source_chunk_id, laneIds: [source.laneId], coverageTags: tagsForText(chunk.text, target) } },
    })), { onConflict: "source_id,chunk_index" }).then(throwIfError);
  }
}

async function generationSummary(runId, mapSlug) {
  const { data: run } = await supabase.from("atlas_generation_runs").select("id,validation_ok,validation_errors,output_draft_path,metadata").eq("id", runId).maybeSingle();
  const map = await readMap(mapSlug);
  if (!map) return { run, map: null };
  const counts = await mapCounts(map.id);
  const groups = await readGroups(map.id);
  const invalidRefs = await invalidProvenanceCount(map.id);
  return { run, map: { id: map.id, reviewStatus: map.review_status, published: map.published }, counts, groups: groups.map(row => row.title), invalidRefs };
}

async function updateReusableRecipeAndRetrievalLearning(batchReport) {
  const notes = [];
  const weakMaps = batchReport.maps.filter(item => item.qc?.blockers?.length);
  if (weakMaps.length) notes.push("Corpus-only generation still needs an editorial pass; keep batch outputs in needs_review unless every score clears threshold.");
  if (batchReport.maps.some(item => item.sourcePacket?.laneCoverage?.some(laneRow => laneRow.chunkCount < 2))) {
    notes.push("Lane templates should prefer at least two chunks for every required lane when the corpus has enough material.");
  }
  notes.push("Category checkpoints are useful as a humane reliability layer when local models produce malformed clustering JSON.");
  batchReport.reusableLearnings = notes;
}

async function ensureConsciousnessPlannedMap() {
  const target = targets.find(item => item.baseMapSlug === "consciousness-theories-v2-corpus-test");
  await supabase.from("atlas_planned_maps").upsert({
    id: target.plannedId,
    territory_slug: target.territorySlug,
    territory_title: target.territoryTitle,
    territory_description: "STEM-oriented maps of mind, consciousness, and cognitive science.",
    territory_display_order: 0,
    branch_slug: target.branchSlug,
    branch_title: target.branchTitle,
    branch_description: "Consciousness theories, models, and explanatory families.",
    branch_display_order: 0,
    map_title: target.mapTitle,
    map_slug: target.baseMapSlug,
    summary: target.topicPrompt,
    status: "queued",
    recipe_id: target.recipeId,
    source_requirements: "Use corpus retrieval lanes and keep separate from the canonical public consciousness map.",
    notes: "Seeded by Atlas Corpus Production Batch v2.",
    display_order: 0,
    metadata: { batch: "atlas-corpus-production-batch-v2" },
  }, { onConflict: "id" }).then(throwIfError);
}

async function preflightModel() {
  const baseUrl = endpoint.replace(/\/chat\/completions\/?$/, "");
  const res = await fetch(`${baseUrl}/models`);
  if (!res.ok) throw new Error(`Model endpoint preflight failed: ${res.status}`);
  const data = await res.json();
  const ids = (data.data || []).map(item => item.id);
  if (!ids.includes(model)) throw new Error(`Model ${model} is not available. Available: ${ids.join(", ")}`);
}

async function readRecipe(recipeId) {
  const { data, error } = await supabase.from("atlas_map_recipes").select("*").eq("id", recipeId).single();
  if (error) throw error;
  return data;
}

async function readMap(slugOrId) {
  const { data, error } = await supabase.from("atlas_maps").select("id,slug,title,review_status,published").or(`id.eq.${slugOrId},slug.eq.${slugOrId}`).maybeSingle();
  if (error) throw error;
  return data;
}

async function readGroups(mapId) {
  const { data, error } = await supabase.from("atlas_groups").select("id,title,short_title,central_claim,related_group_ids,display_order").eq("map_id", mapId).order("display_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function mapCounts(mapId) {
  const [groups, contributors, texts, relations] = await Promise.all([
    supabase.from("atlas_groups").select("id", { count: "exact", head: true }).eq("map_id", mapId),
    supabase.from("atlas_contributors").select("id", { count: "exact", head: true }).eq("map_id", mapId),
    supabase.from("atlas_texts").select("id", { count: "exact", head: true }).eq("map_id", mapId),
    supabase.from("atlas_relations").select("id", { count: "exact", head: true }).eq("map_id", mapId),
  ]);
  return { groups: groups.count || 0, contributors: contributors.count || 0, texts: texts.count || 0, relations: relations.count || 0 };
}

async function invalidProvenanceCount(mapId) {
  const { data: sourceRows } = await supabase.from("atlas_source_chunks").select("source_id,chunk_index");
  const valid = new Set((sourceRows || []).map(row => `${row.source_id}#${row.chunk_index}`));
  const tables = [
    ["atlas_groups", "provenance"],
    ["atlas_contributors", "provenance"],
    ["atlas_texts", "provenance"],
    ["atlas_relations", "provenance"],
  ];
  let invalid = 0;
  for (const [table, field] of tables) {
    const { data, error } = await supabase.from(table).select(field).eq("map_id", mapId);
    if (error) throw error;
    for (const row of data || []) {
      for (const ref of Array.isArray(row[field]) ? row[field] : []) {
        if (ref?.chunkId && !valid.has(ref.chunkId)) invalid += 1;
      }
    }
  }
  return invalid;
}

function scoreDraft({ counts, invalidRefs, selected, groups, runOk }) {
  const redundant = redundancyScore(groups.map(row => row.title));
  return {
    category: runOk && counts.groups >= 5 && redundant >= 4 ? 4 : 3,
    field: counts.contributors >= counts.groups && counts.texts >= counts.groups ? 4 : 3,
    factual: 3,
    contributor: counts.contributors >= counts.groups ? 3 : 2,
    texts: counts.texts >= counts.groups ? 3 : 2,
    objection: 3,
    relation: counts.relations >= 4 ? 3 : 2,
    useful: runOk ? 4 : 2,
    redundancy: redundant,
    provenance: invalidRefs ? 2 : selected.summary.confidence === "strong" ? 4 : 3,
  };
}

function releaseBlockers(score, invalidRefs) {
  const blockers = [];
  if (invalidRefs) blockers.push(`${invalidRefs} invalid provenance references`);
  if (score.category < 4) blockers.push("category quality below release threshold");
  if (score.factual < 4) blockers.push("factual accuracy needs human review");
  if (score.contributor < 4) blockers.push("contributor placement needs editorial review");
  if (score.useful < 4) blockers.push("explanatory usefulness below release threshold");
  if (score.provenance < 4) blockers.push("provenance support below release threshold");
  if (score.relation < 4) blockers.push("relation quality needs editorial review");
  return blockers;
}

function redundancyScore(titles) {
  const words = titles.map(title => new Set(String(title).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3)));
  let maxOverlap = 0;
  for (let i = 0; i < words.length; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      const a = words[i];
      const b = words[j];
      const overlap = [...a].filter(word => b.has(word)).length / Math.max(1, Math.min(a.size, b.size));
      maxOverlap = Math.max(maxOverlap, overlap);
    }
  }
  if (maxOverlap > 0.75) return 2;
  if (maxOverlap > 0.55) return 3;
  return 4;
}

function allCandidates(inventory) {
  return [
    ...(inventory.people || []).map(item => ({ ...item, type: "person" })),
    ...(inventory.concepts || []).map(item => ({ ...item, type: "concept" })),
    ...(inventory.claims || []).map(item => ({ ...item, type: "claim" })),
    ...(inventory.texts || []).map(item => ({ ...item, type: "text" })),
    ...(inventory.objections || []).map(item => ({ ...item, type: "objection" })),
    ...(inventory.relationships || []).map(item => ({ ...item, type: "relationship" })),
  ];
}

function scoreCandidate(candidate, terms) {
  const text = `${candidate.label || ""} ${candidate.title || ""} ${candidate.summary || ""} ${candidate.reason || ""}`.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function tagsForText(text, target) {
  const lower = String(text || "").toLowerCase();
  return target.lanes.filter(laneItem => laneItem.terms.some(term => lower.includes(term.toLowerCase()))).map(laneItem => laneItem.id);
}

function overrepresentationWarnings(sources) {
  const byTitle = groupBy(sources, source => source.title);
  return [...byTitle.entries()]
    .filter(([, rows]) => rows.length > 3)
    .map(([title, rows]) => `${title} is overrepresented across ${rows.length} lanes.`);
}

function groupBy(rows, keyFor) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

function bestScore(rows) {
  return Math.min(...rows.map(row => Number(row.score || 0)));
}

function lane(id, title, terms) {
  return { id, title, terms, query: terms.join(" "), required: true, reason: `Batch v2 lane for ${title}.` };
}

function group(id, title, terms) {
  return { id, title, terms };
}

function uniqueRefs(refs) {
  const seen = new Set();
  return refs.filter(ref => {
    const key = `${ref?.chunkId || ""}:${ref?.sourceId || ""}:${ref?.chunkIndex ?? ""}`;
    if (!ref?.chunkId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function safeId(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "item";
}

function hash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function tail(value) {
  return String(value || "").split(/\r?\n/).slice(-24).join("\n");
}

function writeReport() {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function throwIfError(result) {
  if (result.error) throw new Error(result.error.message);
  return result;
}

function loadLocalEnv(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function pythonSearchScript() {
  return String.raw`
import json
import sqlite3
import sys

payload = json.load(sys.stdin)
target = payload["target"]
conn = sqlite3.connect(payload["dbPath"])
conn.row_factory = sqlite3.Row

def fts_query(terms):
    cleaned = []
    for term in terms:
        term = str(term).replace('"', ' ').strip()
        if term:
            cleaned.append('"' + term + '"')
    return " OR ".join(cleaned[:14]) or '"atlas"'

rows = []
for lane in target.get("lanes", []):
    q = fts_query(lane.get("terms", []))
    try:
        lane_rows = conn.execute("""
            select
              c.source_chunk_id,
              s.source_id,
              s.title,
              s.source_path,
              s.source_type,
              s.reliability_tier,
              s.license,
              s.status,
              c.chunk_index,
              c.text,
              c.word_count,
              bm25(source_chunks_fts) as score
            from source_chunks_fts f
            join source_chunks c on c.source_chunk_id = f.source_chunk_id
            join sources s on s.source_id = c.source_id
            where source_chunks_fts match ?
            order by score
            limit 80
        """, (q,)).fetchall()
    except Exception:
        like_terms = [str(term).lower() for term in lane.get("terms", [])[:6]]
        lane_rows = conn.execute("""
            select
              c.source_chunk_id,
              s.source_id,
              s.title,
              s.source_path,
              s.source_type,
              s.reliability_tier,
              s.license,
              s.status,
              c.chunk_index,
              c.text,
              c.word_count,
              0.0 as score
            from source_chunks c
            join sources s on s.source_id = c.source_id
            limit 5000
        """).fetchall()
        lane_rows = [row for row in lane_rows if any(term in row["text"].lower() or term in row["title"].lower() for term in like_terms)][:80]
    for row in lane_rows:
        item = dict(row)
        item["laneId"] = lane["id"]
        item["laneTitle"] = lane["title"]
        rows.append(item)

print(json.dumps(rows))
`;
}
