import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { validateAtlasMapSpec, type AtlasMapSpec, type AtlasProvenanceRef } from "@/lib/atlasMaps";
import {
  attachAtlasCorpusCandidatesToPlannedMap,
  readAtlasCorpusBridgeState,
  readSelectedAtlasSourceSufficiency,
  type AtlasCorpusBridgeOptions,
  type AtlasCorpusBridgeState,
  type AtlasCorpusCoverageLevel,
  type AtlasSourceSufficiency,
} from "@/lib/atlasCorpusBridge";

export type AtlasReviewStatus = "draft" | "needs_review" | "published" | "archived";

export const ATLAS_REVIEW_STATUSES: AtlasReviewStatus[] = ["draft", "needs_review", "published", "archived"];

export type AtlasAdminMapListItem = {
  id: string;
  slug: string;
  title: string;
  atlasStatus: string;
  reviewStatus: AtlasReviewStatus;
  published: boolean;
  updatedAt: string;
  territoryId: string;
  territoryTitle: string;
  branchId: string;
  branchTitle: string;
  groupCount: number;
  relationCount: number;
};

export type AtlasAdminText = {
  id: string;
  title: string;
  kind: string;
  provenance: AtlasProvenanceRef[];
};

export type AtlasAdminContributor = {
  id: string;
  name: string;
  role: string;
  reason: string;
  texts: AtlasAdminText[];
  provenance: AtlasProvenanceRef[];
};

export type AtlasAdminGroup = {
  id: string;
  slug: string;
  title: string;
  shortTitle: string;
  family: string;
  stance: string;
  centralClaim: string;
  whyItMatters: string;
  objections: string[];
  relatedGroupIds: string[];
  keywords: string[];
  contributors: AtlasAdminContributor[];
  provenance: AtlasProvenanceRef[];
};

export type AtlasAdminRelation = {
  id: string;
  source: string;
  target: string;
  kind: string;
  note: string;
  provenance: AtlasProvenanceRef[];
};

export type AtlasAdminMapDetail = AtlasAdminMapListItem & {
  subtitle: string;
  question: string;
  summary: string;
  buildMode: string;
  groups: AtlasAdminGroup[];
  relations: AtlasAdminRelation[];
};

export type AtlasAdminSourceItem = {
  id: string;
  title: string;
  creator: string;
  sourceType: string;
  territorySlug: string;
  branchSlug: string;
  mapSlug: string;
  filePath: string;
  canonicalUrl: string;
  updatedAt: string;
  chunkCount: number;
  charCount: number;
  tokenEstimate: number;
};

export type AtlasAdminSourceState = {
  sources: AtlasAdminSourceItem[];
  totalSources: number;
  totalChunks: number;
  totalChars: number;
  error?: string;
  tablesMissing?: boolean;
  configMissing?: boolean;
};

export type AtlasMapRecipe = {
  id: string;
  title: string;
  purpose: string;
  groupingLogic: string;
  preferredGroupFields: string[];
  contributorRules: string;
  expectedRelationTypes: string[];
  recommendedGroupCount: {
    min: number;
    max: number;
  };
  generationInstructions: string;
  evaluationCriteria: string[];
  updatedAt: string;
};

export type AtlasPlannedMapStatus = "idea" | "queued" | "generating" | "needs_review" | "published" | "paused";

export const ATLAS_PLANNED_MAP_STATUSES: AtlasPlannedMapStatus[] = [
  "idea",
  "queued",
  "generating",
  "needs_review",
  "published",
  "paused",
];

export type AtlasPlannedMapItem = {
  id: string;
  territorySlug: string;
  territoryTitle: string;
  territoryDescription: string;
  territoryDisplayOrder: number;
  branchSlug: string;
  branchTitle: string;
  branchDescription: string;
  branchDisplayOrder: number;
  mapTitle: string;
  mapSlug: string;
  summary: string;
  status: AtlasPlannedMapStatus;
  recipeId: string;
  sourceRequirements: string;
  notes: string;
  displayOrder: number;
  updatedAt: string;
};

export type AtlasGenerationJobStatus = "queued" | "running" | "awaiting_category_review" | "paused" | "failed" | "draft_ready" | "imported" | "published";

export const ATLAS_GENERATION_JOB_STATUSES: AtlasGenerationJobStatus[] = [
  "queued",
  "running",
  "awaiting_category_review",
  "paused",
  "failed",
  "draft_ready",
  "imported",
  "published",
];

export type AtlasGenerationJobItem = {
  id: string;
  plannedMapId: string;
  territorySlug: string;
  branchSlug: string;
  mapTitle: string;
  mapSlug: string;
  recipeId: string;
  topicPrompt: string;
  selectedSourceIds: string[];
  provider: string;
  model: string;
  endpoint: string;
  status: AtlasGenerationJobStatus;
  runId: string;
  outputDraftPath: string;
  errorSummary: string;
  command: string;
  currentStage: string;
  completedBatches: number;
  totalBatches: number;
  completedGroups: number;
  totalGroups: number;
  latestError: string;
  resumeAvailable: boolean;
  safeInputTokens: number;
  contextWindowTokens: number;
  sourceSufficiency: AtlasSourceSufficiency | null;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
};

export type AtlasFactoryState = {
  recipes: AtlasMapRecipe[];
  plannedMaps: AtlasPlannedMapItem[];
  jobs: AtlasGenerationJobItem[];
  corpusBridge: AtlasCorpusBridgeState;
  error?: string;
  tablesMissing?: boolean;
  configMissing?: boolean;
};

export type AtlasCategoryGroupStatus = "accepted" | "revised" | "rejected" | "uncertain";

export const ATLAS_CATEGORY_GROUP_STATUSES: AtlasCategoryGroupStatus[] = ["accepted", "revised", "rejected", "uncertain"];

export type AtlasCorrectionType =
  | "bad_category"
  | "missing_category"
  | "redundant_category"
  | "wrong_membership"
  | "weak_explanation"
  | "factual_error"
  | "missing_contributor"
  | "bad_relation"
  | "weak_source_support"
  | "other";

export const ATLAS_CORRECTION_TYPES: AtlasCorrectionType[] = [
  "bad_category",
  "missing_category",
  "redundant_category",
  "wrong_membership",
  "weak_explanation",
  "factual_error",
  "missing_contributor",
  "bad_relation",
  "weak_source_support",
  "other",
];

export type AtlasCorrectionStatus = "open" | "accepted" | "applied" | "dismissed";

export const ATLAS_CORRECTION_STATUSES: AtlasCorrectionStatus[] = ["open", "accepted", "applied", "dismissed"];

export type AtlasCategoryDraftText = {
  id: string;
  title: string;
  contributorId: string;
  provenance: AtlasProvenanceRef[];
};

export type AtlasCategoryDraftContributor = {
  id: string;
  name: string;
  texts: AtlasCategoryDraftText[];
  provenance: AtlasProvenanceRef[];
};

export type AtlasCategoryDraftGroup = {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  centralClaim: string;
  relatedGroupIds: string[];
  status: AtlasCategoryGroupStatus;
  notes: string;
  displayOrder: number;
  contributors: AtlasCategoryDraftContributor[];
  texts: AtlasCategoryDraftText[];
  provenance: AtlasProvenanceRef[];
};

export type AtlasCategoryGroupReview = {
  groupId: string;
  status: AtlasCategoryGroupStatus;
  proposedTitle: string;
  proposedShortTitle: string;
  proposedCentralClaim: string;
  proposedRelatedGroupIds: string[];
  notes: string;
  updatedAt: string;
};

export type AtlasQualityScorecard = {
  categoryQuality: number;
  fieldCoverage: number;
  factualAccuracy: number;
  contributorPlacement: number;
  keyTextSelection: number;
  objectionQuality: number;
  relationQuality: number;
  explanatoryUsefulness: number;
  redundancyNoise: number;
  provenanceSupport: number;
  notes: string;
  updatedAt: string;
};

export type AtlasReviewCorrection = {
  id: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  correctionType: AtlasCorrectionType;
  originalValue: string;
  revisedValue: string;
  reason: string;
  reviewerStatus: AtlasCorrectionStatus;
  createdAt: string;
};

export type AtlasRecipeFeedbackItem = {
  id: string;
  recipeId: string;
  correctionType: string;
  summary: string;
  recommendation: string;
  status: "pending" | "applied" | "dismissed";
  evidenceCount: number;
  updatedAt: string;
};

export type AtlasSourceChunkReviewItem = {
  chunkId: string;
  sourceId: string;
  chunkIndex: number;
  heading: string;
  excerpt: string;
};

export type AtlasCategoryCheckpoint = {
  id: string;
  status: "draft" | "awaiting_review" | "approved" | "rejected" | "superseded";
  runId: string;
  jobId: string;
  recipeId: string;
  groups: AtlasCategoryDraftGroup[];
  reviewerNotes: string;
  updatedAt: string;
};

export type AtlasCategoryReviewState = {
  reviewId: string;
  mapId: string;
  referenceMapId: string;
  runId: string;
  jobId: string;
  recipeId: string;
  referenceMap: AtlasAdminMapDetail | null;
  checkpoint: AtlasCategoryCheckpoint | null;
  groupReviews: AtlasCategoryGroupReview[];
  scorecard: AtlasQualityScorecard | null;
  corrections: AtlasReviewCorrection[];
  recipeFeedback: AtlasRecipeFeedbackItem[];
  sourceChunks: AtlasSourceChunkReviewItem[];
  error?: string;
  tablesMissing?: boolean;
  configMissing?: boolean;
};

export type AtlasAdminState = {
  maps: AtlasAdminMapListItem[];
  selectedMap: AtlasAdminMapDetail | null;
  sourceIngest: AtlasAdminSourceState;
  factory: AtlasFactoryState;
  error?: string;
  configMissing?: boolean;
};

export type AtlasAdminReadOptions = {
  corpusBridge?: AtlasCorpusBridgeOptions;
};

export type AtlasDraftImportResult = {
  ok: boolean;
  errors: string[];
  mapIds: string[];
  counts?: {
    territories: number;
    branches: number;
    maps: number;
    groups: number;
    contributors: number;
    texts: number;
    relations: number;
  };
};

type AtlasDraftRows = {
  territories: Array<Record<string, unknown>>;
  branches: Array<Record<string, unknown>>;
  maps: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  contributors: Array<Record<string, unknown>>;
  texts: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
};

type OrderedRow = {
  display_order?: number | null;
  id?: string;
  title?: string;
  name?: string;
};

type TerritoryRow = OrderedRow & {
  id: string;
  title: string;
  slug: string;
};

type BranchRow = OrderedRow & {
  id: string;
  territory_id: string;
  title: string;
  slug: string;
};

type MapRow = OrderedRow & {
  id: string;
  branch_id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  question?: string | null;
  summary?: string | null;
  status?: string | null;
  build_mode?: string | null;
  review_status?: string | null;
  published?: boolean | null;
  updated_at?: string | null;
};

type GroupRow = OrderedRow & {
  map_id: string;
  id: string;
  slug: string;
  title: string;
  short_title?: string | null;
  family?: string | null;
  stance?: string | null;
  central_claim?: string | null;
  why_it_matters?: string | null;
  objections?: string[] | null;
  related_group_ids?: string[] | null;
  keywords?: string[] | null;
  provenance?: unknown;
};

type ContributorRow = OrderedRow & {
  map_id: string;
  group_id: string;
  id: string;
  name: string;
  role?: string | null;
  reason?: string | null;
  provenance?: unknown;
};

type TextRow = OrderedRow & {
  map_id: string;
  group_id: string;
  contributor_id: string;
  id: string;
  title: string;
  kind?: string | null;
  provenance?: unknown;
};

type RelationRow = OrderedRow & {
  map_id: string;
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  note?: string | null;
  provenance?: unknown;
};

type SourceRow = OrderedRow & {
  id: string;
  title: string;
  creator?: string | null;
  source_type?: string | null;
  territory_slug?: string | null;
  branch_slug?: string | null;
  map_slug?: string | null;
  file_path?: string | null;
  canonical_url?: string | null;
  updated_at?: string | null;
};

type SourceChunkRow = {
  source_id: string;
  chunk_index?: number | null;
  heading?: string | null;
  chunk_text?: string | null;
  char_count?: number | null;
  token_estimate?: number | null;
};

type RecipeRow = {
  id: string;
  title: string;
  purpose?: string | null;
  grouping_logic?: string | null;
  preferred_group_fields?: string[] | null;
  contributor_rules?: string | null;
  expected_relation_types?: string[] | null;
  recommended_group_count?: unknown;
  generation_instructions?: string | null;
  evaluation_criteria?: string[] | null;
  updated_at?: string | null;
};

type PlannedMapRow = OrderedRow & {
  id: string;
  territory_slug: string;
  territory_title?: string | null;
  territory_description?: string | null;
  territory_display_order?: number | null;
  branch_slug: string;
  branch_title?: string | null;
  branch_description?: string | null;
  branch_display_order?: number | null;
  map_title: string;
  map_slug: string;
  summary?: string | null;
  status?: string | null;
  recipe_id?: string | null;
  source_requirements?: string | null;
  notes?: string | null;
  updated_at?: string | null;
};

type GenerationJobRow = {
  id: string;
  planned_map_id?: string | null;
  territory_slug?: string | null;
  branch_slug?: string | null;
  map_title?: string | null;
  map_slug?: string | null;
  recipe_id?: string | null;
  topic_prompt?: string | null;
  selected_source_ids?: string[] | null;
  provider?: string | null;
  model?: string | null;
  endpoint?: string | null;
  status?: string | null;
  run_id?: string | null;
  output_draft_path?: string | null;
  error_summary?: string | null;
  metadata?: unknown;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
};

type GenerationRunRow = {
  id: string;
  draft_map_slug?: string | null;
  provider?: string | null;
  model?: string | null;
  metadata?: unknown;
};

type CategoryReviewRow = {
  id: string;
  map_id: string;
  reference_map_id?: string | null;
  job_id?: string | null;
  run_id?: string | null;
  recipe_id?: string | null;
  status?: string | null;
  reviewer_notes?: string | null;
  metadata?: unknown;
  updated_at?: string | null;
};

type CategoryGroupReviewRow = {
  review_id: string;
  map_id: string;
  group_id: string;
  group_status?: string | null;
  proposed_title?: string | null;
  proposed_short_title?: string | null;
  proposed_central_claim?: string | null;
  proposed_related_group_ids?: string[] | null;
  notes?: string | null;
  updated_at?: string | null;
};

type QualityScorecardRow = {
  review_id: string;
  category_quality?: number | null;
  field_coverage?: number | null;
  factual_accuracy?: number | null;
  contributor_placement?: number | null;
  key_text_selection?: number | null;
  objection_quality?: number | null;
  relation_quality?: number | null;
  explanatory_usefulness?: number | null;
  redundancy_noise?: number | null;
  provenance_support?: number | null;
  notes?: string | null;
  updated_at?: string | null;
};

type ReviewCorrectionRow = {
  id: string;
  entity_type?: string | null;
  entity_id?: string | null;
  field_name?: string | null;
  correction_type?: string | null;
  original_value?: unknown;
  revised_value?: unknown;
  reason?: string | null;
  reviewer_status?: string | null;
  created_at?: string | null;
};

type RecipeFeedbackRow = {
  id: string;
  recipe_id: string;
  correction_type?: string | null;
  summary?: string | null;
  recommendation?: string | null;
  status?: string | null;
  evidence_count?: number | null;
  updated_at?: string | null;
};

type CategoryCheckpointRow = {
  id: string;
  review_id?: string | null;
  map_id?: string | null;
  run_id?: string | null;
  job_id?: string | null;
  recipe_id?: string | null;
  status?: string | null;
  groups_json?: unknown;
  reviewer_notes?: string | null;
  updated_at?: string | null;
};

const TERRITORY_SELECT = "id,slug,title,display_order";
const BRANCH_SELECT = "id,territory_id,slug,title,display_order";
const MAP_SELECT = "id,branch_id,slug,title,subtitle,question,summary,status,build_mode,review_status,published,display_order,updated_at";
const GROUP_SELECT = "map_id,id,slug,title,short_title,family,stance,central_claim,why_it_matters,objections,related_group_ids,keywords,provenance,display_order";
const CONTRIBUTOR_SELECT = "map_id,group_id,id,name,role,reason,provenance,display_order";
const TEXT_SELECT = "map_id,group_id,contributor_id,id,title,kind,provenance,display_order";
const RELATION_SELECT = "map_id,id,source_id,target_id,kind,note,provenance,display_order";
const SOURCE_SELECT = "id,title,creator,source_type,territory_slug,branch_slug,map_slug,file_path,canonical_url,updated_at";
const RECIPE_SELECT = "id,title,purpose,grouping_logic,preferred_group_fields,contributor_rules,expected_relation_types,recommended_group_count,generation_instructions,evaluation_criteria,updated_at";
const PLANNED_MAP_SELECT = "id,territory_slug,territory_title,territory_description,territory_display_order,branch_slug,branch_title,branch_description,branch_display_order,map_title,map_slug,summary,status,recipe_id,source_requirements,notes,display_order,updated_at";
const GENERATION_JOB_SELECT = "id,planned_map_id,territory_slug,branch_slug,map_title,map_slug,recipe_id,topic_prompt,selected_source_ids,provider,model,endpoint,status,run_id,output_draft_path,error_summary,metadata,created_at,started_at,completed_at,updated_at";
const GENERATION_RUN_SELECT = "id,draft_map_slug,provider,model,metadata";
const CATEGORY_REVIEW_SELECT = "id,map_id,reference_map_id,job_id,run_id,recipe_id,status,reviewer_notes,metadata,updated_at";
const CATEGORY_GROUP_REVIEW_SELECT = "review_id,map_id,group_id,group_status,proposed_title,proposed_short_title,proposed_central_claim,proposed_related_group_ids,notes,updated_at";
const QUALITY_SCORECARD_SELECT = "review_id,category_quality,field_coverage,factual_accuracy,contributor_placement,key_text_selection,objection_quality,relation_quality,explanatory_usefulness,redundancy_noise,provenance_support,notes,updated_at";
const REVIEW_CORRECTION_SELECT = "id,entity_type,entity_id,field_name,correction_type,original_value,revised_value,reason,reviewer_status,created_at";
const RECIPE_FEEDBACK_SELECT = "id,recipe_id,correction_type,summary,recommendation,status,evidence_count,updated_at";
const CATEGORY_CHECKPOINT_SELECT = "id,review_id,map_id,run_id,job_id,recipe_id,status,groups_json,reviewer_notes,updated_at";

const EMPTY_SOURCE_INGEST: AtlasAdminSourceState = {
  sources: [],
  totalSources: 0,
  totalChunks: 0,
  totalChars: 0,
};

const EMPTY_CORPUS_BRIDGE_STATE: AtlasCorpusBridgeState = {
  available: false,
  dbPath: "",
  sourceName: "Pipeline SQLite KB",
  sourceCount: 0,
  chunkCount: 0,
  ftsEnabled: false,
  candidatesByPlannedMapId: {},
};

const EMPTY_FACTORY_STATE: AtlasFactoryState = {
  recipes: [],
  plannedMaps: [],
  jobs: [],
  corpusBridge: EMPTY_CORPUS_BRIDGE_STATE,
};

export async function readAtlasAdminState(selectedMapId?: string, options: AtlasAdminReadOptions = {}): Promise<AtlasAdminState> {
  if (!hasSupabaseAdminConfig()) {
    return {
      maps: [],
      selectedMap: null,
      sourceIngest: { ...EMPTY_SOURCE_INGEST, configMissing: true },
      factory: { ...EMPTY_FACTORY_STATE, configMissing: true },
      configMissing: true,
    };
  }

  try {
    const supabase = createSupabaseAdminClient();
    const [territoryResult, branchResult, mapResult, groupResult, contributorResult, textResult, relationResult] = await Promise.all([
      supabase.from("atlas_territories").select(TERRITORY_SELECT).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_branches").select(BRANCH_SELECT).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_maps").select(MAP_SELECT).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_groups").select(GROUP_SELECT).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_contributors").select(CONTRIBUTOR_SELECT).order("display_order", { ascending: true }).order("name", { ascending: true }),
      supabase.from("atlas_texts").select(TEXT_SELECT).order("display_order", { ascending: true }).order("title", { ascending: true }),
      supabase.from("atlas_relations").select(RELATION_SELECT).order("display_order", { ascending: true }).order("id", { ascending: true }),
    ]);

    const failed = [territoryResult, branchResult, mapResult, groupResult, contributorResult, textResult, relationResult].find(result => result.error);
    if (failed?.error) {
      return {
        maps: [],
        selectedMap: null,
        sourceIngest: EMPTY_SOURCE_INGEST,
        factory: EMPTY_FACTORY_STATE,
        error: failed.error.message,
      };
    }

    const territories = sorted((territoryResult.data || []) as TerritoryRow[]);
    const branches = sorted((branchResult.data || []) as BranchRow[]);
    const maps = sorted((mapResult.data || []) as MapRow[]);
    const groups = sorted((groupResult.data || []) as GroupRow[]);
    const contributors = sorted((contributorResult.data || []) as ContributorRow[]);
    const texts = sorted((textResult.data || []) as TextRow[]);
    const relations = sorted((relationResult.data || []) as RelationRow[]);

    const territoryById = new Map(territories.map(territory => [territory.id, territory]));
    const branchById = new Map(branches.map(branch => [branch.id, branch]));
    const groupsByMap = groupBy(groups, group => group.map_id);
    const contributorsByGroup = groupBy(contributors, contributor => groupKey(contributor.map_id, contributor.group_id));
    const textsByContributor = groupBy(texts, text => contributorKey(text.map_id, text.group_id, text.contributor_id));
    const relationsByMap = groupBy(relations, relation => relation.map_id);
    const [sourceIngest, factory] = await Promise.all([
      readAtlasSourceAdminState(supabase),
      readAtlasFactoryState(supabase, options.corpusBridge),
    ]);

    const list = maps.map((map): AtlasAdminMapListItem => {
      const branch = branchById.get(map.branch_id);
      const territory = branch ? territoryById.get(branch.territory_id) : undefined;

      return {
        id: map.id,
        slug: map.slug,
        title: map.title,
        atlasStatus: String(map.status || "queued"),
        reviewStatus: normalizeReviewStatus(map.review_status),
        published: map.published !== false,
        updatedAt: String(map.updated_at || ""),
        territoryId: territory?.id || "",
        territoryTitle: territory?.title || "Unassigned",
        branchId: branch?.id || "",
        branchTitle: branch?.title || "Unassigned",
        groupCount: groupsByMap.get(map.id)?.length || 0,
        relationCount: relationsByMap.get(map.id)?.length || 0,
      };
    });

    const selectedId = selectedMapId && maps.some(map => map.id === selectedMapId || map.slug === selectedMapId)
      ? selectedMapId
      : maps[0]?.id || "";
    const selectedRow = maps.find(map => map.id === selectedId || map.slug === selectedId);
    const selectedSummary = selectedRow ? list.find(item => item.id === selectedRow.id) : undefined;

    return {
      maps: list,
      sourceIngest,
      factory,
      selectedMap: selectedRow && selectedSummary ? {
        ...selectedSummary,
        subtitle: String(selectedRow.subtitle || ""),
        question: String(selectedRow.question || ""),
        summary: String(selectedRow.summary || ""),
        buildMode: String(selectedRow.build_mode || "pipeline-ready"),
        groups: sorted(groupsByMap.get(selectedRow.id) || []).map((group): AtlasAdminGroup => ({
          id: group.id,
          slug: group.slug,
          title: group.title,
          shortTitle: String(group.short_title || ""),
          family: String(group.family || ""),
          stance: String(group.stance || ""),
          centralClaim: String(group.central_claim || ""),
          whyItMatters: String(group.why_it_matters || ""),
          objections: stringArray(group.objections),
          relatedGroupIds: stringArray(group.related_group_ids),
          keywords: stringArray(group.keywords),
          provenance: provenanceArray(group.provenance),
          contributors: sorted(contributorsByGroup.get(groupKey(group.map_id, group.id)) || []).map((contributor): AtlasAdminContributor => ({
            id: contributor.id,
            name: contributor.name,
            role: String(contributor.role || ""),
            reason: String(contributor.reason || ""),
            provenance: provenanceArray(contributor.provenance),
            texts: sorted(textsByContributor.get(contributorKey(contributor.map_id, contributor.group_id, contributor.id)) || []).map((text): AtlasAdminText => ({
              id: text.id,
              title: text.title,
              kind: String(text.kind || "other"),
              provenance: provenanceArray(text.provenance),
            })),
          })),
        })),
        relations: sorted(relationsByMap.get(selectedRow.id) || []).map((relation): AtlasAdminRelation => ({
          id: relation.id,
          source: relation.source_id,
          target: relation.target_id,
          kind: relation.kind,
          note: String(relation.note || ""),
          provenance: provenanceArray(relation.provenance),
        })),
      } : null,
    };
  } catch (error) {
    return {
      maps: [],
      selectedMap: null,
      sourceIngest: EMPTY_SOURCE_INGEST,
      factory: EMPTY_FACTORY_STATE,
      error: error instanceof Error ? error.message : "Could not load Atlas maps.",
    };
  }
}

async function readAtlasSourceAdminState(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<AtlasAdminSourceState> {
  const [sourceCountResult, chunkCountResult, sourceResult, chunkResult] = await Promise.all([
    supabase.from("atlas_sources").select("id", { count: "exact", head: true }),
    supabase.from("atlas_source_chunks").select("source_id", { count: "exact", head: true }),
    supabase.from("atlas_sources").select(SOURCE_SELECT).order("updated_at", { ascending: false }).limit(30),
    supabase.from("atlas_source_chunks").select("source_id,char_count,token_estimate"),
  ]);

  const failed = [sourceCountResult, chunkCountResult, sourceResult, chunkResult].find(result => result.error);
  if (failed?.error) {
    if (isMissingAtlasSourceTables(failed.error)) {
      return {
        ...EMPTY_SOURCE_INGEST,
        tablesMissing: true,
        error: "Atlas source tables are not applied yet.",
      };
    }

    return {
      ...EMPTY_SOURCE_INGEST,
      error: failed.error.message,
    };
  }

  const chunks = (chunkResult.data || []) as SourceChunkRow[];
  const sourceRows = ((sourceResult.data || []) as SourceRow[]);
  const chunksBySource = groupBy(chunks, chunk => chunk.source_id);

  return {
    sources: sourceRows.map((source): AtlasAdminSourceItem => {
      const sourceChunks = chunksBySource.get(source.id) || [];
      return {
        id: source.id,
        title: source.title,
        creator: String(source.creator || ""),
        sourceType: String(source.source_type || "other"),
        territorySlug: String(source.territory_slug || ""),
        branchSlug: String(source.branch_slug || ""),
        mapSlug: String(source.map_slug || ""),
        filePath: String(source.file_path || ""),
        canonicalUrl: String(source.canonical_url || ""),
        updatedAt: String(source.updated_at || ""),
        chunkCount: sourceChunks.length,
        charCount: sumRows(sourceChunks, chunk => Number(chunk.char_count || 0)),
        tokenEstimate: sumRows(sourceChunks, chunk => Number(chunk.token_estimate || 0)),
      };
    }),
    totalSources: sourceCountResult.count || 0,
    totalChunks: chunkCountResult.count || 0,
    totalChars: sumRows(chunks, chunk => Number(chunk.char_count || 0)),
  };
}

async function readAtlasFactoryState(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  corpusBridgeOptions: AtlasCorpusBridgeOptions = {},
): Promise<AtlasFactoryState> {
  const [recipeResult, plannedMapResult, jobResult] = await Promise.all([
    supabase.from("atlas_map_recipes").select(RECIPE_SELECT).order("title", { ascending: true }),
    supabase
      .from("atlas_planned_maps")
      .select(PLANNED_MAP_SELECT)
      .order("territory_display_order", { ascending: true })
      .order("branch_display_order", { ascending: true })
      .order("display_order", { ascending: true })
      .order("map_title", { ascending: true }),
    supabase.from("atlas_generation_jobs").select(GENERATION_JOB_SELECT).order("created_at", { ascending: false }).limit(20),
  ]);

  const failed = [recipeResult, plannedMapResult, jobResult].find(result => result.error);
  if (failed?.error) {
    if (isMissingAtlasFactoryTables(failed.error)) {
      return {
        ...EMPTY_FACTORY_STATE,
        tablesMissing: true,
        error: "Atlas factory tables are not applied yet.",
      };
    }

    return {
      ...EMPTY_FACTORY_STATE,
      error: failed.error.message,
    };
  }

  const recipes = ((recipeResult.data || []) as RecipeRow[]).map(rowToRecipe);
  const plannedMaps = sorted((plannedMapResult.data || []) as PlannedMapRow[]).map(rowToPlannedMap);

  return {
    recipes,
    plannedMaps,
    jobs: ((jobResult.data || []) as GenerationJobRow[]).map(rowToGenerationJob),
    corpusBridge: await readAtlasCorpusBridgeState(plannedMaps, recipes, corpusBridgeOptions),
  };
}

export async function readAtlasCategoryReviewState(
  map: AtlasAdminMapDetail,
  maps: AtlasAdminMapListItem[],
  referenceMapId?: string,
): Promise<AtlasCategoryReviewState> {
  if (!hasSupabaseAdminConfig()) {
    return {
      reviewId: "",
      mapId: map.id,
      referenceMapId: "",
      runId: "",
      jobId: "",
      recipeId: "",
      referenceMap: null,
      checkpoint: null,
      groupReviews: [],
      scorecard: null,
      corrections: [],
      recipeFeedback: [],
      sourceChunks: [],
      configMissing: true,
    };
  }

  const referenceId = resolveReferenceMapId(map, maps, referenceMapId);
  const referenceMap = referenceId ? (await readAtlasAdminState(referenceId)).selectedMap : null;
  const reviewId = categoryReviewId(map.id, referenceId);

  try {
    const supabase = createSupabaseAdminClient();
    const context = await inferCategoryReviewContext(supabase, map);
    const reviewResult = await supabase
      .from("atlas_category_reviews")
      .select(CATEGORY_REVIEW_SELECT)
      .eq("id", reviewId)
      .maybeSingle();

    if (reviewResult.error) {
      if (isMissingAtlasQualityTables(reviewResult.error)) {
        return emptyCategoryReviewState(map, referenceId, referenceMap, {
          tablesMissing: true,
          error: "Atlas quality-control tables are not applied yet.",
        });
      }
      throw new Error(reviewResult.error.message);
    }

    const reviewRow = reviewResult.data as CategoryReviewRow | null;
    const effectiveContext = {
      jobId: String(reviewRow?.job_id || context.jobId || ""),
      runId: String(reviewRow?.run_id || context.runId || ""),
      recipeId: String(reviewRow?.recipe_id || context.recipeId || ""),
    };

    const [groupReviewResult, scorecardResult, correctionResult, checkpointResult, feedbackResult, sourceChunkResult] = await Promise.all([
      supabase.from("atlas_category_group_reviews").select(CATEGORY_GROUP_REVIEW_SELECT).eq("review_id", reviewId),
      supabase.from("atlas_quality_scorecards").select(QUALITY_SCORECARD_SELECT).eq("review_id", reviewId).maybeSingle(),
      supabase.from("atlas_review_corrections").select(REVIEW_CORRECTION_SELECT).eq("review_id", reviewId).order("created_at", { ascending: false }).limit(25),
      supabase.from("atlas_category_checkpoints").select(CATEGORY_CHECKPOINT_SELECT).eq("map_id", map.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      effectiveContext.recipeId
        ? supabase.from("atlas_recipe_feedback").select(RECIPE_FEEDBACK_SELECT).eq("recipe_id", effectiveContext.recipeId).order("updated_at", { ascending: false }).limit(12)
        : Promise.resolve({ data: [], error: null }),
      readSourceChunksForMaps(supabase, [map, referenceMap].filter(Boolean) as AtlasAdminMapDetail[]),
    ]);

    const failed = [groupReviewResult, scorecardResult, correctionResult, checkpointResult, feedbackResult, sourceChunkResult].find(result => result.error);
    if (failed?.error) throw new Error(failed.error.message);

    return {
      reviewId,
      mapId: map.id,
      referenceMapId: referenceId,
      referenceMap,
      ...effectiveContext,
      checkpoint: checkpointResult.data ? rowToCategoryCheckpoint(checkpointResult.data as CategoryCheckpointRow, map) : null,
      groupReviews: ((groupReviewResult.data || []) as CategoryGroupReviewRow[]).map(rowToCategoryGroupReview),
      scorecard: scorecardResult.data ? rowToQualityScorecard(scorecardResult.data as QualityScorecardRow) : null,
      corrections: ((correctionResult.data || []) as ReviewCorrectionRow[]).map(rowToReviewCorrection),
      recipeFeedback: ((feedbackResult.data || []) as RecipeFeedbackRow[]).map(rowToRecipeFeedback),
      sourceChunks: sourceChunkResult.data as AtlasSourceChunkReviewItem[],
    };
  } catch (error) {
    return emptyCategoryReviewState(map, referenceId, referenceMap, {
      error: error instanceof Error ? error.message : "Could not load Atlas category review state.",
    });
  }
}

export async function saveAtlasAdminMap(input: {
  mapId: string;
  title: string;
  summary: string;
  reviewStatus: string;
}) {
  const reviewStatus = normalizeReviewStatus(input.reviewStatus);
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("atlas_maps")
    .update({
      title: input.title.trim(),
      summary: input.summary.trim(),
      review_status: reviewStatus,
      published: reviewStatus === "published",
    })
    .eq("id", input.mapId);

  if (error) throw new Error(error.message);
}

export async function saveAtlasAdminGroup(input: {
  mapId: string;
  groupId: string;
  stance: string;
  centralClaim: string;
  whyItMatters: string;
  objections: string[];
}) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("atlas_groups")
    .update({
      stance: input.stance.trim(),
      central_claim: input.centralClaim.trim(),
      why_it_matters: input.whyItMatters.trim(),
      objections: input.objections,
    })
    .eq("map_id", input.mapId)
    .eq("id", input.groupId);

  if (error) throw new Error(error.message);
}

export async function saveAtlasAdminContributor(input: {
  mapId: string;
  groupId: string;
  contributorId: string;
  reason: string;
}) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("atlas_contributors")
    .update({ reason: input.reason.trim() })
    .eq("map_id", input.mapId)
    .eq("group_id", input.groupId)
    .eq("id", input.contributorId);

  if (error) throw new Error(error.message);
}

export async function saveAtlasAdminRelation(input: {
  mapId: string;
  relationId: string;
  note: string;
}) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("atlas_relations")
    .update({ note: input.note.trim() })
    .eq("map_id", input.mapId)
    .eq("id", input.relationId);

  if (error) throw new Error(error.message);
}

export async function saveAtlasCategoryGroupReview(input: {
  mapId: string;
  referenceMapId: string;
  groupId: string;
  title: string;
  shortTitle: string;
  centralClaim: string;
  relatedGroupIds: string[];
  groupStatus: string;
  notes: string;
}) {
  const context = await loadCategoryMutationContext(input.mapId, input.referenceMapId);
  const status = normalizeCategoryGroupStatus(input.groupStatus);
  const groups = context.checkpoint.groups.map(group => group.id === input.groupId
    ? {
      ...group,
      title: input.title.trim() || group.title,
      shortTitle: input.shortTitle.trim() || group.shortTitle,
      centralClaim: input.centralClaim.trim() || group.centralClaim,
      relatedGroupIds: dedupe(input.relatedGroupIds.filter(id => id !== group.id)),
      status,
      notes: input.notes.trim(),
    }
    : group);

  const { error } = await context.supabase.from("atlas_category_group_reviews").upsert({
    review_id: context.reviewId,
    map_id: context.map.id,
    group_id: input.groupId,
    group_status: status,
    proposed_title: input.title.trim(),
    proposed_short_title: input.shortTitle.trim(),
    proposed_central_claim: input.centralClaim.trim(),
    proposed_related_group_ids: dedupe(input.relatedGroupIds.filter(Boolean)),
    notes: input.notes.trim(),
  }, { onConflict: "review_id,group_id" });

  if (error) throw new Error(error.message);

  await saveCategoryCheckpointGroups(context, groups, "draft");
  if (status !== "accepted") {
    await insertReviewCorrection(context, {
      correctionType: status === "rejected" ? "bad_category" : "weak_explanation",
      entityType: "group",
      entityId: input.groupId,
      fieldName: "category_review",
      originalValue: { groupId: input.groupId },
      revisedValue: {
        title: input.title.trim(),
        shortTitle: input.shortTitle.trim(),
        centralClaim: input.centralClaim.trim(),
        relatedGroupIds: input.relatedGroupIds,
        status,
      },
      reason: input.notes.trim() || `Group marked ${status}.`,
      reviewerStatus: "open",
    });
  }
}

export async function applyAtlasCategoryOperation(input: {
  mapId: string;
  referenceMapId: string;
  operation: string;
  groupId: string;
  targetGroupId: string;
  newGroupTitle: string;
  memberType: string;
  memberId: string;
  memberIds: string[];
  direction: string;
  reason: string;
}) {
  const context = await loadCategoryMutationContext(input.mapId, input.referenceMapId);
  const groups = [...context.checkpoint.groups].sort((a, b) => a.displayOrder - b.displayOrder);
  const reason = input.reason.trim();
  let correctionType: AtlasCorrectionType = "other";
  let entityId = input.groupId || input.targetGroupId;
  let originalValue: Record<string, unknown> = {};
  let revisedValue: Record<string, unknown> = {};

  if (input.operation === "add_group") {
    const title = input.newGroupTitle.trim() || "New Atlas group";
    const id = uniqueGroupId(groups, title);
    groups.push({
      id,
      title,
      shortTitle: title,
      description: reason,
      centralClaim: "",
      relatedGroupIds: [],
      status: "revised",
      notes: reason,
      displayOrder: groups.length,
      contributors: [],
      texts: [],
      provenance: [],
    });
    correctionType = "missing_category";
    entityId = id;
    revisedValue = { id, title };
  } else if (input.operation === "remove_group") {
    const index = groups.findIndex(group => group.id === input.groupId);
    if (index < 0) throw new Error("Group to remove was not found.");
    const [removed] = groups.splice(index, 1);
    correctionType = "bad_category";
    entityId = removed.id;
    originalValue = removed;
    revisedValue = { removed: true };
  } else if (input.operation === "merge_groups") {
    const sourceIndex = groups.findIndex(group => group.id === input.groupId);
    const target = groups.find(group => group.id === input.targetGroupId);
    if (sourceIndex < 0 || !target || input.groupId === input.targetGroupId) throw new Error("Select two different groups to merge.");
    const source = groups[sourceIndex];
    originalValue = { source, target };
    target.contributors = mergeContributors(target.contributors, source.contributors);
    target.texts = mergeTexts(target.texts, source.texts);
    target.relatedGroupIds = dedupe([...target.relatedGroupIds, ...source.relatedGroupIds].filter(id => id !== source.id && id !== target.id));
    target.provenance = dedupeRefs([...target.provenance, ...source.provenance]);
    target.notes = [target.notes, `Merged ${source.title}.`, reason].filter(Boolean).join("\n");
    groups.splice(sourceIndex, 1);
    groups.forEach(group => {
      group.relatedGroupIds = group.relatedGroupIds.map(id => id === source.id ? target.id : id).filter(id => id !== group.id);
    });
    correctionType = "redundant_category";
    entityId = source.id;
    revisedValue = { mergedInto: target.id };
  } else if (input.operation === "split_group") {
    const source = groups.find(group => group.id === input.groupId);
    if (!source) throw new Error("Group to split was not found.");
    const title = input.newGroupTitle.trim() || `${source.title} split`;
    const id = uniqueGroupId(groups, title);
    const moved = new Set(input.memberIds);
    const movedContributors = source.contributors.filter(contributor => moved.has(contributor.id));
    source.contributors = source.contributors.filter(contributor => !moved.has(contributor.id));
    const movedTextIds = new Set(movedContributors.flatMap(contributor => contributor.texts.map(text => text.id)));
    const movedTexts = source.texts.filter(text => moved.has(text.id) || movedTextIds.has(text.id));
    source.texts = source.texts.filter(text => !moved.has(text.id) && !movedTextIds.has(text.id));
    const splitGroup: AtlasCategoryDraftGroup = {
      id,
      title,
      shortTitle: title,
      description: reason,
      centralClaim: "",
      relatedGroupIds: [source.id],
      status: "revised",
      notes: reason,
      displayOrder: source.displayOrder + 1,
      contributors: movedContributors,
      texts: movedTexts,
      provenance: dedupeRefs([...source.provenance, ...movedContributors.flatMap(contributor => contributor.provenance), ...movedTexts.flatMap(text => text.provenance)]),
    };
    source.relatedGroupIds = dedupe([...source.relatedGroupIds, id]);
    groups.splice(groups.findIndex(group => group.id === source.id) + 1, 0, splitGroup);
    correctionType = "missing_category";
    entityId = source.id;
    originalValue = { sourceGroupId: source.id };
    revisedValue = { splitGroupId: id, movedMemberIds: input.memberIds };
  } else if (input.operation === "move_member") {
    const source = groups.find(group => group.id === input.groupId);
    const target = groups.find(group => group.id === input.targetGroupId);
    if (!source || !target || source.id === target.id) throw new Error("Select two different groups for the move.");
    if (input.memberType === "text") {
      const textIndex = source.texts.findIndex(text => text.id === input.memberId);
      if (textIndex < 0) throw new Error("Text to move was not found.");
      const [text] = source.texts.splice(textIndex, 1);
      target.texts = mergeTexts(target.texts, [text]);
      originalValue = { from: source.id, text };
      revisedValue = { to: target.id, textId: text.id };
    } else {
      const contributorIndex = source.contributors.findIndex(contributor => contributor.id === input.memberId);
      if (contributorIndex < 0) throw new Error("Contributor to move was not found.");
      const [contributor] = source.contributors.splice(contributorIndex, 1);
      target.contributors = mergeContributors(target.contributors, [contributor]);
      const textIds = new Set(contributor.texts.map(text => text.id));
      const movedTexts = source.texts.filter(text => textIds.has(text.id));
      source.texts = source.texts.filter(text => !textIds.has(text.id));
      target.texts = mergeTexts(target.texts, movedTexts);
      originalValue = { from: source.id, contributor };
      revisedValue = { to: target.id, contributorId: contributor.id };
    }
    correctionType = "wrong_membership";
    entityId = input.memberId;
  } else if (input.operation === "reorder_group") {
    const index = groups.findIndex(group => group.id === input.groupId);
    if (index < 0) throw new Error("Group to reorder was not found.");
    const delta = input.direction === "down" ? 1 : -1;
    const nextIndex = index + delta;
    if (nextIndex >= 0 && nextIndex < groups.length) {
      const [group] = groups.splice(index, 1);
      groups.splice(nextIndex, 0, group);
    }
    correctionType = "other";
    entityId = input.groupId;
    revisedValue = { direction: input.direction };
  } else {
    throw new Error("Unsupported Atlas category operation.");
  }

  await saveCategoryCheckpointGroups(context, groups, "draft");
  await insertReviewCorrection(context, {
    correctionType,
    entityType: input.operation,
    entityId,
    fieldName: "category_structure",
    originalValue,
    revisedValue,
    reason: reason || input.operation.replace(/_/g, " "),
    reviewerStatus: "open",
  });
}

export async function saveAtlasQualityScorecard(input: {
  mapId: string;
  referenceMapId: string;
  categoryQuality: number;
  fieldCoverage: number;
  factualAccuracy: number;
  contributorPlacement: number;
  keyTextSelection: number;
  objectionQuality: number;
  relationQuality: number;
  explanatoryUsefulness: number;
  redundancyNoise: number;
  provenanceSupport: number;
  notes: string;
}) {
  const context = await loadCategoryMutationContext(input.mapId, input.referenceMapId);
  const { error } = await context.supabase.from("atlas_quality_scorecards").upsert({
    review_id: context.reviewId,
    map_id: context.map.id,
    recipe_id: context.recipeId || null,
    category_quality: score(input.categoryQuality),
    field_coverage: score(input.fieldCoverage),
    factual_accuracy: score(input.factualAccuracy),
    contributor_placement: score(input.contributorPlacement),
    key_text_selection: score(input.keyTextSelection),
    objection_quality: score(input.objectionQuality),
    relation_quality: score(input.relationQuality),
    explanatory_usefulness: score(input.explanatoryUsefulness),
    redundancy_noise: score(input.redundancyNoise),
    provenance_support: score(input.provenanceSupport),
    notes: input.notes.trim(),
  }, { onConflict: "review_id" });

  if (error) throw new Error(error.message);
}

export async function saveAtlasReviewCorrection(input: {
  mapId: string;
  referenceMapId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  correctionType: string;
  originalValue: string;
  revisedValue: string;
  reason: string;
  reviewerStatus: string;
}) {
  const context = await loadCategoryMutationContext(input.mapId, input.referenceMapId);
  await insertReviewCorrection(context, {
    correctionType: normalizeCorrectionType(input.correctionType),
    entityType: input.entityType.trim(),
    entityId: input.entityId.trim(),
    fieldName: input.fieldName.trim(),
    originalValue: textJson(input.originalValue),
    revisedValue: textJson(input.revisedValue),
    reason: input.reason.trim(),
    reviewerStatus: normalizeCorrectionStatus(input.reviewerStatus),
  });
}

export async function saveAtlasRecipeFeedback(input: {
  feedbackId: string;
  recipeId: string;
  correctionType: string;
  summary: string;
  recommendation: string;
  status: string;
}) {
  const supabase = createSupabaseAdminClient();
  const correctionType = normalizeCorrectionType(input.correctionType);
  const id = input.feedbackId.trim() || recipeFeedbackId(input.recipeId, correctionType);
  const { error } = await supabase.from("atlas_recipe_feedback").upsert({
    id,
    recipe_id: input.recipeId.trim(),
    correction_type: correctionType,
    summary: input.summary.trim(),
    recommendation: input.recommendation.trim(),
    status: ["pending", "applied", "dismissed"].includes(input.status) ? input.status : "pending",
  }, { onConflict: "id" });

  if (error) throw new Error(error.message);
}

export async function approveAtlasCategoryCheckpoint(input: {
  mapId: string;
  referenceMapId: string;
  reviewerNotes: string;
}) {
  const context = await loadCategoryMutationContext(input.mapId, input.referenceMapId);
  await saveCategoryCheckpointGroups(context, context.checkpoint.groups, "approved", input.reviewerNotes.trim());
  if (context.jobId) {
    await context.supabase
      .from("atlas_generation_jobs")
      .update({
        status: "queued",
        metadata: {
          ...(context.jobMetadata || {}),
          categoryCheckpointApprovedAt: new Date().toISOString(),
          progress: {
            ...recordObject(context.jobMetadata?.progress),
            currentStage: "category-approved",
            latestError: "",
          },
        },
      })
      .eq("id", context.jobId);
  }
}

export async function saveAtlasMapRecipe(input: {
  recipeId: string;
  title: string;
  purpose: string;
  groupingLogic: string;
  preferredGroupFields: string[];
  contributorRules: string;
  expectedRelationTypes: string[];
  recommendedMin: number;
  recommendedMax: number;
  generationInstructions: string;
  evaluationCriteria: string[];
}) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("atlas_map_recipes")
    .update({
      title: input.title.trim(),
      purpose: input.purpose.trim(),
      grouping_logic: input.groupingLogic.trim(),
      preferred_group_fields: input.preferredGroupFields,
      contributor_rules: input.contributorRules.trim(),
      expected_relation_types: input.expectedRelationTypes,
      recommended_group_count: {
        min: Math.max(1, Math.floor(input.recommendedMin || 5)),
        max: Math.max(Math.floor(input.recommendedMin || 5), Math.floor(input.recommendedMax || 10)),
      },
      generation_instructions: input.generationInstructions.trim(),
      evaluation_criteria: input.evaluationCriteria,
    })
    .eq("id", input.recipeId);

  if (error) throw new Error(error.message);
}

export async function saveAtlasPlannedMapFactorySettings(input: {
  plannedMapId: string;
  recipeId: string;
  status: string;
}) {
  const status = normalizePlannedMapStatus(input.status);
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("atlas_planned_maps")
    .update({
      recipe_id: input.recipeId.trim() || null,
      status,
    })
    .eq("id", input.plannedMapId);

  if (error) throw new Error(error.message);
}

export async function attachAtlasCorpusSourcesToPlannedMap(input: {
  plannedMapId: string;
  corpusSourceIds: string[];
  corpusBridgeOptions?: AtlasCorpusBridgeOptions;
}) {
  const supabase = createSupabaseAdminClient();
  const { data: plannedMapRow, error: plannedMapError } = await supabase
    .from("atlas_planned_maps")
    .select(PLANNED_MAP_SELECT)
    .eq("id", input.plannedMapId)
    .single();

  if (plannedMapError || !plannedMapRow) {
    throw new Error(plannedMapError?.message || "Planned Atlas map was not found.");
  }

  const plannedMap = rowToPlannedMap(plannedMapRow as PlannedMapRow);
  let recipe: AtlasMapRecipe | undefined;
  if (plannedMap.recipeId) {
    const recipeResult = await supabase
      .from("atlas_map_recipes")
      .select(RECIPE_SELECT)
      .eq("id", plannedMap.recipeId)
      .maybeSingle();

    if (recipeResult.error) throw new Error(recipeResult.error.message);
    if (recipeResult.data) recipe = rowToRecipe(recipeResult.data as RecipeRow);
  }

  return attachAtlasCorpusCandidatesToPlannedMap({
    supabase,
    plannedMap,
    recipe,
    corpusSourceIds: dedupe(input.corpusSourceIds.map(value => value.trim()).filter(Boolean)),
    options: input.corpusBridgeOptions,
  });
}

export async function queueAtlasFactoryGenerationJob(input: {
  plannedMapId: string;
  recipeId: string;
  topicPrompt: string;
  selectedSourceIds: string[];
  provider: string;
  model: string;
  endpoint: string;
}) {
  const supabase = createSupabaseAdminClient();
  const { data: plannedMapRow, error: plannedMapError } = await supabase
    .from("atlas_planned_maps")
    .select(PLANNED_MAP_SELECT)
    .eq("id", input.plannedMapId)
    .single();

  if (plannedMapError || !plannedMapRow) {
    throw new Error(plannedMapError?.message || "Planned Atlas map was not found.");
  }

  const plannedMap = rowToPlannedMap(plannedMapRow as PlannedMapRow);
  const recipeId = input.recipeId.trim() || plannedMap.recipeId;
  if (!recipeId) throw new Error("Select an Atlas map recipe before queueing generation.");

  const recipeResult = await supabase
    .from("atlas_map_recipes")
    .select(RECIPE_SELECT)
    .eq("id", recipeId)
    .single();

  if (recipeResult.error || !recipeResult.data) {
    throw new Error(recipeResult.error?.message || "Atlas map recipe was not found.");
  }

  const recipe = rowToRecipe(recipeResult.data as RecipeRow);
  const sourceIds = dedupe(input.selectedSourceIds.map(value => value.trim()).filter(Boolean));
  const sourceSufficiency = await readSelectedAtlasSourceSufficiency({
    supabase,
    plannedMap,
    recipe,
    sourceIds,
  });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
  const jobId = `atlas-job-${plannedMap.mapSlug}-${stamp}`;
  const runId = `atlas-factory-${plannedMap.mapSlug}-${stamp}`;
  const draftMapSlug = `${plannedMap.mapSlug}-factory-${stamp}`;
  const topicPrompt = input.topicPrompt.trim() || plannedMap.summary;
  const command = buildAtlasFactoryCommand({
    jobId,
    territorySlug: plannedMap.territorySlug,
    branchSlug: plannedMap.branchSlug,
    mapSlug: draftMapSlug,
    sourceMapSlug: plannedMap.mapSlug,
    topicPrompt,
    recipeId,
    runId,
    sourceIds,
    provider: input.provider.trim(),
    model: input.model.trim(),
    endpoint: input.endpoint.trim(),
  });

  const { error } = await supabase.from("atlas_generation_jobs").insert({
    id: jobId,
    planned_map_id: plannedMap.id,
    territory_slug: plannedMap.territorySlug,
    branch_slug: plannedMap.branchSlug,
    map_title: plannedMap.mapTitle,
    map_slug: plannedMap.mapSlug,
    recipe_id: recipeId,
    topic_prompt: topicPrompt,
    selected_source_ids: sourceIds,
    provider: input.provider.trim() || null,
    model: input.model.trim() || null,
    endpoint: input.endpoint.trim() || null,
    status: "queued",
    run_id: runId,
    output_draft_path: `atlas/generation-runs/${runId}/06-final-draft.json`,
    metadata: {
      factoryVersion: "v1",
      draftMapSlug,
      sourceMapSlug: plannedMap.mapSlug,
      command,
      recipe,
      sourceSufficiency,
      sourceSufficiencyWarnings: sourceSufficiency.warnings,
    },
  });

  if (error) throw new Error(error.message);

  const updateResult = await supabase
    .from("atlas_planned_maps")
    .update({
      status: "queued",
      recipe_id: recipeId,
    })
    .eq("id", plannedMap.id);

  if (updateResult.error) throw new Error(updateResult.error.message);

  return { jobId, runId, command };
}

export async function importAtlasDraftSpecToSupabase(spec: AtlasMapSpec): Promise<AtlasDraftImportResult> {
  const issues = validateAtlasMapSpec(spec);
  if (issues.length) {
    return {
      ok: false,
      errors: issues.map(issue => `${issue.path}: ${issue.message}`),
      mapIds: [],
    };
  }

  if (!hasSupabaseAdminConfig()) {
    return {
      ok: false,
      errors: ["Supabase admin config is missing."],
      mapIds: [],
    };
  }

  const rows = atlasMapSpecToDraftRows(spec);
  const mapIds = rows.maps.map(row => String(row.id)).filter(Boolean);
  const counts = {
    territories: rows.territories.length,
    branches: rows.branches.length,
    maps: rows.maps.length,
    groups: rows.groups.length,
    contributors: rows.contributors.length,
    texts: rows.texts.length,
    relations: rows.relations.length,
  };

  try {
    const supabase = createSupabaseAdminClient();
    await upsertRows(supabase, "atlas_territories", rows.territories, "id");
    await upsertRows(supabase, "atlas_branches", rows.branches, "id");
    await upsertRows(supabase, "atlas_maps", rows.maps, "id");
    await upsertRows(supabase, "atlas_groups", rows.groups, "map_id,id");
    await upsertRows(supabase, "atlas_contributors", rows.contributors, "map_id,group_id,id");
    await upsertRows(supabase, "atlas_texts", rows.texts, "map_id,group_id,contributor_id,id");
    await upsertRows(supabase, "atlas_relations", rows.relations, "map_id,id");

    return { ok: true, errors: [], mapIds, counts };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Atlas draft import failed."],
      mapIds,
    };
  }
}

export function normalizeReviewStatus(value: string | null | undefined): AtlasReviewStatus {
  return ATLAS_REVIEW_STATUSES.includes(value as AtlasReviewStatus) ? value as AtlasReviewStatus : "draft";
}

export function linesToText(values: string[]) {
  return values.join("\n");
}

export function textToLines(value: string) {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

type CategoryMutationContext = {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  map: AtlasAdminMapDetail;
  reviewId: string;
  referenceMapId: string;
  jobId: string;
  runId: string;
  recipeId: string;
  jobMetadata: Record<string, unknown>;
  checkpoint: AtlasCategoryCheckpoint;
};

async function loadCategoryMutationContext(mapId: string, referenceMapId: string): Promise<CategoryMutationContext> {
  const state = await readAtlasAdminState(mapId);
  if (!state.selectedMap) throw new Error("Atlas map was not found for category review.");

  const map = state.selectedMap;
  const resolvedReferenceMapId = resolveReferenceMapId(map, state.maps, referenceMapId);
  const supabase = createSupabaseAdminClient();
  const inferred = await inferCategoryReviewContext(supabase, map);
  const reviewId = categoryReviewId(map.id, resolvedReferenceMapId);
  const review = await ensureCategoryReviewRow(supabase, map, resolvedReferenceMapId, inferred, reviewId);
  const context = {
    jobId: String(review.job_id || inferred.jobId || ""),
    runId: String(review.run_id || inferred.runId || ""),
    recipeId: String(review.recipe_id || inferred.recipeId || ""),
    jobMetadata: inferred.jobMetadata,
  };
  const checkpoint = await ensureCategoryCheckpoint(supabase, map, reviewId, context);

  return {
    supabase,
    map,
    reviewId,
    referenceMapId: resolvedReferenceMapId,
    ...context,
    checkpoint,
  };
}

async function ensureCategoryReviewRow(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  map: AtlasAdminMapDetail,
  referenceMapId: string,
  context: { jobId: string; runId: string; recipeId: string },
  reviewId: string,
) {
  const { data, error } = await supabase.from("atlas_category_reviews").upsert({
    id: reviewId,
    map_id: map.id,
    reference_map_id: referenceMapId || null,
    job_id: context.jobId || null,
    run_id: context.runId || null,
    recipe_id: context.recipeId || null,
    status: "open",
  }, { onConflict: "id" }).select(CATEGORY_REVIEW_SELECT).single();

  if (error || !data) throw new Error(error?.message || "Could not create Atlas category review.");
  return data as CategoryReviewRow;
}

async function inferCategoryReviewContext(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  map: AtlasAdminMapDetail,
) {
  const fallback = { jobId: "", runId: "", recipeId: "", jobMetadata: {} as Record<string, unknown> };
  const jobResult = await supabase
    .from("atlas_generation_jobs")
    .select(GENERATION_JOB_SELECT)
    .filter("metadata->>draftMapSlug", "eq", map.slug)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobResult.data) {
    const job = jobResult.data as GenerationJobRow;
    return {
      jobId: job.id,
      runId: String(job.run_id || ""),
      recipeId: String(job.recipe_id || ""),
      jobMetadata: recordObject(job.metadata),
    };
  }

  const runResult = await supabase
    .from("atlas_generation_runs")
    .select(GENERATION_RUN_SELECT)
    .eq("draft_map_slug", map.slug)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!runResult.data) return fallback;

  const run = runResult.data as GenerationRunRow;
  const metadata = recordObject(run.metadata);
  const recipe = recordObject(metadata.recipe);
  return {
    jobId: String(metadata.jobId || ""),
    runId: run.id,
    recipeId: String(recipe.id || metadata.recipeId || ""),
    jobMetadata: {},
  };
}

async function ensureCategoryCheckpoint(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  map: AtlasAdminMapDetail,
  reviewId: string,
  context: { jobId: string; runId: string; recipeId: string },
) {
  const existing = await supabase
    .from("atlas_category_checkpoints")
    .select(CATEGORY_CHECKPOINT_SELECT)
    .eq("map_id", map.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return rowToCategoryCheckpoint(existing.data as CategoryCheckpointRow, map);

  const id = `${reviewId}-checkpoint`;
  const { data, error } = await supabase.from("atlas_category_checkpoints").insert({
    id,
    review_id: reviewId,
    map_id: map.id,
    run_id: context.runId || null,
    job_id: context.jobId || null,
    recipe_id: context.recipeId || null,
    status: "draft",
    groups_json: checkpointPayloadFromGroups(mapToCheckpointGroups(map)),
  }).select(CATEGORY_CHECKPOINT_SELECT).single();

  if (error || !data) throw new Error(error?.message || "Could not create Atlas category checkpoint.");
  return rowToCategoryCheckpoint(data as CategoryCheckpointRow, map);
}

async function saveCategoryCheckpointGroups(
  context: CategoryMutationContext,
  groups: AtlasCategoryDraftGroup[],
  status: AtlasCategoryCheckpoint["status"],
  reviewerNotes = context.checkpoint.reviewerNotes,
) {
  const ordered = normalizeCheckpointOrder(groups);
  const { data, error } = await context.supabase
    .from("atlas_category_checkpoints")
    .update({
      status,
      groups_json: checkpointPayloadFromGroups(ordered),
      reviewer_notes: reviewerNotes,
    })
    .eq("id", context.checkpoint.id)
    .select(CATEGORY_CHECKPOINT_SELECT)
    .single();

  if (error || !data) throw new Error(error?.message || "Could not save Atlas category checkpoint.");
  context.checkpoint = rowToCategoryCheckpoint(data as CategoryCheckpointRow, context.map);
}

async function insertReviewCorrection(
  context: CategoryMutationContext,
  input: {
    correctionType: AtlasCorrectionType;
    entityType: string;
    entityId: string;
    fieldName: string;
    originalValue: unknown;
    revisedValue: unknown;
    reason: string;
    reviewerStatus: AtlasCorrectionStatus;
  },
) {
  const id = `atlas-correction-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const { error } = await context.supabase.from("atlas_review_corrections").insert({
    id,
    review_id: context.reviewId,
    map_id: context.map.id,
    run_id: context.runId || null,
    job_id: context.jobId || null,
    recipe_id: context.recipeId || null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    field_name: input.fieldName,
    correction_type: input.correctionType,
    original_value: input.originalValue || {},
    revised_value: input.revisedValue || {},
    reason: input.reason,
    reviewer_status: input.reviewerStatus,
  });

  if (error) throw new Error(error.message);
  if (context.recipeId) await refreshRecipeFeedbackFor(context.supabase, context.recipeId, input.correctionType);
}

async function refreshRecipeFeedbackFor(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  recipeId: string,
  correctionType: AtlasCorrectionType,
) {
  const countResult = await supabase
    .from("atlas_review_corrections")
    .select("id", { count: "exact", head: true })
    .eq("recipe_id", recipeId)
    .eq("correction_type", correctionType);

  const evidenceCount = countResult.count || 0;
  if (!evidenceCount) return;

  const id = recipeFeedbackId(recipeId, correctionType);
  const existing = await supabase
    .from("atlas_recipe_feedback")
    .select(RECIPE_FEEDBACK_SELECT)
    .eq("id", id)
    .maybeSingle();

  const existingRow = existing.data as RecipeFeedbackRow | null;
  const { error } = await supabase.from("atlas_recipe_feedback").upsert({
    id,
    recipe_id: recipeId,
    correction_type: correctionType,
    summary: existingRow?.summary || feedbackSummaryFor(correctionType, evidenceCount),
    recommendation: existingRow?.recommendation || feedbackRecommendationFor(correctionType),
    status: existingRow?.status || "pending",
    evidence_count: evidenceCount,
  }, { onConflict: "id" });

  if (error) throw new Error(error.message);
}

function mapToCheckpointGroups(map: AtlasAdminMapDetail): AtlasCategoryDraftGroup[] {
  return map.groups.map((group, index) => {
    const texts = group.contributors.flatMap(contributor => contributor.texts.map(text => ({
      ...text,
      contributorId: contributor.id,
    })));
    return {
      id: group.id,
      title: group.title,
      shortTitle: group.shortTitle,
      description: group.stance,
      centralClaim: group.centralClaim,
      relatedGroupIds: group.relatedGroupIds,
      status: "uncertain",
      notes: "",
      displayOrder: index,
      contributors: group.contributors.map(contributor => ({
        id: contributor.id,
        name: contributor.name,
        provenance: contributor.provenance,
        texts: contributor.texts.map(text => ({
          id: text.id,
          title: text.title,
          contributorId: contributor.id,
          provenance: text.provenance,
        })),
      })),
      texts,
      provenance: group.provenance,
    };
  });
}

function checkpointPayloadFromGroups(groups: AtlasCategoryDraftGroup[]) {
  return {
    stage: "clustering",
    ok: true,
    groups: normalizeCheckpointOrder(groups).map(group => ({
      id: group.id,
      title: group.title,
      shortTitle: group.shortTitle,
      description: group.description || group.centralClaim,
      centralClaim: group.centralClaim,
      memberCandidateIds: [
        ...group.contributors.map(contributor => contributor.id),
        ...group.texts.map(text => text.id),
      ],
      relatedGroupIds: group.relatedGroupIds,
      status: group.status,
      notes: group.notes,
      displayOrder: group.displayOrder,
      contributors: group.contributors,
      texts: group.texts,
      provenance: group.provenance,
    })),
  };
}

function normalizeCheckpointOrder(groups: AtlasCategoryDraftGroup[]) {
  return groups
    .map((group, index) => ({ ...group, displayOrder: Number.isFinite(group.displayOrder) ? group.displayOrder : index }))
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((group, index) => ({ ...group, displayOrder: index }));
}

function mergeContributors(current: AtlasCategoryDraftContributor[], incoming: AtlasCategoryDraftContributor[]) {
  const byId = new Map(current.map(contributor => [contributor.id, contributor]));
  incoming.forEach(contributor => {
    const existing = byId.get(contributor.id);
    if (existing) {
      existing.texts = mergeTexts(existing.texts, contributor.texts);
      existing.provenance = dedupeRefs([...existing.provenance, ...contributor.provenance]);
    } else {
      byId.set(contributor.id, contributor);
    }
  });
  return [...byId.values()];
}

function mergeTexts(current: AtlasCategoryDraftText[], incoming: AtlasCategoryDraftText[]) {
  const byId = new Map(current.map(text => [text.id, text]));
  incoming.forEach(text => {
    const existing = byId.get(text.id);
    byId.set(text.id, existing ? { ...existing, provenance: dedupeRefs([...existing.provenance, ...text.provenance]) } : text);
  });
  return [...byId.values()];
}

function dedupeRefs(refs: AtlasProvenanceRef[]) {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = ref.chunkId || `${ref.sourceId}#${ref.chunkIndex}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueGroupId(groups: AtlasCategoryDraftGroup[], title: string) {
  const used = new Set(groups.map(group => group.id));
  const base = safeId(title || "group") || "group";
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function score(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.floor(value)));
}

function textJson(value: string) {
  return { text: value.trim() };
}

function recipeFeedbackId(recipeId: string, correctionType: string) {
  return `atlas-recipe-feedback-${safeId(recipeId)}-${safeId(correctionType)}`;
}

function feedbackSummaryFor(correctionType: AtlasCorrectionType, evidenceCount: number) {
  return `${titleFromSlug(correctionType)} appeared in ${evidenceCount} Atlas review correction${evidenceCount === 1 ? "" : "s"}.`;
}

function feedbackRecommendationFor(correctionType: AtlasCorrectionType) {
  if (correctionType === "bad_category") return "Tighten grouping instructions so generated categories are conceptually distinct and reviewable.";
  if (correctionType === "missing_category") return "Add recipe guidance for mandatory coverage areas before enrichment starts.";
  if (correctionType === "redundant_category") return "Ask clustering to merge overlapping families before group enrichment.";
  if (correctionType === "wrong_membership") return "Strengthen contributor and text placement rules in the recipe prompt.";
  if (correctionType === "bad_relation") return "Constrain relation generation to explain specific conceptual movement, not generic adjacency.";
  if (correctionType === "weak_source_support") return "Require stronger provenance selection and reject unsupported categories.";
  return "Review the recurring correction and decide whether the recipe needs a prompt or evaluation update.";
}

function atlasMapSpecToDraftRows(spec: AtlasMapSpec): AtlasDraftRows {
  const now = new Date().toISOString();
  const rows: AtlasDraftRows = {
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
      metadata: draftMetadata(spec, now),
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
        metadata: draftMetadata(spec, now),
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
          metadata: draftMetadata(spec, now),
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
            metadata: draftMetadata(spec, now),
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
              metadata: draftMetadata(spec, now),
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
                metadata: draftMetadata(spec, now),
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
            metadata: draftMetadata(spec, now),
          });
        });
      });
    });
  });

  return rows;
}

function draftMetadata(spec: AtlasMapSpec, importedAt: string) {
  return {
    source: "atlas-draft-import",
    specUpdatedAt: spec.updatedAt,
    importedAt,
  };
}

async function upsertRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
) {
  if (!rows.length) return;

  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`Could not upsert ${table}: ${error.message}`);
}

function emptyCategoryReviewState(
  map: AtlasAdminMapDetail,
  referenceMapId: string,
  referenceMap: AtlasAdminMapDetail | null,
  extra: Partial<AtlasCategoryReviewState>,
): AtlasCategoryReviewState {
  return {
    reviewId: categoryReviewId(map.id, referenceMapId),
    mapId: map.id,
    referenceMapId,
    runId: "",
    jobId: "",
    recipeId: "",
    referenceMap,
    checkpoint: null,
    groupReviews: [],
    scorecard: null,
    corrections: [],
    recipeFeedback: [],
    sourceChunks: [],
    ...extra,
  };
}

function resolveReferenceMapId(map: AtlasAdminMapDetail, maps: AtlasAdminMapListItem[], requested?: string) {
  if (requested && maps.some(item => (item.id === requested || item.slug === requested) && item.id !== map.id)) {
    const match = maps.find(item => item.id === requested || item.slug === requested);
    return match?.id || "";
  }

  const exact = maps.find(item => item.id !== map.id && item.published && (item.slug === map.slug || item.id === map.slug));
  if (exact) return exact.id;

  if (/metaphysics-families/i.test(map.slug)) {
    const metaphysics = maps.find(item => item.id !== map.id && item.published && item.slug === "metaphysics-families");
    if (metaphysics) return metaphysics.id;
  }

  const sameBranch = maps.find(item => item.id !== map.id && item.published && item.branchId === map.branchId);
  return sameBranch?.id || "";
}

function categoryReviewId(mapId: string, referenceMapId: string) {
  return `atlas-category-review-${safeId(mapId)}-${safeId(referenceMapId || "no-reference")}`;
}

async function readSourceChunksForMaps(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  maps: AtlasAdminMapDetail[],
): Promise<{ data: AtlasSourceChunkReviewItem[]; error: { message: string } | null }> {
  const refs = dedupeRefs(maps.flatMap(collectRefsFromMap));
  if (!refs.length) return { data: [], error: null };

  const sourceIds = dedupe(refs.map(ref => ref.sourceId).filter(Boolean));
  const wanted = new Set(refs.map(ref => ref.chunkId || `${ref.sourceId}#${ref.chunkIndex}`));
  const { data, error } = await supabase
    .from("atlas_source_chunks")
    .select("source_id,chunk_index,heading,chunk_text")
    .in("source_id", sourceIds)
    .order("source_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  if (error) return { data: [], error: { message: error.message } };

  return {
    data: ((data || []) as SourceChunkRow[])
      .map((row): AtlasSourceChunkReviewItem => {
        const sourceId = row.source_id;
        const chunkIndex = Number(row.chunk_index || 0);
        return {
          sourceId,
          chunkIndex,
          chunkId: `${sourceId}#${chunkIndex}`,
          heading: String(row.heading || ""),
          excerpt: String(row.chunk_text || "").replace(/\s+/g, " ").trim().slice(0, 340),
        };
      })
      .filter(chunk => wanted.has(chunk.chunkId)),
    error: null,
  };
}

function collectRefsFromMap(map: AtlasAdminMapDetail) {
  return dedupeRefs([
    ...map.groups.flatMap(group => [
      ...group.provenance,
      ...group.contributors.flatMap(contributor => [
        ...contributor.provenance,
        ...contributor.texts.flatMap(text => text.provenance),
      ]),
    ]),
    ...map.relations.flatMap(relation => relation.provenance),
  ]);
}

function rowToCategoryGroupReview(row: CategoryGroupReviewRow): AtlasCategoryGroupReview {
  return {
    groupId: row.group_id,
    status: normalizeCategoryGroupStatus(row.group_status),
    proposedTitle: String(row.proposed_title || ""),
    proposedShortTitle: String(row.proposed_short_title || ""),
    proposedCentralClaim: String(row.proposed_central_claim || ""),
    proposedRelatedGroupIds: stringArray(row.proposed_related_group_ids),
    notes: String(row.notes || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowToQualityScorecard(row: QualityScorecardRow): AtlasQualityScorecard {
  return {
    categoryQuality: score(Number(row.category_quality || 3)),
    fieldCoverage: score(Number(row.field_coverage || 3)),
    factualAccuracy: score(Number(row.factual_accuracy || 3)),
    contributorPlacement: score(Number(row.contributor_placement || 3)),
    keyTextSelection: score(Number(row.key_text_selection || 3)),
    objectionQuality: score(Number(row.objection_quality || 3)),
    relationQuality: score(Number(row.relation_quality || 3)),
    explanatoryUsefulness: score(Number(row.explanatory_usefulness || 3)),
    redundancyNoise: score(Number(row.redundancy_noise || 3)),
    provenanceSupport: score(Number(row.provenance_support || 3)),
    notes: String(row.notes || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowToReviewCorrection(row: ReviewCorrectionRow): AtlasReviewCorrection {
  return {
    id: row.id,
    entityType: String(row.entity_type || ""),
    entityId: String(row.entity_id || ""),
    fieldName: String(row.field_name || ""),
    correctionType: normalizeCorrectionType(row.correction_type),
    originalValue: jsonSummary(row.original_value),
    revisedValue: jsonSummary(row.revised_value),
    reason: String(row.reason || ""),
    reviewerStatus: normalizeCorrectionStatus(row.reviewer_status),
    createdAt: String(row.created_at || ""),
  };
}

function rowToRecipeFeedback(row: RecipeFeedbackRow): AtlasRecipeFeedbackItem {
  const status = ["pending", "applied", "dismissed"].includes(String(row.status)) ? String(row.status) as AtlasRecipeFeedbackItem["status"] : "pending";
  return {
    id: row.id,
    recipeId: row.recipe_id,
    correctionType: String(row.correction_type || "other"),
    summary: String(row.summary || ""),
    recommendation: String(row.recommendation || ""),
    status,
    evidenceCount: Number(row.evidence_count || 0),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowToCategoryCheckpoint(row: CategoryCheckpointRow, map: AtlasAdminMapDetail): AtlasCategoryCheckpoint {
  const payload = recordObject(row.groups_json);
  const rawGroups = Array.isArray(payload.groups) ? payload.groups : [];
  const fallbackById = new Map(mapToCheckpointGroups(map).map(group => [group.id, group]));
  const groups = rawGroups.map((raw, index): AtlasCategoryDraftGroup => {
    const record = recordObject(raw);
    const id = String(record.id || `group-${index + 1}`);
    const fallback = fallbackById.get(id);
    const contributors = Array.isArray(record.contributors)
      ? record.contributors.map(rowToDraftContributor).filter(isDraftContributor)
      : fallback?.contributors || [];
    const texts = Array.isArray(record.texts)
      ? record.texts.map(rowToDraftText).filter(isDraftText)
      : fallback?.texts || contributors.flatMap(contributor => contributor.texts);

    return {
      id,
      title: String(record.title || fallback?.title || titleFromSlug(id)),
      shortTitle: String(record.shortTitle || fallback?.shortTitle || record.title || titleFromSlug(id)),
      description: String(record.description || fallback?.description || ""),
      centralClaim: String(record.centralClaim || fallback?.centralClaim || ""),
      relatedGroupIds: stringArray(record.relatedGroupIds),
      status: normalizeCategoryGroupStatus(String(record.status || fallback?.status || "uncertain")),
      notes: String(record.notes || fallback?.notes || ""),
      displayOrder: Number(record.displayOrder ?? index),
      contributors,
      texts,
      provenance: provenanceArray(record.provenance).length ? provenanceArray(record.provenance) : fallback?.provenance || [],
    };
  });

  return {
    id: row.id,
    status: normalizeCheckpointStatus(row.status),
    runId: String(row.run_id || ""),
    jobId: String(row.job_id || ""),
    recipeId: String(row.recipe_id || ""),
    groups: normalizeCheckpointOrder(groups.length ? groups : mapToCheckpointGroups(map)),
    reviewerNotes: String(row.reviewer_notes || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowToDraftContributor(value: unknown): AtlasCategoryDraftContributor | null {
  const record = recordObject(value);
  const id = String(record.id || "");
  if (!id) return null;
  return {
    id,
    name: String(record.name || titleFromSlug(id)),
    texts: Array.isArray(record.texts) ? record.texts.map(rowToDraftText).filter(isDraftText) : [],
    provenance: provenanceArray(record.provenance),
  };
}

function rowToDraftText(value: unknown): AtlasCategoryDraftText | null {
  const record = recordObject(value);
  const id = String(record.id || "");
  if (!id) return null;
  return {
    id,
    title: String(record.title || titleFromSlug(id)),
    contributorId: String(record.contributorId || ""),
    provenance: provenanceArray(record.provenance),
  };
}

function isDraftContributor(value: AtlasCategoryDraftContributor | null): value is AtlasCategoryDraftContributor {
  return Boolean(value);
}

function isDraftText(value: AtlasCategoryDraftText | null): value is AtlasCategoryDraftText {
  return Boolean(value);
}

function normalizeCategoryGroupStatus(value: string | null | undefined): AtlasCategoryGroupStatus {
  return ATLAS_CATEGORY_GROUP_STATUSES.includes(value as AtlasCategoryGroupStatus) ? value as AtlasCategoryGroupStatus : "uncertain";
}

function normalizeCorrectionType(value: string | null | undefined): AtlasCorrectionType {
  return ATLAS_CORRECTION_TYPES.includes(value as AtlasCorrectionType) ? value as AtlasCorrectionType : "other";
}

function normalizeCorrectionStatus(value: string | null | undefined): AtlasCorrectionStatus {
  return ATLAS_CORRECTION_STATUSES.includes(value as AtlasCorrectionStatus) ? value as AtlasCorrectionStatus : "open";
}

function normalizeCheckpointStatus(value: string | null | undefined): AtlasCategoryCheckpoint["status"] {
  return ["draft", "awaiting_review", "approved", "rejected", "superseded"].includes(String(value))
    ? value as AtlasCategoryCheckpoint["status"]
    : "draft";
}

function jsonSummary(value: unknown) {
  if (typeof value === "string") return value;
  const record = recordObject(value);
  if (typeof record.text === "string") return record.text;
  return Object.keys(record).length ? JSON.stringify(record) : "";
}

function safeId(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
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

function sorted<Row extends OrderedRow>(rows: Row[]) {
  return [...rows].sort((a, b) => {
    const orderDelta = Number(a.display_order || 0) - Number(b.display_order || 0);
    if (orderDelta !== 0) return orderDelta;
    return String(a.title || a.name || a.id || "").localeCompare(String(b.title || b.name || b.id || ""));
  });
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : [];
}

function provenanceArray(value: unknown): AtlasProvenanceRef[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): AtlasProvenanceRef | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const sourceId = String(record.sourceId || "");
      const chunkIndex = Number(record.chunkIndex);
      if (!sourceId || !Number.isInteger(chunkIndex) || chunkIndex < 0) return null;

      const chunkId = String(record.chunkId || "").trim();
      const note = String(record.note || "").trim();
      return {
        sourceId,
        chunkIndex,
        ...(chunkId ? { chunkId } : {}),
        ...(note ? { note } : {}),
      };
    })
    .filter((item): item is AtlasProvenanceRef => Boolean(item));
}

function sumRows<Row>(rows: Row[], valueFor: (row: Row) => number) {
  return rows.reduce((total, row) => total + valueFor(row), 0);
}

function rowToRecipe(row: RecipeRow): AtlasMapRecipe {
  return {
    id: row.id,
    title: row.title,
    purpose: String(row.purpose || ""),
    groupingLogic: String(row.grouping_logic || ""),
    preferredGroupFields: stringArray(row.preferred_group_fields),
    contributorRules: String(row.contributor_rules || ""),
    expectedRelationTypes: stringArray(row.expected_relation_types),
    recommendedGroupCount: recommendedGroupCount(row.recommended_group_count),
    generationInstructions: String(row.generation_instructions || ""),
    evaluationCriteria: stringArray(row.evaluation_criteria),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowToPlannedMap(row: PlannedMapRow): AtlasPlannedMapItem {
  return {
    id: row.id,
    territorySlug: row.territory_slug,
    territoryTitle: String(row.territory_title || titleFromSlug(row.territory_slug)),
    territoryDescription: String(row.territory_description || ""),
    territoryDisplayOrder: Number(row.territory_display_order || 0),
    branchSlug: row.branch_slug,
    branchTitle: String(row.branch_title || titleFromSlug(row.branch_slug)),
    branchDescription: String(row.branch_description || ""),
    branchDisplayOrder: Number(row.branch_display_order || 0),
    mapTitle: row.map_title,
    mapSlug: row.map_slug,
    summary: String(row.summary || ""),
    status: normalizePlannedMapStatus(row.status),
    recipeId: String(row.recipe_id || ""),
    sourceRequirements: String(row.source_requirements || ""),
    notes: String(row.notes || ""),
    displayOrder: Number(row.display_order || 0),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowToGenerationJob(row: GenerationJobRow): AtlasGenerationJobItem {
  const metadata = recordObject(row.metadata);
  const progress = recordObject(metadata.progress);

  return {
    id: row.id,
    plannedMapId: String(row.planned_map_id || ""),
    territorySlug: String(row.territory_slug || ""),
    branchSlug: String(row.branch_slug || ""),
    mapTitle: String(row.map_title || ""),
    mapSlug: String(row.map_slug || ""),
    recipeId: String(row.recipe_id || ""),
    topicPrompt: String(row.topic_prompt || ""),
    selectedSourceIds: stringArray(row.selected_source_ids),
    provider: String(row.provider || ""),
    model: String(row.model || ""),
    endpoint: String(row.endpoint || ""),
    status: normalizeGenerationJobStatus(row.status),
    runId: String(row.run_id || ""),
    outputDraftPath: String(row.output_draft_path || ""),
    errorSummary: String(row.error_summary || ""),
    command: String(metadata.command || ""),
    currentStage: String(progress.currentStage || ""),
    completedBatches: Number(progress.completedBatches || 0),
    totalBatches: Number(progress.totalBatches || 0),
    completedGroups: Number(progress.completedGroups || 0),
    totalGroups: Number(progress.totalGroups || 0),
    latestError: String(progress.latestError || ""),
    resumeAvailable: Boolean(progress.resumeAvailable),
    safeInputTokens: Number(progress.safeInputTokens || 0),
    contextWindowTokens: Number(progress.contextWindowTokens || 0),
    sourceSufficiency: rowToSufficiency(metadata.sourceSufficiency),
    createdAt: String(row.created_at || ""),
    startedAt: String(row.started_at || ""),
    completedAt: String(row.completed_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowToSufficiency(value: unknown): AtlasSourceSufficiency | null {
  const record = recordObject(value);
  if (!Object.keys(record).length) return null;

  return {
    sourceCount: Number(record.sourceCount || 0),
    chunkCount: Number(record.chunkCount || 0),
    sourceDiversity: Number(record.sourceDiversity || 0),
    sourceTypes: stringArray(record.sourceTypes),
    reliabilityTiers: stringArray(record.reliabilityTiers),
    categoryCoverage: Number(record.categoryCoverage || 0),
    chronologyCoverage: normalizeCoverage(record.chronologyCoverage, "not_applicable"),
    contributorTextCoverage: normalizeCoverage(record.contributorTextCoverage, "weak"),
    contributorPersonCoverage: normalizeCoverage(record.contributorPersonCoverage, "weak"),
    conceptTheoryCoverage: normalizeCoverage(record.conceptTheoryCoverage, "weak"),
    relationEvidenceCoverage: normalizeCoverage(record.relationEvidenceCoverage, "weak"),
    laneCoverage: arrayRecords(record.laneCoverage).map(item => ({
      laneId: String(item.laneId || ""),
      title: String(item.title || ""),
      required: Boolean(item.required),
      sourceCount: Number(item.sourceCount || 0),
      chunkCount: Number(item.chunkCount || 0),
      covered: Boolean(item.covered),
    })),
    confidence: normalizeSufficiencyConfidence(record.confidence),
    obviousGaps: stringArray(record.obviousGaps),
    warnings: stringArray(record.warnings),
    missingLaneWarnings: stringArray(record.missingLaneWarnings),
    overrepresentationWarnings: stringArray(record.overrepresentationWarnings),
  };
}

function normalizeCoverage(value: unknown, fallback: AtlasCorpusCoverageLevel): AtlasCorpusCoverageLevel {
  return ["not_applicable", "weak", "partial", "usable", "strong"].includes(String(value))
    ? String(value) as AtlasCorpusCoverageLevel
    : fallback;
}

function normalizeSufficiencyConfidence(value: unknown): AtlasSourceSufficiency["confidence"] {
  return ["insufficient", "weak", "usable", "strong"].includes(String(value))
    ? String(value) as AtlasSourceSufficiency["confidence"]
    : "weak";
}

function normalizePlannedMapStatus(value: string | null | undefined): AtlasPlannedMapStatus {
  return ATLAS_PLANNED_MAP_STATUSES.includes(value as AtlasPlannedMapStatus) ? value as AtlasPlannedMapStatus : "idea";
}

function normalizeGenerationJobStatus(value: string | null | undefined): AtlasGenerationJobStatus {
  return ATLAS_GENERATION_JOB_STATUSES.includes(value as AtlasGenerationJobStatus) ? value as AtlasGenerationJobStatus : "queued";
}

function recommendedGroupCount(value: unknown) {
  const record = recordObject(value);
  const min = Number(record.min || 5);
  const max = Number(record.max || 10);

  return {
    min: Number.isFinite(min) && min > 0 ? Math.floor(min) : 5,
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
  };
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(recordObject) : [];
}

function buildAtlasFactoryCommand(input: {
  jobId: string;
  territorySlug: string;
  branchSlug: string;
  mapSlug: string;
  sourceMapSlug: string;
  topicPrompt: string;
  recipeId: string;
  runId: string;
  sourceIds: string[];
  provider: string;
  model: string;
  endpoint: string;
}) {
  const parts = [
    "npm",
    "run",
    "atlas:generate-staged",
    "--",
    "--territory-slug",
    input.territorySlug,
    "--branch-slug",
    input.branchSlug,
    "--map-slug",
    input.mapSlug,
    "--source-map-slug",
    input.sourceMapSlug,
    "--topic-prompt",
    input.topicPrompt,
    "--recipe-id",
    input.recipeId,
    "--run-id",
    input.runId,
    "--job-id",
    input.jobId,
    "--chunk-char-limit",
    "900",
    "--import-on-success",
  ];

  if (input.sourceIds.length) parts.push("--source-ids", input.sourceIds.join(","));
  if (input.provider) parts.push("--provider", input.provider);
  if (input.model) parts.push("--model", input.model);
  if (input.endpoint) parts.push("--endpoint", input.endpoint);

  return parts.map(commandArg).join(" ");
}

function commandArg(value: string) {
  if (/^[A-Za-z0-9_./:=,@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function titleFromSlug(value: string) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isMissingAtlasSourceTables(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");

  return code === "42P01"
    || code === "PGRST205"
    || /atlas_sources|atlas_source_chunks|atlas_generation_runs|atlas_map_sources/i.test(message)
    || /could not find .*atlas_/i.test(message);
}

function isMissingAtlasFactoryTables(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");

  return code === "42P01"
    || code === "PGRST205"
    || /atlas_map_recipes|atlas_planned_maps|atlas_generation_jobs/i.test(message)
    || /could not find .*atlas_/i.test(message);
}

function isMissingAtlasQualityTables(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(record.code || "");
  const message = String(record.message || "");

  return code === "42P01"
    || code === "PGRST205"
    || /atlas_category_reviews|atlas_category_group_reviews|atlas_quality_scorecards|atlas_review_corrections|atlas_recipe_feedback|atlas_category_checkpoints/i.test(message)
    || /could not find .*atlas_/i.test(message);
}
