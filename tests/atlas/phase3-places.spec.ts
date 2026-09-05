import { expect, test, type Page, type TestInfo } from "@playwright/test";

function isMobile(testInfo: TestInfo) {
  return testInfo.project.name.startsWith("mobile");
}

async function waitForMap(page: Page) {
  await expect(page.locator("[data-atlas-map-group]")).toHaveAttribute("transform", /scale\(/);
}

async function openSearch(page: Page) {
  const search = page.getByRole("combobox", { name: "Find a country, city, river, or lake" });
  if (!await search.isVisible()) {
    await page.getByRole("button", { name: "Find a place", exact: true }).click();
  }
  return search;
}

test("typed place search selects a city and a multipart river without losing the lens", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop typed-search and browser-history coverage");

  await page.goto("/atlas?view=where-people-live", { waitUntil: "domcontentloaded" });
  await waitForMap(page);

  const search = await openSearch(page);
  await search.fill("cairo");
  await page.getByRole("option", { name: "Cairo National capital · Egypt · Al Qahirah", exact: true }).click();
  const cityCard = page.locator('[data-atlas-place-card="city"]');
  await expect(cityCard.getByRole("heading", { name: "Cairo", exact: true })).toBeVisible();
  await expect(cityCard).toBeFocused();
  await expect(page).toHaveURL(/city=cairo-egy/);
  await expect(page).toHaveURL(/view=where-people-live/);

  await (await openSearch(page)).fill("nile");
  await page.getByRole("option", { name: /^Nile River · Egypt, Ethiopia, Sudan/ }).click();
  const riverCard = page.locator('[data-atlas-place-card="river"]');
  await expect(riverCard.getByRole("heading", { name: "Nile", exact: true })).toBeVisible();
  await expect(riverCard.getByRole("region", { name: "Crosses mapped countries" })).toContainText("South Sudan");
  await expect(page).toHaveURL(/feature=river%3Anile/);
  await expect.poll(() => page.locator(
    '[data-atlas-place="place:natural-earth:river:nile"][data-atlas-place-selected="true"]',
  ).count()).toBeGreaterThan(1);

  await page.goBack();
  await expect(cityCard.getByRole("heading", { name: "Cairo", exact: true })).toBeVisible();
  await page.goForward();
  await expect(riverCard.getByRole("heading", { name: "Nile", exact: true })).toBeVisible();
});

test("friendly feature deep links are resolved on the server before hydration", async ({ page, request }, testInfo) => {
  test.skip(isMobile(testInfo), "One server-rendering contract is sufficient");

  const response = await request.get("/atlas?view=where-people-live&feature=lake%3Alake-victoria");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('data-atlas-initial-view="where-people-live"');
  expect(html).toContain('data-atlas-initial-focus="feature"');
  expect(html).toContain("Lake Victoria");

  await page.goto("/atlas?view=where-people-live&feature=lake%3Alake-victoria", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  await expect(page.locator('[data-atlas-place-card="lake"]')
    .getByRole("heading", { name: "Lake Victoria", exact: true })).toBeVisible();
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "where-people-live");
});

test("progressive detail pins a selected close-zoom city and omits unnamed search placeholders", async ({ page }, testInfo) => {
  await page.goto("/atlas?view=where-people-live&city=napier-nzl", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  await expect(page.locator('[data-atlas-place-card="city"]')
    .getByRole("heading", { name: "Napier", exact: true })).toBeVisible();
  await expect(page.locator('[data-atlas-place="city:natural-earth:1159151687"]'))
    .toHaveAttribute("data-atlas-place-selected", "true");
  await expect(page.locator("[data-atlas-map-group]")).toHaveAttribute("data-atlas-zoom-scale", /^(?:1[4-9]|2\d)/);

  if (!isMobile(testInfo)) {
    const search = await openSearch(page);
    await search.fill("unnamed");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: /Unnamed feature/ })).toHaveCount(0);
  }
});

test("the phone keeps the map visible while a selected place uses a touch-sized sheet", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "Phone composition coverage");

  await page.goto("/atlas?view=where-people-live&city=cairo-egy", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  const card = page.locator('[data-atlas-place-card="city"]');
  await expect(card).toBeVisible();
  await expect(page.locator("[data-atlas-world-map]")).toBeVisible();
  const cardBox = await card.boundingBox();
  const viewport = page.viewportSize();
  expect(cardBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(cardBox!.height).toBeLessThan(viewport!.height * 0.55);
  await expect(card.getByRole("button", { name: "Close Cairo" })).toHaveCSS("height", "44px");
  await expect(page.getByRole("button", { name: "Find a place", exact: true })).toBeVisible();
  await expect(page.locator('[aria-live="polite"]')).toContainText("Cairo city selected.");

  const controlsBox = await page.getByRole("group", { name: "Map controls" }).boundingBox();
  const legendBox = await page.getByRole("complementary", { name: /map legend$/ }).boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(legendBox).not.toBeNull();
  expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(cardBox!.y);
  expect(legendBox!.y + legendBox!.height).toBeLessThanOrEqual(cardBox!.y);

  await page.goto("/atlas?view=where-people-live&feature=river%3Anile", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  const riverCard = page.locator('[data-atlas-place-card="river"]');
  await expect(riverCard).toBeVisible();
  await expect(page.locator('[aria-live="polite"]')).toContainText("Nile river selected.");
  const riverCardBox = await riverCard.boundingBox();
  const riverControlsBox = await page.getByRole("group", { name: "Map controls" }).boundingBox();
  const riverLegendBox = await page.getByRole("complementary", { name: /map legend$/ }).boundingBox();
  expect(riverCardBox).not.toBeNull();
  expect(riverControlsBox).not.toBeNull();
  expect(riverLegendBox).not.toBeNull();
  expect(riverControlsBox!.y + riverControlsBox!.height).toBeLessThanOrEqual(riverCardBox!.y);
  expect(riverLegendBox!.y + riverLegendBox!.height).toBeLessThanOrEqual(riverCardBox!.y);
});
