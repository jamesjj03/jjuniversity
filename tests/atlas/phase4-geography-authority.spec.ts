import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

import geographyPayload from "../../lib/atlas-world/data/geography-pack.v1.json";
import palette from "../../lib/atlas-world/data/political-palette.v1.json";
import type { AtlasGeographyPack, AtlasGlobeContextAsset } from "../../lib/atlas-world/geographyTypes";
import { getAtlasGlossaryTerm } from "../../lib/atlas-world/glossary";
import { buildAtlasFeatureSurfaceIndex } from "../../lib/atlas-world/featureSurface";
import { buildAtlasPlaceIndex, findAtlasPlaceByShareKey } from "../../lib/atlas-world/places";
import { atlasPoliticalColorAuthority } from "../../lib/atlas-world/politicalPalette";

const geography = geographyPayload as unknown as AtlasGeographyPack;

test("JJU political colors expose reviewed stable manual authority", () => {
  expect(Object.keys(palette.colors)).toHaveLength(242);
  expect(palette.authorityStatus).toBe("reviewed-editorial-palette");
  expect(palette.assignmentPolicy.manualOverrides).toContain("visual-memory aids");
  expect(palette.references.every((reference) => reference.url.startsWith("https://"))).toBe(true);

  const expected = {
    CHN: "#b46754",
    DEU: "#8c9291",
    FRA: "#527d9f",
    GBR: "#b26a78",
    IRL: "#8daa85",
    MEX: "#73906d",
    POL: "#b2747d",
    SWE: "#7698b2",
    USA: "#668da9",
  };
  for (const [code, color] of Object.entries(expected)) {
    expect(palette.colors[code as keyof typeof palette.colors]).toBe(color);
    expect(atlasPoliticalColorAuthority(`country:${code}`)?.color).toBe(color);
  }
});

test("water and watershed places preserve logical identity and careful country relations", () => {
  const places = buildAtlasPlaceIndex(geography.featureCollections, geography.placeRelationships);
  const water = places.filter((place) => place.kind === "water");
  const watersheds = places.filter((place) => place.kind === "watershed");

  expect(water.length).toBeLessThan(geography.featureCollections.majorWaterBodies.features.length);
  expect(watersheds).toHaveLength(5);
  const atlantic = findAtlasPlaceByShareKey(places, "water", "water:atlantic-ocean");
  expect(atlantic?.kind).toBe("water");
  expect(atlantic?.featureIds.length).toBe(2);
  const mediterranean = findAtlasPlaceByShareKey(places, "water", "mediterranean-sea");
  expect(mediterranean?.name).toBe("Mediterranean Sea");
  expect(mediterranean?.relatedCountryIds.length).toBeGreaterThan(5);

  const nileBasin = findAtlasPlaceByShareKey(places, "watershed", "watershed:nile-drainage-basin");
  expect(nileBasin?.kind).toBe("watershed");
  if (nileBasin?.kind === "watershed") {
    expect(nileBasin.linkedRiverPlaceId).toBe("place:natural-earth:river:nile");
    expect(nileBasin.countryRelationship).toBe("intersects_mapped_admin0");
    expect(nileBasin.relatedPlaces.some((relationship) => (
      relationship.placeId === "place:natural-earth:river:nile"
      && relationship.relationship === "river_system"
    ))).toBe(true);
    const nileRiver = places.find((place) => place.placeId === nileBasin.linkedRiverPlaceId);
    expect(nileRiver?.relatedPlaces.some((relationship) => (
      relationship.placeId === nileBasin.placeId
      && relationship.relationship === "drainage_basin"
    ))).toBe(true);
  }

  const cairo = findAtlasPlaceByShareKey(places, "city", "city:cairo-egy");
  expect(cairo?.relatedPlaces.some((relationship) => (
    relationship.placeId === "place:natural-earth:river:nile"
    && relationship.relationship === "near_mapped_geometry"
  ))).toBe(true);

  for (const feature of geography.featureCollections.majorWaterBodies.features) {
    expect(feature.entityRelation.kind).toBe("coastline_adjacent_to_mapped_admin0_geometry");
    expect(feature.entityRelation.caveat).toMatch(/not ownership|not a claim of ownership/i);
    expect(feature.label.anchorWgs84).toHaveLength(2);
    expect(feature.label.priority).toBeGreaterThan(0);
  }
});

test("River V2 facts are bounded, statement-backed, and omit incomparable discharge", () => {
  const places = buildAtlasPlaceIndex(geography.featureCollections, geography.placeRelationships);
  for (const shareKey of ["nile", "amazon", "mississippi", "danube", "yangtze"]) {
    const river = findAtlasPlaceByShareKey(places, "river", `river:${shareKey}`);
    expect(river?.kind).toBe("river");
    if (river?.kind !== "river") continue;
    expect(river.lengthKm?.value).toBeGreaterThan(0);
    expect(river.basinAreaKm2?.value).toBeGreaterThan(0);
    expect(river.mouthPlace?.value.length).toBeGreaterThan(0);
    expect(river.headwaters?.value.length).toBeGreaterThan(0);
    expect(river.majorTributaries?.value.length).toBeGreaterThan(0);
    expect("discharge" in river).toBe(false);
  }
  expect(geography.datasets.find((dataset) => dataset.id === "major-rivers")?.factPilot).toMatchObject({
    omittedMeasures: ["discharge"],
  });
});

test("feature and globe indexes carry bounded water label and WGS84 context", () => {
  const surface = buildAtlasFeatureSurfaceIndex(geography.featureCollections);
  const gulf = surface.find((record) => record.kind === "water" && record.name === "Gulf of Mexico");
  expect(gulf?.geometryHref).toContain("water-mercator.v1.svg#");
  expect(gulf?.label?.text).toBe("Gulf of Mexico");
  const nileBasin = surface.find((record) => record.kind === "watershed" && record.name === "Nile drainage basin");
  expect(nileBasin?.geometryHref).toContain("watersheds-mercator.v1.svg#");

  const globePath = path.resolve(process.cwd(), "public", "atlas-world", "globe-context.v1.json");
  const globeBytes = readFileSync(globePath);
  const globe = JSON.parse(globeBytes.toString("utf8")) as AtlasGlobeContextAsset;
  expect(globe.canonicalCrs).toBe("EPSG:4326");
  expect(globeBytes.byteLength).toBeLessThan(200_000);
  expect(globe.rivers).toHaveLength(22);
  expect(globe.cities).toHaveLength(230);
  expect(globe.waterLabels).toHaveLength(59);
});

test("Atlas Index explains the new geography without turning adjacency into ownership", () => {
  expect(getAtlasGlossaryTerm("ocean")?.id).toBe("marine-water-body");
  expect(getAtlasGlossaryTerm("channel")?.id).toBe("strait");
  expect(getAtlasGlossaryTerm("watershed")?.inAtlas).toContain("five-basin pilot");
  expect(getAtlasGlossaryTerm("marine-water-body")?.caveat).toMatch(/does not mean.*owns/i);
});

test("water search and connected geography lead from the Gulf to the Nile basin", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "The phone path is covered in the full mobile Atlas suite.");
  test.setTimeout(60_000);

  await page.goto("/atlas?view=population-density", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Choose view: Population density", exact: true })).toBeEnabled({ timeout: 30_000 });
  const searchButton = page.getByRole("button", { name: "Find a place", exact: true });
  await searchButton.click();
  const search = page.getByRole("combobox", {
    name: "Find a country, city, river, lake, sea, or drainage basin",
    exact: true,
  });

  await search.fill("Gulf of Mexico");
  await page.getByRole("option").filter({ hasText: "Gulf of Mexico" }).click();
  const gulfCard = page.locator('[data-atlas-place-card="water"]');
  await expect(gulfCard.getByRole("heading", { name: "Gulf of Mexico", exact: true })).toBeVisible();
  await expect(gulfCard.getByRole("region", { name: "Coastline adjacency" })).toContainText("Mexico");
  await expect(page).toHaveURL(/feature=water%3A/);

  await searchButton.click();
  await search.fill("Nile");
  await page.getByRole("option").filter({ hasText: /^NileRiver/ }).click();
  const riverCard = page.locator('[data-atlas-place-card="river"]');
  await riverCard.getByRole("button", { name: /Nile drainage basin/ }).click();
  const basinCard = page.locator('[data-atlas-place-card="watershed"]');
  await expect(basinCard.getByRole("heading", { name: "Nile drainage basin", exact: true })).toBeVisible();
  await expect(page.locator('[data-atlas-place-kind="watershed"][data-atlas-place-selected="true"]')).toHaveCount(1);
  await expect(page).toHaveURL(/feature=watershed%3Anile-drainage-basin/);
});
