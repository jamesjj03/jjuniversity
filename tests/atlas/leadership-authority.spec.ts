import { expect, test } from "@playwright/test";
import countries from "../../lib/atlas-world/data/countries.v1.json";
import leadershipSchema from "../../lib/atlas-world/leadership/schema/leadership-authority.v2.schema.json";
import portraitSchema from "../../lib/atlas-world/leadership/schema/portrait-pilot.v1.schema.json";
import {
  ATLAS_LEADERSHIP_AUTHORITY,
  ATLAS_PORTRAIT_PILOT,
  atlasLeadershipFreshness,
  atlasLeadershipOfficeId,
  deriveAtlasLeadershipOccupancy,
  resolveAtlasLeadershipState,
  validateAtlasLeadershipAuthority,
  validateAtlasPortraitPilotAuthority,
} from "../../lib/atlas-world/leadership/authority";
import type { AtlasRuntimeCountry } from "../../lib/atlas-world/runtime";
import type { AtlasLeadershipFactLike } from "../../lib/atlas-world/leadership/types";

type LeadershipFact = NonNullable<AtlasRuntimeCountry["facts"]["headOfState"]>;

function factFor(entityId: string, role: "headOfState" | "headOfGovernment"): LeadershipFact {
  const fact = countries.countries.find((country) => country.id === entityId)!.facts[role]!;
  return { ...fact, ...fact.temporal } as LeadershipFact;
}

const syntheticFact = (value: AtlasLeadershipFactLike["value"]): AtlasLeadershipFactLike => ({
  value,
  observedAt: "2026-09-05",
  sourceId: "test-source",
});

test("leadership authority separates people, offices, polities, and dated occupancy", () => {
  expect(leadershipSchema.properties.schemaVersion.const).toBe(ATLAS_LEADERSHIP_AUTHORITY.schemaVersion);
  expect(leadershipSchema.properties.authorityId.const).toBe(ATLAS_LEADERSHIP_AUTHORITY.authorityId);
  expect(portraitSchema.properties.schemaVersion.const).toBe(ATLAS_PORTRAIT_PILOT.schemaVersion);
  expect(ATLAS_LEADERSHIP_AUTHORITY.policy).toEqual({
    automaticPublication: false,
    freshnessDoesNotAssertCurrentOffice: true,
    separatePersonOfficeAndPolityIdentity: true,
    unreviewedPortraitBehavior: "no_portrait",
  });

  const gabonHeadOfState = ATLAS_LEADERSHIP_AUTHORITY.offices.find((office) => office.id === "office:country:GAB:head-of-state")!;
  const gabonHeadOfGovernment = ATLAS_LEADERSHIP_AUTHORITY.offices.find((office) => office.id === "office:country:GAB:head-of-government")!;
  expect(gabonHeadOfState.polityEntityId).toBe("country:GAB");
  expect(gabonHeadOfState.role).toBe("headOfState");
  expect(gabonHeadOfGovernment.role).toBe("headOfGovernment");
  expect(gabonHeadOfGovernment.id).not.toBe(gabonHeadOfState.id);
  expect(atlasLeadershipOfficeId("country:GAB", "headOfState")).toBe(gabonHeadOfState.id);

  for (const binding of ATLAS_PORTRAIT_PILOT.bindings) {
    const office = ATLAS_LEADERSHIP_AUTHORITY.offices.find((candidate) => candidate.id === binding.officeId)!;
    expect(office.polityEntityId, binding.officeId).toBe(binding.entityId);
    expect(office.role, binding.officeId).toBe(binding.role);
    expect(binding.identityConfidence, binding.officeId).toBe("high");
    expect(binding.reviewedAt, binding.officeId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});

test("occupancy and freshness remain independent and cover collective, vacant, and uncertain records", () => {
  const holder = { nameAndTitle: "President Example", relationship: "principal" as const, termStartedAt: null, termStartPrecision: "unknown" as const };
  expect(deriveAtlasLeadershipOccupancy(syntheticFact({ raw: "President Example", isVacant: false, officeholders: [holder] }).value)).toBe("occupied");
  expect(deriveAtlasLeadershipOccupancy(syntheticFact({ raw: "vacant", isVacant: true, officeholders: [] }).value)).toBe("vacant");
  expect(deriveAtlasLeadershipOccupancy(syntheticFact({ raw: "unparsed", isVacant: false, officeholders: [] }).value)).toBe("uncertain");
  expect(deriveAtlasLeadershipOccupancy(syntheticFact({ raw: "two co-princes", isVacant: false, officeholders: [holder, { ...holder, nameAndTitle: "Co-prince Example" }] }).value)).toBe("collective");
  expect(deriveAtlasLeadershipOccupancy(syntheticFact({ raw: "presidency", isVacant: false, officeholders: [{ ...holder, relationship: "member" }, { ...holder, nameAndTitle: "Second member", relationship: "member" }] }).value)).toBe("collective");

  expect(atlasLeadershipFreshness("2026-09-05", "2026-09-05")).toBe("recent_observation");
  expect(atlasLeadershipFreshness("2025-10-01", "2026-09-05")).toBe("review_due");
  expect(atlasLeadershipFreshness("2026-09-06", "2026-09-05")).toBe("future_dated");
  expect(atlasLeadershipFreshness(null, "2026-09-05")).toBe("undated");
});

test("reviewed updates and archived snapshots make different currency claims", () => {
  const uk = resolveAtlasLeadershipState("country:GBR", "headOfGovernment", factFor("country:GBR", "headOfGovernment"), "2026-09-05");
  expect(uk).toMatchObject({
    office: { id: "office:country:GBR:head-of-government", polityEntityId: "country:GBR", role: "headOfGovernment" },
    recordKind: "reviewed_update",
    personId: "person:andy-burnham",
    occupancy: "occupied",
    freshness: "recent_observation",
    confidence: "high",
    currentOfficeClaim: "occupied_on_observation_date",
  });
  expect(resolveAtlasLeadershipState("country:GBR", "headOfGovernment", factFor("country:GBR", "headOfGovernment"), "2027-01-03").freshness).toBe("review_due");

  const gabon = resolveAtlasLeadershipState("country:GAB", "headOfState", factFor("country:GAB", "headOfState"), "2026-09-05");
  expect(gabon).toMatchObject({
    recordKind: "archived_snapshot",
    personId: "person:brice-oligui-nguema",
    occupancy: "occupied",
    freshness: "review_due",
    confidence: "high",
    currentOfficeClaim: "not_asserted",
  });
});

test("authority validation fails closed on crossed offices, unsafe policy, and portrait identity drift", () => {
  const crossedOffice = structuredClone(ATLAS_LEADERSHIP_AUTHORITY) as unknown as {
    offices: Array<{ polityEntityId: string }>;
  };
  crossedOffice.offices[0].polityEntityId = "country:ZWE";
  expect(() => validateAtlasLeadershipAuthority(crossedOffice)).toThrow(/stable ID|office\/polity/);

  const unsafePolicy = structuredClone(ATLAS_LEADERSHIP_AUTHORITY) as unknown as {
    policy: { automaticPublication: boolean };
  };
  unsafePolicy.policy.automaticPublication = true;
  expect(() => validateAtlasLeadershipAuthority(unsafePolicy)).toThrow(/must not publish automatically/);

  const crossedPortrait = structuredClone(ATLAS_PORTRAIT_PILOT) as unknown as {
    bindings: Array<{ entityId: string }>;
  };
  crossedPortrait.bindings[0].entityId = "country:ZWE";
  expect(() => validateAtlasPortraitPilotAuthority(crossedPortrait, ATLAS_LEADERSHIP_AUTHORITY)).toThrow(/office\/polity/);

  const renamedPortraitPerson = structuredClone(ATLAS_PORTRAIT_PILOT) as unknown as {
    people: Array<{ name: string }>;
  };
  renamedPortraitPerson.people[0].name = "Different person";
  expect(() => validateAtlasPortraitPilotAuthority(renamedPortraitPerson, ATLAS_LEADERSHIP_AUTHORITY)).toThrow(/name differs/);
});
