import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "atlas", "sources");
const supportedExtensions = new Set([".md", ".txt", ".json"]);
const sourceTypes = new Set(["book", "article", "note", "manual", "seed", "web", "other"]);
const maxChunkChars = 1800;

loadLocalEnv(".env.local");
loadLocalEnv(".env");

const args = parseArgs(process.argv.slice(2));
const dryRun = args.has("dry-run");
const targetPath = args.get("path") || args.get("source") || sourceRoot;
const resolvedTarget = resolveInputPath(targetPath);

if (!existsSync(sourceRoot)) mkdirSync(sourceRoot, { recursive: true });
if (!existsSync(resolvedTarget)) {
  console.error(`Atlas source path does not exist: ${resolvedTarget}`);
  process.exit(1);
}

const files = (await collectSourceFiles(resolvedTarget)).sort();
if (!files.length) {
  console.log("No Atlas source files found.");
  console.log(`- root: ${sourceRoot}`);
  process.exit(0);
}

const documents = files.map(readSourceDocument);
const sourceRows = documents.map(documentToSourceRow);
const chunkRows = documents.flatMap(documentToChunkRows);
const mapSourceRows = documents
  .filter(document => document.mapSlug)
  .map(documentToMapSourceRow);

const counts = {
  files: documents.length,
  sources: sourceRows.length,
  chunks: chunkRows.length,
  mapSources: mapSourceRows.length,
};

if (dryRun) {
  console.log("Dry run: Atlas sources are ready to ingest.");
  printCounts(counts);
  sourceRows.forEach(source => console.log(`- ${source.id}: ${source.title}`));
  process.exit(0);
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

try {
  await ensureSourceTablesReady();
  await upsertRows("atlas_sources", sourceRows, "id");
  await replaceChunks(chunkRows);
  await upsertRows("atlas_map_sources", mapSourceRows, "source_id,map_slug");

  console.log("Ingested Atlas sources into Supabase.");
  printCounts(counts);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Atlas source ingest failed.");
  process.exit(1);
}

async function collectSourceFiles(path) {
  const current = statSync(path);
  if (current.isFile()) return supportedExtensions.has(extname(path).toLowerCase()) ? [path] : [];

  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase())) return [fullPath];
    return [];
  }));
  return files.flat();
}

function readSourceDocument(filePath) {
  const extension = extname(filePath).toLowerCase();
  const raw = readFileSync(filePath, "utf8");
  const relativePath = normalizePath(relative(sourceRoot, filePath));
  const pathParts = relativePath.split("/");
  const territorySlug = toSlug(pathParts[0] || "");
  const branchSlug = toSlug(pathParts[1] || "");
  const fallbackMapSlug = toSlug(pathParts[pathParts.length - 1].replace(/\.[^.]+$/, ""));

  const parsed = extension === ".json"
    ? parseJsonSource(raw)
    : parseTextSource(raw, extension);
  const metadata = {
    ...parsed.metadata,
    extension,
    relativePath,
  };

  const sourceId = toSlug(parsed.metadata.id || relativePath.replace(/\.[^.]+$/, ""));
  const mapSlug = toSlug(parsed.metadata.mapSlug || parsed.metadata.map_slug || fallbackMapSlug);

  return {
    id: sourceId,
    title: String(parsed.metadata.title || firstHeading(parsed.text) || titleFromSlug(fallbackMapSlug)),
    creator: String(parsed.metadata.author || parsed.metadata.creator || ""),
    sourceType: normalizeSourceType(parsed.metadata.sourceType || parsed.metadata.source_type || "note"),
    territorySlug: toSlug(parsed.metadata.territorySlug || parsed.metadata.territory_slug || territorySlug),
    branchSlug: toSlug(parsed.metadata.branchSlug || parsed.metadata.branch_slug || branchSlug),
    mapSlug,
    filePath: `atlas/sources/${relativePath}`,
    canonicalUrl: stringOrNull(parsed.metadata.canonicalUrl || parsed.metadata.canonical_url || parsed.metadata.url),
    text: parsed.text,
    metadata,
  };
}

function resolveInputPath(inputPath) {
  return isAbsolute(inputPath) ? inputPath : resolve(root, inputPath);
}

function parseTextSource(raw, extension) {
  const { metadata, body } = parseFrontmatter(raw);
  return {
    metadata: {
      ...metadata,
      sourceType: metadata.sourceType || metadata.source_type || (extension === ".md" ? "note" : "other"),
    },
    text: body.trim(),
  };
}

function parseJsonSource(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return {
      metadata: { sourceType: "seed" },
      text: parsed.map(item => typeof item === "string" ? item : JSON.stringify(item, null, 2)).join("\n\n"),
    };
  }

  if (parsed && typeof parsed === "object") {
    const metadata = parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {};
    const text = typeof parsed.text === "string"
      ? parsed.text
      : Array.isArray(parsed.chunks)
        ? parsed.chunks.map(chunk => typeof chunk === "string" ? chunk : chunk.text || JSON.stringify(chunk, null, 2)).join("\n\n")
        : JSON.stringify(parsed, null, 2);

    return {
      metadata: {
        ...parsed,
        ...metadata,
        text: undefined,
        chunks: undefined,
        metadata: undefined,
        sourceType: parsed.sourceType || parsed.source_type || metadata.sourceType || metadata.source_type || "seed",
      },
      text: text.trim(),
    };
  }

  return { metadata: { sourceType: "other" }, text: String(parsed || "") };
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { metadata: {}, body: raw };

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { metadata: {}, body: raw };

  const metadata = {};
  match[1].split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf(":");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key) metadata[key] = value;
  });

  return { metadata, body: raw.slice(match[0].length) };
}

function documentToSourceRow(document) {
  return {
    id: document.id,
    title: document.title,
    creator: document.creator,
    source_type: document.sourceType,
    territory_slug: document.territorySlug,
    branch_slug: document.branchSlug,
    map_slug: document.mapSlug,
    file_path: document.filePath,
    canonical_url: document.canonicalUrl,
    content_hash: hashText(document.text),
    metadata: document.metadata,
  };
}

function documentToChunkRows(document) {
  return chunkText(document.text).map((chunk, index) => ({
    source_id: document.id,
    chunk_index: index,
    heading: chunk.heading,
    chunk_text: chunk.text,
    char_count: chunk.text.length,
    token_estimate: estimateTokens(chunk.text),
    content_hash: hashText(chunk.text),
    metadata: {
      sourceTitle: document.title,
      territorySlug: document.territorySlug,
      branchSlug: document.branchSlug,
      mapSlug: document.mapSlug,
    },
  }));
}

function documentToMapSourceRow(document) {
  return {
    source_id: document.id,
    map_slug: document.mapSlug,
    territory_slug: document.territorySlug,
    branch_slug: document.branchSlug,
    metadata: {
      sourceTitle: document.title,
      filePath: document.filePath,
    },
  };
}

function chunkText(raw) {
  const sections = splitSections(raw);
  const chunks = [];

  sections.forEach(section => {
    const paragraphs = section.text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    let current = "";
    paragraphs.forEach(paragraph => {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (candidate.length <= maxChunkChars) {
        current = candidate;
        return;
      }

      if (current) chunks.push({ heading: section.heading, text: current });
      current = paragraph;

      while (current.length > maxChunkChars) {
        const slice = current.slice(0, maxChunkChars);
        const splitAt = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(", "));
        const end = splitAt > 600 ? splitAt + 1 : maxChunkChars;
        chunks.push({ heading: section.heading, text: current.slice(0, end).trim() });
        current = current.slice(end).trim();
      }
    });

    if (current) chunks.push({ heading: section.heading, text: current });
  });

  return chunks.length ? chunks : [{ heading: "", text: raw.trim() }];
}

function splitSections(raw) {
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let heading = "";
  let buffer = [];

  lines.forEach(line => {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      if (buffer.join("\n").trim()) {
        sections.push({ heading, text: buffer.join("\n").trim() });
      }
      heading = match[2].trim();
      buffer = [line];
      return;
    }

    buffer.push(line);
  });

  if (buffer.join("\n").trim()) {
    sections.push({ heading, text: buffer.join("\n").trim() });
  }

  return sections;
}

async function ensureSourceTablesReady() {
  const { error } = await supabase.from("atlas_sources").select("id").limit(1);
  if (!error) return;

  throw new Error(`Atlas source tables are not ready: ${error.message}\nApply supabase/jju_atlas_source_ingest_schema.sql first, then rerun this ingest.`);
}

async function replaceChunks(rows) {
  const sourceIds = [...new Set(rows.map(row => row.source_id))];
  for (const sourceId of sourceIds) {
    const { error } = await supabase.from("atlas_source_chunks").delete().eq("source_id", sourceId);
    if (error) throw new Error(`Could not clear chunks for ${sourceId}: ${error.message}`);
  }

  await upsertRows("atlas_source_chunks", rows, "source_id,chunk_index");
}

async function upsertRows(table, rows, onConflict) {
  if (!rows.length) return;

  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`Could not upsert ${table}: ${error.message}`);
}

function normalizeSourceType(value) {
  const normalized = toSlug(String(value || "other")).replace(/-/g, "_");
  return sourceTypes.has(normalized) ? normalized : "other";
}

function firstHeading(text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function titleFromSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function stringOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function toSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function printCounts(value) {
  Object.entries(value).forEach(([name, count]) => console.log(`- ${name}: ${count}`));
}

function parseArgs(rawArgs) {
  const parsed = new Map();
  rawArgs.forEach((arg, index) => {
    if (!arg.startsWith("--")) return;
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    const nextValue = rawArgs[index + 1];
    if (inlineValue !== undefined) parsed.set(name, inlineValue);
    else if (nextValue && !nextValue.startsWith("--")) parsed.set(name, nextValue);
    else parsed.set(name, "true");
  });
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
