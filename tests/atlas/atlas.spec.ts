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
  if (!await search.isVisible()) await page.getByRole("button", { name: "Search countries", exact: true }).click();
  await search.fill(name.slice(0, 4));
  await page.getByRole("option", { name: new RegExp(`^${name}(?:\\s|$)`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function chooseView(page: Page, name: string) {
  await page.getByRole("button", { name: /^Choose view:/ }).click();
  await page.getByRole("group", { name: "Atlas view", exact: true })
    .getByRole("button").filter({ has: page.getByText(name, { exact: true }) }).click();
  await expect(page.getByRole("button", { name: `Choose view: ${name}`, exact: true })).toBeVisible();
}

async function openExplanationPicker(page: Page) {
  const picker = page.getByLabel("Explanations on this map", { exact: true });
  if (!await picker.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await picker.locator(":scope > summary").click();
  }
  return picker;
}

async function openLayerControls(page: Page) {
  const appearance = page.getByLabel("Where people live map legend", { exact: true })
    .locator(":scope > div details").filter({ has: page.getByText("Map detail & layers", { exact: true }) });
  if (!await appearance.evaluate((element) => (element as HTMLDetailsElement).open)) {
    await appearance.locator(":scope > summary").click();
  }
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
  await expect(page.getByRole("combobox", { name: "Search countries" })).not.toBeVisible();

  await chooseCountry(page, "Zimbabwe");
  await expect(page.locator("[data-atlas-sheet]")).toBeFocused();
  expect(searchParam(page, "country")).toBe("zwe");
  expect(searchParam(page, "focus")).toBe("entity:country:ZWE");
  await expect(page.locator("[data-atlas-sheet]")).toContainText("Harare");

  await chooseView(page, "Government");
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

  await chooseView(page, "Population");
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
  await expect(page.getByRole("button", { name: "Choose view: Political", exact: true })).toBeVisible();
  await expect.poll(() => searchParam(page, "layers")).toBeNull();
  await expect(page.getByLabel("Political map legend")).toBeVisible();
  await expect(page.getByRole("img", { name: /Political view/ })).toBeVisible();

  await page.goto("/atlas?view=political&focus=entity%3Acountry%3AZWE&country=fra");
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  expect(searchParam(page, "country")).toBe("zwe");
  expect(searchParam(page, "focus")).toBe("entity:country:ZWE");

  await chooseCountry(page, "Andorra");
  const dominantReligion = page.getByLabel("Religious composition", { exact: true });
  await expect(dominantReligion).toContainText("Christianity");
  await expect(dominantReligion).toContainText("No comparable percentage is available for the dominant tradition");
  await page.getByRole("button", { name: "Politics", exact: true }).click();
  await expect(page.getByRole("button", { name: "Politics", exact: true })).toHaveAttribute("aria-current", "page");

  await chooseCountry(page, "Zimbabwe");
  await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Close Zimbabwe" }).click();
  await expect(page.getByRole("button", { name: "Search countries", exact: true })).toBeFocused();
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
  expect(await firstTick.evaluate((element) => parseFloat((element as HTMLElement).style.left)))
    .toBeCloseTo(expectedLogPosition, 2);

  const sourceDisclosure = desktopLegend.locator("details").filter({ hasText: "Sources" }).first();
  await sourceDisclosure.locator("summary").click();
  await expect(sourceDisclosure.getByRole("link", { name: "World Bank", exact: true })).toBeVisible();

  const method = desktopLegend.locator("details").filter({ hasText: "How to read this map" }).first();
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
  expect(response.headers()["cache-control"]).toContain("public");
  expect(response.headers()["cache-control"]).toContain("max-age=3600");
  // Vercel consumes CDN-only directives rather than forwarding them to the
  // browser: https://vercel.com/docs/caching/cache-control-headers
  if (!response.headers()["x-vercel-id"]) {
    expect(response.headers()["cache-control"]).toContain("stale-while-revalidate");
  }
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
  await expect(page.getByRole("button", { name: "Choose view: Where people live", exact: true })).toBeVisible();
  await expect(page.getByLabel("Explanations on this map", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 900, height: 800 });
  const toolbarBox = await page.locator("header").filter({ has: page.getByRole("heading", { name: "ATLAS" }) }).boundingBox();
  const noteNavigatorBox = await page.getByLabel("Explanations on this map", { exact: true }).boundingBox();
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
  await expectLayerVisible(page, "population-geography-annotations", true);

  // Confirm the image actually loaded. Resolution or opacity can legitimately
  // change during cartographic improvements without changing this contract.
  const densitySurface = page.locator('[data-atlas-layer="population-density-2025"]');
  const densityHref = await densitySurface.evaluate((surface) => surface.getAttribute("href") ?? surface.querySelector("image")?.getAttribute("href"));
  expect(densityHref).toMatch(/population-density-2025.*\.webp$/);
  await expect.poll(() => page.evaluate((href) => new Promise<boolean>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 1000);
    image.onerror = () => resolve(false);
    image.src = href!;
  }), densityHref)).toBe(true);

  await openLayerControls(page);

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
  await expectLayerVisible(page, "population-geography-annotations", true);
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
  await openLayerControls(page);
  await expect(page.getByRole("button", { name: "Major rivers", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expectLayerVisible(page, "major-rivers", false);

  await page.getByRole("button", { name: "Major rivers", exact: true }).click();
  await expectLayerVisible(page, "major-rivers", true);
  expect(searchParam(page, "layers")).toBeNull();

  await openExplanationPicker(page);
  await page.getByRole("button", { name: "1. A country gathered around one river", exact: true }).click();
  await expectLayerVisible(page, "population-geography-annotations", true);
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toBeVisible();
  await expect(page.getByText(/Egypt’s bright population corridor follows the Nile Valley/)).toBeVisible();
  expect(searchParam(page, "focus")).toBe("feature:pattern-note:population:nile-valley");
  await expect(page.locator('[data-atlas-raster-level]')).toHaveAttribute('data-atlas-raster-level', 'country');
  await expect(page.locator('[data-atlas-note-highlight="pattern-note:population:nile-valley"]')).toBeVisible();

  await page.getByText("Evidence & caveats", { exact: true }).click();
  await expect(page.getByRole("link", { name: /NASA Earth Observatory/ }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Explanations on this map", { exact: true })).toBeVisible();
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

  await chooseView(page, "Where people live");
  const noteSurface = page.getByLabel("Explanations on this map", { exact: true }).locator("..");
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

  await openExplanationPicker(page);
  await page.getByRole("button", { name: "1. A country gathered around one river", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A country gathered around one river", exact: true })).toBeVisible();
  await expect(mapControls).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => inertState(mapControls)).toBe(true);

  await page.getByRole("button", { name: "Close map explanation" }).click();
  await expect(mapControls).not.toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => inertState(mapControls)).toBe(false);
});

async function countryScreenPoint(page: Page, id: string) {
  return page.locator(`[data-atlas-label-entity="country:${id}"]`).evaluate((element) => {
    const label = element as SVGTextElement;
    const matrix = label.closest<SVGGElement>("[data-atlas-map-group]")!.getScreenCTM()!;
    const x = Number(label.dataset.atlasX);
    const y = Number(label.dataset.atlasY);
    return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  });
}

async function countryAtPoint(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)
    ?.closest("[data-atlas-country]")?.getAttribute("data-atlas-country") ?? null, point);
}

test("tiny-place assistance never steals Belgium and retires when Luxembourg is directly clickable", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop pointer hit-testing and zoom regression");
  await page.goto("/atlas");
  const luxembourgHit = page.locator('circle[data-atlas-country="country:LUX"]');
  await expect(luxembourgHit).toBeVisible();
  const worldHit = (await luxembourgHit.boundingBox())!;
  expect(worldHit.width).toBeLessThanOrEqual(20);
  const belgiumPoint = await countryScreenPoint(page, "BEL");
  // This is the exact failure region: Belgium is inside Luxembourg's assisted
  // click circle at overview scale. Actual geography must win the overlap.
  expect(Math.hypot(belgiumPoint.x - worldHit.x - worldHit.width / 2, belgiumPoint.y - worldHit.y - worldHit.height / 2))
    .toBeLessThan(worldHit.width / 2);
  expect(await countryAtPoint(page, belgiumPoint)).toBe("country:BEL");
  await page.mouse.click(belgiumPoint.x, belgiumPoint.y);
  await expect(page.getByRole("heading", { name: "Belgium", exact: true })).toBeVisible();

  await chooseCountry(page, "Luxembourg");
  await expect.poll(async () => Number(await page.locator("[data-atlas-map-group]").getAttribute("data-atlas-zoom-scale"))).toBeGreaterThan(4);
  await expect(luxembourgHit).not.toBeVisible();
  const luxembourgPoint = await countryScreenPoint(page, "LUX");
  expect(await countryAtPoint(page, luxembourgPoint)).toBe("country:LUX");

  // An even smaller entity still receives assistance, but the invisible target
  // remains a small screen-space target rather than growing with the world.
  const vaticanHit = page.locator('circle[data-atlas-country="country:VAT"]');
  const zoomedHit = (await vaticanHit.boundingBox())!;
  expect(zoomedHit.width).toBeGreaterThan(0);
  expect(zoomedHit.width).toBeLessThanOrEqual(20);

  await page.getByRole("button", { name: "Reset world view", exact: true }).click();
  await expect(luxembourgHit).toBeVisible();
  await expect.poll(async () => (await luxembourgHit.boundingBox())!.width).toBeLessThanOrEqual(20);
});

test("country and city labels remain readable while zoom reveals detail", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop geographic label and symbol scale coverage");
  await page.goto("/atlas?view=where-people-live");
  const visibleCityLabels = () => page.locator('[data-atlas-label="city"]').evaluateAll((elements) =>
    elements.filter((element) => getComputedStyle(element).display !== "none").length,
  );
  await expect.poll(visibleCityLabels).toBeLessThan(10);
  const worldCities = await visibleCityLabels();
  await chooseCountry(page, "Egypt");
  const countryLabel = page.locator('[data-atlas-label-entity="country:EGY"]');
  await expect(countryLabel).toBeVisible();
  const initialCountryHeight = (await countryLabel.boundingBox())!.height;
  await expect.poll(visibleCityLabels).toBeGreaterThan(worldCities);
  const cityLabel = page.locator('[data-atlas-label="city"]').filter({ hasText: /Cairo$/ });
  await expect(cityLabel).toBeVisible();
  const initialCityHeight = (await cityLabel.boundingBox())!.height;
  const citySymbol = cityLabel.locator("..").locator('[data-atlas-screen-symbol="city"]');
  const initialCityWidth = (await citySymbol.boundingBox())!.width;

  const initialZoom = Number(await page.locator("[data-atlas-map-group]").getAttribute("data-atlas-zoom-scale"));
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => Number(await page.locator("[data-atlas-map-group]").getAttribute("data-atlas-zoom-scale"))).toBeGreaterThan(initialZoom * 1.2);
  await expect(countryLabel).toBeVisible();
  await expect(cityLabel).toBeVisible();
  expect((await countryLabel.boundingBox())!.height / initialCountryHeight).toBeCloseTo(1, 1);
  expect((await cityLabel.boundingBox())!.height / initialCityHeight).toBeCloseTo(1, 1);
  expect((await citySymbol.boundingBox())!.width / initialCityWidth).toBeCloseTo(1, 1);
  expect(initialCityWidth).toBeLessThan(15);
});

test("government terms are inspectable without losing the selected place or keyboard focus", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop glossary semantics and focus coverage");
  await page.goto("/atlas?view=government&country=zwe");
  const term = page.getByLabel("Government map legend", { exact: true }).getByRole("button", { name: "Define Presidential republic", exact: true });
  await term.focus();
  await page.keyboard.press("Enter");
  const definition = page.getByRole("dialog", { name: "Presidential republic", exact: true });
  await expect(definition).toBeVisible();
  await expect(definition).toContainText("How Atlas uses it");
  await expect(definition.getByRole("link", { name: /Presidential and semi-presidential systems/ })).toBeVisible();
  await page.keyboard.press("/");
  await expect(definition).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(definition).not.toBeVisible();
  await expect(term).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Search countries", exact: true })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  expect(searchParam(page, "country")).toBe("zwe");

  await page.getByRole("button", { name: "Field guide", exact: true }).filter({ visible: true }).click();
  const index = page.getByRole("dialog", { name: "Reading the Atlas", exact: true });
  await index.getByRole("searchbox", { name: "Find a definition", exact: true }).fill("density");
  await index.getByRole("button", { name: /Population density/ }).click();
  await expect(page.getByRole("dialog", { name: "Population density", exact: true })).toContainText("modeled distribution");
});

test("territorial status is visible on hover and explained with source evidence on selection", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop hover and territorial-status evidence coverage");
  await page.goto("/atlas");
  const point = await countryScreenPoint(page, "SAH");
  await page.mouse.move(point.x, point.y);
  const tooltip = page.getByRole("status").filter({ hasText: "Western Sahara" });
  await expect(tooltip).toContainText("Unresolved territorial status");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("heading", { name: "Western Sahara", exact: true })).toBeVisible();
  const statusNote = page.locator("[data-atlas-territorial-status]");
  await statusNote.locator(":scope > summary").click();
  await expect(statusNote).toContainText("UN list of Non-Self-Governing Territories");
  await expect(statusNote.getByRole("link", { name: /Western Sahara · UN decolonization record/ })).toBeVisible();
  await expect(statusNote).toContainText("does not locate each disputed");
});

test("religion retains composition in both the tooltip and compact cockpit", async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), "Desktop two-level religion information coverage");
  await page.goto("/atlas?view=religion");
  const point = await countryScreenPoint(page, "ZWE");
  await page.mouse.move(point.x, point.y);
  const tooltip = page.getByRole("status").filter({ hasText: "Zimbabwe" });
  await expect(tooltip).toContainText("85.3%");
  await page.mouse.click(point.x, point.y);
  const composition = page.getByLabel("Religious composition", { exact: true });
  await expect(composition).toBeVisible();
  await expect(composition).toContainText("Christianity");
  await expect(composition).toContainText("85.3%");
  await expect(composition).toContainText("Unaffiliated");
});
