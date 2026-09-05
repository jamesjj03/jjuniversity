import type { AtlasCityFeature } from "./geographyTypes";

/** Small client identity record; canonical geometry stays in the source pack. */
export type AtlasCitySummary = {
  featureId: string;
  entityId: string;
  name: string;
  countryId: string | null;
  isNationalCapital: boolean;
  coordinates: [number, number];
  point: [number, number];
  sourceIds: string[];
};

export function atlasCitySummary(feature: AtlasCityFeature): AtlasCitySummary {
  return {
    featureId: feature.featureId, entityId: feature.entity.entityId,
    name: feature.name, countryId: feature.entity.countryId,
    isNationalCapital: feature.isNationalCapital,
    coordinates: feature.geometry.canonicalWgs84.coordinates as [number, number],
    point: feature.geometry.derived.point!, sourceIds: feature.sourceIds,
  };
}
