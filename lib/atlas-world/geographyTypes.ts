import type { AtlasDatePrecision, AtlasObservationStatus } from "./types";

/**
 * A geographic feature is not an entity, and an entity is not its geometry.
 * These deliberately small Phase 2 contracts leave room for subdivisions and
 * historical geometry without pretending that ontology is already complete.
 */
export type AtlasPresentDayEntityKind =
  | "present-day-admin0"
  | "administrative-unit"
  | "city"
  | "site";

export type AtlasEntityIdentity = {
  entityId: string;
  kind: AtlasPresentDayEntityKind;
  parentId: string | null;
  sovereignId: string | null;
  countryId: string | null;
  adminLevel: number | null;
  codes: Array<{ scheme: string; value: string }>;
  temporal: { validFrom: string | null; validTo: string | null };
};

export type AtlasAdmin0EntityIdentity = AtlasEntityIdentity & {
  kind: "present-day-admin0";
  politicalStatus: {
    /** Retained rather than over-normalized; Natural Earth mixes legal and cartographic categories. */
    sourceClassification: string;
    sovereignName: string;
    relationToSovereign: "self" | "associated" | "contested_or_cartographic" | "unresolved";
  };
};

export type AtlasWgs84Geometry = {
  type: "Point" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

export type AtlasGeometryRecord = {
  geometryId: string;
  geometrySetId: string;
  geometryType: "point" | "linestring" | "multilinestring" | "polygon" | "multipolygon";
  crs: "EPSG:4326";
  canonicalWgs84: AtlasWgs84Geometry;
  boundsWgs84: [[number, number], [number, number]];
  derived: {
    projectionId: "equal-earth";
    viewBox: [0, 0, 1200, 650];
    transformationId: string;
    path?: string;
    point?: [number, number];
    bounds: [[number, number], [number, number]];
  };
};

export type AtlasPhysicalFeature = {
  featureId: string;
  kind: "river" | "lake";
  name: string;
  alternateName: string | null;
  entityIds: string[];
  sourceIds: string[];
  sourceFeatureId: string;
  sourceScaleRank: number | null;
  sourceMinZoom: number | null;
  displayLod: "world" | "regional" | "country";
  temporal: {
    observedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    precision: AtlasDatePrecision;
  };
  geometry: AtlasGeometryRecord;
};

export type AtlasCityFeature = {
  featureId: string;
  kind: "city";
  name: string;
  entity: AtlasEntityIdentity;
  isNationalCapital: boolean;
  isWorldCity: boolean;
  sourceScaleRank: number;
  sourceMinZoom: number | null;
  displayLod: "world" | "regional" | "country";
  population: {
    value: number;
    status: AtlasObservationStatus;
    unit: "people";
    temporal: {
      observedAt: string | null;
      validFrom: string | null;
      validTo: string | null;
      precision: AtlasDatePrecision;
    };
    sourceIds: string[];
    sourceField: string;
    notes: string[];
  } | null;
  sourceIds: string[];
  temporal: {
    observedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    precision: AtlasDatePrecision;
  };
  geometry: AtlasGeometryRecord;
};

export type AtlasGeographySource = {
  id: string;
  title: string;
  publisher: string;
  version: string;
  url: string;
  retrievedAt: string;
  license: { name: string; url: string };
  checksumSha256: string;
};

export type AtlasGeographyDataset = {
  id: string;
  name: string;
  dataType: string;
  measure: string;
  unit: string | null;
  geographicResolution: string;
  conceptualResolution: string;
  temporal: {
    support: "static" | "snapshot";
    observedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    precision: AtlasDatePrecision;
    selectionPolicy: "exact" | "timeless";
  };
  sourceIds: string[];
  transformationId: string;
  asset?: {
    href: string;
    mediaType: string;
    width: number;
    height: number;
    viewBox: [0, 0, 1200, 650];
    checksumSha256: string;
    bytes: number;
  };
  visualization?: Record<string, unknown>;
  statistics?: Record<string, unknown>;
  caveats: string[];
};

export type AtlasGeographyPack = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  sourceLockId: string;
  projection: {
    id: "equal-earth";
    viewBox: [0, 0, 1200, 650];
    canonicalCrs: "EPSG:4326";
    transformationId: string;
  };
  sources: AtlasGeographySource[];
  transformations: Array<Record<string, unknown>>;
  datasets: AtlasGeographyDataset[];
  featureCollections: {
    majorRivers: { datasetId: string; features: AtlasPhysicalFeature[] };
    majorLakes: { datasetId: string; features: AtlasPhysicalFeature[] };
    majorCities: { datasetId: string; features: AtlasCityFeature[] };
  };
};

export type AtlasPatternNoteEvidence = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  supports: string;
};

export type AtlasPatternNote = {
  id: string;
  revision: number;
  headline: string;
  summary: string;
  noteType: "spatial-explanation";
  causalStrength: "supported-multifactor";
  triggers: {
    datasetIds: string[];
    viewPresetIds: string[];
    minimumZoom: number;
    maximumZoom: number;
  };
  spatial: {
    focus: { longitude: number; latitude: number; equalEarth: [number, number] };
    boundsWgs84: [[number, number], [number, number]];
    entityIds: string[];
    featureIds: string[];
    highlight: Record<string, unknown>;
  };
  observationRefs: Array<{
    datasetId: string;
    snapshotId: string;
    observedAt: string | null;
    status: AtlasObservationStatus;
  }>;
  evidence: AtlasPatternNoteEvidence[];
  relatedLayerIds: string[];
  caveats: string[];
  temporal: { validFrom: string | null; validTo: string | null; precision: string };
  review: {
    status: "source-reviewed";
    reviewerKind: "ai-assisted";
    reviewedBy: string;
    reviewedAt: string;
    humanEditorialReview: "not-performed";
    publicationStatus: "atlas-visible";
  };
};

export type AtlasPatternNoteSnapshot = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  modelName: "PatternNote";
  modelStatus: "internal-name-only";
  notes: AtlasPatternNote[];
};
