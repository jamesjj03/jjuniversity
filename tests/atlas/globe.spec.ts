import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";

type GlobeAsset = {
  snapshotId: string;
  canonicalCrs: string;
  source: { id: string; checksumSha256: string; license: { name: string } };
  features: Array<{ id: string; properties: { entityId: string }; geometry: { type: string } }>;
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

test("experimental globe searches, rotates, zooms, deep-links, and preserves browser history", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/atlas/globe?country=zwe", { waitUntil: "domcontentloaded" });

  const globe = page.locator("[data-atlas-globe]");
  await expect(globe).toHaveAttribute("data-atlas-globe-loaded", "true", { timeout: 15_000 });
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

  await expect(page.getByRole("link", { name: "Return to flat Atlas" })).toHaveAttribute("href", "/atlas?country=zwe");
  expect(errors).toEqual([]);
});
