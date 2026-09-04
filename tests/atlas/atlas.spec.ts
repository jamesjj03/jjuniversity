import { expect, test, type Page, type TestInfo } from "@playwright/test";

const GDP_LAYER_ENDPOINT = "/api/atlas/layers/admin0-gdp-per-capita";

type GdpLayerPayload = {
  layerId: string;
  datasetId: string;
  requestedTime: { kind: string };
  coverage: { total: number; observed: number; unavailable: number };
  values: Array<{
    entityId: string;
    status: "observed" | "unavailable";
    formattedValue: string | null;
    observedAt: string | null;
    sourceId: string | null;
  }>;
  sources: Array<{
    id: string;
    publisher: string;
    sourceUpdatedAt: string | null;
  }>;
};

function isMobile(testInfo: TestInfo) {
  return testInfo.project.name.startsWith("mobile");
}

function searchParam(page: Page, name: string) {
  return new URL(page.url()).searchParams.get(name);
}

async function chooseCountry(page: Page, name: string) {
  const search = page.getByRole("combobox", { name: "Search countries" });
  await search.fill(name.slice(0, 4));
  await page.getByRole("option", { name: new RegExp(`^${name}(?:\\s|$)`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function expectLayerVisible(page: Page, layerId: string, visible: boolean) {
  const layer = page.locator(`[data-atlas-layer="${layerId}"]`);
  await expect(layer).toHaveCount(1);
  await expect.poll(async () => layer.evaluate((element) => getComputedStyle(element).display !== "none"))
    .toBe(visible);
}

async function inertState(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => (element as HTMLElement).inert);
}

test("preserves the search → lens → country curiosity loop and browser history", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop curiosity-loop coverage");

  await page.goto("/atlas");
  await expect(page.getByRole("heading", { name: "ATLAS" })).toBeVisible();
  await expect(page.locator("[data-atlas-world-map]")).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("/atlas-world/layers/")).length)).toBe(0);

  await chooseCountry(page, "Zimbabwe");
  await expect(page.locator("[data-atlas-sheet]")).toBeFocused();
  expect(searchParam(page, "country")).toBe("zwe");
  expect(searchParam(page, "focus")).toBe("entity:country:ZWE");
  await expect(page.getByText("At a glance", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Government", exact: true }).click();
  expect(searchParam(page, "view")).toBe("government");
  await expect(page.getByLabel("What the map is showing")).toContainText("Government");

  await page.goBack();
  await expect(page).toHaveURL(/\/atlas\/?$/);
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toHaveCount(0);

  await page.goForward();
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  await expect(page.getByLabel("What the map is showing")).toContainText("Government");
});

test("keeps V1 mode links working and canonicalizes them into shareable scene state", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop deep-link coverage");

  await page.goto("/atlas?country=zwe&mode=religion");
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  await expect(page.getByLabel("What the map is showing")).toContainText("Religion");
  expect(searchParam(page, "mode")).toBeNull();
  expect(searchParam(page, "view")).toBe("religion");

  await page.getByRole("button", { name: "Population", exact: true }).click();
  expect(searchParam(page, "mode")).toBeNull();
  expect(searchParam(page, "view")).toBe("population");
  expect(searchParam(page, "country")).toBe("zwe");
  expect(searchParam(page, "focus")).toBe("entity:country:ZWE");
  await expect(page.getByLabel("What the map is showing")).toContainText("Population");
});

test("keeps shared scenes authored and resets the cockpit when moving between countries", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop scene-integrity and cockpit-state coverage");

  const unrelatedGovernmentStack = encodeURIComponent(
    'v2:[{"l":"admin0-government"},{"l":"modern-borders"},{"l":"admin0-interaction"}]',
  );
  await page.goto(`/atlas?view=political&layers=${unrelatedGovernmentStack}`);
  await expect(page.getByRole("button", { name: "Political", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => searchParam(page, "layers")).toBeNull();
  await expect(page.getByLabel("Political map legend")).toBeVisible();
  await expect(page.getByRole("img", { name: /Political view/ })).toBeVisible();

  await page.goto("/atlas?view=political&focus=entity%3Acountry%3AZWE&country=fra");
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  expect(searchParam(page, "country")).toBe("zwe");
  expect(searchParam(page, "focus")).toBe("entity:country:ZWE");

  await chooseCountry(page, "Andorra");
  const dominantReligion = page.locator("article").filter({ hasText: "Dominant tradition" });
  await expect(dominantReligion).toContainText("Christianity");
  await expect(dominantReligion).toContainText("does not provide a comparable percentage");
  await page.getByRole("button", { name: "Politics", exact: true }).click();
  await expect(page.getByRole("button", { name: "Politics", exact: true })).toHaveAttribute("aria-current", "page");

  await chooseCountry(page, "Zimbabwe");
  await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Close Zimbabwe" }).click();
  await expect(page.getByRole("combobox", { name: "Search countries" })).toBeFocused();
});

test("GDP per capita exposes loading, year, missing-data, provenance, and reload-safe share state", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop legend and cockpit coverage");

  let apiRequestObserved = false;
  await page.route(`**${GDP_LAYER_ENDPOINT}*`, async (route) => {
    apiRequestObserved = true;
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await page.goto("/atlas?view=gdp-per-capita", { waitUntil: "domcontentloaded" });
  const legend = page.getByLabel("GDP per capita map legend");
  const desktopLegend = legend.locator(":scope > div").first();
  await expect(desktopLegend.getByText("Loading current values…", { exact: true })).toBeVisible();
  await expect.poll(() => apiRequestObserved).toBe(true);
  await expect(desktopLegend.getByText("No World Bank observation", { exact: true })).toBeVisible();
  await expect(desktopLegend.getByText("29 places", { exact: true })).toBeVisible();

  const firstTick = desktopLegend.locator('[data-atlas-continuous-tick="500"]');
  const expectedLogPosition = (
    (Math.log(500) - Math.log(200))
    / (Math.log(300_000) - Math.log(200))
  ) * 100;
  await expect(firstTick).toHaveCSS("position", "absolute");
  expect(await firstTick.evaluate((element) => parseFloat((element as HTMLElement).style.left)))
    .toBeCloseTo(expectedLogPosition, 2);

  const sourceDisclosure = desktopLegend.locator("details").filter({ hasText: "Sources" }).first();
  await sourceDisclosure.locator("summary").click();
  await expect(sourceDisclosure.getByRole("link", { name: "World Bank", exact: true })).toBeVisible();

  const method = desktopLegend.locator("details").filter({ hasText: "How this view was made" }).first();
  await method.locator("summary").click();
  await expect(method).toContainText("World Bank · 2026");

  await chooseCountry(page, "Zimbabwe");
  const lens = page.getByLabel("What the map is showing");
  await expect(lens).toContainText("GDP per capita");
  await expect(lens).toContainText("$3,021 · 2025 observation");
  await expect(lens).toContainText("World Bank");
  expect(searchParam(page, "view")).toBe("gdp-per-capita");
  expect(searchParam(page, "country")).toBe("zwe");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  await expect(page.getByLabel("What the map is showing")).toContainText("$3,021 · 2025 observation");

  await page.goto("/atlas?view=gdp-per-capita&country=ata");
  await expect(page.getByRole("heading", { name: "Antarctica", exact: true })).toBeVisible();
  await expect(page.getByLabel("What the map is showing")).toContainText("No World Bank observation");

  await page.goto("/atlas?view=gdp-per-capita&time=1900&country=zwe");
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  expect(searchParam(page, "time")).toBeNull();
  await expect(page.getByLabel("What the map is showing")).toContainText("$3,021 · 2025 observation");
});

test("GDP per capita API preserves observation and time-selection semantics", async ({ request }, testInfo) => {
  test.skip(isMobile(testInfo), "The data-contract check only needs one browser project");

  const response = await request.get(GDP_LAYER_ENDPOINT);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("stale-while-revalidate");
  expect(response.headers().etag).toContain("latest");
  const payload = await response.json() as GdpLayerPayload;

  expect(payload.layerId).toBe("admin0-gdp-per-capita");
  expect(payload.datasetId).toBe("admin0-gdp-per-capita");
  expect(payload.requestedTime.kind).toBe("latest");
  expect(payload.coverage).toEqual({ total: 242, observed: 213, unavailable: 29 });

  expect(payload.values.find((value) => value.entityId === "country:ZWE")).toMatchObject({
    status: "observed",
    formattedValue: "$3,021",
    observedAt: "2025",
    sourceId: "world-bank-ny-gdp-pcap-cd-2026-07-13",
  });
  expect(payload.values.find((value) => value.entityId === "country:ATA")).toMatchObject({
    status: "unavailable",
    formattedValue: null,
    observedAt: null,
    sourceId: null,
  });
  expect(payload.sources).toContainEqual(expect.objectContaining({
    id: "world-bank-ny-gdp-pcap-cd-2026-07-13",
    publisher: "World Bank",
    sourceUpdatedAt: "2026-07-13",
  }));

  const historical = await request.get(`${GDP_LAYER_ENDPOINT}?at=1900`);
  expect(historical.status()).toBe(422);
  await expect(historical.json()).resolves.toEqual({
    error: "GDP per capita currently supports only the latest available observation.",
  });
});

test("Where people live composes physical layers, preserves toggles, and explains visible patterns", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop composed-view coverage");

  await page.goto("/atlas?view=where-people-live");
  await expect(page.getByRole("button", { name: "Where people live", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "Explanations on this map" })).toBeVisible();

  await page.setViewportSize({ width: 900, height: 800 });
  const toolbarBox = await page.locator("header").filter({ has: page.getByRole("heading", { name: "ATLAS" }) }).boundingBox();
  const noteNavigatorBox = await page.getByRole("navigation", { name: "Explanations on this map" }).boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(noteNavigatorBox).not.toBeNull();
  expect(noteNavigatorBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height + 8);

  const densityTick = page.locator('[data-atlas-continuous-tick="10"]').first();
  const expectedLog1pPosition = (
    (Math.log1p(10) - Math.log1p(1))
    / (Math.log1p(20_000) - Math.log1p(1))
  ) * 100;
  expect(await densityTick.evaluate((element) => parseFloat((element as HTMLElement).style.left)))
    .toBeCloseTo(expectedLog1pPosition, 2);

  const visibleLayerIds = [
    "physical-relief",
    "population-density-2025",
    "major-lakes",
    "major-rivers",
    "modern-borders",
    "major-cities",
    "admin0-interaction",
  ];
  for (const layerId of visibleLayerIds) await expectLayerVisible(page, layerId, true);
  const annotationLayer = page.locator('[data-atlas-layer="population-geography-annotations"]');
  await expect(annotationLayer).toHaveAttribute("data-atlas-layer-active", "true");
  await expectLayerVisible(page, "population-geography-annotations", false);
  await expect(page.locator('[data-atlas-layer="physical-relief"]')).toHaveCSS("opacity", "0.18");
  await expect(page.locator('[data-atlas-layer="population-density-2025"]')).toHaveAttribute(
    "href",
    "/atlas-world/layers/population-density-2025.equal-earth.webp",
  );
  await expect(page.locator("[data-atlas-visual]").first()).toHaveCSS("opacity", "0.12");

  const densityToggle = page.getByRole("button", { name: "Population density", exact: true });
  const explanationToggle = page.getByRole("button", { name: "Contextual explanations", exact: true });
  await densityToggle.click();
  await expect(densityToggle).toHaveAttribute("aria-pressed", "false");
  await expect(explanationToggle).toHaveAttribute("aria-pressed", "false");
  await expectLayerVisible(page, "population-density-2025", false);
  await expect(annotationLayer).toHaveAttribute("data-atlas-layer-active", "false");
  await expectLayerVisible(page, "population-geography-annotations", false);
  await densityToggle.click();
  await explanationToggle.click();
  await expectLayerVisible(page, "population-density-2025", true);
  await expect(annotationLayer).toHaveAttribute("data-atlas-layer-active", "true");
  await expectLayerVisible(page, "population-geography-annotations", false);
  expect(searchParam(page, "layers")).toBeNull();

  const riverToggle = page.getByRole("button", { name: "Major rivers", exact: true });
  await expect(riverToggle).toHaveAttribute("aria-pressed", "true");
  await riverToggle.click();
  await expect(riverToggle).toHaveAttribute("aria-pressed", "false");
  await expectLayerVisible(page, "major-rivers", false);

  const serializedLayers = searchParam(page, "layers");
  expect(serializedLayers).toMatch(/^v2:/);
  const sharedLayerState = JSON.parse(serializedLayers!.slice(3)) as Array<{
    l: string;
    e?: boolean;
    p?: Record<string, string>;
  }>;
  expect(sharedLayerState.find((layer) => layer.l === "major-rivers")?.e).toBe(false);
  expect(sharedLayerState.find((layer) => layer.l === "admin0-political")?.p).toEqual({ role: "context" });

  await page.reload();
  await expect(page.getByRole("button", { name: "Major rivers", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expectLayerVisible(page, "major-rivers", false);

  await page.getByRole("button", { name: "Major rivers", exact: true }).click();
  await expectLayerVisible(page, "major-rivers", true);
  expect(searchParam(page, "layers")).toBeNull();

  await page.getByRole("button", { name: "1. A country gathered around one river", exact: true }).click();
  await expectLayerVisible(page, "population-geography-annotations", true);
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toBeVisible();
  await expect(page.getByText(/Egypt’s bright population corridor follows the Nile Valley/)).toBeVisible();
  expect(searchParam(page, "focus")).toBe("feature:pattern-note:population:nile-valley");

  await page.getByText("Evidence & caveats", { exact: true }).click();
  await expect(page.getByRole("link", { name: /NASA Earth Observatory/ }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Explanations on this map" })).toBeVisible();
});

test("mobile country details deliberately move through Peek, Half, and Full", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "Mobile interaction and accessibility coverage");

  await page.goto("/atlas?country=zwe");
  await expect(page.getByRole("heading", { name: "ATLAS" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();

  const panel = page.locator("[data-atlas-sheet]");
  const toolbar = page.locator("header").filter({ has: page.getByRole("heading", { name: "ATLAS" }) });
  const legend = page.locator('[aria-label="Political map legend"]');
  const mapControls = page.locator('[aria-label="Map controls"]');
  const detentButtons = page.getByRole("group", { name: "Country detail height" }).getByRole("button");

  await expect(panel).toHaveAttribute("data-atlas-sheet", "half");
  const halfHeight = (await panel.boundingBox())!.height;
  await expect(legend).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => inertState(legend)).toBe(true);
  await expect.poll(() => inertState(toolbar)).toBe(false);
  await expect.poll(() => inertState(mapControls)).toBe(false);

  await page.getByRole("button", { name: "Where people live", exact: true }).click();
  const noteSurface = page.locator('nav[aria-label="Explanations on this map"]').locator("..");
  await expect.poll(() => inertState(noteSurface)).toBe(false);

  await expect(detentButtons).toHaveCount(3);
  for (const button of await detentButtons.all()) {
    const target = await button.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole("button", { name: "full", exact: true }).click();
  await expect(panel).toHaveAttribute("data-atlas-sheet", "full");
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(halfHeight + 100);
  await expect.poll(() => inertState(toolbar)).toBe(true);
  await expect.poll(() => inertState(mapControls)).toBe(true);
  await expect.poll(() => inertState(noteSurface)).toBe(true);

  const fullBox = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(fullBox.y).toBeGreaterThanOrEqual(0);
  expect(fullBox.y + fullBox.height).toBeLessThanOrEqual(viewport.height + 1);

  await page.getByRole("button", { name: "peek", exact: true }).click();
  await expect(panel).toHaveAttribute("data-atlas-sheet", "peek");
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeLessThan(halfHeight - 100);
  await expect(page.locator("[data-atlas-world-map]")).toBeVisible();
  await expect.poll(() => inertState(toolbar)).toBe(false);
  await expect.poll(() => inertState(mapControls)).toBe(false);
  await expect.poll(() => inertState(noteSurface)).toBe(false);

  await page.getByRole("button", { name: "Expand country details", exact: true }).click();
  await expect(panel).toHaveAttribute("data-atlas-sheet", "half");
});

test("mobile legend exposes source links without clipping", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "Mobile legend disclosure coverage");

  await page.goto("/atlas?view=gdp-per-capita");
  const legend = page.getByLabel("GDP per capita map legend");
  const layerDisclosure = legend.locator(":scope > details");
  await layerDisclosure.locator(":scope > summary").click();

  const sourceDisclosure = layerDisclosure.locator("details").filter({ hasText: "Sources" }).first();
  await sourceDisclosure.locator("summary").click();
  const sourceLink = sourceDisclosure.getByRole("link", { name: "World Bank", exact: true });
  await expect(sourceLink).toBeVisible();

  const legendBox = await legend.boundingBox();
  const linkBox = await sourceLink.boundingBox();
  expect(legendBox).not.toBeNull();
  expect(linkBox).not.toBeNull();
  expect(linkBox!.y).toBeGreaterThanOrEqual(legendBox!.y);
  expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(legendBox!.y + legendBox!.height + 1);
});

test("mobile explanations remove covered map controls from interaction", async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), "Mobile annotation accessibility coverage");

  await page.goto("/atlas?view=where-people-live");
  const mapControls = page.locator('[aria-label="Map controls"]');
  await expect.poll(() => inertState(mapControls)).toBe(false);

  await page.getByRole("button", { name: "1. A country gathered around one river", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toBeVisible();
  await expect(mapControls).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => inertState(mapControls)).toBe(true);

  await page.getByRole("button", { name: "Close map explanation" }).click();
  await expect(mapControls).not.toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => inertState(mapControls)).toBe(false);
});
