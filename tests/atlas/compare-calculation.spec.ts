import { expect, test } from "@playwright/test";
import { ATLAS_COMPARISONS } from "../../lib/atlas-world/compare";

test("every GDP-per-capita comparison discloses its logarithmic analysis scale", () => {
  const gdpComparisons = ATLAS_COMPARISONS.filter((comparison) =>
    comparison.a.viewId === "gdp-per-capita" || comparison.b.viewId === "gdp-per-capita",
  );

  expect(gdpComparisons.map((comparison) => comparison.id)).toEqual([
    "wealth-longevity",
    "urban-wealth",
    "fertility-wealth",
  ]);

  for (const comparison of gdpComparisons) {
    expect(comparison.calculationNote).toContain("correlation");
    expect(comparison.calculationNote).toContain("outlier calculations");
    expect(comparison.calculationNote).toContain("same logarithmic scale displayed on the map");
  }
});
