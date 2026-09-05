import { expect, test } from "@playwright/test";
import { ATLAS_GLOSSARY, getAtlasGlossaryTerm } from "../../lib/atlas-world/glossary";
import { getAtlasTerritorialStatus } from "../../lib/atlas-world/territorialStatus";

function status(id: string, type = "Sovereign country") {
  return getAtlasTerritorialStatus({ id: `country:${id}`, geography: {
    continent: "", region: "", subregion: "", incomeLevel: null,
    naturalEarthType: type, sovereignName: "Source field", boundaryNote: null,
  } });
}

test("field guide separates teaching from method and every related path resolves", () => {
  expect(ATLAS_GLOSSARY.length).toBeGreaterThanOrEqual(36);
  expect(new Set(ATLAS_GLOSSARY.map((entry) => entry.id)).size).toBe(ATLAS_GLOSSARY.length);
  for (const entry of ATLAS_GLOSSARY) {
    expect(entry.definition.length, entry.id).toBeGreaterThan(35);
    expect(entry.inAtlas.length, entry.id).toBeGreaterThan(30);
    expect(entry.definition, entry.id).not.toBe(entry.inAtlas);
    expect(entry.relatedTerms.length, entry.id).toBeGreaterThan(0);
    for (const related of entry.relatedTerms) {
      expect(related, entry.id).not.toBe(entry.id);
      expect(getAtlasGlossaryTerm(related), `${entry.id} → ${related}`).not.toBeNull();
    }
  }
  expect(getAtlasGlossaryTerm("folk_or_traditional")?.definition).toContain("local or indigenous");
  expect(getAtlasGlossaryTerm("folk_or_traditional")?.definition).not.toContain("source labels");
  expect(getAtlasGlossaryTerm("other", "government")?.id).toBe("government_other");
  expect(getAtlasGlossaryTerm("other", "religion")?.id).toBe("religion_other");
});

test("disputes distinguish claims, administration, reasons and the map choice", () => {
  for (const id of ["SAH", "KOS", "CYN", "SOL", "PSX", "TWN"]) {
    const entry = status(id);
    for (const field of ["claims", "administration", "disputeReason", "mapChoice"] as const) {
      expect(entry[field]?.length, `${id}.${field}`).toBeGreaterThan(50);
    }
    expect(entry.observedAt).toBe("2026-09-05");
    expect(entry.evidence.length).toBeGreaterThan(2);
    expect(entry.temporal.validFrom).toBeNull();
    expect(entry.temporal.validTo).toBeNull();
  }
  expect(status("SAH").administration).toContain("berm");
  expect(status("SAH").mapChoice).toContain("not the berm");
  expect(status("SOL").summary).toContain("December 2025");
  expect(status("SOL").summary).not.toContain("unrecognized by every");
  expect(status("PSX").administration).toContain("June 2026");
  expect(status("TWN").summary).toContain("does not administer");
  expect(status("ATA", "Indeterminate").outline).toBe(false);
  expect(status("CUB", "Sovereignty").kind).toBe("standard");
  expect(status("GRL", "Dependency").kind).toBe("dependency");
});

test("field guide teaches first, supports related/back/search, and keeps modal focus", async ({ page }, testInfo) => {
  await page.goto("/atlas?view=political");
  await expect(page.locator("[data-atlas-map-group]")).toHaveAttribute("transform", /scale\(/);
  const legend = page.getByLabel("Political map legend", { exact: true });
  // Political starts with a compact key. Open the visible surface before
  // entering its guide; mobile owns a separate outer disclosure.
  if (testInfo.project.name.startsWith("mobile")) {
    await legend.locator(":scope > details > summary").click();
  }
  // The Phase 4 key leads with interpretation; the complete field guide lives
  // with methodology and provenance one level deeper.
  await legend.getByText("Sources & methodology", { exact: true }).filter({ visible: true }).click();
  const trigger = page.getByRole("button", { name: "Field guide", exact: true }).filter({ visible: true });
  await trigger.click();
  const dialog = page.locator("dialog[data-atlas-glossary]");
  await expect(dialog.getByRole("heading", { name: "Understand the map", exact: true })).toBeVisible();
  const search = dialog.getByRole("searchbox", { name: "Find a definition", exact: true });
  await expect(search).toBeFocused();
  await search.fill("folk religion");
  await dialog.getByRole("button", { name: /^Folk \/ traditional religions/ }).click();
  await expect(dialog.getByRole("heading", { name: "Folk / traditional religions", exact: true })).toBeFocused();
  await expect(dialog).toContainText("local or indigenous religious traditions");
  const method = dialog.locator("details");
  await expect(method).not.toHaveAttribute("open", "");
  await expect(dialog.getByText("This is a broad display category", { exact: false })).not.toBeVisible();
  await method.locator("summary").click();
  await expect(dialog.getByText("This is a broad display category", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Religious composition", exact: false }).click();
  await expect(dialog.getByRole("heading", { name: "Religious composition", exact: true })).toBeFocused();
  await expect(dialog.locator("details")).not.toHaveAttribute("open", "");
  await dialog.getByRole("button", { name: "Back in field guide", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Folk / traditional religions", exact: true })).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(dialog.getByRole("searchbox", { name: "Find a definition", exact: true })).toHaveValue("folk religion");
  await page.keyboard.press("/");
  await expect(dialog).toBeVisible();
  for (let count = 0; count < 12; count++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[data-atlas-glossary]')))).toBe(true);
  }
  for (let count = 0; count < 12; count++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[data-atlas-glossary]')))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(new URL(page.url()).searchParams.get("view")).toBe("political");
});
