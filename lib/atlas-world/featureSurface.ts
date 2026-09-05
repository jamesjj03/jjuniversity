import type {
  AtlasCityFeature,
  AtlasGeographyPack,
  AtlasPhysicalFeature,
} from "./geographyTypes";

export type AtlasFeatureSurfaceKind = "city" | "river" | "lake";

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
};

type AtlasSurfaceFeature = AtlasPhysicalFeature | AtlasCityFeature;

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
  return {
    featureId: feature.featureId,
    placeId,
    kind: feature.kind,
    name: feature.name,
    bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]],
    point: feature.geometry.derived.point
      ?? pathLabelPoint(feature.geometry.derived.path, fallback),
    minimumZoom: feature.displayMinimumZoom ?? 1,
    maximumZoom: feature.displayMaximumZoom ?? null,
    sourceScaleRank: feature.sourceScaleRank,
    displayLod: feature.displayLod,
    geometryHref: feature.kind === "city"
      ? null
      : `/atlas-world/physical-mercator-${detail ? "detail" : "overview"}.v1.svg#${geometryAssetId(feature.featureId)}`,
    countryId: feature.kind === "city" ? feature.entity.countryId : null,
    isNationalCapital: feature.kind === "city" && feature.isNationalCapital,
  };
}

export function buildAtlasFeatureSurfaceIndex(
  collections: AtlasGeographyPack["featureCollections"],
): AtlasFeatureSurfaceRecord[] {
  return [
    ...collections.majorRivers.features,
    ...collections.majorLakes.features,
    ...collections.majorCities.features,
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
