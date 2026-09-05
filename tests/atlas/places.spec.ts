import { expect, test } from "@playwright/test";
import geographyPackJson from "../../lib/atlas-world/data/geography-pack.v1.json";
import type {
  AtlasCityFeature,
  AtlasGeographyPack,
  AtlasPhysicalFeature,
} from "../../lib/atlas-world/geographyTypes";
import {
  atlasCityPlaceSummaries,
  atlasPhysicalPlaceSummaries,
  atlasPlaceSlug,
  buildAtlasPlaceIndex,
  findAtlasPlaceByShareKey,
} from "../../lib/atlas-world/places";

type Point = [number, number];

function bounds(points: Point[]): [[number, number], [number, number]] {
  return [
    [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
    [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))],
  ];
}

function physicalFeature({
  id,
  name,
  points,
  kind = "river",
  sourceFeatureId = id,
  placeId,
}: {
  id: string;
  name: string;
  points: Point[];
  kind?: "river" | "lake";
  sourceFeatureId?: string;
  placeId?: string;
}) {
  const featureBounds = bounds(points);
  return {
    featureId: `feature:test:${kind}:${id}`,
    kind,
    name,
    alternateName: null,
    aliases: [],
    entityIds: [],
    entityRelation: {
      kind: "intersects_mapped_admin0_geometry",
      method: "natural-earth-admin0-intersection-v1",
    },
    sourceIds: [`test-${kind}-source`],
    sourceFeatureId,
    sourceScaleRank: 1,
    sourceMinZoom: 1,
    displayLod: "world",
    temporal: { observedAt: null, validFrom: null, validTo: null, precision: "unknown" },
    geometry: {
      geometryId: `geometry:test:${kind}:${id}`,
      geometrySetId: "test-geometries",
      geometryType: kind === "river" ? "linestring" : "polygon",
      crs: "EPSG:4326",
      canonicalWgs84: {
        type: kind === "river" ? "LineString" : "Polygon",
        coordinates: kind === "river" ? points : [[...points, points[0]]],
      },
      boundsWgs84: featureBounds,
      derived: {
        projectionId: "mercator",
        viewBox: [0, 0, 1200, 650],
        transformationId: "test",
        path: "M0 0L1 1",
        bounds: featureBounds,
      },
    },
    ...(placeId ? { placeId } : {}),
  } as unknown as AtlasPhysicalFeature & { placeId?: string };
}

function cityFeature(id: string, name: string, countryId: string): AtlasCityFeature {
  const point: Point = [10, 20];
  return {
    featureId: `feature:test:city:${id}`,
    kind: "city",
    name,
    aliases: [],
    entity: {
      entityId: `city:test:${id}`,
      kind: "city",
      parentId: countryId,
      sovereignId: countryId,
      countryId,
      adminLevel: null,
      codes: [],
      temporal: { validFrom: null, validTo: null },
    },
    administrativeRegion: null,
    isNationalCapital: true,
    isWorldCity: false,
    sourceScaleRank: 1,
    sourceMinZoom: 1,
    displayLod: "world",
    population: {
      value: 1_250_000,
      status: "estimated",
      unit: "people",
      temporal: { observedAt: "2025", validFrom: null, validTo: null, precision: "year" },
      sourceIds: ["test-population-source"],
      sourceField: "population",
      notes: ["Test estimate."],
    },
    sourceIds: ["test-city-source"],
    temporal: { observedAt: "2025", validFrom: null, validTo: null, precision: "year" },
    geometry: {
      geometryId: `geometry:test:city:${id}`,
      geometrySetId: "test-geometries",
      geometryType: "point",
      crs: "EPSG:4326",
      canonicalWgs84: { type: "Point", coordinates: point },
      boundsWgs84: [point, point],
      derived: {
        projectionId: "mercator",
        viewBox: [0, 0, 1200, 650],
        transformationId: "test",
        point,
        bounds: [point, point],
      },
    },
  };
}

test("place slugs remain readable, deterministic, and diacritic-insensitive", () => {
  expect(atlasPlaceSlug("São Tomé & Príncipe")).toBe("sao-tome-and-principe");
  expect(atlasPlaceSlug("  Lake Victoria  ")).toBe("lake-victoria");
});

test("city keys use parent-country identity and disambiguate same-country homonyms", () => {
  const places = atlasCityPlaceSummaries([
    cityFeature("one", "Victoria", "country:CAN"),
    cityFeature("two", "Victoria", "country:SYC"),
    cityFeature("three", "Suzhou", "country:CHN"),
    cityFeature("four", "Suzhou", "country:CHN"),
  ]);
  expect(places.find((place) => place.entityId === "city:test:one")?.shareKey).toBe("victoria-can");
  expect(places.find((place) => place.entityId === "city:test:two")?.shareKey).toBe("victoria-syc");
  const suzhouKeys = places.filter((place) => place.name === "Suzhou").map((place) => place.shareKey);
  expect(new Set(suzhouKeys).size).toBe(2);
  expect(suzhouKeys.every((key) => /^suzhou-chn--[a-z0-9]{7}$/.test(key))).toBe(true);
  expect(places[0].population?.value).toBe(1_250_000);
  expect(places[0].sourceIds).toContain("test-population-source");
});

test("homonymous rivers are never merged by name alone", () => {
  const places = atlasPhysicalPlaceSummaries([
    physicalFeature({ id: "north", name: "San Juan", points: [[-108, 37], [-107, 36]] }),
    physicalFeature({ id: "south", name: "San Juan", points: [[-72, 5], [-71, 4]] }),
  ]);
  expect(places).toHaveLength(2);
  expect(new Set(places.map((place) => place.shareKey)).size).toBe(2);
  expect(places.every((place) => /^river:san-juan--[a-z0-9]{7}$/.test(place.shareKey))).toBe(true);
});

test("connected render parts form one logical river with one full-highlight identity", () => {
  const places = atlasPhysicalPlaceSummaries([
    physicalFeature({ id: "upper", name: "Example River", points: [[1, 1], [2, 2]] }),
    physicalFeature({ id: "lower", name: "Example River", points: [[2.04, 2.02], [3, 3]] }),
  ]);
  expect(places).toHaveLength(1);
  expect(places[0].featureIds).toEqual([
    "feature:test:river:lower",
    "feature:test:river:upper",
  ]);
  expect(places[0].shareKey).toBe("river:example-river");
});

test("explicit logical identity wins across generalized geometry representations", () => {
  const places = atlasPhysicalPlaceSummaries([
    physicalFeature({ id: "overview", name: "Great Lake", kind: "lake", points: [[1, 1], [2, 1], [2, 2]], placeId: "place:lake:great" }),
    physicalFeature({ id: "detail", name: "Great Lake", kind: "lake", points: [[20, 20], [21, 20], [21, 21]], placeId: "place:lake:great" }),
  ]);
  expect(places).toHaveLength(1);
  expect(places[0].placeId).toBe("place:lake:great");
  expect(places[0].featureIds).toHaveLength(2);
});

test("friendly share lookup accepts the feature prefix without conflating kinds", () => {
  const river = atlasPhysicalPlaceSummaries([
    physicalFeature({ id: "nile", name: "Nile", points: [[31, 30], [31, 29]] }),
  ])[0];
  const city = atlasCityPlaceSummaries([cityFeature("cairo", "Cairo", "country:EGY")])[0];
  const places = [river, city];
  expect(findAtlasPlaceByShareKey(places, "river", "river:nile")?.placeId).toBe(river.placeId);
  expect(findAtlasPlaceByShareKey(places, "city", "cairo-egy")?.placeId).toBe(city.placeId);
  expect(findAtlasPlaceByShareKey(places, "lake", "river:nile")).toBeNull();
});

test("the generated geography pack exposes coherent Nile, Lake Victoria, and Cairo places", () => {
  const pack = geographyPackJson as unknown as AtlasGeographyPack;
  const places = buildAtlasPlaceIndex(pack.featureCollections);
  expect(places.some((place) => place.name === "Unnamed feature")).toBe(false);
  const nile = findAtlasPlaceByShareKey(places, "river", "river:nile");
  const victoria = findAtlasPlaceByShareKey(places, "lake", "lake:lake-victoria");
  const cairo = findAtlasPlaceByShareKey(places, "city", "cairo-egy");
  expect(nile?.name).toBe("Nile");
  expect(nile?.featureIds.length).toBeGreaterThan(10);
  expect(nile?.relatedCountryIds).toContain("country:EGY");
  expect(victoria?.aliases).toContain("Nyanza");
  expect(cairo?.kind).toBe("city");
  if (cairo?.kind === "city") {
    expect(cairo.administrativeRegion).toBe("Al Qahirah");
    expect(cairo.population?.value).toBe(14_451_000);
  }
});
