import { expect, test } from "@playwright/test";
import countries from "../../lib/atlas-world/data/countries.v1.json";
import schema from "../../lib/atlas-world/territorial-status/schema/authority.v1.schema.json";
import {
  ATLAS_TERRITORIAL_STATUS_AUTHORITY,
  getAtlasTerritorialStatusAuthorityRecord,
  resolveAtlasTerritorialStatusCitations,
  validateAtlasTerritorialStatusAuthority,
} from "../../lib/atlas-world/territorial-status/authority";
import { getAtlasTerritorialStatus } from "../../lib/atlas-world/territorialStatus";

const FULL_CASES = [
  "country:SAH",
  "country:KOS",
  "country:CYN",
  "country:SOL",
  "country:PSX",
  "country:TWN",
] as const;

test("territorial authority is bounded, source-explicit, reviewed, and carries no control geometry", () => {
  const authority = ATLAS_TERRITORIAL_STATUS_AUTHORITY;
  expect(authority.schemaVersion).toBe("1.0.0");
  expect(schema.properties.schemaVersion.const).toBe(authority.schemaVersion);
  expect(schema.properties.authorityId.const).toBe(authority.authorityId);
  expect(authority.policy).toEqual({
    geometrySemantic: "map-unit-outline",
    controlLineGeometryIncluded: false,
    adjudicatesSovereignty: false,
    requireSourceForEveryRelationship: true,
    requireReviewMetadata: true,
  });
  expect(authority.records).toHaveLength(7);
  expect(new Set(authority.records.map((record) => record.entityId))).toEqual(new Set([...FULL_CASES, "country:KAS"]));
  expect(new Set(authority.sources.map((source) => source.id)).size).toBe(authority.sources.length);

  const sourceIds = new Set(authority.sources.map((source) => source.id));
  for (const source of authority.sources) {
    expect(source.url, source.id).toMatch(/^https:\/\//);
    expect(source.retrievedAt, source.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
  for (const record of authority.records) {
    expect(record.geometrySemantic, record.id).toBe("map-unit-outline");
    expect(record.review.status, record.id).toBe("published-reviewed");
    expect(record.review.reviewedBy, record.id).toBeTruthy();
    expect(record.review.reviewedAt, record.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(record.review.sourceCheckedThrough, record.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(record), record.id).not.toContain('"coordinates"');
    for (const relationship of [
      ...record.claimants,
      ...record.administratorsOrControllers,
      ...record.internationalStatus.perspectives,
    ]) {
      expect(relationship.sourceIds.length, `${record.id}/${relationship.actorId}`).toBeGreaterThan(0);
      expect(relationship.sourceIds.every((sourceId) => sourceIds.has(sourceId)), `${record.id}/${relationship.actorId}`).toBe(true);
    }
    expect(resolveAtlasTerritorialStatusCitations(record).length, record.id).toBe(record.citations.length);
  }
});
test("the six authored cases preserve detailed public explanations and pin the reviewed source snapshot", () => {
  for (const entityId of FULL_CASES) {
    const record = getAtlasTerritorialStatusAuthorityRecord(entityId)!;
    const country = countries.countries.find((candidate) => candidate.id === entityId)!;
    expect(record.scope, entityId).toBe("territorial-status-case");
    expect(record.placeName, entityId).toBe(country.names.common);
    expect(record.sourceSnapshot, entityId).toEqual({
      datasetId: "natural-earth-admin-0-50m-5.1.2",
      classification: country.geography.naturalEarthType,
      sovereignName: country.geography.sovereignName,
      boundaryNote: country.geography.boundaryNote,
    });
    expect(record.claimants.length, entityId).toBeGreaterThan(0);
    expect(record.administratorsOrControllers.length, entityId).toBeGreaterThan(0);
    expect(record.internationalStatus.perspectives.length, entityId).toBeGreaterThan(0);
    for (const field of ["summary", "claims", "administration", "disputeReason", "mapChoice"] as const) {
      expect(record.explanation[field].length, `${entityId}.${field}`).toBeGreaterThan(50);
    }

    const publicStatus = getAtlasTerritorialStatus(country);
    expect(publicStatus.summary, entityId).toBe(record.explanation.summary);
    expect(publicStatus.claims, entityId).toBe(record.explanation.claims);
    expect(publicStatus.administration, entityId).toBe(record.explanation.administration);
    expect(publicStatus.disputeReason, entityId).toBe(record.explanation.disputeReason);
    expect(publicStatus.mapChoice, entityId).toBe(record.explanation.mapChoice);
    expect(publicStatus.observedAt, entityId).toBe(record.review.reviewedAt);
    expect(publicStatus.evidence.length, entityId).toBe(record.citations.length + 2);
  }
});

test("Siachen is explicitly scoped to one source map unit, never all Kashmir", () => {
  const record = getAtlasTerritorialStatusAuthorityRecord("country:KAS")!;
  const country = countries.countries.find((candidate) => candidate.id === "country:KAS")!;
  expect(record.scope).toBe("specific-feature-only");
  expect(record.scopeCaveat).toMatch(/not a model of all Kashmir/i);
  expect(record.administratorsOrControllers).toEqual([]);
  expect(record.explanation.mapChoice).toContain("not all Kashmir");
  expect(record.sourceSnapshot.boundaryNote).toBe("Claimed by Pakistan and India");
  const status = getAtlasTerritorialStatus(country);
  expect(status.summary).toContain("not a sovereign country");
  expect(status.caveat).toContain("not a model of all Kashmir");
  expect(status.caveat).toContain("not live control lines");
});

test("authority validation fails closed on missing provenance, review metadata, or embedded geometry", () => {
  const missingSource = structuredClone(ATLAS_TERRITORIAL_STATUS_AUTHORITY);
  missingSource.records[0].claimants[0].sourceIds = ["source:does-not-exist"];
  expect(() => validateAtlasTerritorialStatusAuthority(missingSource)).toThrow(/unknown source/);

  const missingReview = structuredClone(ATLAS_TERRITORIAL_STATUS_AUTHORITY);
  missingReview.records[0].review.reviewedBy = "";
  expect(() => validateAtlasTerritorialStatusAuthority(missingReview)).toThrow(/reviewer identity/);

  const embeddedGeometry = structuredClone(ATLAS_TERRITORIAL_STATUS_AUTHORITY) as unknown as {
    records: Array<Record<string, unknown>>;
  };
  embeddedGeometry.records[0].coordinates = [[0, 0], [1, 1]];
  expect(() => validateAtlasTerritorialStatusAuthority(embeddedGeometry)).toThrow(/embeds geometry or a control line/);
});
