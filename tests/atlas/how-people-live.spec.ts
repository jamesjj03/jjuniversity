import { expect, test } from "@playwright/test";
import countrySnapshotJson from "../../lib/atlas-world/data/countries.v1.json";
import geometrySnapshotJson from "../../lib/atlas-world/data/geometry-mercator.v1.json";
import {
  ATLAS_LAYER_BY_ID,
  resolveAtlasLayerValue,
} from "../../lib/atlas-world/layers";
import type { AtlasRuntimeCountry, AtlasRuntimeFeatureMeta } from "../../lib/atlas-world/runtime";
import type { AtlasCountryEntity, AtlasProjectedFeature } from "../../lib/atlas-world/types";

const cases = [
  { layerId: "admin0-urban-population-share", fact: "urbanPopulationPercent", field: "SP.URB.TOTL.IN.ZS", year: "2025" },
  { layerId: "admin0-population-growth-annual", fact: "populationGrowthAnnualPercent", field: "SP.POP.GROW", year: "2025" },
  { layerId: "admin0-population-ages-0-14", fact: "populationAges0To14Percent", field: "SP.POP.0014.TO.ZS", year: "2025" },
  { layerId: "admin0-population-ages-65-plus", fact: "populationAges65PlusPercent", field: "SP.POP.65UP.TO.ZS", year: "2025" },
  { layerId: "admin0-fertility-rate", fact: "fertilityRateBirthsPerWoman", field: "SP.DYN.TFRT.IN", year: "2024" },
  { layerId: "admin0-life-expectancy", fact: "lifeExpectancyYears", field: "SP.DYN.LE00.IN", year: "2024" },
] as const;

const countries = (countrySnapshotJson as { countries: AtlasCountryEntity[] }).countries;
const features = (geometrySnapshotJson as unknown as { features: AtlasProjectedFeature[] }).features;

function runtimeCountry(entityId: string) {
  const country = countries.find((candidate) => candidate.id === entityId);
  if (!country) throw new Error(`Missing test country ${entityId}.`);
  const facts = Object.fromEntries(Object.entries(country.facts).map(([key, fact]) => [
    key,
    fact ? {
      value: fact.value,
      status: fact.status,
      observedAt: fact.temporal.observedAt,
      validFrom: fact.temporal.validFrom,
      validTo: fact.temporal.validTo,
      precision: fact.temporal.precision,
      sourceId: fact.sourceId,
      sourceField: fact.sourceField,
      notes: fact.notes,
    } : null,
  ]));
  return { id: country.id, facts } as unknown as AtlasRuntimeCountry;
}

function feature(entityId: string) {
  const found = features.find((candidate) => candidate.entityId === entityId);
  if (!found) throw new Error(`Missing test geometry ${entityId}.`);
  return found as AtlasRuntimeFeatureMeta;
}

test("How People Live resolvers preserve exact value, year and source", () => {
  const zimbabwe = runtimeCountry("country:ZWE");
  const zimbabweFeature = feature("country:ZWE");
  for (const item of cases) {
    const layer = ATLAS_LAYER_BY_ID.get(item.layerId);
    expect(layer, item.layerId).toBeTruthy();
    const resolved = resolveAtlasLayerValue(layer!, { country: zimbabwe, feature: zimbabweFeature });
    expect(resolved.status).toBe("observed");
    expect(resolved.sourceField).toBe(item.field);
    expect(resolved.temporal?.observedAt).toBe(item.year);
    expect(typeof resolved.numericValue).toBe("number");
    expect(resolved.tooltip).toContain(item.year);
    expect(resolved.color).not.toBe(layer!.missingData.styles.unavailable?.color);
  }
});

test("How People Live resolvers preserve explicit gaps and latest-only time scope", () => {
  const antarctica = runtimeCountry("country:ATA");
  const antarcticaFeature = feature("country:ATA");
  for (const item of cases) {
    const layer = ATLAS_LAYER_BY_ID.get(item.layerId)!;
    const resolved = resolveAtlasLayerValue(layer, { country: antarctica, feature: antarcticaFeature });
    expect(resolved).toMatchObject({
      status: "unavailable",
      value: null,
      numericValue: null,
      sourceId: null,
      sourceField: null,
      label: "No World Bank observation",
    });
    expect(layer.temporal.supportsArbitraryTime).toBe(false);
    expect(layer.temporal.fallback).toBe("none");
  }
});
