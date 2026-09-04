/**
 * Public data contract for the rebuilt Atlas.
 *
 * Mutable facts are observations with explicit source and time metadata. The
 * geometry and entity records also carry validity intervals so a later Atlas
 * snapshot can describe a historical world without changing this contract.
 */

export type AtlasDatePrecision =
  | "day"
  | "month"
  | "year"
  | "source_snapshot"
  | "unknown";

export interface AtlasTemporalExtent {
  observedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  precision: AtlasDatePrecision;
}

export interface AtlasObservation<T> {
  value: T;
  temporal: AtlasTemporalExtent;
  sourceId: string;
  sourceField: string;
  notes: string[];
}

export interface AtlasLicenseRecord {
  name: string;
  url: string;
}

export interface AtlasSourceRecord {
  id: string;
  title: string;
  publisher: string;
  url: string;
  license: AtlasLicenseRecord;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  localInput: string;
  checksumSha256: string;
  notes: string[];
}

export type AtlasGovernmentCategory =
  | "presidential_republic"
  | "parliamentary_republic"
  | "semi_presidential_republic"
  | "constitutional_monarchy"
  | "absolute_monarchy"
  | "one_party_state"
  | "military_or_transitional"
  | "theocracy"
  | "territory_or_dependency"
  | "other"
  | "unknown";

export type AtlasReligionCategory =
  | "christianity"
  | "islam"
  | "hinduism"
  | "buddhism"
  | "judaism"
  | "folk_or_traditional"
  | "religiously_unaffiliated"
  | "other"
  | "mixed_or_no_clear_majority"
  | "unknown";

export interface AtlasGovernmentValue {
  raw: string;
  category: AtlasGovernmentCategory;
  normalizationMethod: "factbook-government-rules-v1";
}

export interface AtlasLeadershipOfficeholder {
  /** A display-ready Factbook clause that deliberately keeps name and title together. */
  nameAndTitle: string;
  /** How this entry relates to the role heading, based only on explicit source wording and position. */
  relationship: "principal" | "representative" | "member" | "associated_official";
  termStartedAt: string | null;
  termStartPrecision: "day" | "month" | "year" | "unknown";
}

export interface AtlasLeadershipValue {
  raw: string;
  isVacant: boolean;
  officeholders: AtlasLeadershipOfficeholder[];
}

export interface AtlasReligionComposition {
  category: Exclude<
    AtlasReligionCategory,
    "mixed_or_no_clear_majority"
  >;
  sharePercent: number;
  shareIsApproximate: boolean;
  rawLabels: string[];
}

export interface AtlasReligionValue {
  raw: string;
  dominantCategory: AtlasReligionCategory;
  composition: AtlasReligionComposition[];
  normalizationMethod:
    | "factbook-percent-composition-v1"
    | "factbook-qualitative-label-v1"
    | "unresolved";
}

export interface AtlasLanguage {
  code: string;
  name: string | null;
}

export interface AtlasCurrency {
  code: string;
  name: string;
}

export interface AtlasCountryNames {
  common: string;
  official: string | null;
  aliases: string[];
}

export interface AtlasCountryCodes {
  naturalEarthAdm0A3: string;
  naturalEarthId: number;
  iso2: string | null;
  iso3: string | null;
  isoNumeric: string | null;
  worldBankIso2: string | null;
  worldBankIso3: string | null;
  geonamesIso2: string | null;
  geonamesIso3: string | null;
  geonamesId: string | null;
  factbookCode: string | null;
  wikidataId: string | null;
}

export interface AtlasCountryGeography {
  continent: string;
  region: string;
  subregion: string;
  worldBankRegion: string | null;
  incomeLevel: string | null;
  naturalEarthType: string;
  sovereignName: string;
  boundaryNote: string | null;
}

export interface AtlasJjuLink {
  title: string;
  href: string;
  kind: "book" | "topic" | "person" | "event" | "concept" | "other";
}

export interface AtlasCountryEntity {
  id: string;
  slug: string;
  names: AtlasCountryNames;
  codes: AtlasCountryCodes;
  geography: AtlasCountryGeography;
  temporal: Pick<AtlasTemporalExtent, "validFrom" | "validTo">;
  facts: {
    capital: AtlasObservation<string> | null;
    population: AtlasObservation<number> | null;
    areaKm2: AtlasObservation<number> | null;
    languages: AtlasObservation<AtlasLanguage[]> | null;
    currency: AtlasObservation<AtlasCurrency> | null;
    gdpCurrentUsd: AtlasObservation<number> | null;
    gdpPerCapitaCurrentUsd: AtlasObservation<number> | null;
    government: AtlasObservation<AtlasGovernmentValue> | null;
    headOfState: AtlasObservation<AtlasLeadershipValue> | null;
    headOfGovernment: AtlasObservation<AtlasLeadershipValue> | null;
    religion: AtlasObservation<AtlasReligionValue> | null;
  };
  /** Empty until links have passed a separate JJU editorial review. */
  jjuLinks: AtlasJjuLink[];
}

export interface AtlasCountrySnapshot {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  sources: AtlasSourceRecord[];
  countries: AtlasCountryEntity[];
}

export interface AtlasProjectedFeature {
  entityId: string;
  path: string;
  centroid: [number, number];
  bounds: [[number, number], [number, number]];
  tinyRank: number | null;
  mapColor7: number | null;
}

export interface AtlasGeometrySnapshot {
  schemaVersion: "1.0.0";
  snapshotId: string;
  projection: {
    id: "equal-earth";
    viewBox: [0, 0, 1200, 650];
    width: 1200;
    height: 650;
  };
  sourceId: string;
  temporal: Pick<AtlasTemporalExtent, "validFrom" | "validTo">;
  spherePath: string;
  graticulePath: string;
  features: AtlasProjectedFeature[];
}

export interface AtlasValidationCoverage {
  populated: number;
  total: number;
  percent: number;
}

export interface AtlasJoinAudit {
  sourceId: string;
  method: string;
  sourceRecords: number;
  matchedEntities: number;
  unmatchedSourceCodes: string[];
  entityCoverage: AtlasValidationCoverage;
}

export interface AtlasValidationIssue {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  entityIds: string[];
  sourceKeys: string[];
}

export interface AtlasValidationSnapshot {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  status: "pass" | "fail";
  counts: {
    geometryFeatures: number;
    countryEntities: number;
    uniqueEntityIds: number;
    uniqueNaturalEarthCodes: number;
  };
  coverage: Record<string, AtlasValidationCoverage>;
  joins: AtlasJoinAudit[];
  governmentCategoryCounts: Record<AtlasGovernmentCategory, number>;
  religionCategoryCounts: Record<AtlasReligionCategory, number>;
  issues: AtlasValidationIssue[];
}
