import { expect, test, type Page } from "@playwright/test";
import geographyPack from "../../lib/atlas-world/data/geography-pack.v1.json";

const DETAIL_REQUEST = /\/atlas-world\/layers\/population-density-2025-mercator\/(regional|country|close)\//;
const DENSITY = '[data-atlas-layer="population-density-2025"]';
const SURFACE = `${DENSITY} [data-atlas-raster-level]`;
const TILES = `${SURFACE} [data-atlas-raster-tile]`;
const pyramid = geographyPack.datasets.find((dataset) => dataset.id === "population-density-2025")!.assetPyramid!;
const manifestTiles = pyramid.levels.flatMap((level) => level.tiles);

async function settleCamera(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function openLayers(page: Page) {
  const legend = page.getByLabel("Where people live map legend", { exact: true });
  const mobileDisclosure = legend.locator(":scope > details");
  if (await mobileDisclosure.isVisible() && !await mobileDisclosure.evaluate((node) => (node as HTMLDetailsElement).open)) {
    await mobileDisclosure.locator(":scope > summary").click();
  }
  const layerOptions = legend.locator("summary").filter({ hasText: /^Map detail & layers$/ }).filter({ visible: true }).locator("..");
  if (!await layerOptions.evaluate((node) => (node as HTMLDetailsElement).open)) {
    await layerOptions.locator(":scope > summary").click();
  }
}

async function toggleDensity(page: Page) {
  await page.getByRole("button", { name: "Population density", exact: true }).filter({ visible: true }).click();
}

async function expectDetailReady(page: Page) {
  await expect(page.locator(SURFACE)).not.toHaveAttribute("data-atlas-raster-level", "overview");
  await expect.poll(async () => page.locator(TILES).count()).toBeGreaterThan(0);
  await expect.poll(async () => page.locator(TILES).evaluateAll((tiles) => tiles.every((tile) => tile.getAttribute("visibility") === "visible"))).toBe(true);
}

async function assertOnlyViewportTiles(page: Page) {
  const state = await page.locator(SURFACE).evaluate((surface) => {
    const svg = (surface as SVGElement).ownerSVGElement!;
    const matrix = svg.querySelector<SVGGElement>("[data-atlas-map-group]")!.getScreenCTM()!;
    const inverse = matrix.inverse();
    const rect = svg.getBoundingClientRect();
    const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
    const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
    return {
      level: surface.getAttribute("data-atlas-raster-level"),
      bounds: [a.x, a.y, b.x, b.y],
      tiles: Array.from(surface.querySelectorAll("[data-atlas-raster-tile]")).map((tile) => ({
        id: tile.getAttribute("data-atlas-raster-tile")!,
        href: tile.getAttribute("href")!,
        rect: ["x", "y", "width", "height"].map((attribute) => Number(tile.getAttribute(attribute))),
      })),
    };
  });
  expect(state.tiles.length).toBeGreaterThan(0);
  expect(state.tiles.length).toBeLessThanOrEqual(20);
  const [left, top, right, bottom] = state.bounds;
  const expected = pyramid.levels.find((level) => level.id === state.level)!.tiles.filter((tile) => {
    const [x, y, width, height] = tile.viewBox;
    return x < right && x + width > left && y < bottom && y + height > top;
  });
  expect(state.tiles.map((tile) => tile.id).sort()).toEqual(expected.map((tile) => tile.id).sort());
  for (const tile of state.tiles) {
    const authority = manifestTiles.find((entry) => entry.id === tile.id)!;
    expect(tile.href).toBe(authority.href);
    expect(tile.rect).toEqual(authority.viewBox);
  }
  return state;
}

test("world views do not fetch detail and zoom loads only registered visible source tiles", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop network and world-to-region coverage");
  const detailRequests: string[] = [];
  const densityRequests: string[] = [];
  page.on("request", (request) => {
    if (DETAIL_REQUEST.test(request.url())) detailRequests.push(request.url());
    if (request.url().includes("/atlas-world/layers/population-density-2025")) densityRequests.push(request.url());
  });
  await page.goto("/atlas");
  await expect(page.locator(DENSITY)).toHaveAttribute("data-atlas-layer-active", "false");
  await settleCamera(page);
  expect(densityRequests).toEqual([]);
  await expect(page.locator(`${SURFACE} > image[mask]`)).not.toHaveAttribute("href");
  await page.getByRole("button", { name: /^Choose view:/ }).click();
  await page.getByRole("dialog", { name: "Explore the map", exact: true })
    .getByRole("button", { name: "Where people live", exact: true }).click();
  await expect(page.locator(DENSITY)).toHaveAttribute("data-atlas-layer-active", "true");
  await expect(page.locator(SURFACE)).toHaveAttribute("data-atlas-raster-level", "overview");
  await settleCamera(page);
  expect(await page.locator(TILES).count()).toBe(0);
  expect(detailRequests).toEqual([]);

  await page.getByRole("button", { name: "Find a place", exact: true }).click();
  await page.getByRole("combobox", { name: "Find a country, city, river, or lake", exact: true }).fill("Egypt");
  await page.getByRole("option", { name: /^Egypt\s/ }).click();
  await expect(page.getByRole("heading", { name: "Egypt", exact: true })).toBeVisible();
  await expectDetailReady(page);
  await settleCamera(page);
  const state = await assertOnlyViewportTiles(page);
  expect(detailRequests.length).toBeGreaterThan(0);
  expect(new Set(detailRequests).size).toBeLessThan(manifestTiles.length / 2);
  const maskHoles = page.locator(`${SURFACE} mask rect[fill="black"]`);
  expect(await maskHoles.count()).toBe(state.tiles.length);

  await page.getByRole("button", { name: "Reset world view", exact: true }).click();
  await expect(page.locator(SURFACE)).toHaveAttribute("data-atlas-raster-level", "overview");
  await expect(page.locator(TILES)).toHaveCount(0);
  await expect(maskHoles).toHaveCount(0);
});

test("a failed detail request retains overview pixels and clears fallback after a successful retry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop failed-resource recovery");
  let failedHref: string | null = null;
  let block = true;
  await page.route("**/atlas-world/layers/population-density-2025-mercator/*/*.webp", async (route) => {
    if (block && (!failedHref || route.request().url().endsWith(failedHref))) {
      failedHref ??= new URL(route.request().url()).pathname;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("/atlas?view=where-people-live&country=egy");
  await expect(page.getByRole("heading", { name: "Egypt", exact: true })).toBeVisible();
  await expect(page.locator(SURFACE)).toHaveAttribute("data-atlas-raster-fallback", "true");
  const failedTile = manifestTiles.find((tile) => tile.href === failedHref)!;
  expect(failedTile).toBeDefined();
  await expect(page.locator(`[data-atlas-raster-tile="${failedTile.id}"]`)).toHaveAttribute("visibility", "hidden");
  const masks = await page.locator(`${SURFACE} mask rect[fill="black"]`).evaluateAll((rectangles) => rectangles.map((rect) => ["x", "y", "width", "height"].map((key) => Number(rect.getAttribute(key)))));
  expect(masks).not.toContainEqual(failedTile.viewBox);
  await expect(page.locator(`${SURFACE} > image[mask]`)).toHaveAttribute("href", /population-density-2025\.mercator\.webp$/);

  await page.getByRole("button", { name: "Close Egypt", exact: true }).click();
  await openLayers(page);
  await toggleDensity(page);
  await expect(page.locator(TILES)).toHaveCount(0);
  block = false;
  await toggleDensity(page);
  await expectDetailReady(page);
  await expect(page.locator(SURFACE)).toHaveAttribute("data-atlas-raster-fallback", "false");
});

test("revisiting a tile does not erase the overview while a replacement request is pending", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop delayed re-entry compositing regression");
  await page.goto("/atlas?view=where-people-live&country=egy");
  await expectDetailReady(page);
  const href = await page.locator(TILES).first().getAttribute("href");
  const tile = manifestTiles.find((entry) => entry.href === href)!;
  await page.getByRole("button", { name: "Close Egypt", exact: true }).click();
  await openLayers(page);
  await toggleDensity(page);
  await expect(page.locator(TILES)).toHaveCount(0);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let pending = false;
  await page.route(`**${href}`, async (route) => { pending = true; await gate; await route.continue(); });
  await toggleDensity(page);
  await expect.poll(() => pending).toBe(true);
  try {
    await expect(page.locator(`[data-atlas-raster-tile="${tile.id}"]`)).toHaveAttribute("visibility", "hidden");
    const masks = await page.locator(`${SURFACE} mask rect[fill="black"]`).evaluateAll((rectangles) => rectangles.map((rect) => ["x", "y", "width", "height"].map((key) => Number(rect.getAttribute(key)))));
    expect(masks).not.toContainEqual(tile.viewBox);
  } finally {
    release!();
  }
  await expectDetailReady(page);
});

test("mobile detail keeps decoded images bounded and disabling density releases its detail surfaces", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Phone-sized decode and visibility coverage");
  await page.goto("/atlas?view=where-people-live&country=egy");
  await expect(page.getByRole("heading", { name: "Egypt", exact: true })).toBeVisible();
  await expectDetailReady(page);
  // Country selection starts map-first; the explicit height buttons appear only
  // after expanding the sheet, so assert the initial compact surface directly.
  await expect(page.locator("[data-atlas-sheet]")).toHaveAttribute("data-atlas-sheet", "peek");
  await settleCamera(page);
  const state = await assertOnlyViewportTiles(page);
  const tile = manifestTiles.find((entry) => entry.id === state.tiles[0].id)!;
  const actual = await page.evaluate((href) => new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Detail image failed to decode"));
    image.src = href;
  }), tile.href);
  expect(actual).toEqual({ width: tile.width, height: tile.height });
  expect(actual.width * actual.height * 4).toBeLessThanOrEqual(6_240_000);
  expect(state.tiles.length * 6_240_000).toBeLessThanOrEqual(124_800_000);
  await page.getByRole("button", { name: "Close Egypt", exact: true }).click();
  await openLayers(page);
  await toggleDensity(page);
  await expect(page.locator(DENSITY)).toHaveAttribute("data-atlas-layer-active", "false");
  await expect(page.locator(TILES)).toHaveCount(0);
  await expect(page.locator(`${SURFACE} > image[mask]`)).not.toHaveAttribute("href");
});
