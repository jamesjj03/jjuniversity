import { expect, test } from "@playwright/test";

async function openCountry(page: import("@playwright/test").Page, country: string, view = "political") {
  await page.goto(`/atlas?country=${country}&view=${view}`);
  await page.waitForLoadState("networkidle");
  const panel = page.locator("aside[data-atlas-sheet]");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  if (await panel.getAttribute("data-atlas-sheet") === "peek") {
    const expand = panel.getByRole("button", { name: "Expand country details" });
    if (await expand.isVisible()) await expand.click();
  }
  return panel;
}

test("Gabon has one readable overview and a higher-resolution credited portrait", async ({ page }) => {
  const panel = await openCountry(page, "gab");
  await expect(panel.getByRole("navigation")).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "Gabon", exact: true })).toBeVisible();
  const portrait = panel.getByRole("img", { name: "Brice Oligui Nguema" });
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThanOrEqual(448);
  expect((await portrait.boundingBox())!.width).toBeGreaterThanOrEqual(100);
  expect((await panel.getByRole("img", { name: "Gabon flag" }).boundingBox())!.width).toBeGreaterThanOrEqual(48);
  await expect(panel.getByText(/ended the military transition/)).toBeVisible();
  await expect(panel.getByText(/Recorded 1 Oct 2025/)).toBeVisible();
  await panel.getByText("Sources & photo credit", { exact: true }).click();
  await expect(panel.getByRole("link", { name: "CC BY 4.0", exact: true })).toBeVisible();
  await expect(panel.getByText(/Lukasz Kobus \/ European Communities/)).toBeVisible();
});

test("UK separates a reviewed office update from its unchanged archived predecessor", async ({ page }) => {
  const panel = await openCountry(page, "gbr");
  await expect(panel.getByRole("img", { name: "Charles III", exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: "Keir Starmer", exact: true })).toHaveCount(0);
  const update = panel.locator("[data-atlas-office-update]");
  await expect(update.getByText("Andy Burnham", { exact: true })).toBeVisible();
  await expect(update.getByText(/Checked 5 Sept 2026/)).toBeVisible();
  await update.getByText("Updated officeholder · source & previous record", { exact: true }).click();
  await expect(update.getByText(/The old record names Prime Minister Keir STARMER/)).toBeVisible();
  await expect(update.getByRole("link", { name: /current role holder and responsibilities/ })).toHaveAttribute("href", "https://www.gov.uk/government/ministers/prime-minister");
});

test("Japan composition is immediate and distinguishes affiliation from the whole population", async ({ page }) => {
  const panel = await openCountry(page, "jpn", "religion");
  const composition = panel.locator("[data-atlas-religion-composition]");
  await expect(composition).toBeVisible();
  await expect(composition.getByText("48.6%", { exact: true })).toBeVisible();
  await expect(composition.getByText("Shintoism", { exact: true })).toBeVisible();
  await expect(composition.getByText(/not Japan’s whole population/)).toBeVisible();
  await composition.getByText("Read the original figures & how to interpret them", { exact: true }).click();
  await expect(composition.locator("blockquote")).toContainText("Shintoism 48.6%, Buddhism 46.4%");
  await expect(composition.getByText(/color is a broad starting point/)).toBeVisible();
});

test("Russia preserves the source ranges and explains practicing worshipers", async ({ page }) => {
  const panel = await openCountry(page, "rus", "religion");
  const composition = panel.locator("[data-atlas-religion-composition]");
  await expect(composition.getByText("17–22%", { exact: true })).toBeVisible();
  await expect(composition.getByText("10–15%", { exact: true })).toBeVisible();
  await expect(composition.getByText(/count practicing worshipers/)).toBeVisible();
  await composition.getByText("Read the original figures & how to interpret them", { exact: true }).click();
  await expect(composition.locator("blockquote")).toContainText("2006 est.");
  await expect(composition.getByText(/midpoint positions the bars/)).toBeVisible();
});

test("a country offers a keyboard-accessible route to its mapped cities", async ({ page }) => {
  const panel = await openCountry(page, "egy");
  const cityList = panel.locator("[data-atlas-mapped-cities]");
  const summary = cityList.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const cairo = cityList.getByRole("button", { name: "Show Cairo on map", exact: true });
  await page.keyboard.press("Tab");
  await expect(cairo).toBeFocused();
  await page.keyboard.press("Enter");
  const cityCard = page.locator("[data-atlas-city-card]");
  await expect(cityCard.getByRole("heading", { name: "Cairo", exact: true })).toBeVisible();
  await expect(cityCard.getByRole("button", { name: /^Egypt/ })).toBeVisible();
  await expect(cityCard).toBeFocused();
  await expect(page).toHaveURL(/feature%3Anatural-earth%3Acity%3A1159151603/);
});

test("Western Sahara identifies the claimant name and flag in its persistent header", async ({ page }) => {
  const panel = await openCountry(page, "sah");
  await expect(panel.getByText("SADR name & flag · one claimant", { exact: true })).toBeVisible();
  await expect(panel.getByRole("img", { name: "Sahrawi Arab Democratic Republic flag; one claimant in Western Sahara", exact: true })).toBeVisible();
  const peek = panel.getByRole("button", { name: "peek", exact: true });
  if (await peek.isVisible()) {
    await peek.click();
    await expect(panel.getByText("SADR name & flag · one claimant", { exact: true })).toBeVisible();
  }
});
