import { expect, test, type Page, type TestInfo } from "@playwright/test";

function isMobile(testInfo: TestInfo) {
  return testInfo.project.name.startsWith("mobile");
}

async function waitForMap(page: Page) {
  await expect(page.locator("[data-atlas-map-group]")).toHaveAttribute("data-atlas-zoom-scale", /\d/);
  await expect(page.getByRole("button", { name: /^Choose view:/ })).toBeEnabled();
}

test("old population-density links canonicalize without losing country focus", async ({ page }) => {
  await page.goto("/atlas?view=where-people-live&country=egy", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "population-density");
  await expect(page.getByRole("button", { name: "Choose view: Population density" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Egypt", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("population-density");
  expect(new URL(page.url()).searchParams.get("country")).toBe("egy");
});

test("view command palette filters, follows related views, remembers recent, and supports shortcuts", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop keyboard and recent-view coverage");
  await page.goto("/atlas?view=political", { waitUntil: "domcontentloaded" });
  await waitForMap(page);

  await page.keyboard.press("v");
  const chooser = page.getByRole("dialog", { name: "Explore the map" });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("textbox", { name: "Find an Atlas view" })).toBeFocused();
  await chooser.getByRole("textbox", { name: "Find an Atlas view" }).fill("longevity");
  await expect(chooser.getByRole("button", { name: "Life expectancy" })).toBeVisible();
  await expect(chooser.getByRole("button", { name: "Government" })).not.toBeVisible();
  await chooser.getByRole("button", { name: "Life expectancy" }).click();
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "life-expectancy");

  await page.keyboard.press("v");
  await expect(chooser.getByLabel("Recent").getByRole("button", { name: "Political", exact: true })).toBeVisible();
  await chooser.locator("footer").getByRole("button", { name: "GDP per capita", exact: true }).click();
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "gdp-per-capita");

  await page.keyboard.press("v");
  await expect(chooser.getByLabel("Recent").getByRole("button", { name: "Life expectancy", exact: true })).toBeVisible();
  await chooser.getByRole("button", { name: "Close map views" }).click();

  await page.keyboard.press("1");
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "political");
  await page.keyboard.press("2");
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "population-density");
  await page.keyboard.press("]");
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "population");
});

test("Compare World toggles sourced A/B maps without moving the camera or losing selection", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop statistical readout and camera-continuity coverage");
  await page.goto("/atlas?view=gdp-per-capita&country=zwe", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  const mapGroup = page.locator("[data-atlas-map-group]");
  const before = await mapGroup.getAttribute("transform");
  const rivers = page.getByRole("button", { name: "Major rivers", exact: true });
  await rivers.click();
  await expect(rivers).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Compare views", exact: true }).click();
  const compare = page.getByRole("dialog", { name: "Read two lenses together" });
  await compare.getByRole("button", { name: /Wealth ↔ Longevity/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("compare")).toBe("wealth-longevity");
  await expect(compare.getByLabel("Zimbabwe comparison values").getByText("Zimbabwe", { exact: true })).toBeVisible();
  await expect(compare.locator("figcaption")).toContainText(/Across \d+ comparable country observations/);
  await expect(compare.getByRole("figure", { name: /Wealth ↔ Longevity country scatter plot/ })).toBeVisible();
  await expect(compare.getByLabel("Comparison scale and calculation")).toContainText(
    "Scatter position, correlation, and outlier calculations use GDP per capita on the same logarithmic scale displayed on the map",
  );
  const gdpPayload = await page.request.get("/api/atlas/layers/admin0-gdp-per-capita").then((response) => response.json()) as {
    values: Array<{ entityId: string; formattedValue: string | null }>;
  };
  const expectedGdp = gdpPayload.values.find((datum) => datum.entityId === "country:ZWE")?.formattedValue;
  if (expectedGdp) await expect(compare.getByLabel("Zimbabwe comparison values")).toContainText(expectedGdp);

  await compare.getByRole("button", { name: /B\s*Life expectancy/ }).click();
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "life-expectancy");
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  await expect(rivers).toHaveAttribute("aria-pressed", "false");
  expect(await mapGroup.getAttribute("transform")).toBe(before);
  expect(new URL(page.url()).searchParams.get("compareSide")).toBe("b");

  await compare.getByRole("button", { name: "Close Compare World" }).click();
  const quickBar = page.getByLabel("Wealth ↔ Longevity comparison controls");
  await expect(quickBar).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "gdp-per-capita");
  expect(await mapGroup.getAttribute("transform")).toBe(before);
  await page.keyboard.press("x");
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "life-expectancy");
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMap(page);
  await expect(page.getByLabel("Wealth ↔ Longevity comparison controls")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("compareSide")).toBe("b");

  await page.getByRole("button", { name: /Compare views: Wealth ↔ Longevity/ }).click();
  const outliers = page.getByLabel("Notable statistical outliers");
  await expect(outliers.getByRole("button")).toHaveCount(3);
  const firstOutlier = outliers.getByRole("button").first();
  const outlierName = await firstOutlier.textContent();
  await firstOutlier.click();
  if (outlierName) await expect(page.getByRole("heading", { name: outlierName, exact: true })).toBeVisible();
});

test("comparison scatter points expose both values and focus countries on the map", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop pointer and keyboard scatter coverage");
  await page.goto("/atlas?view=gdp-per-capita&country=zwe&compare=wealth-longevity&compareSide=a", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  await page.getByRole("button", { name: /Compare views: Wealth ↔ Longevity/ }).click();

  const compare = page.getByRole("dialog", { name: "Read two lenses together" });
  const figure = compare.getByRole("figure", { name: /Wealth ↔ Longevity country scatter plot/ });
  const selectedZimbabwePoint = figure.locator('[data-atlas-comparison-country="country:ZWE"]');
  await expect(figure.locator('[data-atlas-comparison-country][tabindex="0"]')).toHaveCount(1);
  await expect(selectedZimbabwePoint).toHaveAttribute("tabindex", "0");
  await selectedZimbabwePoint.focus();
  await selectedZimbabwePoint.press("ArrowRight");
  const arrowFocusedPoint = figure.locator('[data-atlas-comparison-country]:focus');
  await expect(arrowFocusedPoint).toHaveCount(1);
  await expect(arrowFocusedPoint).not.toHaveAttribute("data-atlas-comparison-country", "country:ZWE");
  await expect(arrowFocusedPoint).toHaveAttribute("tabindex", "0");

  const usaPoint = figure.locator('[data-atlas-comparison-country="country:USA"]');
  await expect(usaPoint).toHaveAttribute("role", "button");
  await expect(usaPoint).toHaveAttribute("aria-label", /United States.*GDP per capita:.*Life expectancy:.*Select to focus this country on the map/);

  await usaPoint.focus();
  await expect(usaPoint).toHaveAttribute("data-active", "true");
  await expect(figure.getByText("United States of America", { exact: true })).toBeVisible();
  await expect.poll(async () => page.locator('[data-atlas-visual="country:USA"]').first().getAttribute("class"))
    .toContain("hoveredShape");
  await usaPoint.press("Enter");
  await expect(compare).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "United States of America", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("country")).toBe("usa");

  await page.getByRole("button", { name: /Compare views: Wealth ↔ Longevity/ }).click();
  const canadaPoint = compare.getByRole("figure", { name: /Wealth ↔ Longevity country scatter plot/ })
    .locator('[data-atlas-comparison-country="country:CAN"]');
  await canadaPoint.focus();
  await canadaPoint.press("Space");
  await expect(page.getByRole("heading", { name: "Canada", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("country")).toBe("can");

  await page.getByRole("button", { name: /Compare views: Wealth ↔ Longevity/ }).click();
  const zimbabwePoint = compare.getByRole("figure", { name: /Wealth ↔ Longevity country scatter plot/ })
    .locator('[data-atlas-comparison-country="country:ZWE"]');
  await zimbabwePoint.click();
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("country")).toBe("zwe");
});

test("comparison and map-to-globe state remain usable at phone width", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "Phone composition coverage");
  await page.goto("/atlas?view=fertility&country=ind&compare=fertility-population-growth&compareSide=a", { waitUntil: "domcontentloaded" });
  await waitForMap(page);
  const quickBar = page.getByLabel("Fertility ↔ Population growth comparison controls");
  await expect(quickBar).toBeVisible();
  await expect(quickBar.getByRole("button", { name: /A\s*Fertility/ })).toHaveAttribute("aria-pressed", "true");
  await quickBar.getByRole("button", { name: /B\s*Growth/ }).click();
  await expect(page.locator("[data-atlas-root]")).toHaveAttribute("data-atlas-view", "population-growth");
  await expect(page.getByRole("link", { name: "Globe" })).toHaveAttribute("href", "/atlas/globe?country=ind");
});
