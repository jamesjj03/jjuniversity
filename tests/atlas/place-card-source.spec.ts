import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const component = readFileSync("components/atlas-world/AtlasPlaceCard.tsx", "utf8");
const styles = readFileSync("components/atlas-world/AtlasPlaceCard.module.css", "utf8");

test("the generic place card keeps identity, relationships, provenance, and focus semantics explicit", () => {
  expect(component).toContain("data-atlas-place-card={place.kind}");
  expect(component).toContain("data-atlas-place-id={place.placeId}");
  expect(component).toContain("aria-labelledby=\"atlas-place-title\"");
  expect(component).toContain("tabIndex={-1}");
  expect(component).toContain("onCountry(country.id)");
  expect(component).toContain("Map source");
  expect(component).toContain("rel=\"noreferrer\"");
});

test("the card only renders optional sourced measurements and states the relationship limit", () => {
  for (const fact of ["place.population &&", "place.elevationMetres &&", "place.lengthKm &&", "place.areaKm2 &&", "place.maximumDepthMetres &&"]) {
    expect(component).toContain(fact);
  }
  expect(component).not.toContain("Not available");
  expect(component).not.toContain("Unknown");
  expect(component).toContain("does not describe the entire drainage basin");
});

test("the standalone card stylesheet preserves mobile touch targets and safe-area placement", () => {
  expect(styles).toMatch(/\.close\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/);
  expect(styles).toContain("env(safe-area-inset-bottom)");
  expect(styles).toContain("@media (max-width: 760px)");
});
