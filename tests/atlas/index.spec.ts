import { expect, test } from "@playwright/test";
import {
  ATLAS_GLOSSARY,
  ATLAS_GLOSSARY_GROUPS,
  getAtlasGlossaryTerm,
} from "../../lib/atlas-world/glossary";

test("Atlas Index covers the new evidence subjects without ambiguous term lookup", () => {
  const expectedGroups = ["Demography", "Economy", "Territorial status", "Geography"];
  expect(ATLAS_GLOSSARY_GROUPS.map((group) => group.name)).toEqual(expect.arrayContaining(expectedGroups));
  expect(ATLAS_GLOSSARY.length).toBeGreaterThanOrEqual(58);

  for (const id of [
    "life-expectancy",
    "total-fertility-rate",
    "urban-population-share",
    "population-growth",
    "children-share",
    "older-population-share",
    "purchasing-power-parity",
    "gni-per-capita",
    "economic-growth",
    "inflation",
    "trade-share",
    "sovereignty",
    "de-facto-control",
    "territorial-claim",
    "diplomatic-recognition",
    "map-unit",
    "administrative-unit",
    "disputed-boundary",
    "river",
    "drainage-basin",
    "lake",
    "coastline",
  ]) {
    const entry = getAtlasGlossaryTerm(id);
    expect(entry, id).not.toBeNull();
    expect(entry?.sources.length, id).toBeGreaterThan(0);
    expect(entry?.sources.every((source) => source.url.startsWith("https://")), id).toBe(true);
    expect(entry?.caveat.length, id).toBeGreaterThan(60);
  }

  expect(getAtlasGlossaryTerm("Sovereignty")?.id).toBe("sovereignty");
  expect(getAtlasGlossaryTerm("Disputed boundary")?.id).toBe("disputed-boundary");
  expect(getAtlasGlossaryTerm("PPP")?.id).toBe("purchasing-power-parity");
});

test("Atlas Index is searchable, filterable, sourced, and usable at either viewport", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Vercel injects these endpoints at the deployment edge; a local
    // production server intentionally returns 404 for the two scripts.
    if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(message.location().url ?? "")
      && /\/_vercel\/(insights|speed-insights)\/script\.js/.test(message.location().url ?? "")) return;
    browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/atlas/index");
  await expect(page.getByRole("heading", { name: "The language behind the map." })).toBeVisible();
  await expect(page.getByText(`${ATLAS_GLOSSARY.length} concepts`, { exact: true })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Find a concept" });
  await search.fill("watershed");
  await expect(page.locator("article#drainage-basin")).toBeVisible();
  await expect(page.locator("article#life-expectancy")).not.toBeVisible();

  await search.fill("");
  await page.getByRole("button", { name: "Territorial status", exact: true }).click();
  await expect(page.locator("article#sovereignty")).toBeVisible();
  await expect(page.locator("article#river")).not.toBeVisible();

  const claim = page.locator("article#territorial-claim");
  await claim.getByText("How Atlas handles this", { exact: true }).click();
  await expect(claim.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  await expect(claim.getByRole("link", { name: /How Natural Earth represents disputed boundaries/ })).toHaveAttribute("href", /^https:\/\//);

  await page.getByRole("link", { name: /Back to the map/ }).focus();
  await expect(page.getByRole("link", { name: /Back to the map/ })).toBeFocused();
  expect(browserErrors).toEqual([]);
});
