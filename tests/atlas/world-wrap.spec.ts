import { expect, test, type Page } from "@playwright/test";
import { projectAtlasWgs84 } from "../../lib/atlas-world/projection";
import {
  ATLAS_WORLD_WIDTH,
  atlasNearestWrappedX,
  atlasWorldWrapOffsets,
} from "../../lib/atlas-world/worldWrap";

async function openAtlas(page: Page, url = "/atlas") {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-atlas-map-group]")).toHaveAttribute("transform", /scale\(/, { timeout: 15_000 });
}

async function chooseCountry(page: Page, query: string, name: string) {
  await page.getByRole("button", { name: "Find a place", exact: true }).click();
  const search = page.getByRole("combobox", { name: /^Find a country/ });
  await search.fill(query);
  await page.getByRole("option", { name: new RegExp(`^${name} Country`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("world-copy planning is continuous and focuses the nearest equivalent longitude", () => {
  expect(atlasWorldWrapOffsets({ x: 0, k: 1 })).toEqual([
    -2 * ATLAS_WORLD_WIDTH,
    -ATLAS_WORLD_WIDTH,
    0,
    ATLAS_WORLD_WIDTH,
    2 * ATLAS_WORLD_WIDTH,
  ]);

  const oneWorldEast = atlasWorldWrapOffsets({ x: -ATLAS_WORLD_WIDTH, k: 1 });
  expect(oneWorldEast).toEqual([
    -ATLAS_WORLD_WIDTH,
    0,
    ATLAS_WORLD_WIDTH,
    2 * ATLAS_WORLD_WIDTH,
    3 * ATLAS_WORLD_WIDTH,
  ]);
  expect(oneWorldEast.every((offset, index) => index === 0
    || offset - oneWorldEast[index - 1] === ATLAS_WORLD_WIDTH)).toBe(true);

  expect(atlasNearestWrappedX(300, 930)).toBe(300 + ATLAS_WORLD_WIDTH);
  expect(atlasNearestWrappedX(900, 930)).toBe(900);
});

test("Russia and wrapped Alaska are adjacent, clickable, and retain country share state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop seam hit-testing coverage");
  await openAtlas(page);
  await chooseCountry(page, "russ", "Russia");
  // Keep Russia's fitted camera, but uncover the neighboring wrapped copy so
  // elementFromPoint exercises the map rather than the desktop cockpit.
  await page.getByRole("button", { name: "Close Russia", exact: true }).click();

  const alaska = projectAtlasWgs84([-150, 64]);
  const alaskaPoint = await page.locator("[data-atlas-map-group]").evaluate((group, point) => {
    const mapGroup = group as SVGGElement;
    const svg = mapGroup.ownerSVGElement!;
    const viewport = svg.getBoundingClientRect();
    const matrix = mapGroup.getScreenCTM()!;
    const copies = svg.querySelectorAll<SVGUseElement>("[data-atlas-world-copy]");
    const offsets = [0, ...Array.from(copies, (copy) => Number(copy.dataset.atlasWorldOffset))];
    return offsets.map((offset) => ({
      x: matrix.a * (point[0] + offset) + matrix.e,
      y: matrix.d * point[1] + matrix.f,
    })).filter(({ x, y }) => x >= viewport.left && x <= viewport.right
      && y >= viewport.top && y <= viewport.bottom)
      .sort((left, right) => Math.abs(left.x - (viewport.left + viewport.width / 2))
        - Math.abs(right.x - (viewport.left + viewport.width / 2)))[0] ?? null;
  }, alaska);
  expect(alaskaPoint).not.toBeNull();

  const hit = await page.evaluate((point) => document.elementsFromPoint(point!.x, point!.y)
    .slice(0, 8).map((element) => {
      const country = element.closest<SVGElement>("[data-atlas-country], [data-atlas-wrapped-country]");
      const place = element.closest<SVGElement>("[data-atlas-place], [data-atlas-wrapped-place]");
      return {
        tag: element.tagName,
        country: country?.dataset.atlasCountry ?? country?.dataset.atlasWrappedCountry ?? null,
        place: place?.dataset.atlasPlace ?? place?.dataset.atlasWrappedPlace ?? null,
        className: element.getAttribute("class"),
        pointerEvents: getComputedStyle(element).pointerEvents,
      };
    }), alaskaPoint);
  expect(hit[0]?.country, JSON.stringify(hit)).toBe("country:USA");
  await page.mouse.click(alaskaPoint!.x, alaskaPoint!.y);
  await expect(page.getByRole("heading", { name: "United States of America", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("country")).toBe("usa");
});

test("fixed-size map circles never balloon between a camera transform and the reading-aid pass", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop mutation timing coverage");
  await openAtlas(page, "/atlas?view=where-people-live");

  await page.evaluate(() => {
    const group = document.querySelector<SVGGElement>("[data-atlas-map-group]")!;
    const samples: number[] = [];
    const measure = () => {
      document.querySelectorAll<SVGGraphicsElement>(
        '[data-atlas-screen-symbol], circle[data-atlas-assistance="hit"]',
      ).forEach((element) => samples.push(element.getBoundingClientRect().width));
    };
    const observer = new MutationObserver(measure);
    observer.observe(group, { attributes: true, attributeFilter: ["transform"] });
    (window as typeof window & { __atlasCircleFlashProbe?: () => number[] }).__atlasCircleFlashProbe = () => {
      observer.disconnect();
      measure();
      return samples;
    };
  });

  await page.getByRole("button", { name: "Zoom in", exact: true }).click({ clickCount: 4 });
  const samples = await page.evaluate(() =>
    (window as typeof window & { __atlasCircleFlashProbe?: () => number[] }).__atlasCircleFlashProbe?.() ?? []);
  expect(samples.length).toBeGreaterThan(0);
  expect(Math.max(...samples)).toBeLessThanOrEqual(22);
});

test("detail raster tiles follow the visible world copy across the seam", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "Desktop raster seam coverage");
  await openAtlas(page, "/atlas?view=population-density&country=rus");
  await expect(page.getByRole("heading", { name: "Russia", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click({ clickCount: 2 });
  const surface = page.locator('[data-atlas-layer="population-density-2025"] [data-atlas-raster-level]');
  await expect(surface).not.toHaveAttribute("data-atlas-raster-level", "overview");
  await expect.poll(() => surface.locator("[data-atlas-raster-tile]").count()).toBeGreaterThan(0);

  const copiedOnlyTiles = await surface.evaluate((element) => {
    const svg = (element as SVGElement).ownerSVGElement!;
    const group = svg.querySelector<SVGGElement>("[data-atlas-map-group]")!;
    const matrix = group.getScreenCTM()!;
    const viewport = svg.getBoundingClientRect();
    const offsets = Array.from(svg.querySelectorAll<SVGUseElement>("[data-atlas-world-copy]"),
      (copy) => Number(copy.dataset.atlasWorldOffset));
    const intersects = (tile: Element, offset: number) => {
      const x = Number(tile.getAttribute("x"));
      const y = Number(tile.getAttribute("y"));
      const width = Number(tile.getAttribute("width"));
      const height = Number(tile.getAttribute("height"));
      const left = matrix.a * (x + offset) + matrix.e;
      const right = matrix.a * (x + width + offset) + matrix.e;
      const top = matrix.d * y + matrix.f;
      const bottom = matrix.d * (y + height) + matrix.f;
      return Math.max(left, right) > viewport.left && Math.min(left, right) < viewport.right
        && Math.max(top, bottom) > viewport.top && Math.min(top, bottom) < viewport.bottom;
    };
    return Array.from(element.querySelectorAll("[data-atlas-raster-tile]"))
      .filter((tile) => !intersects(tile, 0) && offsets.some((offset) => intersects(tile, offset))).length;
  });
  expect(copiedOnlyTiles).toBeGreaterThan(0);
});

test("phone dragging crosses the antimeridian without exhausting the map", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Phone wrap and touch-sized viewport coverage");
  await openAtlas(page);
  const map = page.locator("[data-atlas-world-map]");
  const viewport = page.viewportSize()!;
  const firstCopy = map.locator('[data-atlas-world-copy][data-atlas-world-wrap-slot="0"]');
  const initialOffset = await firstCopy.getAttribute("data-atlas-world-offset");

  for (let index = 0; index < 6; index += 1) {
    await page.mouse.move(viewport.width * 0.24, viewport.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(viewport.width * 0.78, viewport.height * 0.48, { steps: 4 });
    await page.mouse.up();
  }

  await expect.poll(() => firstCopy.getAttribute("data-atlas-world-offset"))
    .not.toBe(initialOffset);
  await expect.poll(() => map.locator("[data-atlas-wrapped-country]").count()).toBeGreaterThan(0);
});
