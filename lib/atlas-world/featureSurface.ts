import type {
  AtlasCityFeature,
  AtlasGeographyPack,
  AtlasPhysicalFeature,
  AtlasWaterFeature,
  AtlasWatershedFeature,
} from "./geographyTypes";

export type AtlasFeatureSurfaceKind = "city" | "river" | "lake" | "water" | "watershed";

export type AtlasFeatureSurfaceRecord = {
  featureId: string;
  placeId: string;
  kind: AtlasFeatureSurfaceKind;
  name: string;
  bounds: [number, number, number, number];
  point: [number, number];
  minimumZoom: number;
  maximumZoom: number | null;
  sourceScaleRank: number | null;
  displayLod: "world" | "regional" | "country";
  geometryHref: string | null;
  countryId: string | null;
  isNationalCapital: boolean;
  label: {
    text: string;
    anchor: [number, number];
    priority: number;
    minimumZoom: number;
    maximumZoom: number | null;
  } | null;
};

type AtlasSurfaceFeature = AtlasPhysicalFeature | AtlasCityFeature | AtlasWaterFeature | AtlasWatershedFeature;

function geometryAssetId(featureId: string) {
  return featureId.replace(/[^A-Za-z0-9_-]/g, "-");
}

function pathLabelPoint(path: string | undefined, fallback: [number, number]): [number, number] {
  const values = path?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (values.length < 2) return fallback;
  const index = Math.floor(values.length / 4) * 2;
  return [values[index] ?? fallback[0], values[index + 1] ?? fallback[1]];
}

function boundsCenter(bounds: [[number, number], [number, number]]): [number, number] {
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
}

function toSurfaceRecord(feature: AtlasSurfaceFeature): AtlasFeatureSurfaceRecord {
  const bounds = feature.geometry.derived.bounds;
  const fallback = boundsCenter(bounds);
  const placeId = feature.kind === "city" ? feature.entity.entityId : feature.placeId;
  const detail = feature.sourceIds.some((sourceId) => sourceId.includes("10m"));
  const explicitLabel = feature.kind === "water" || feature.kind === "watershed" ? feature.label : null;
  const geometryHref = feature.kind === "city"
    ? null
    : feature.kind === "water"
      ? `/atlas-world/water-mercator.v1.svg#${geometryAssetId(feature.featureId)}`
      : feature.kind === "watershed"
        ? `/atlas-world/watersheds-mercator.v1.svg#${geometryAssetId(feature.featureId)}`
        : `/atlas-world/physical-mercator-${detail ? "detail" : "overview"}.v1.svg#${geometryAssetId(feature.featureId)}`;
  return {
    featureId: feature.featureId,
    placeId,
    kind: feature.kind,
    name: feature.name,
    bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
    point: explicitLabel?.anchorProjected
      ?? feature.geometry.derived.point
      ?? pathLabelPoint(feature.geometry.derived.path, fallback),
    minimumZoom: feature.kind === "watershed" ? feature.label.minimumZoom : feature.displayMinimumZoom ?? 1,
    maximumZoom: "displayMaximumZoom" in feature ? feature.displayMaximumZoom ?? null : null,
    sourceScaleRank: "sourceScaleRank" in feature ? feature.sourceScaleRank : null,
    displayLod: "displayLod" in feature ? feature.displayLod : "regional",
    geometryHref,
    countryId: feature.kind === "city" ? feature.entity.countryId : null,
    isNationalCapital: feature.kind === "city" && feature.isNationalCapital,
    label: explicitLabel ? {
      text: feature.name,
      anchor: explicitLabel.anchorProjected,
      priority: explicitLabel.priority,
      minimumZoom: explicitLabel.minimumZoom,
      maximumZoom: "maximumZoom" in explicitLabel ? explicitLabel.maximumZoom ?? null : null,
    } : null,
  };
}

export function buildAtlasFeatureSurfaceIndex(
  collections: AtlasGeographyPack["featureCollections"],
): AtlasFeatureSurfaceRecord[] {
  return [
    ...collections.majorRivers.features,
    ...collections.majorLakes.features,
    ...collections.majorCities.features,
    ...collections.majorWaterBodies.features,
    ...collections.watershedPilot.features,
  ].map(toSurfaceRecord);
}

export function atlasInitialFeatureSurfaceRecords(
  records: readonly AtlasFeatureSurfaceRecord[],
  focusedPlaceId: string | null,
) {
  return records.filter((record) =>
    record.minimumZoom <= 1
    || record.placeId === focusedPlaceId
    || record.featureId === focusedPlaceId,
  );
}
