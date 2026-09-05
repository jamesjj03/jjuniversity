import { expect, test } from "@playwright/test";
import countries from "../../lib/atlas-world/data/countries.v1.json";
import pilot from "../../lib/atlas-world/data/portrait-pilot.json";
import { atlasLeadershipReviewDue, findAtlasOfficeUpdate, findAtlasPortrait } from "../../lib/atlas-world/portraitPilot";
import type { AtlasRuntimeCountry } from "../../lib/atlas-world/runtime";

type LeadershipFact = NonNullable<AtlasRuntimeCountry["facts"]["headOfState"]>;

function factFor(entityId: string, role: string): LeadershipFact {
  const country = countries.countries.find((entry) => entry.id === entityId)!;
  const fact = country.facts[role as "headOfState" | "headOfGovernment"]!;
  return { ...fact, ...fact.temporal } as LeadershipFact;
}

test("portrait pilot keeps person identity, office observation, and reusable media separate", () => {
  expect(pilot.people).toHaveLength(4);
  expect(new Set(pilot.bindings.map((binding) => binding.entityId)).size).toBe(3);
  for (const binding of pilot.bindings) {
    const fact = factFor(binding.entityId, binding.role);
    const person = fact.value.officeholders.find((holder) => holder.nameAndTitle === binding.exactSourceName)!;
    const match = findAtlasPortrait(binding.entityId, binding.role as "headOfState" | "headOfGovernment", fact, person);
    if (binding.personId === "person:keir-starmer") {
      expect(match).toBeNull();
      expect(findAtlasOfficeUpdate(binding.entityId, binding.role, fact)?.personId).toBe("person:andy-burnham");
      continue;
    }
    expect(match?.person.id).toBe(binding.personId);
    expect(match?.media.personId).toBe(binding.personId);
    expect(match?.media.sourceUrl).toMatch(/^https:\/\/commons.wikimedia.org\//);
    expect(match?.media.licenseUrl).toMatch(/^https:\/\//);
    expect(match?.media.sourceSha256).toHaveLength(64);
    expect(match?.media.outputSha256).toHaveLength(64);
    expect(match?.media.width).toBeGreaterThanOrEqual(448);
    expect(match?.media.sourceWidth).toBeGreaterThanOrEqual(match!.media.width);
    expect(match?.media.bytes).toBeLessThan(190_000);
  }
});

test("leadership review dates and known supersessions fail closed without changing archived facts", () => {
  expect(atlasLeadershipReviewDue("2025-10-01", "2026-09-05")).toBe(true);
  expect(atlasLeadershipReviewDue("2026-09-05", "2026-09-05")).toBe(false);
  expect(atlasLeadershipReviewDue(null, "2026-09-05")).toBe(true);
  expect(atlasLeadershipReviewDue("2026-09-06", "2026-09-05")).toBe(true);
  expect(atlasLeadershipReviewDue("2026", "2026-09-05")).toBe(true);
  const fact = factFor("country:GBR", "headOfGovernment");
  const before = JSON.stringify(fact);
  expect(findAtlasOfficeUpdate("country:GBR", "headOfGovernment", fact)?.personName).toBe("Andy Burnham");
  expect(findAtlasOfficeUpdate("country:GBR", "headOfGovernment", { ...fact, observedAt: "2026-09-05" })).toBeNull();
  expect(findAtlasOfficeUpdate("country:GBR", "headOfGovernment", { ...fact, value: { ...fact.value, isVacant: true } })).toBeNull();
  expect(JSON.stringify(fact)).toBe(before);
});

test("a new officeholder, date, source or vacancy cannot inherit the previous person's portrait", () => {
  const fact = factFor("country:GAB", "headOfState");
  const holder = fact.value.officeholders[0];
  expect(findAtlasPortrait("country:GAB", "headOfState", fact, holder)).not.toBeNull();
  expect(findAtlasPortrait("country:GAB", "headOfState", { ...fact, observedAt: "2027-01-01" }, holder)).toBeNull();
  expect(findAtlasPortrait("country:GAB", "headOfState", { ...fact, sourceId: "different-source" }, holder)).toBeNull();
  expect(findAtlasPortrait("country:GAB", "headOfState", fact, { ...holder, nameAndTitle: "Different person" })).toBeNull();
  expect(findAtlasPortrait("country:GAB", "headOfState", { ...fact, value: { ...fact.value, isVacant: true } }, holder)).toBeNull();
  expect(findAtlasPortrait("country:ZWE", "headOfState", fact, holder)).toBeNull();
});
