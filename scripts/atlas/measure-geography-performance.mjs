import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const base = process.env.ATLAS_TEST_BASE_URL ?? "http://127.0.0.1:3213";
const output = path.resolve(process.env.ATLAS_PERFORMANCE_OUTPUT ?? "output/atlas-finish/geography-performance");
fs.mkdirSync(output, { recursive: true });
const pack = JSON.parse(fs.readFileSync("lib/atlas-world/data/geography-pack.v1.json", "utf8"));
const pyramid = pack.datasets.find((d) => d.id === "population-density-2025").assetPyramid;
const html = Buffer.from(await (await fetch(`${base}/atlas`)).arrayBuffer());
const results = { base, generatedAt: new Date().toISOString(), html: { bytes: html.length, gzipBytes: gzipSync(html).length }, devices: [] };
const browser = await chromium.launch();
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: name === "phone" ? 2 : 1 });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/atlas`);
  await page.waitForFunction(() => Number(document.querySelector("[data-atlas-map-group]")?.getAttribute("data-atlas-zoom-scale")) > 1);
  await page.waitForTimeout(400);
  const initial = { totalRequests: requests.length, physicalOverview: requests.filter((url) => url.includes("physical-mercator-overview")).length,
    physicalDetail: requests.filter((url) => url.includes("physical-mercator-detail")).length, densityDetails: requests.filter((url) => /population-density-2025-mercator\//.test(url)).length };
  await page.goto(`${base}/atlas?view=where-people-live&country=egy`);
  await page.getByRole("heading", { name: "Egypt", exact: true }).waitFor();
  await page.getByRole("button", { name: "Close Egypt", exact: true }).click();
  const measurements = [];
  for (const target of [6, 12, 24, 128]) {
    const map = page.locator("[data-atlas-world-map]");
    const rect = await map.boundingBox();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    for (let tries = 0; tries < 3; tries++) {
      const current = Number(await page.locator("[data-atlas-map-group]").getAttribute("data-atlas-zoom-scale"));
      if (Math.abs(current - target) < 0.01) break;
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -Math.log2(target / current) / 0.0016);
      await page.waitForTimeout(220);
    }
    await page.waitForFunction(() => [...document.querySelectorAll("[data-atlas-raster-tile]")].every((tile) => tile.getAttribute("visibility") === "visible"));
    const state = await page.evaluate(() => {
      const svg = document.querySelector("[data-atlas-world-map]");
      const group = svg.querySelector("[data-atlas-map-group]");
      const inverse = group.getScreenCTM().inverse();
      const bounds = svg.getBoundingClientRect();
      const a = new DOMPoint(bounds.left, bounds.top).matrixTransform(inverse);
      const b = new DOMPoint(bounds.right, bounds.bottom).matrixTransform(inverse);
      return { zoom: Number(group.getAttribute("data-atlas-zoom-scale")), preserveAspectRatio: svg.getAttribute("preserveAspectRatio"),
        level: svg.querySelector("[data-atlas-raster-level]").getAttribute("data-atlas-raster-level"),
        bounds: [a.x, a.y, b.x, b.y], tiles: [...svg.querySelectorAll("[data-atlas-raster-tile]")].map((tile) => tile.getAttribute("data-atlas-raster-tile")) };
    });
    const level = pyramid.levels.find((item) => item.id === state.level);
    const expected = level.tiles.filter((tile) => {
      const [x, y, w, h] = tile.viewBox;
      return x < state.bounds[2] && x + w > state.bounds[0] && y < state.bounds[3] && y + h > state.bounds[1];
    });
    const viewportMatches = JSON.stringify(expected.map((t) => t.id).sort()) === JSON.stringify([...state.tiles].sort());
    await page.evaluate(() => {
      window.__atlasPerformanceObserver?.disconnect();
      window.__atlasLongTasks = [];
      window.__atlasPerformanceObserver = new PerformanceObserver((list) => window.__atlasLongTasks.push(...list.getEntries().map((e) => e.duration)));
      window.__atlasPerformanceObserver.observe({ type: "longtask", buffered: false });
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + Math.min(120, rect.width / 5), y + 45, { steps: 40 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const longTasks = await page.evaluate(() => { window.__atlasPerformanceObserver.disconnect(); return window.__atlasLongTasks; });
    const compressedBytes = expected.reduce((sum, tile) => sum + tile.bytes, 0);
    measurements.push({ target, ...state, viewportMatches, compressedBytes, decodedBytes: expected.reduce((sum, tile) => sum + tile.width * tile.height * 4, 0), panLongTasksMilliseconds: longTasks });
    await page.screenshot({ path: path.join(output, `${name}-${target}.png`) });
  }
  results.devices.push({ name, viewport, initial, errors, measurements });
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(output, "measurements.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
