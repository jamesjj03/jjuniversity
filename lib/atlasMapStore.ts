import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import {
  assertAtlasMapSpec,
  getAtlasMaps as getStaticAtlasMaps,
  type AtlasBranch,
  type AtlasContributor,
  type AtlasGroup,
  type AtlasMap,
  type AtlasMapBuildMode,
  type AtlasMapSpec,
  type AtlasMapStatus,
  type AtlasMapsData,
  type AtlasRelation,
  type AtlasRelationKind,
  type AtlasTerritory,
  type AtlasText,
} from "@/lib/atlasMaps";

type TimestampedRow = {
  updated_at?: string | null;
};

type AtlasTerritoryRow = TimestampedRow & {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  display_order: number | null;
};

type AtlasBranchRow = TimestampedRow & {
  id: string;
  territory_id: string;
  slug: string;
  title: string;
  summary: string | null;
  display_order: number | null;
};

type AtlasMapRow = TimestampedRow & {
  id: string;
  branch_id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  question: string | null;
  summary: string | null;
  status: string | null;
  build_mode: string | null;
  display_order: number | null;
};

type AtlasGroupRow = TimestampedRow & {
  map_id: string;
  id: string;
  slug: string;
  title: string;
  short_title: string | null;
  family: string | null;
  stance: string | null;
  central_claim: string | null;
  why_it_matters: string | null;
  objections: string[] | null;
  related_group_ids: string[] | null;
  keywords: string[] | null;
  display_order: number | null;
};

type AtlasContributorRow = TimestampedRow & {
  map_id: string;
  group_id: string;
  id: string;
  name: string;
  role: string | null;
  reason: string | null;
  display_order: number | null;
};

type AtlasTextRow = TimestampedRow & {
  map_id: string;
  group_id: string;
  contributor_id: string;
  id: string;
  title: string;
  kind: string | null;
  display_order: number | null;
};

type AtlasRelationRow = TimestampedRow & {
  map_id: string;
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  note: string | null;
  display_order: number | null;
};

const ATLAS_TABLE_PATTERN = /atlas_(territories|branches|maps|groups|contributors|texts|relations)/i;

const TERRITORY_SELECT = "id,slug,title,summary,display_order,updated_at";
const BRANCH_SELECT = "id,territory_id,slug,title,summary,display_order,updated_at";
const MAP_SELECT = "id,branch_id,slug,title,subtitle,question,summary,status,build_mode,display_order,updated_at";
const GROUP_SELECT = "map_id,id,slug,title,short_title,family,stance,central_claim,why_it_matters,objections,related_group_ids,keywords,display_order,updated_at";
const CONTRIBUTOR_SELECT = "map_id,group_id,id,name,role,reason,display_order,updated_at";
const TEXT_SELECT = "map_id,group_id,contributor_id,id,title,kind,display_order,updated_at";
const RELATION_SELECT = "map_id,id,source_id,target_id,kind,note,display_order,updated_at";

export function isMissingAtlasMapTables(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");

  return code === "42P01"
    || code === "PGRST205"
    || ATLAS_TABLE_PATTERN.test(message)
    || /could not find .*atlas_/i.test(message);
}

export async function readAtlasMapSpecFromSupabase(): Promise<AtlasMapSpec | null> {
  if (!hasSupabaseAdminConfig()) return null;

  try {
    const supabase = createSupabaseAdminClient();
    const [
      territoryResult,
      branchResult,
      mapResult,
      groupResult,
      contributorResult,
      textResult,
      relationResult,
    ] = await Promise.all([
      supabase.from("atlas_territories").select(TERRITORY_SELECT).eq("published", true).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_branches").select(BRANCH_SELECT).eq("published", true).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_maps").select(MAP_SELECT).eq("published", true).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_groups").select(GROUP_SELECT).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_contributors").select(CONTRIBUTOR_SELECT).order("display_order", { ascending: true }).order("name", { ascending: true }),
      supabase.from("atlas_texts").select(TEXT_SELECT).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_relations").select(RELATION_SELECT).order("display_order", { ascending: true }).order("id", { ascending: true }),
    ]);

    const results = [territoryResult, branchResult, mapResult, groupResult, contributorResult, textResult, relationResult];
    const failed = results.find(result => result.error);
    if (failed?.error) {
      if (isMissingAtlasMapTables(failed.error)) return null;
      return null;
    }

    const territoryRows = (territoryResult.data || []) as AtlasTerritoryRow[];
    const branchRows = (branchResult.data || []) as AtlasBranchRow[];
    const mapRows = (mapResult.data || []) as AtlasMapRow[];
    const groupRows = (groupResult.data || []) as AtlasGroupRow[];
    const contributorRows = (contributorResult.data || []) as AtlasContributorRow[];
    const textRows = (textResult.data || []) as AtlasTextRow[];
    const relationRows = (relationResult.data || []) as AtlasRelationRow[];

    if (!territoryRows.length) return null;

    const territoryIds = new Set(territoryRows.map(row => row.id));
    const branchIds = new Set(branchRows.filter(row => territoryIds.has(row.territory_id)).map(row => row.id));
    const mapIds = new Set(mapRows.filter(row => branchIds.has(row.branch_id)).map(row => row.id));

    const textsByContributor = groupBy(textRows.filter(row => mapIds.has(row.map_id)), row => contributorKey(row.map_id, row.group_id, row.contributor_id));
    const contributorsByGroup = groupBy(contributorRows.filter(row => mapIds.has(row.map_id)), row => groupKey(row.map_id, row.group_id));
    const groupsByMap = groupBy(groupRows.filter(row => mapIds.has(row.map_id)), row => row.map_id);
    const relationsByMap = groupBy(relationRows.filter(row => mapIds.has(row.map_id)), row => row.map_id);
    const mapsByBranch = groupBy(mapRows.filter(row => branchIds.has(row.branch_id)), row => row.branch_id);
    const branchesByTerritory = groupBy(branchRows.filter(row => territoryIds.has(row.territory_id)), row => row.territory_id);

    const territories: AtlasTerritory[] = territoryRows
      .map((territory): AtlasTerritory => ({
        id: territory.id,
        slug: territory.slug,
        title: territory.title,
        summary: String(territory.summary || ""),
        branches: sorted(branchesByTerritory.get(territory.id) || []).map((branch): AtlasBranch => ({
          id: branch.id,
          slug: branch.slug,
          title: branch.title,
          summary: String(branch.summary || ""),
          maps: sorted(mapsByBranch.get(branch.id) || []).map((map): AtlasMap => ({
            id: map.id,
            slug: map.slug,
            title: map.title,
            subtitle: String(map.subtitle || ""),
            question: String(map.question || ""),
            summary: String(map.summary || ""),
            status: toMapStatus(map.status),
            buildMode: toBuildMode(map.build_mode),
            groups: sorted(groupsByMap.get(map.id) || []).map((group): AtlasGroup => ({
              id: group.id,
              slug: group.slug,
              title: group.title,
              shortTitle: String(group.short_title || ""),
              family: String(group.family || ""),
              stance: String(group.stance || ""),
              centralClaim: String(group.central_claim || ""),
              whyItMatters: String(group.why_it_matters || ""),
              contributors: sorted(contributorsByGroup.get(groupKey(group.map_id, group.id)) || []).map((contributor): AtlasContributor => ({
                id: contributor.id,
                name: contributor.name,
                role: String(contributor.role || ""),
                reason: String(contributor.reason || ""),
                texts: sorted(textsByContributor.get(contributorKey(contributor.map_id, contributor.group_id, contributor.id)) || []).map(rowToAtlasText),
              })),
              objections: stringArray(group.objections),
              relatedGroupIds: stringArray(group.related_group_ids),
              keywords: stringArray(group.keywords),
            })),
            relations: sorted(relationsByMap.get(map.id) || []).map((relation): AtlasRelation => ({
              id: relation.id,
              source: relation.source_id,
              target: relation.target_id,
              kind: relation.kind as AtlasRelationKind,
              note: String(relation.note || ""),
            })),
          })),
        })),
      }))
      .filter(territory => territory.branches.length);

    if (!territories.length) return null;

    const spec: AtlasMapSpec = {
      schemaVersion: 1,
      updatedAt: latestUpdatedAt([
        ...territoryRows,
        ...branchRows,
        ...mapRows,
        ...groupRows,
        ...contributorRows,
        ...textRows,
        ...relationRows,
      ]),
      territories,
    };

    assertAtlasMapSpec(spec);
    return spec;
  } catch {
    return null;
  }
}

export async function readPublishedAtlasMapSpecFromSupabase(mapIdOrSlug: string): Promise<AtlasMapSpec | null> {
  const spec = await readAtlasMapSpecFromSupabase();
  if (!spec) return null;

  const wanted = mapIdOrSlug.trim();
  if (!wanted) return null;

  const territories = spec.territories
    .map((territory): AtlasTerritory => ({
      ...territory,
      branches: territory.branches
        .map((branch): AtlasBranch => ({
          ...branch,
          maps: branch.maps.filter(map => map.id === wanted || map.slug === wanted),
        }))
        .filter(branch => branch.maps.length),
    }))
    .filter(territory => territory.branches.length);

  if (!territories.length) return null;

  const filteredSpec: AtlasMapSpec = {
    ...spec,
    territories,
  };
  assertAtlasMapSpec(filteredSpec);
  return filteredSpec;
}

export async function getAtlasMapsWithFallback(): Promise<AtlasMapsData> {
  const supabaseSpec = await readAtlasMapSpecFromSupabase();
  return supabaseSpec || getStaticAtlasMaps();
}

function groupKey(mapId: string, groupId: string) {
  return `${mapId}\u0000${groupId}`;
}

function contributorKey(mapId: string, groupId: string, contributorId: string) {
  return `${mapId}\u0000${groupId}\u0000${contributorId}`;
}

function groupBy<Row>(rows: Row[], keyFor: (row: Row) => string) {
  const groups = new Map<string, Row[]>();
  rows.forEach(row => {
    const key = keyFor(row);
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  });
  return groups;
}

function sorted<Row extends { display_order: number | null; id?: string; title?: string; name?: string }>(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const orderDelta = Number(a.display_order || 0) - Number(b.display_order || 0);
    if (orderDelta !== 0) return orderDelta;
    return String(a.title || a.name || a.id || "").localeCompare(String(b.title || b.name || b.id || ""));
  });
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function rowToAtlasText(row: AtlasTextRow): AtlasText {
  const kind = toTextKind(row.kind);
  return {
    id: row.id,
    title: row.title,
    ...(kind ? { kind } : {}),
  };
}

function toMapStatus(value: string | null): AtlasMapStatus {
  return value === "live" ? "live" : "queued";
}

function toBuildMode(value: string | null): AtlasMapBuildMode {
  return value === "seeded" ? "seeded" : "pipeline-ready";
}

function toTextKind(value: string | null): AtlasText["kind"] | undefined {
  if (value === "book" || value === "essay" || value === "paper" || value === "dialogue" || value === "lecture") {
    return value;
  }
  return undefined;
}

function latestUpdatedAt(rows: TimestampedRow[]) {
  const latest = rows.reduce((max, row) => {
    const timestamp = Date.parse(String(row.updated_at || ""));
    return Number.isFinite(timestamp) && timestamp > max ? timestamp : max;
  }, 0);

  return latest > 0 ? new Date(latest).toISOString() : getStaticAtlasMaps().updatedAt;
}
