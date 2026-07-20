import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { validateAtlasMapSpec } from "../lib/atlasMaps.ts";

const root = process.cwd();
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
  console.error("Missing required grounded generation inputs.");
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

const runId = `atlas-grounded-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
const outputPath = resolveOutputPath(getOption("output", "out") || `${mapSlug}-atlas-map-spec.json`);
const outputDraftPath = normalizePath(relative(root, outputPath));

try {
  const sourcePacket = await loadSourcePacket({
    territorySlug,
    branchSlug,
    mapSlug,
    sourceMapSlug,
    maxChunks,
  });

  if (!sourcePacket.chunks.length) {
    throw new Error(`No Atlas source chunks found for ${territorySlug} / ${branchSlug} / ${sourceMapSlug || mapSlug}.`);
  }

  const spec = buildAtlasMapSpec({
    territorySlug,
    branchSlug,
    mapSlug,
    topicPrompt,
    sourcePacket,
  });
  const validationIssues = validateAtlasMapSpec(spec);
  const validationErrors = validationIssues.map(issue => `${issue.path}: ${issue.message}`);
  const validationOk = validationErrors.length === 0;

  if (validationOk) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  }

  await recordGenerationRun({
    runId,
    territorySlug,
    branchSlug,
    mapSlug,
    topicPrompt,
    sourcePacket,
    outputDraftPath: validationOk ? outputDraftPath : null,
    validationOk,
    validationErrors,
  });

  if (!validationOk) {
    console.error("Generated AtlasMapSpec is invalid:");
    validationErrors.forEach(error => console.error(`- ${error}`));
    process.exit(1);
  }

  const map = spec.territories[0].branches[0].maps[0];
  console.log("Generated grounded AtlasMapSpec draft.");
  console.log(`- run: ${runId}`);
  console.log(`- file: ${outputPath}`);
  console.log(`- draft map: ${map.title} (${map.slug})`);
  console.log(`- source ids: ${sourcePacket.sources.map(source => source.id).join(", ")}`);
  console.log(`- chunks used: ${sourcePacket.chunks.length}`);
  console.log(`- groups: ${map.groups.length}`);
  console.log(`- relations: ${map.relations.length}`);
  console.log("Validation passed.");
  console.log("Not imported. Not published.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Grounded Atlas generation failed.");
  process.exit(1);
}

async function loadSourcePacket(input) {
  const exactSources = await loadSourcesForMapSlug(input.sourceMapSlug);
  const fallbackSources = exactSources.length ? exactSources : await loadSourcesForMapSlug(input.mapSlug);
  const sources = fallbackSources.length ? fallbackSources : await loadSourcesForBranch();

  if (!sources.length) {
    return { sources: [], chunks: [], sourceMapSlug: input.sourceMapSlug };
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
    .map(chunk => ({
      sourceId: String(chunk.source_id || ""),
      chunkIndex: Number(chunk.chunk_index || 0),
      heading: String(chunk.heading || ""),
      text: String(chunk.chunk_text || ""),
      charCount: Number(chunk.char_count || 0),
      tokenEstimate: Number(chunk.token_estimate || 0),
    }))
    .filter(chunk => chunk.sourceId && chunk.text.trim())
    .slice(0, input.maxChunks);

  return {
    sources,
    chunks,
    sourceMapSlug: input.sourceMapSlug,
    packetHash: hashText(chunks.map(chunk => `${chunk.sourceId}:${chunk.chunkIndex}:${chunk.text}`).join("\n\n")),
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

function buildAtlasMapSpec({ territorySlug, branchSlug, mapSlug, topicPrompt, sourcePacket }) {
  const branchTitle = titleFromSlug(branchSlug);
  const territoryTitle = titleFromSlug(territorySlug);
  const mapTitle = titleFromSlug(sourcePacket.sourceMapSlug || mapSlug);
  const groups = buildGroupsFromChunks(sourcePacket.chunks);

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    territories: [
      {
        id: territorySlug,
        slug: territorySlug,
        title: territoryTitle,
        summary: `${territoryTitle} source-grounded Atlas drafts and review material.`,
        branches: [
          {
            id: branchSlug,
            slug: branchSlug,
            title: branchTitle,
            summary: `${branchTitle} source-grounded drafts built from ingested Atlas source chunks.`,
            maps: [
              {
                id: mapSlug,
                slug: mapSlug,
                title: mapTitle,
                subtitle: "A source-grounded review draft.",
                question: questionFor(mapTitle, topicPrompt),
                summary: summaryFor(topicPrompt, sourcePacket),
                status: "queued",
                buildMode: "pipeline-ready",
                groups,
                relations: buildRelations(groups),
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildGroupsFromChunks(chunks) {
  const groupChunks = chunks
    .filter(chunk => chunk.heading && !/source brief/i.test(chunk.heading))
    .filter(chunk => /(physical|material|ideal|dual|substance|hylomorph|process|becoming|neutral|panpsych|pragmat|critique)/i.test(chunk.heading));

  const usableChunks = groupChunks.length >= 5 ? groupChunks : chunks.filter(chunk => chunk.heading).slice(0, 8);

  return usableChunks.slice(0, 10).map((chunk, index) => {
    const title = normalizeGroupTitle(chunk.heading || `Source group ${index + 1}`);
    const id = uniqueGroupSlug(title, index);
    const text = stripMarkdown(chunk.text, chunk.heading);
    const sentences = splitSentences(text);
    const pressure = pressurePointFrom(text);
    const contributors = contributorsForGroup(title, text, chunk);

    return {
      id,
      slug: id,
      title,
      shortTitle: shortTitleFor(title),
      family: familyFor(title),
      stance: trimSentence(sentences[0] || `${title} is presented as a major family in the ingested source packet.`),
      centralClaim: trimSentence(sentences[1] || `${title} gives one answer to the map's guiding metaphysical problem.`),
      whyItMatters: trimSentence(sentences[2] || `The source packet marks ${title.toLowerCase()} as necessary for comparing the major positions in this map.`),
      contributors,
      objections: pressure.length ? pressure : [
        `Review whether the source packet gives enough evidence for ${title.toLowerCase()}.`,
        "Add primary source citations before publishing this generated draft.",
      ],
      relatedGroupIds: [],
      keywords: keywordsFor(title, text),
    };
  }).map((group, index, groups) => ({
    ...group,
    relatedGroupIds: relatedIds(groups, index),
  }));
}

function contributorsForGroup(title, text, chunk) {
  const names = knownContributorsFor(title, text);
  const sourceTextTitle = `Source chunk: ${chunk.heading || title}`;

  if (!names.length) {
    return [
      {
        id: `${toSlug(title)}-source-cluster`,
        name: `${title} source cluster`,
        role: "source-grounded placeholder",
        reason: `This generated contributor placeholder is grounded in ${chunk.sourceId} chunk ${chunk.chunkIndex}.`,
        texts: [{ id: toSlug(sourceTextTitle), title: sourceTextTitle, kind: "other" }],
      },
    ];
  }

  return names.map(name => ({
    id: toSlug(name),
    name,
    role: roleForContributor(name, title),
    reason: reasonForContributor(name, title, chunk),
    texts: textsForContributor(name, sourceTextTitle),
  }));
}

function knownContributorsFor(title, text) {
  const candidates = [
    "Thomas Hobbes",
    "J. J. C. Smart",
    "David Armstrong",
    "George Berkeley",
    "Immanuel Kant",
    "G. W. F. Hegel",
    "Plato",
    "Rene Descartes",
    "Elisabeth of Bohemia",
    "Aristotle",
    "Thomas Aquinas",
    "Heraclitus",
    "Alfred North Whitehead",
    "Henri Bergson",
    "Baruch Spinoza",
    "Bertrand Russell",
    "William James",
    "Charles Sanders Peirce",
    "John Dewey",
    "Rudolf Carnap",
  ];

  const haystack = `${title}\n${text}`.toLowerCase();
  return candidates.filter(name => haystack.includes(name.toLowerCase()) || nameAliases(name).some(alias => haystack.includes(alias)));
}

function nameAliases(name) {
  const aliases = {
    "Thomas Hobbes": ["hobbes"],
    "J. J. C. Smart": ["smart", "identity theorists"],
    "David Armstrong": ["armstrong", "identity theorists"],
    "George Berkeley": ["berkeley"],
    "Immanuel Kant": ["kant"],
    "G. W. F. Hegel": ["hegel"],
    "Rene Descartes": ["descartes"],
    "Elisabeth of Bohemia": ["elisabeth"],
    "Thomas Aquinas": ["aquinas"],
    "Alfred North Whitehead": ["whitehead"],
    "Henri Bergson": ["bergson"],
    "Baruch Spinoza": ["spinoza"],
    "Bertrand Russell": ["russell"],
    "William James": ["james"],
    "Charles Sanders Peirce": ["peirce"],
    "John Dewey": ["dewey"],
    "Rudolf Carnap": ["carnap"],
  };
  return aliases[name] || [name.toLowerCase()];
}

function textsForContributor(name, sourceTextTitle) {
  const knownTexts = {
    "Thomas Hobbes": [["Leviathan", "book"]],
    "J. J. C. Smart": [["Sensations and Brain Processes", "essay"]],
    "David Armstrong": [["A Materialist Theory of the Mind", "book"]],
    "George Berkeley": [["A Treatise Concerning the Principles of Human Knowledge", "book"]],
    "Immanuel Kant": [["Critique of Pure Reason", "book"]],
    "G. W. F. Hegel": [["Phenomenology of Spirit", "book"]],
    Plato: [["Phaedo", "dialogue"], ["Republic", "dialogue"]],
    "Rene Descartes": [["Meditations on First Philosophy", "book"]],
    "Elisabeth of Bohemia": [["Correspondence with Descartes", "other"]],
    Aristotle: [["Metaphysics", "book"]],
    "Thomas Aquinas": [["On Being and Essence", "essay"]],
    Heraclitus: [["Fragments", "other"]],
    "Alfred North Whitehead": [["Process and Reality", "book"]],
    "Henri Bergson": [["Creative Evolution", "book"]],
    "Baruch Spinoza": [["Ethics", "book"]],
    "Bertrand Russell": [["The Analysis of Matter", "book"]],
    "William James": [["Essays in Radical Empiricism", "essay"]],
    "Charles Sanders Peirce": [["How to Make Our Ideas Clear", "essay"]],
    "John Dewey": [["Experience and Nature", "book"]],
    "Rudolf Carnap": [["The Elimination of Metaphysics Through Logical Analysis of Language", "essay"]],
  };

  return (knownTexts[name] || [[sourceTextTitle, "other"]]).map(([title, kind]) => ({
    id: toSlug(title),
    title,
    kind,
  }));
}

function roleForContributor(name, title) {
  if (/source cluster/i.test(name)) return "source placeholder";
  return `${shortTitleFor(title).toLowerCase()} reference`;
}

function reasonForContributor(name, title, chunk) {
  return `${name} appears in the ingested ${title.toLowerCase()} source chunk as a reference point for this family. Source: ${chunk.sourceId} chunk ${chunk.chunkIndex}.`;
}

function buildRelations(groups) {
  const relationPairs = [
    [0, 1, "opposes"],
    [0, 2, "answers"],
    [2, 5, "reframes"],
    [3, 4, "reframes"],
    [4, 6, "neighbors"],
    [5, 1, "borrows"],
  ];

  return relationPairs
    .filter(([sourceIndex, targetIndex]) => groups[sourceIndex] && groups[targetIndex])
    .map(([sourceIndex, targetIndex, kind]) => {
      const source = groups[sourceIndex];
      const target = groups[targetIndex];
      return {
        id: `${source.id}-to-${target.id}`,
        source: source.id,
        target: target.id,
        kind,
        note: `Source-grounded draft relation between ${source.shortTitle} and ${target.shortTitle}; review the source packet before publishing.`,
      };
    });
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
    provider: "local-script",
    model: "grounded-deterministic-v0",
    validation_ok: input.validationOk,
    validation_errors: input.validationErrors,
    metadata: {
      sourceMapSlug: input.sourcePacket.sourceMapSlug,
      sourceCount: input.sourcePacket.sources.length,
      chunkCount: input.sourcePacket.chunks.length,
      sourcePacketHash: input.sourcePacket.packetHash || "",
      chunks: input.sourcePacket.chunks.map(chunk => ({
        sourceId: chunk.sourceId,
        chunkIndex: chunk.chunkIndex,
        heading: chunk.heading,
        charCount: chunk.charCount,
        tokenEstimate: chunk.tokenEstimate,
      })),
    },
  }, { onConflict: "id" });

  if (error) throw new Error(`Could not record Atlas generation run: ${error.message}`);
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

function sourceSlugForDraft(value) {
  return value
    .replace(/-(grounded|generated)-v\d+$/i, "")
    .replace(/-v\d+$/i, "");
}

function questionFor(mapTitle, topicPrompt) {
  const cleanedPrompt = topicPrompt.trim().replace(/\s+/g, " ");
  if (cleanedPrompt.endsWith("?")) return cleanedPrompt;
  return `What are the major families inside ${mapTitle.toLowerCase()}, and what pressure point does each family expose?`;
}

function summaryFor(topicPrompt, sourcePacket) {
  const sourceTitles = sourcePacket.sources.map(source => source.title).filter(Boolean).join("; ");
  return `Source-grounded draft based on ${sourcePacket.chunks.length} ingested chunk(s). Prompt: ${topicPrompt.trim()} Sources: ${sourceTitles || "Atlas source packet"}.`;
}

function pressurePointFrom(text) {
  const match = text.match(/pressure point is\s+([^.\n]+(?:\.[^.\n]+)?)/i);
  if (match?.[1]) return [trimSentence(match[1])];

  return splitSentences(text)
    .filter(sentence => /\b(pressure|problem|objection|difficult|risk|ask whether|challenge)\b/i.test(sentence))
    .slice(0, 2)
    .map(trimSentence);
}

function normalizeGroupTitle(value) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueGroupSlug(title, index) {
  const slug = toSlug(title);
  return slug || `source-group-${index + 1}`;
}

function shortTitleFor(title) {
  const replacements = {
    "Physicalism and materialism": "Physicalism",
    "Substance and hylomorphism": "Substance",
    "Neutral monism and panpsychism": "Neutral monism",
    "Pragmatism and metaphysical critique": "Pragmatism",
  };
  if (replacements[title]) return replacements[title];

  return title
    .replace(/\s+metaphysics$/i, "")
    .split(/\s+and\s+|,\s*/)
    .filter(Boolean)[0]
    .trim();
}

function familyFor(title) {
  const lower = title.toLowerCase();
  if (lower.includes("physical") || lower.includes("material")) return "Naturalist metaphysics";
  if (lower.includes("ideal")) return "Mind-first metaphysics";
  if (lower.includes("dual")) return "Two-principle metaphysics";
  if (lower.includes("substance") || lower.includes("hylomorph")) return "Form-and-substance metaphysics";
  if (lower.includes("process") || lower.includes("becoming")) return "Becoming-first metaphysics";
  if (lower.includes("neutral") || lower.includes("panpsych")) return "Mind-matter bridge metaphysics";
  if (lower.includes("pragmat") || lower.includes("critique")) return "Use-and-critique metaphysics";
  return `${title} family`;
}

function keywordsFor(title, text) {
  const base = [
    ...title.toLowerCase().split(/[^a-z0-9]+/),
    ...text.toLowerCase().match(/\b(mind|matter|substance|process|experience|reality|causation|identity|critique|pressure)\b/g) || [],
  ];
  return [...new Set(base.filter(Boolean))].slice(0, 10);
}

function relatedIds(groups, index) {
  return [
    groups[(index + groups.length - 1) % groups.length]?.id,
    groups[(index + 1) % groups.length]?.id,
  ].filter(Boolean);
}

function stripMarkdown(value, heading = "") {
  const headingPattern = heading ? new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*`, "im") : null;
  const withoutHeading = headingPattern ? value.replace(headingPattern, "") : value;

  return withoutHeading
    .replace(/^---[\s\S]*?---/m, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, match => match.replace(/^\[|\]\([^)]+\)$/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSentences(value) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function trimSentence(value) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 280 ? `${text.slice(0, 277).replace(/\s+\S*$/, "")}...` : text;
}

function titleFromSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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

function toSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  npm run atlas:generate-from-sources -- \\
    --territory-slug humanities \\
    --branch-slug philosophy \\
    --map-slug metaphysics-families-grounded-v0 \\
    --source-map-slug metaphysics-families \\
    --topic-prompt "Map the major metaphysical families from ingested source chunks." \\
    --max-chunks 8

Optional:
  --output atlas/drafts/custom-file.json
`);
}
