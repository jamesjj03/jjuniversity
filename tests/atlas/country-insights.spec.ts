import { expect, test } from "@playwright/test";
import {
  getAtlasCountryInsight,
  type AtlasComparableCountryFact,
} from "../../lib/atlas-world/countryInsights";
import type { AtlasRuntimeCountrySummary } from "../../lib/atlas-world/runtime";

function country(id: string, name: string, region: string, value: number | null) {
  const fact = value == null ? null : {
    value,
    status: "observed" as const,
    observedAt: "2025",
    validFrom: null,
    validTo: null,
    precision: "year" as const,
    sourceId: "test",
    sourceField: "test",
    notes: [],
  };
  return {
    id,
    name,
    geography: { region },
    facts: { fertilityRateBirthsPerWoman: fact },
  } as unknown as AtlasRuntimeCountrySummary;
}

test("country insight ranks only reported values and leaves gaps out", () => {
  const countries = [
    country("a", "A", "One", 5),
    country("b", "B", "One", 4),
    country("c", "C", "One", 3),
    country("d", "D", "One", 2),
    country("e", "E", "One", 1),
    country("missing", "Missing", "One", null),
  ];
  const result = getAtlasCountryInsight(
    countries,
    "b",
    "fertilityRateBirthsPerWoman" satisfies AtlasComparableCountryFact,
  );
  expect(result?.global).toEqual({ rank: 2, total: 5, percentile: 0.75 });
  expect(result?.regional).toEqual({ rank: 2, total: 5, percentile: 0.75 });
  expect(result?.observedAt).toBe("2025");
});

test("country insight is descriptive and does not invent a missing value", () => {
  const countries = [country("a", "A", "One", 5), country("b", "B", "One", null)];
  expect(getAtlasCountryInsight(countries, "b", "fertilityRateBirthsPerWoman")).toBeNull();
});

test("equal observations receive the same rank and percentile regardless of country name", () => {
  const countries = [
    country("z", "Zulu", "One", 5),
    country("a", "Alpha", "One", 5),
    country("c", "Charlie", "One", 3),
    country("d", "Delta", "One", 2),
    country("e", "Echo", "One", 1),
  ];
  const alpha = getAtlasCountryInsight(countries, "a", "fertilityRateBirthsPerWoman");
  const zulu = getAtlasCountryInsight(countries, "z", "fertilityRateBirthsPerWoman");

  expect(alpha?.global).toEqual(zulu?.global);
  expect(alpha?.global.rank).toBe(1);
  expect(alpha?.regional).toEqual(zulu?.regional);
  expect(alpha?.regional?.rank).toBe(1);
});
