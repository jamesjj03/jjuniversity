import rawAuthority from "./data/authority.v1.json";
import type {
  AtlasTerritorialAuthorityRecord,
  AtlasTerritorialAuthoritySource,
  AtlasTerritorialStatusAuthority,
} from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FULL_CASE_ENTITY_IDS = new Set([
  "country:SAH",
  "country:KOS",
  "country:CYN",
  "country:SOL",
  "country:PSX",
  "country:TWN",
]);
const EXPECTED_ENTITY_IDS = new Set([...FULL_CASE_ENTITY_IDS, "country:KAS"]);
const FORBIDDEN_GEOMETRY_KEYS = new Set([
  "geometry",
  "coordinates",
  "controlLine",
  "controlLines",
  "controlLineGeometry",
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Atlas territorial-status authority: ${message}`);
}
function hasForbiddenGeometryKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasForbiddenGeometryKey);
  return Object.entries(value).some(([key, nested]) => (
    FORBIDDEN_GEOMETRY_KEYS.has(key) || hasForbiddenGeometryKey(nested)
  ));
}

function validateSourceIds(
  ids: readonly string[],
  knownSourceIds: ReadonlySet<string>,
  context: string,
) {
  invariant(ids.length > 0, `${context} needs at least one source`);
  invariant(new Set(ids).size === ids.length, `${context} repeats a source`);
  for (const id of ids) invariant(knownSourceIds.has(id), `${context} references unknown source ${id}`);
}

/**
 * Runtime validation keeps a malformed editorial data file from silently
 * becoming public cartography. The JSON Schema is the portable contract; this
 * check also enforces cross-record source and scope invariants.
 */
export function validateAtlasTerritorialStatusAuthority(
  value: unknown,
): AtlasTerritorialStatusAuthority {
  invariant(Boolean(value) && typeof value === "object" && !Array.isArray(value), "root must be an object");
  const authority = value as AtlasTerritorialStatusAuthority;
  invariant(authority.schemaVersion === "1.0.0", `unsupported schema ${String(authority.schemaVersion)}`);
  invariant(authority.authorityId === "jju-atlas-territorial-status", "unexpected authority ID");
  invariant(Boolean(authority.revision), "revision is required");
  invariant(ISO_DATE.test(authority.updatedAt), "updatedAt must be an ISO date");
  invariant(authority.policy?.geometrySemantic === "map-unit-outline", "only map-unit outlines are allowed");
  invariant(authority.policy.controlLineGeometryIncluded === false, "control-line geometry must remain absent");
  invariant(authority.policy.adjudicatesSovereignty === false, "the authority cannot adjudicate sovereignty");
  invariant(authority.policy.requireSourceForEveryRelationship === true, "relationship sourcing must remain mandatory");
  invariant(authority.policy.requireReviewMetadata === true, "review metadata must remain mandatory");
  invariant(Array.isArray(authority.sources) && authority.sources.length > 0, "sources are required");
  invariant(Array.isArray(authority.records), "records must be an array");

  const sourceIds = new Set<string>();
  for (const source of authority.sources) {
    invariant(Boolean(source.id), "a source is missing its ID");
    invariant(!sourceIds.has(source.id), `duplicate source ${source.id}`);
    sourceIds.add(source.id);
    invariant(Boolean(source.title && source.publisher), `${source.id} needs title and publisher`);
    invariant(source.url.startsWith("https://"), `${source.id} must use an HTTPS URL`);
    invariant(ISO_DATE.test(source.retrievedAt), `${source.id} needs a retrieval date`);
  }

  const recordIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const record of authority.records) {
    invariant(Boolean(record.id) && !recordIds.has(record.id), `duplicate or missing record ID ${record.id}`);
    invariant(Boolean(record.entityId) && !entityIds.has(record.entityId), `duplicate or missing entity ${record.entityId}`);
    recordIds.add(record.id);
    entityIds.add(record.entityId);
    invariant(Number.isInteger(record.revision) && record.revision >= 1, `${record.id} has an invalid revision`);
    invariant(record.geometrySemantic === "map-unit-outline", `${record.id} must use map-unit-outline geometry semantics`);
    invariant(!hasForbiddenGeometryKey(record), `${record.id} embeds geometry or a control line`);
    invariant(record.sourceSnapshot?.datasetId === "natural-earth-admin-0-50m-5.1.2", `${record.id} has an unreviewed geometry source`);
    invariant(record.temporal?.precision === "source_snapshot", `${record.id} must expose source-snapshot time precision`);
    invariant(record.temporal.validFrom === null && record.temporal.validTo === null, `${record.id} invents a validity interval`);
    invariant(record.review?.status === "published-reviewed", `${record.id} is not in the reviewed publication state`);
    invariant(["agent", "human"].includes(record.review.reviewerKind), `${record.id} has no honest reviewer kind`);
    invariant(Boolean(record.review.reviewedBy), `${record.id} has no reviewer identity`);
    invariant(ISO_DATE.test(record.review.reviewedAt), `${record.id} has no review date`);
    invariant(ISO_DATE.test(record.review.sourceCheckedThrough), `${record.id} has no source-check date`);
    invariant(record.review.sourceCheckedThrough <= record.review.reviewedAt, `${record.id} claims sources checked after review`);
    invariant(record.explanation?.summary.length > 50, `${record.id} has no usable explanation`);
    invariant(record.internationalStatus?.perspectives.length > 0, `${record.id} has no attributed status perspective`);
    invariant(record.claimants?.length > 0, `${record.id} has no sourced claimant relationship`);
    invariant(record.citations?.length > 0, `${record.id} has no public citations`);

    for (const claimant of record.claimants) {
      validateSourceIds(claimant.sourceIds, sourceIds, `${record.id}/${claimant.actorId}`);
    }
    for (const administrator of record.administratorsOrControllers) {
      validateSourceIds(administrator.sourceIds, sourceIds, `${record.id}/${administrator.actorId}`);
    }
    for (const perspective of record.internationalStatus.perspectives) {
      validateSourceIds(perspective.sourceIds, sourceIds, `${record.id}/${perspective.id}`);
    }
    for (const citation of record.citations) {
      invariant(sourceIds.has(citation.sourceId), `${record.id} cites unknown source ${citation.sourceId}`);
      invariant(citation.supports.length > 20, `${record.id}/${citation.sourceId} does not say what the source supports`);
    }

    if (FULL_CASE_ENTITY_IDS.has(record.entityId)) {
      invariant(record.scope === "territorial-status-case", `${record.id} unexpectedly narrows its authored scope`);
      invariant(record.administratorsOrControllers.length > 0, `${record.id} has no sourced administration account`);
      for (const field of ["claims", "administration", "disputeReason", "mapChoice"] as const) {
        invariant(record.explanation[field].length > 50, `${record.id} has no substantive ${field} explanation`);
      }
    }
  }

  invariant(entityIds.size === EXPECTED_ENTITY_IDS.size, "the bounded authority must contain exactly seven records");
  for (const id of EXPECTED_ENTITY_IDS) invariant(entityIds.has(id), `missing required record ${id}`);
  for (const id of entityIds) invariant(EXPECTED_ENTITY_IDS.has(id), `unexpected expansion beyond bounded scope: ${id}`);

  const siachen = authority.records.find((record) => record.entityId === "country:KAS");
  invariant(siachen?.scope === "specific-feature-only", "Siachen must remain a feature-only record");
  invariant(/not (?:a model of )?all Kashmir/i.test(siachen.scopeCaveat), "Siachen must explicitly say it is not all Kashmir");
  invariant(siachen.administratorsOrControllers.length === 0, "Siachen must not infer administrator or control data");

  return authority;
}

export const ATLAS_TERRITORIAL_STATUS_AUTHORITY = validateAtlasTerritorialStatusAuthority(rawAuthority);

const sourceById = new Map<string, AtlasTerritorialAuthoritySource>(
  ATLAS_TERRITORIAL_STATUS_AUTHORITY.sources.map((source) => [source.id, source]),
);
const recordByEntityId = new Map<string, AtlasTerritorialAuthorityRecord>(
  ATLAS_TERRITORIAL_STATUS_AUTHORITY.records.map((record) => [record.entityId, record]),
);

export function getAtlasTerritorialStatusAuthorityRecord(entityId: string) {
  return recordByEntityId.get(entityId) ?? null;
}

export function getAtlasTerritorialStatusAuthoritySource(sourceId: string) {
  return sourceById.get(sourceId) ?? null;
}

/** Public evidence projection used by the existing country-panel API. */
export function resolveAtlasTerritorialStatusCitations(record: AtlasTerritorialAuthorityRecord) {
  return record.citations.map((citation) => {
    const source = sourceById.get(citation.sourceId);
    invariant(source, `${record.id} cites missing source ${citation.sourceId}`);
    return {
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      supports: citation.supports,
      publishedAt: source.publishedAt,
    };
  });
}

export function getAtlasTerritorialStatusAuthorityOutlineEntityIds() {
  return ATLAS_TERRITORIAL_STATUS_AUTHORITY.records.map((record) => record.entityId);
}
