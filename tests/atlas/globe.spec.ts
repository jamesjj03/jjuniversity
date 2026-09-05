import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import { atlasGlobeCoordinateIsVisible } from "../../lib/atlas-world/globeVisibility";

type GlobeAsset = {
  snapshotId: string;
  canonicalCrs: string;
  source: { id: string; checksumSha256: string; license: { name: string } };
  features: Array<{ id: string; properties: { entityId: string }; geometry: { type: string } }>;
};

type GlobeContextAsset = {
  schemaVersion: string;
  snapshotId: string;
  canonicalCrs: string;
  sourceLockId: string;
  sourceIds: string[];
  rivers: Array<{ featureId: string; geometry: { type: string } }>;
  cities: Array<{ featureId: string; coordinates: [number, number] }>;
  waterLabels: Array<{ placeId: string; priority: number; minimumZoom: number; coordinates: [number, number] }>;
};

function isMobile(testInfo: TestInfo) {
  return testInfo.project.name.startsWith("mobile");
}

test("globe asset preserves all 242 Atlas identities in canonical WGS84", () => {
  const root = process.cwd();
  const globe = JSON.parse(readFileSync(path.join(root, "public", "atlas-world", "geometry-wgs84.v1.json"), "utf8")) as GlobeAsset;
  const countries = JSON.parse(readFileSync(path.join(root, "lib", "atlas-world", "data", "countries.v1.json"), "utf8")) as {
    snapshotId: string; countries: Array<{ id: string }>;
  };
  expect(globe.canonicalCrs).toBe("EPSG:4326");
  expect(globe.snapshotId).toBe(countries.snapshotId);
  expect(globe.features).toHaveLength(242);
  expect(new Set(globe.features.map((feature) => feature.id))).toEqual(new Set(countries.countries.map((country) => country.id)));
  expect(globe.features.every((feature) => feature.id === feature.properties.entityId)).toBe(true);
  expect(globe.features.every((feature) => ["Polygon", "MultiPolygon"].includes(feature.geometry.type))).toBe(true);
  expect(globe.source.id).toBe("natural-earth-admin-0-50m-5.1.2");
  expect(globe.source.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(globe.source.license.name).toBe("Public domain");
});

test("globe context is a bounded, source-locked WGS84 geography pack", () => {
  const root = process.cwd();
  const context = JSON.parse(readFileSync(path.join(root, "public", "atlas-world", "globe-context.v1.json"), "utf8")) as GlobeContextAsset;
  const sourceLock = JSON.parse(readFileSync(path.join(root, "data", "atlas", "sources.lock.json"), "utf8")) as {
    lockId: string;
    sources: Array<{ id: string }>;
  };
  const sourceIds = new Set(sourceLock.sources.map((source) => source.id));

  expect(context.schemaVersion).toBe("1.0.0");
  expect(context.canonicalCrs).toBe("EPSG:4326");
  expect(context.sourceLockId).toBe(sourceLock.lockId);
  expect(context.sourceIds.every((sourceId) => sourceIds.has(sourceId))).toBe(true);
  expect(context.rivers).toHaveLength(22);
  expect(context.cities).toHaveLength(230);
  expect(context.waterLabels).toHaveLength(59);
  expect(context.rivers.every((river) => ["LineString", "MultiLineString"].includes(river.geometry.type))).toBe(true);
  expect(context.cities.every((city) => city.coordinates.length === 2 && city.coordinates.every(Number.isFinite))).toBe(true);
  expect(context.waterLabels.every((label) => label.priority > 0 && label.minimumZoom >= 1 && label.coordinates.every(Number.isFinite))).toBe(true);
});

test("globe hemisphere gate excludes hidden tiny-territory anchors", () => {
  expect(atlasGlobeCoordinateIsVisible([0, 0], [0, 0])).toBe(true);
  expect(atlasGlobeCoordinateIsVisible([0, 0], [87.9, 0])).toBe(true);
  expect(atlasGlobeCoordinateIsVisible([0, 0], [91, 0])).toBe(false);
  expect(atlasGlobeCoordinateIsVisible([12, 12], [-168, -12])).toBe(false);
  expect(atlasGlobeCoordinateIsVisible([0, 0], [88, 0], 0.06)).toBe(false);
});

test("experimental globe searches, rotates, zooms, deep-links, and preserves browser history", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(message.location().url ?? "")
      && /\/_vercel\/(insights|speed-insights)\/script\.js/.test(message.location().url ?? "")) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/atlas/globe?country=zwe", { waitUntil: "domcontentloaded" });

  const globe = page.locator("[data-atlas-globe]");
  await expect(globe).toHaveAttribute("data-atlas-globe-loaded", "true", { timeout: 15_000 });
  await expect(globe).toHaveAttribute("data-atlas-globe-context-loaded", "true", { timeout: 15_000 });
  await expect(globe).toHaveAttribute("data-atlas-globe-context-rivers", "22");
  await expect(globe).toHaveAttribute("data-atlas-globe-context-cities", "230");
  await expect(globe).toHaveAttribute("data-atlas-globe-context-water-labels", "59");
  await expect(globe).toHaveAttribute("data-atlas-globe-selected", "country:ZWE");
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Globe selection" })).toHaveText("Zimbabwe selected on the globe.");
  await expect(page.getByText("Population density and relief are not shown", { exact: false })).not.toBeVisible();
  await expect(page.getByRole("link", { name: /Open full country cockpit/ })).toHaveAttribute("href", "/atlas?country=zwe");

  const search = page.getByRole("combobox", { name: "Search countries on the globe" });
  await search.fill("jap");
  await page.getByRole("option", { name: /Japan/ }).getByRole("button").click();
  await expect(globe).toHaveAttribute("data-atlas-globe-selected", "country:JPN");
  await expect(page).toHaveURL(/country=jpn/);
  await expect(page.getByRole("heading", { name: "Japan", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Globe selection" })).toHaveText("Japan selected on the globe.");

  await page.goBack();
  await expect(globe).toHaveAttribute("data-atlas-globe-selected", "country:ZWE");
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close Zimbabwe" }).click();
  await expect(globe).toHaveAttribute("data-atlas-globe-selected", "none");
  await expect(page.getByRole("status", { name: "Globe selection" })).toHaveText("No country selected on the globe.");
  await expect(page.getByRole("application")).toHaveCount(0);
  const mapCanvas = page.getByRole("img", { name: /Orthographic world globe/ });
  const mapBounds = await mapCanvas.boundingBox();
  expect(mapBounds).not.toBeNull();
  await mapCanvas.click({ position: { x: (mapBounds?.width ?? 600) / 2, y: (mapBounds?.height ?? 500) / 2 } });
  await expect(globe).toHaveAttribute("data-atlas-globe-selected", "country:ZWE");
  await expect(page.getByRole("status", { name: "Globe selection" })).toHaveText("Zimbabwe selected on the globe.");

  const initialZoom = await globe.getAttribute("data-atlas-globe-zoom");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(globe).not.toHaveAttribute("data-atlas-globe-zoom", initialZoom ?? "1.000");

  if (!isMobile(testInfo)) {
    const bounds = await mapCanvas.boundingBox();
    expect(bounds).not.toBeNull();
    const initialRotation = await globe.getAttribute("data-atlas-globe-rotation");
    await page.mouse.move((bounds?.x ?? 0) + (bounds?.width ?? 600) * 0.46, (bounds?.y ?? 0) + (bounds?.height ?? 500) * 0.48);
    await page.mouse.down();
    await page.mouse.move((bounds?.x ?? 0) + (bounds?.width ?? 600) * 0.58, (bounds?.y ?? 0) + (bounds?.height ?? 500) * 0.48, { steps: 5 });
    await page.mouse.up();
    await expect(globe).not.toHaveAttribute("data-atlas-globe-rotation", initialRotation ?? "");
  }

  await expect(page.getByRole("link", { name: "Map", exact: true })).toHaveAttribute("href", "/atlas?country=zwe");
  expect(errors).toEqual([]);
});
