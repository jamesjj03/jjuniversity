import { expect, test } from "@playwright/test";

import { getAtlasAdmin1Pilot, resolveAtlasAdmin1Focus } from "../../lib/atlas-world/admin1Pilot";

test("Admin-1 pilot keeps entities, parentage, and geometry representations separate", () => {
  const pilot = getAtlasAdmin1Pilot();
  expect(pilot.pilot.status).toBe("bounded-pilot");
  expect(pilot.features).toHaveLength(184);
  const california = resolveAtlasAdmin1Focus("admin1:USA:US-CA");
  expect(california).toMatchObject({
    name: "California",
    kind: "administrative-unit",
    entity: { parentId: "country:USA", countryId: "country:USA", adminLevel: 1 },
    geometry: {
      crs: "EPSG:4326",
      canonicalAsset: "data/atlas/derived/admin1-pilot-wgs84.v1.geojson",
      derived: { projectionId: "mercator", assetHref: "/atlas-world/admin1-pilot-mercator.v1.svg" },
    },
  });
  expect(pilot.pilot.excludedSourceFeatures).toEqual([
    expect.objectContaining({ name: "Paracel Islands", sourceCode: "CN-X01~" }),
  ]);
});

test("subnational deep link opens the selected unit with explicitly inherited national context", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Existing root-layout prepaint script warning emitted by the Next dev client.
    if (message.text().includes("Encountered a script tag while rendering React component")) return;
    errors.push(message.text());
  });
  await page.goto("/atlas/subnational?focus=admin1%3AUSA%3AUS-CA&country=usa");
  await expect(page.locator("[data-atlas-subnational]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "California" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inherited from United States" })).toBeVisible();
  const inheritedContext = page.getByText("They are context—not measurements of California.");
  if (testInfo.project.name.startsWith("mobile")) {
    await expect(inheritedContext).toBeAttached();
  } else {
    await expect(inheritedContext).toBeVisible();
  }
  await expect(page.locator("use[data-admin1-entity]")).toHaveCount(184);
  await expect(page).toHaveURL(/focus=admin1%3AUSA%3AUS-CA/);
  expect(errors).toEqual([]);
});

test("typed subdivision search changes parent context, map focus, URL, and browser history", async ({ page }) => {
  await page.goto("/atlas/subnational?country=usa");
  const search = page.getByRole("combobox", { name: "Search subdivisions" });
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(search).toHaveAttribute("aria-controls", /.+/);
  await expect(page.getByText("All 184 pilot subdivisions can be found by name, alias, or code.")).toBeAttached();
  await search.fill("Bavaria");
  const result = page.getByRole("option", { name: /Bavaria/ });
  await expect(result).toContainText("Germany");
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await search.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", await result.getAttribute("id") ?? "missing-id");
  await expect(result).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "Bavaria" })).toBeVisible();
  await expect(page).toHaveURL(/focus=admin1%3ADEU%3ADE-BY/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Countries become containers." })).toBeVisible();
  await expect(page.getByRole("button", { name: "United States" })).toHaveAttribute("aria-pressed", "true");
});

test("subdivision combobox supports aliases and closing results without adding SVG tab stops", async ({ page }) => {
  await page.goto("/atlas/subnational?country=ind");
  const search = page.getByRole("combobox", { name: "Search subdivisions" });
  await search.fill("IN-WB");
  await expect(page.getByRole("option", { name: /West Bengal/ })).toBeVisible();
  await search.press("ArrowUp");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "West Bengal" })).toBeVisible();

  await search.fill("Ontario");
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await search.press("Escape");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("use[data-admin1-entity][tabindex]")).toHaveCount(0);
});

test("subnational pilot keeps the map available beside its mobile information sheet", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile layout assertion");
  await page.goto("/atlas/subnational?focus=admin1%3AIND%3AIN-WB&country=ind");
  await expect(page.getByRole("img", { name: /first-order administrative subdivisions/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "West Bengal" })).toBeVisible();
  const mapBox = await page.getByRole("img", { name: /first-order administrative subdivisions/ }).boundingBox();
  const panelBox = await page.getByRole("complementary", { name: "Subdivision details" }).boundingBox();
  for (const tab of await page.getByRole("navigation", { name: "Pilot countries" }).getByRole("button").all()) {
    expect((await tab.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(mapBox?.height ?? 0).toBeGreaterThan(250);
  expect(panelBox?.height ?? 999).toBeLessThan((page.viewportSize()?.height ?? 900) * 0.45);
});
