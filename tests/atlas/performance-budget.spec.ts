import { expect, test } from "@playwright/test";

test("the opening Atlas stays inside its phone-safe HTML and DOM budgets", async ({ page, request }) => {
  const response = await request.get("/atlas", {
    headers: { "accept-encoding": "identity" },
  });
  expect(response.status()).toBe(200);
  const html = await response.body();
  expect(html.byteLength).toBeLessThan(4_500_000);

  await page.goto("/atlas", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-atlas-map-group]")).toHaveAttribute("transform", /scale\(/);
  await expect.poll(() => page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    features: document.querySelectorAll("[data-atlas-map-feature]").length,
  }))).toMatchObject({
    nodes: expect.any(Number),
    features: expect.any(Number),
  });
  const metrics = await page.evaluate(() => ({
    nodes: document.querySelectorAll("*").length,
    features: document.querySelectorAll("[data-atlas-map-feature]").length,
    detailVectorRequests: performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("physical-mercator-detail")).length,
  }));
  expect(metrics.nodes).toBeLessThan(5_000);
  expect(metrics.features).toBeLessThan(400);
  expect(metrics.detailVectorRequests).toBe(0);

  const openingFeatureIds = await page.locator("[data-atlas-map-feature]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-atlas-map-feature")));
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.click({ clickCount: 3 });
  await expect.poll(() => page.locator("[data-atlas-map-feature]").evaluateAll(
    (nodes, initialIds) => {
      const currentIds = nodes.map((node) => node.getAttribute("data-atlas-map-feature"));
      return currentIds.some((id) => !initialIds.includes(id));
    },
    openingFeatureIds,
  )).toBe(true);
});
