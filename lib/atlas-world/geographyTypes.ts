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
    projectionId: "mercator";
    viewBox: [0, 0, 1200, 650];
    transformationId: string;
    path?: string;
    point?: [number, number];
    bounds: [[number, number], [number, number]];
  };
};

export type AtlasPhysicalFeature = {
  featureId: string;
  /** Stable logical place identity. Several LOD geometry parts may share it. */
  placeId: string;
  kind: "river" | "lake";
  name: string;
  alternateName: string | null;
  aliases: string[];
  entityIds: string[];
  entityRelation: {
    kind: "intersects_mapped_admin0_geometry";
    method: "natural-earth-admin0-intersection-v1";
  };
  sourceIds: string[];
  sourceFeatureId: string;
  sourceScaleRank: number | null;
  sourceMinZoom: number | null;
  displayLod: "world" | "regional" | "country";
  displayMinimumZoom?: number;
  displayMaximumZoom?: number;
  temporal: {
    observedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    precision: AtlasDatePrecision;
  };
  geometry: AtlasGeometryRecord;
  /** Bounded, source-backed descriptive facts. Geometry does not imply these values. */
  facts?: AtlasPhysicalFeatureFacts;
};

export type AtlasFeatureObservation<T> = {
  value: T;
  status: AtlasObservationStatus;
  unit: string | null;
  observedAt: string | null;
  sourceIds: string[];
  sourceStatementIds?: string[];
  notes: string[];
};

export type AtlasPhysicalFeatureFacts = {
  lengthKm?: AtlasFeatureObservation<number> | null;
  areaKm2?: AtlasFeatureObservation<number> | null;
  maximumDepthMetres?: AtlasFeatureObservation<number> | null;
  sourcePlace?: AtlasFeatureObservation<string> | null;
  headwaters?: AtlasFeatureObservation<string[]> | null;
  mouthPlace?: AtlasFeatureObservation<string> | null;
  basinName?: AtlasFeatureObservation<string> | null;
  basinAreaKm2?: AtlasFeatureObservation<number> | null;
  majorTributaries?: AtlasFeatureObservation<string[]> | null;
};

export type AtlasWaterKind = "ocean" | "sea" | "gulf" | "bay" | "strait" | "channel";

export type AtlasWaterFeature = {
  featureId: string;
  /** Stable logical identity; multipart Natural Earth polygons may share it. */
  placeId: string;
  kind: "water";
  waterKind: AtlasWaterKind;
  name: string;
  aliases: string[];
  wikidataId: string | null;
  adjacentEntityIds: string[];
  entityRelation: {
    kind: "coastline_adjacent_to_mapped_admin0_geometry";
    method: "natural-earth-marine-admin0-coastline-proximity-v1";
    toleranceDegrees: number;
    caveat: string;
  };
  label: {
    anchorWgs84: [number, number];
    anchorProjected: [number, number];
    priority: number;
    minimumZoom: number;
    maximumZoom: number | null;
    method: "representative-point-within-source-polygon";
  };
  sourceIds: string[];
  sourceFeatureId: string;
  sourceScaleRank: number;
  sourceMinZoom: number | null;
  displayLod: "world" | "regional" | "country";
  displayMinimumZoom: number;
  displayMaximumZoom?: number;
  temporal: {
    observedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    precision: AtlasDatePrecision;
  };
  geometry: AtlasGeometryRecord;
};

export type AtlasWatershedFeature = {
  featureId: string;
  placeId: string;
  kind: "watershed";
  name: string;
  aliases: string[];
  linkedRiverPlaceId: string;
  sourceIds: string[];
  sourceFeatureIds: string[];
  intersectingEntityIds: string[];
  entityRelation: {
    kind: "intersects_mapped_admin0_geometry";
    method: "world-bank-basin-admin0-intersection-v1";
    caveat: string;
  };
  label: {
    anchorWgs84: [number, number];
    anchorProjected: [number, number];
    priority: number;
    minimumZoom: number;
    method: "representative-point-within-derived-union";
  };
  temporal: {
    observedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    precision: AtlasDatePrecision;
  };
  geometry: AtlasGeometryRecord;
};

export type AtlasPlaceRelationship = {
  id: string;
  fromPlaceId: string;
  toPlaceId: string;
  kind: "near_mapped_geometry";
  wording: string;
  distanceKm: number;
  sourceIds: string[];
  evidence: {
    method: "nearest-wgs84-source-geometry-v1";
    thresholdKm: number;
    caveat: string;
  };
  review: {
    status: "derived-reviewed";
    reviewedAt: string;
  };
};

export type AtlasCityFeature = {
  featureId: string;
  kind: "city";
  name: string;
  aliases: string[];
  entity: AtlasEntityIdentity;
  administrativeRegion: string | null;
  isNationalCapital: boolean;
  isWorldCity: boolean;
  sourceScaleRank: number;
  sourceMinZoom: number | null;
  displayLod: "world" | "regional" | "country";
  displayMinimumZoom?: number;
  displayMaximumZoom?: number;
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

export type AtlasRasterAsset = {
  href: string;
  mediaType: string;
  width: number;
  height: number;
  /** Exact destination rectangle in the registered projected SVG coordinate space. */
  viewBox: [number, number, number, number];
  checksumSha256: string;
  bytes: number;
};

export type AtlasRasterPyramid = {
  projectionId: "mercator";
  /** Source pixel spacing, not positional accuracy or measured elevation. */
  sourceResolutionMetres: number;
  sourcePixelDegrees?: [number, number];
  nativeSourceDimensions?: [number, number];
  sourceCrs: string;
  resampling: "average" | "bilinear";
  maximumDecodedTileBytes: number;
  compositing: string;
  emptyTileBehavior: string;
  levels: Array<{
    id: string;
    minimumZoom: number;
    width: number;
    height: number;
    displayMetresPerPixel: number;
    bytes: number;
    tiles: Array<AtlasRasterAsset & { id: string }>;
  }>;
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
  asset?: AtlasRasterAsset;
  assetPyramid?: AtlasRasterPyramid;
  visualization?: Record<string, unknown>;
  statistics?: Record<string, unknown>;
  factPilot?: {
    placeIds: string[];
    omittedMeasures: string[];
    omissionReason: string;
  };
  caveats: string[];
};

export type AtlasGeographyPack = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  sourceLockId: string;
  projection: {
    id: "mercator";
    crs: string;
    viewBox: [0, 0, 1200, 650];
    canonicalCrs: "EPSG:4326";
    transformationId: string;
  };
  sources: AtlasGeographySource[];
  physicalGeometryAssets?: Record<"overview" | "detail", { href: string; mediaType: string; bytes: number; checksumSha256: string; featureCount: number }>;
  waterGeometryAsset?: { href: string; mediaType: string; bytes: number; checksumSha256: string; featureCount: number };
  watershedGeometryAsset?: { href: string; mediaType: string; bytes: number; checksumSha256: string; featureCount: number };
  globeContextAsset?: { href: string; mediaType: string; bytes: number; checksumSha256: string; riverCount: number; cityCount: number; waterLabelCount: number };
  transformations: Array<Record<string, unknown>>;
  datasets: AtlasGeographyDataset[];
  placeRelationships?: AtlasPlaceRelationship[];
  featureCollections: {
    majorRivers: { datasetId: string; features: AtlasPhysicalFeature[] };
    majorLakes: { datasetId: string; features: AtlasPhysicalFeature[] };
    majorCities: { datasetId: string; features: AtlasCityFeature[] };
    majorWaterBodies: { datasetId: string; features: AtlasWaterFeature[] };
    watershedPilot: { datasetId: string; features: AtlasWatershedFeature[] };
  };
};

export type AtlasGlobeContextAsset = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  canonicalCrs: "EPSG:4326";
  sourceLockId: string;
  sourceIds: string[];
  rivers: Array<{
    featureId: string;
    placeId: string;
    name: string;
    sourceScaleRank: number | null;
    geometry: AtlasWgs84Geometry;
  }>;
  cities: Array<{
    featureId: string;
    placeId: string;
    name: string;
    countryId: string | null;
    isNationalCapital: boolean;
    sourceScaleRank: number;
    coordinates: [number, number];
  }>;
  waterLabels: Array<{
    placeId: string;
    name: string;
    waterKind: AtlasWaterKind;
    priority: number;
    minimumZoom: number;
    coordinates: [number, number];
  }>;
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
    focus: { longitude: number; latitude: number; projected: [number, number] };
    boundsWgs84: [[number, number], [number, number]];
    /** Derived viewing extent, never a claim or measurement boundary. */
    viewingBoundsProjected?: [[number, number], [number, number]];
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
