import type {
  AtlasCityFeature,
  AtlasGeographyPack,
  AtlasPlaceRelationship,
  AtlasPhysicalFeature,
  AtlasWaterFeature,
  AtlasWatershedFeature,
} from "./geographyTypes";
import type { AtlasObservationStatus } from "./types";

export type AtlasPlaceKind = "city" | "river" | "lake" | "water" | "watershed";
export type AtlasPlaceBounds = [[number, number], [number, number]];

export type AtlasRelatedPlace = {
  placeId: string;
  name: string;
  placeKind: AtlasPlaceKind;
  relationship: "near_mapped_geometry" | "drainage_basin" | "river_system";
  wording: string;
  distanceKm: number | null;
  sourceIds: string[];
  caveat: string | null;
};

export type AtlasPlaceObservation<T> = {
  value: T;
  status: AtlasObservationStatus;
  unit: string | null;
  observedAt: string | null;
  sourceIds: string[];
  notes: string[];
};

type AtlasPlaceSummaryBase = {
  /** Stable logical identity. Geometry-part IDs remain separate. */
  placeId: string;
  kind: AtlasPlaceKind;
  name: string;
  aliases: string[];
  /** Friendly, deterministic value suitable for `city=` or `feature=`. */
  shareKey: string;
  featureIds: string[];
  sourceIds: string[];
  boundsWgs84: AtlasPlaceBounds;
  boundsProjected: AtlasPlaceBounds;
  focusPoint: [number, number];
  relatedCountryIds: string[];
  relatedPlaces: AtlasRelatedPlace[];
  observedAt: string | null;
};

export type AtlasCityPlaceSummary = AtlasPlaceSummaryBase & {
  kind: "city";
  entityId: string;
  countryId: string | null;
  administrativeRegion: string | null;
  coordinates: [number, number];
  isNationalCapital: boolean;
  isWorldCity: boolean;
  population: AtlasPlaceObservation<number> | null;
  elevationMetres: AtlasPlaceObservation<number> | null;
};

export type AtlasPhysicalPlaceSummary = AtlasPlaceSummaryBase & {
  kind: "river" | "lake";
  sourceFeatureIds: string[];
  /** Describes only the mapped geometry relationship, never an entire basin. */
  countryRelationship: "crosses_mapped_admin0" | "borders_mapped_admin0" | null;
  lengthKm: AtlasPlaceObservation<number> | null;
  areaKm2: AtlasPlaceObservation<number> | null;
  maximumDepthMetres: AtlasPlaceObservation<number> | null;
  sourcePlace: AtlasPlaceObservation<string> | null;
  headwaters: AtlasPlaceObservation<string[]> | null;
  mouthPlace: AtlasPlaceObservation<string> | null;
  basinName: AtlasPlaceObservation<string> | null;
  basinAreaKm2: AtlasPlaceObservation<number> | null;
  majorTributaries: AtlasPlaceObservation<string[]> | null;
};

export type AtlasWaterPlaceSummary = AtlasPlaceSummaryBase & {
  kind: "water";
  waterKind: AtlasWaterFeature["waterKind"];
  wikidataId: string | null;
  /** Explicitly a cartographic coastline relation, never political ownership. */
  countryRelationship: "coastline_adjacent_to_mapped_admin0" | null;
  label: AtlasWaterFeature["label"];
};

export type AtlasWatershedPlaceSummary = AtlasPlaceSummaryBase & {
  kind: "watershed";
  linkedRiverPlaceId: string;
  sourceFeatureIds: string[];
  countryRelationship: "intersects_mapped_admin0" | null;
  label: AtlasWatershedFeature["label"];
};

export type AtlasPlaceSummary =
  | AtlasCityPlaceSummary
  | AtlasPhysicalPlaceSummary
  | AtlasWaterPlaceSummary
  | AtlasWatershedPlaceSummary;

type FuturePlaceFields = {
  elevationMetres?: AtlasPlaceObservation<number> | null;
  relatedCountryIds?: string[];
  countryRelationship?: AtlasPhysicalPlaceSummary["countryRelationship"];
  names?: { common?: string; aliases?: string[] };
  facts?: Partial<Pick<
    AtlasPhysicalPlaceSummary,
    "lengthKm" | "areaKm2" | "maximumDepthMetres" | "sourcePlace" | "headwaters" | "mouthPlace" | "basinName" | "basinAreaKm2" | "majorTributaries"
  >>;
};

type PhysicalInput = AtlasPhysicalFeature & FuturePlaceFields;
type CityInput = AtlasCityFeature & FuturePlaceFields;

type AtlasPhysicalPlaceFacts = Pick<
  AtlasPhysicalPlaceSummary,
  "lengthKm" | "areaKm2" | "maximumDepthMetres" | "sourcePlace" | "headwaters" | "mouthPlace" | "basinName" | "basinAreaKm2" | "majorTributaries"
>;

const EMPTY_PHYSICAL_FACTS: AtlasPhysicalPlaceFacts = {
  lengthKm: null,
  areaKm2: null,
  maximumDepthMetres: null,
  sourcePlace: null,
  headwaters: null,
  mouthPlace: null,
  basinName: null,
  basinAreaKm2: null,
  majorTributaries: null,
};

/** Search normalization is deliberately shared by names and URL keys. */
export function atlasPlaceSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unnamed";
}

function stableDigest(value: string) {
  // FNV-1a is sufficient here: this is a readable disambiguator, not a
  // provenance checksum or security boundary.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

function unique(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function unionBounds(bounds: AtlasPlaceBounds[]): AtlasPlaceBounds {
  return [
    [Math.min(...bounds.map((entry) => entry[0][0])), Math.min(...bounds.map((entry) => entry[0][1]))],
    [Math.max(...bounds.map((entry) => entry[1][0])), Math.max(...bounds.map((entry) => entry[1][1]))],
  ];
}

function boundsCenter(bounds: AtlasPlaceBounds): [number, number] {
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
}

function flattenCoordinates(value: unknown, output: Array<[number, number]> = []) {
  if (!Array.isArray(value)) return output;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    output.push([value[0], value[1]]);
    return output;
  }
  for (const child of value) flattenCoordinates(child, output);
  return output;
}

function expandedBoundsOverlap(left: AtlasPlaceBounds, right: AtlasPlaceBounds, tolerance: number) {
  return left[0][0] <= right[1][0] + tolerance
    && left[1][0] + tolerance >= right[0][0]
    && left[0][1] <= right[1][1] + tolerance
    && left[1][1] + tolerance >= right[0][1];
}

function pointSegmentDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const amount = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
  ));
  return Math.hypot(
    point[0] - (start[0] + amount * dx),
    point[1] - (start[1] + amount * dy),
  );
}

function coordinatesConnect(left: PhysicalInput, right: PhysicalInput) {
  const tolerance = left.kind === "river" ? 0.08 : 0.025;
  if (!expandedBoundsOverlap(left.geometry.boundsWgs84, right.geometry.boundsWgs84, tolerance)) {
    return false;
  }
  const leftPoints = flattenCoordinates(left.geometry.canonicalWgs84.coordinates);
  const rightPoints = flattenCoordinates(right.geometry.canonicalWgs84.coordinates);
  if (leftPoints.length === 0 || rightPoints.length === 0) return false;

  const sampled = leftPoints.length <= rightPoints.length ? leftPoints : rightPoints;
  const segments = leftPoints.length <= rightPoints.length ? rightPoints : leftPoints;
  const stride = Math.max(1, Math.floor(sampled.length / 80));
  for (let pointIndex = 0; pointIndex < sampled.length; pointIndex += stride) {
    const point = sampled[pointIndex];
    for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
      if (pointSegmentDistance(point, segments[segmentIndex - 1], segments[segmentIndex]) <= tolerance) {
        return true;
      }
    }
  }
  return false;
}

function featureNames(feature: PhysicalInput) {
  return unique([
    feature.names?.common,
    feature.name,
    feature.alternateName,
    ...(feature.names?.aliases ?? []),
    ...(feature.aliases ?? []),
  ]);
}

function logicalPlaceId(feature: AtlasPhysicalFeature) {
  // Retain the fallback for a preserved pre-Phase-3 pack while the contract
  // and generated geography move forward together.
  return (feature as AtlasPhysicalFeature & { placeId?: string }).placeId;
}

function namesOverlap(left: PhysicalInput, right: PhysicalInput) {
  const rightNames = new Set(featureNames(right).map(atlasPlaceSlug));
  return featureNames(left).some((name) => rightNames.has(atlasPlaceSlug(name)));
}

class DisjointSet {
  private readonly parents: number[];

  constructor(length: number) {
    this.parents = Array.from({ length }, (_, index) => index);
  }

  find(value: number): number {
    const parent = this.parents[value];
    if (parent === value) return value;
    this.parents[value] = this.find(parent);
    return this.parents[value];
  }

  union(left: number, right: number) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parents[rightRoot] = leftRoot;
  }
}

function assignUniqueShareKeys<T extends AtlasPlaceSummary>(
  places: T[],
  baseKey: (place: T) => string,
) {
  const groups = new Map<string, T[]>();
  for (const place of places) {
    const key = baseKey(place);
    const group = groups.get(key) ?? [];
    group.push(place);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    if (group.length === 1) {
      group[0].shareKey = key;
      continue;
    }
    for (const place of group) place.shareKey = `${key}--${stableDigest(place.placeId)}`;
  }
  return places;
}

function cityCountrySuffix(countryId: string | null) {
  return countryId ? atlasPlaceSlug(countryId.split(":").at(-1) ?? countryId) : "unplaced";
}

export function atlasCityPlaceSummaries(features: readonly AtlasCityFeature[]) {
  const places: AtlasCityPlaceSummary[] = features.map((sourceFeature) => {
    const feature = sourceFeature as CityInput;
    const coordinates = feature.geometry.canonicalWgs84.coordinates as [number, number];
    const point = feature.geometry.derived.point ?? boundsCenter(feature.geometry.derived.bounds);
    const sourceIds = unique([
      ...feature.sourceIds,
      ...(feature.population?.sourceIds ?? []),
      ...(feature.elevationMetres?.sourceIds ?? []),
    ]);
    return {
      placeId: feature.entity.entityId,
      kind: "city",
      name: feature.names?.common ?? feature.name,
      aliases: unique([
        ...(feature.names?.aliases ?? []),
        ...(feature.aliases ?? []),
      ]),
      shareKey: "",
      featureIds: [feature.featureId],
      sourceIds,
      boundsWgs84: feature.geometry.boundsWgs84,
      boundsProjected: feature.geometry.derived.bounds,
      focusPoint: point,
      relatedCountryIds: feature.entity.countryId ? [feature.entity.countryId] : [],
      relatedPlaces: [],
      observedAt: feature.temporal.observedAt,
      entityId: feature.entity.entityId,
      countryId: feature.entity.countryId,
      administrativeRegion: feature.administrativeRegion ?? null,
      coordinates,
      isNationalCapital: feature.isNationalCapital,
      isWorldCity: feature.isWorldCity,
      population: feature.population ? {
        value: feature.population.value,
        status: feature.population.status,
        unit: feature.population.unit,
        observedAt: feature.population.temporal.observedAt,
        sourceIds: feature.population.sourceIds,
        notes: feature.population.notes,
      } : null,
      elevationMetres: feature.elevationMetres ?? null,
    };
  });
  return assignUniqueShareKeys(places, (place) =>
    `${atlasPlaceSlug(place.name)}-${cityCountrySuffix(place.countryId)}`,
  ).sort((left, right) => left.name.localeCompare(right.name) || left.placeId.localeCompare(right.placeId));
}

function physicalAnchor(features: PhysicalInput[]) {
  return features.slice().sort((left, right) => {
    const leftCoarse = left.sourceIds.some((id) => id.includes("50m")) ? 0 : 1;
    const rightCoarse = right.sourceIds.some((id) => id.includes("50m")) ? 0 : 1;
    return leftCoarse - rightCoarse
      || (left.sourceScaleRank ?? 99) - (right.sourceScaleRank ?? 99)
      || left.featureId.localeCompare(right.featureId);
  })[0];
}

function fallbackPhysicalPlaceId(features: PhysicalInput[]) {
  const anchor = physicalAnchor(features);
  const identity = anchor.sourceFeatureId || anchor.featureId;
  return `place:natural-earth:${anchor.kind}:${atlasPlaceSlug(identity)}`;
}

function physicalName(features: PhysicalInput[]) {
  const anchor = physicalAnchor(features);
  const semanticId = logicalPlaceId(anchor)?.split(":").at(-1);
  if (semanticId && !/^\d+$/.test(semanticId) && !/^(?:10m|50m)-/.test(semanticId)) {
    const identityName = features.flatMap(featureNames)
      .find((name) => atlasPlaceSlug(name) === atlasPlaceSlug(semanticId));
    if (identityName) return identityName;
  }
  return anchor.names?.common ?? featureNames(anchor).find((name) => name !== "Unnamed feature") ?? "Unnamed feature";
}

function groupPhysicalFeatures(features: readonly AtlasPhysicalFeature[]) {
  const sorted = features
    .map((feature) => feature as PhysicalInput)
    .slice()
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
  const explicitGroups = new Map<string, PhysicalInput[]>();
  const unkeyed: PhysicalInput[] = [];
  for (const feature of sorted) {
    const placeId = logicalPlaceId(feature);
    if (!placeId) {
      unkeyed.push(feature);
      continue;
    }
    const group = explicitGroups.get(placeId) ?? [];
    group.push(feature);
    explicitGroups.set(placeId, group);
  }

  // Generated packs carry a logical identity on every part, making the hot
  // server path linear. The spatial fallback remains for preserved older packs.
  const sets = new DisjointSet(unkeyed.length);

  for (let leftIndex = 0; leftIndex < unkeyed.length; leftIndex += 1) {
    const left = unkeyed[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < unkeyed.length; rightIndex += 1) {
      const right = unkeyed[rightIndex];
      if (left.kind !== right.kind) continue;
      if (left.sourceFeatureId && left.sourceFeatureId === right.sourceFeatureId && namesOverlap(left, right)) {
        sets.union(leftIndex, rightIndex);
        continue;
      }
      // A shared name only opens the comparison. Actual spatial contact is
      // required, preventing unrelated San Juan/Red/Grande rivers worldwide
      // from collapsing into one place.
      if (namesOverlap(left, right) && coordinatesConnect(left, right)) {
        sets.union(leftIndex, rightIndex);
      }
    }
  }

  const grouped = new Map<number, PhysicalInput[]>();
  unkeyed.forEach((feature, index) => {
    const root = sets.find(index);
    const group = grouped.get(root) ?? [];
    group.push(feature);
    grouped.set(root, group);
  });
  return [...explicitGroups.values(), ...grouped.values()];
}

export function atlasPhysicalPlaceSummaries(features: readonly AtlasPhysicalFeature[]) {
  const places = groupPhysicalFeatures(features).map((group): AtlasPhysicalPlaceSummary => {
    const explicitId = group.map(logicalPlaceId).find(Boolean);
    const name = physicalName(group);
    const aliases = unique(group.flatMap(featureNames)).filter((alias) =>
      alias.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US"),
    );
    const boundsWgs84 = unionBounds(group.map((feature) => feature.geometry.boundsWgs84));
    const boundsProjected = unionBounds(group.map((feature) => feature.geometry.derived.bounds));
    const relatedCountryIds = unique(group.flatMap((feature) => [
      ...feature.entityIds,
      ...(feature.relatedCountryIds ?? []),
    ])).sort();
    const factSourceIds = group.flatMap((feature) => Object.values(feature.facts ?? {})
      .flatMap((fact) => fact?.sourceIds ?? []));
    const sourceIds = unique([...group.flatMap((feature) => feature.sourceIds), ...factSourceIds]).sort();
    const facts = group.reduce<AtlasPhysicalPlaceFacts>(
      (current, feature) => ({ ...current, ...feature.facts }),
      { ...EMPTY_PHYSICAL_FACTS },
    );
    const kind = group[0].kind;
    return {
      placeId: explicitId ?? fallbackPhysicalPlaceId(group),
      kind,
      name,
      aliases,
      shareKey: "",
      featureIds: unique(group.map((feature) => feature.featureId)).sort(),
      sourceFeatureIds: unique(group.map((feature) => feature.sourceFeatureId)).sort(),
      sourceIds,
      boundsWgs84,
      boundsProjected,
      focusPoint: boundsCenter(boundsProjected),
      relatedCountryIds,
      relatedPlaces: [],
      countryRelationship: group.find((feature) => feature.countryRelationship)?.countryRelationship
        ?? (relatedCountryIds.length > 0
          ? kind === "river" ? "crosses_mapped_admin0" : "borders_mapped_admin0"
          : null),
      observedAt: group.find((feature) => feature.temporal.observedAt)?.temporal.observedAt ?? null,
      ...facts,
    };
  });
  return assignUniqueShareKeys(places, (place) => `${place.kind}:${atlasPlaceSlug(place.name)}`)
    .sort((left, right) => left.name.localeCompare(right.name) || left.placeId.localeCompare(right.placeId));
}

export function atlasWaterPlaceSummaries(features: readonly AtlasWaterFeature[]) {
  const grouped = new Map<string, AtlasWaterFeature[]>();
  for (const feature of features) {
    const group = grouped.get(feature.placeId) ?? [];
    group.push(feature);
    grouped.set(feature.placeId, group);
  }
  const places = [...grouped.values()].map((group): AtlasWaterPlaceSummary => {
    const anchor = group.slice().sort((left, right) =>
      left.sourceScaleRank - right.sourceScaleRank || left.featureId.localeCompare(right.featureId)
    )[0];
    const boundsWgs84 = unionBounds(group.map((feature) => feature.geometry.boundsWgs84));
    const boundsProjected = unionBounds(group.map((feature) => feature.geometry.derived.bounds));
    const relatedCountryIds = unique(group.flatMap((feature) => feature.adjacentEntityIds)).sort();
    return {
      placeId: anchor.placeId,
      kind: "water",
      waterKind: anchor.waterKind,
      name: anchor.name,
      aliases: unique(group.flatMap((feature) => [feature.name, ...feature.aliases]))
        .filter((alias) => alias.toLocaleLowerCase("en-US") !== anchor.name.toLocaleLowerCase("en-US")),
      shareKey: "",
      featureIds: unique(group.map((feature) => feature.featureId)).sort(),
      sourceIds: unique(group.flatMap((feature) => feature.sourceIds)).sort(),
      boundsWgs84,
      boundsProjected,
      focusPoint: anchor.label.anchorProjected,
      relatedCountryIds,
      relatedPlaces: [],
      observedAt: anchor.temporal.observedAt,
      wikidataId: anchor.wikidataId,
      countryRelationship: relatedCountryIds.length > 0 ? "coastline_adjacent_to_mapped_admin0" : null,
      label: anchor.label,
    };
  });
  return assignUniqueShareKeys(places, (place) => `water:${atlasPlaceSlug(place.name)}`)
    .sort((left, right) => left.name.localeCompare(right.name) || left.placeId.localeCompare(right.placeId));
}

export function atlasWatershedPlaceSummaries(features: readonly AtlasWatershedFeature[]) {
  const places: AtlasWatershedPlaceSummary[] = features.map((feature) => ({
    placeId: feature.placeId,
    kind: "watershed",
    name: feature.name,
    aliases: feature.aliases,
    shareKey: `watershed:${atlasPlaceSlug(feature.name)}`,
    featureIds: [feature.featureId],
    sourceFeatureIds: feature.sourceFeatureIds,
    sourceIds: feature.sourceIds,
    boundsWgs84: feature.geometry.boundsWgs84,
    boundsProjected: feature.geometry.derived.bounds,
    focusPoint: feature.label.anchorProjected,
    relatedCountryIds: feature.intersectingEntityIds,
    relatedPlaces: [],
    observedAt: feature.temporal.observedAt,
    linkedRiverPlaceId: feature.linkedRiverPlaceId,
    countryRelationship: feature.intersectingEntityIds.length > 0 ? "intersects_mapped_admin0" : null,
    label: feature.label,
  }));
  return assignUniqueShareKeys(places, (place) => `watershed:${atlasPlaceSlug(place.name)}`)
    .sort((left, right) => left.name.localeCompare(right.name) || left.placeId.localeCompare(right.placeId));
}

function connectAtlasPlaces(
  places: AtlasPlaceSummary[],
  relationships: readonly AtlasPlaceRelationship[],
) {
  const byId = new Map(places.map((place) => [place.placeId, place]));
  const append = (fromId: string, relation: AtlasRelatedPlace) => {
    const from = byId.get(fromId);
    if (!from || from.relatedPlaces.some((entry) => entry.placeId === relation.placeId
      && entry.relationship === relation.relationship)) return;
    from.relatedPlaces.push(relation);
  };

  for (const relationship of relationships) {
    const from = byId.get(relationship.fromPlaceId);
    const to = byId.get(relationship.toPlaceId);
    if (!from || !to) continue;
    const shared = {
      relationship: relationship.kind,
      wording: relationship.wording,
      distanceKm: relationship.distanceKm,
      sourceIds: relationship.sourceIds,
      caveat: relationship.evidence.caveat,
    } as const;
    append(from.placeId, { placeId: to.placeId, name: to.name, placeKind: to.kind, ...shared });
    append(to.placeId, { placeId: from.placeId, name: from.name, placeKind: from.kind, ...shared });
  }

  for (const basin of places.filter((place): place is AtlasWatershedPlaceSummary => place.kind === "watershed")) {
    const river = byId.get(basin.linkedRiverPlaceId);
    if (!river || river.kind !== "river") continue;
    append(river.placeId, {
      placeId: basin.placeId,
      name: basin.name,
      placeKind: basin.kind,
      relationship: "drainage_basin",
      wording: `${basin.name} is the mapped pilot basin for ${river.name}.`,
      distanceKm: null,
      sourceIds: basin.sourceIds,
      caveat: "The basin is generalized learning geometry, not an engineering or legal boundary.",
    });
    append(basin.placeId, {
      placeId: river.placeId,
      name: river.name,
      placeKind: river.kind,
      relationship: "river_system",
      wording: `${river.name} is the river linked to this mapped basin.`,
      distanceKm: null,
      sourceIds: [...new Set([...basin.sourceIds, ...river.sourceIds])],
      caveat: "The river centerline and basin polygon come from separate sourced cartographic records.",
    });
  }

  for (const place of places) {
    place.relatedPlaces.sort((left, right) => {
      const priority = (value: AtlasRelatedPlace["relationship"]) => value === "drainage_basin" || value === "river_system" ? 0 : 1;
      return priority(left.relationship) - priority(right.relationship) || left.name.localeCompare(right.name);
    });
  }
  return places;
}

export function buildAtlasPlaceIndex(
  collections: AtlasGeographyPack["featureCollections"],
  relationships: readonly AtlasPlaceRelationship[] = [],
): AtlasPlaceSummary[] {
  const places = [
    ...atlasCityPlaceSummaries(collections.majorCities.features),
    ...atlasPhysicalPlaceSummaries(collections.majorRivers.features),
    ...atlasPhysicalPlaceSummaries(collections.majorLakes.features),
    ...atlasWaterPlaceSummaries(collections.majorWaterBodies.features),
    ...atlasWatershedPlaceSummaries(collections.watershedPilot.features),
  ].filter((place) => place.name.trim().length > 0 && place.name !== "Unnamed feature");
  return connectAtlasPlaces(places, relationships);
}

export function findAtlasPlaceByShareKey(
  places: readonly AtlasPlaceSummary[],
  kind: AtlasPlaceKind,
  shareKey: string,
) {
  const normalized = atlasPlaceSlug(shareKey.replace(new RegExp(`^${kind}:`, "i"), ""));
  return places.find((place) => {
    if (place.kind !== kind) return false;
    const candidate = place.kind === "city" ? place.shareKey : place.shareKey.replace(`${kind}:`, "");
    return atlasPlaceSlug(candidate) === normalized;
  }) ?? null;
}
