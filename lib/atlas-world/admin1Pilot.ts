import snapshotJson from "./data/admin1-pilot.v1.json";

export type AtlasAdmin1Observation<T> = {
  value: T;
  status: "observed" | "estimated";
  unit: string | null;
  temporal: {
    observedAt: string;
    validFrom: string | null;
    validTo: string | null;
    precision: "day" | "year";
  };
  sourceIds: string[];
  sourceField: string;
  notes: string[];
};

export type AtlasAdmin1PilotFeature = {
  featureId: string;
  kind: "administrative-unit";
  name: string;
  aliases: string[];
  administrativeType: string | null;
  entity: {
    entityId: string;
    kind: "administrative-unit";
    parentId: string;
    sovereignId: string;
    countryId: string;
    adminLevel: 1;
    codes: Array<{ scheme: string; value: string }>;
    temporal: { validFrom: string | null; validTo: string | null };
  };
  sourceIds: string[];
  sourceAdministrativeType: string | null;
  displayMinimumZoom: number;
  labelMinimumZoom: number;
  label: { wgs84: [number, number]; projected: [number, number] };
  temporal: {
    observedAt: string | null;
    validFrom: string | null;
    validTo: string | null;
    precision: "source_snapshot";
  };
  observations: {
    population: AtlasAdmin1Observation<number> | null;
  };
  geometry: {
    geometryId: string;
    geometrySetId: string;
    geometryType: "polygon" | "multipolygon";
    crs: "EPSG:4326";
    canonicalAsset: string;
    canonicalFeatureId: string;
    boundsWgs84: [[number, number], [number, number]];
    derived: {
      projectionId: "mercator";
      viewBox: [0, 0, 1200, 650];
      transformationId: string;
      assetHref: string;
      assetId: string;
      bounds: [[number, number], [number, number]];
    };
  };
};

export type AtlasAdmin1PilotSnapshot = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  sourceLockId: string;
  projection: {
    id: "mercator";
    viewBox: [0, 0, 1200, 650];
    canonicalCrs: "EPSG:4326";
    transformationId: string;
  };
  pilot: {
    status: "bounded-pilot";
    countryIds: string[];
    featureCount: number;
    coverageStatement: string;
    excludedSourceFeatures: Array<{
      sourceFeatureId: string;
      sourceCode: string;
      name: string;
      reason: string;
    }>;
  };
  source: {
    id: string;
    title: string;
    publisher: string;
    version: string;
    url: string;
    retrievedAt: string;
    license: { name: string; url: string };
    checksumSha256: string;
    sourcePerspective: string;
  };
  observationSources: Array<{
    id: string;
    title: string;
    publisher: string;
    version: string;
    url: string;
    retrievedAt: string;
    license: { name: string; url: string };
    checksumSha256: string;
  }>;
  observationDatasets: Array<{
    id: string;
    name: string;
    geographicResolution: string;
    temporal: {
      support: "snapshot";
      observedAt: string;
      precision: "day" | "year";
      selectionPolicy: "exact";
    };
    sourceIds: string[];
    coverage: { populatedFeatures: number; totalPilotFeatures: number; countryIds: string[] };
    caveats: string[];
  }>;
  dataset: {
    id: string;
    name: string;
    geographicResolution: string;
    conceptualResolution: string;
    temporal: {
      support: "snapshot";
      observedAt: string | null;
      validFrom: string | null;
      validTo: string | null;
      precision: "source_snapshot";
      selectionPolicy: "exact";
    };
    sourceIds: string[];
    transformationId: string;
    canonicalAsset: {
      path: string;
      mediaType: "application/geo+json";
      bytes: number;
      checksumSha256: string;
      crs: "EPSG:4326";
    };
    derivedAsset: {
      href: string;
      mediaType: "image/svg+xml";
      bytes: number;
      checksumSha256: string;
      projectionId: "mercator";
      viewBox: [0, 0, 1200, 650];
    };
    caveats: string[];
  };
  features: AtlasAdmin1PilotFeature[];
};

const snapshot = snapshotJson as unknown as AtlasAdmin1PilotSnapshot;

export function getAtlasAdmin1Pilot() {
  return snapshot;
}

export function resolveAtlasAdmin1Focus(rawFocus: string | null) {
  if (!rawFocus) return null;
  return snapshot.features.find((feature) => feature.entity.entityId === rawFocus) ?? null;
}
