import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertAtlasMapSpec,
  atlasMapsData,
} from "../lib/atlasMaps.ts";

const root = process.cwd();
loadLocalEnv(".env.local");
loadLocalEnv(".env");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const mapFilter = getArgValue("--map");
const spec = mapFilter ? filterSpecToMap(atlasMapsData, mapFilter) : atlasMapsData;

assertAtlasMapSpec(spec);

const rows = flattenAtlasMapSpec(spec);
const counts = {
  territories: rows.territories.length,
  branches: rows.branches.length,
  maps: rows.maps.length,
  groups: rows.groups.length,
  contributors: rows.contributors.length,
  texts: rows.texts.length,
  relations: rows.relations.length,
};

if (dryRun) {
  console.log("Dry run: AtlasMapSpec is valid and ready to import.");
  Object.entries(counts).forEach(([name, count]) => console.log(`- ${name}: ${count}`));
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
  await ensureAtlasTablesReady();
  await upsertRows("atlas_territories", rows.territories, "id");
  await upsertRows("atlas_branches", rows.branches, "id");
  await upsertRows("atlas_maps", rows.maps, "id");
  await upsertRows("atlas_groups", rows.groups, "map_id,id");
  await upsertRows("atlas_contributors", rows.contributors, "map_id,group_id,id");
  await upsertRows("atlas_texts", rows.texts, "map_id,group_id,contributor_id,id");
  await upsertRows("atlas_relations", rows.relations, "map_id,id");

  console.log("Imported AtlasMapSpec into Supabase.");
  Object.entries(counts).forEach(([name, count]) => console.log(`- ${name}: ${count}`));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Atlas import failed.");
  process.exit(1);
}

function flattenAtlasMapSpec(value) {
  const now = new Date().toISOString();
  const territories = [];
  const branches = [];
  const maps = [];
  const groups = [];
  const contributors = [];
  const texts = [];
  const relations = [];

  value.territories.forEach((territory, territoryIndex) => {
    territories.push({
      id: territory.id,
      slug: territory.slug,
      title: territory.title,
      summary: territory.summary,
      display_order: territoryIndex,
      published: true,
      metadata: sourceMetadata(value, now),
    });

    territory.branches.forEach((branch, branchIndex) => {
      branches.push({
        id: branch.id,
        territory_id: territory.id,
        slug: branch.slug,
        title: branch.title,
        summary: branch.summary,
        display_order: branchIndex,
        published: true,
        metadata: sourceMetadata(value, now),
      });

      branch.maps.forEach((map, mapIndex) => {
        maps.push({
          id: map.id,
          branch_id: branch.id,
          slug: map.slug,
          title: map.title,
          subtitle: map.subtitle,
          question: map.question,
          summary: map.summary,
          status: map.status,
          build_mode: map.buildMode,
          review_status: "published",
          schema_version: value.schemaVersion,
          display_order: mapIndex,
          published: true,
          metadata: sourceMetadata(value, now),
        });

        map.groups.forEach((group, groupIndex) => {
          groups.push({
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
            metadata: sourceMetadata(value, now),
          });

          group.contributors.forEach((contributor, contributorIndex) => {
            contributors.push({
              map_id: map.id,
              group_id: group.id,
              id: contributor.id,
              name: contributor.name,
              role: contributor.role,
              reason: contributor.reason,
              provenance: contributor.provenance || [],
              display_order: contributorIndex,
              metadata: sourceMetadata(value, now),
            });

            contributor.texts.forEach((text, textIndex) => {
              texts.push({
                map_id: map.id,
                group_id: group.id,
                contributor_id: contributor.id,
                id: text.id,
                title: text.title,
                kind: text.kind || "other",
                provenance: text.provenance || [],
                display_order: textIndex,
                metadata: sourceMetadata(value, now),
              });
            });
          });
        });

        map.relations.forEach((relation, relationIndex) => {
          relations.push({
            map_id: map.id,
            id: relation.id,
            source_id: relation.source,
            target_id: relation.target,
            kind: relation.kind,
            note: relation.note,
            provenance: relation.provenance || [],
            display_order: relationIndex,
            metadata: sourceMetadata(value, now),
          });
        });
      });
    });
  });

  return { territories, branches, maps, groups, contributors, texts, relations };
}

function sourceMetadata(spec, importedAt) {
  return {
    source: "lib/atlasMaps.ts",
    specUpdatedAt: spec.updatedAt,
    importedAt,
  };
}

function filterSpecToMap(spec, mapIdOrSlug) {
  const wanted = mapIdOrSlug.trim();
  const territories = spec.territories
    .map(territory => ({
      ...territory,
      branches: territory.branches
        .map(branch => ({
          ...branch,
          maps: branch.maps.filter(map => map.id === wanted || map.slug === wanted),
        }))
        .filter(branch => branch.maps.length),
    }))
    .filter(territory => territory.branches.length);

  if (!territories.length) {
    throw new Error(`No Atlas map found for "${mapIdOrSlug}".`);
  }

  return {
    ...spec,
    territories,
  };
}

async function ensureAtlasTablesReady() {
  const { error } = await supabase.from("atlas_territories").select("id").limit(1);
  if (!error) return;

  throw new Error(`Atlas tables are not ready: ${error.message}\nApply supabase/jju_atlas_maps_schema.sql first, then rerun this importer.`);
}

async function upsertRows(table, items, onConflict) {
  if (!items.length) return;

  const { error } = await supabase.from(table).upsert(items, { onConflict });
  if (error) throw new Error(`Could not upsert ${table}: ${error.message}`);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length) || "";
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
