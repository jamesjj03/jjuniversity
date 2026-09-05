import { expect, test } from "@playwright/test";
import {
  ATLAS_LAYER_BY_ID,
  resolveAtlasLayerDatum,
  type AtlasLayerDatum,
} from "../../lib/atlas-world/layers";

const gdpLayer = ATLAS_LAYER_BY_ID.get("admin0-gdp-per-capita");
if (!gdpLayer) throw new Error("GDP per-capita layer is not registered.");

function datum(status: AtlasLayerDatum["status"]): AtlasLayerDatum {
  return {
    entityId: "country:TEST",
    status,
    value: 1_234,
    formattedValue: "$1,234",
    observedAt: "2024",
    validFrom: null,
    validTo: null,
    precision: "year",
    sourceId: "test-source",
    sourceField: "test-field",
    notes: ["Status-preservation fixture."],
  };
}

test("observation quality survives layer resolution without discarding usable values", () => {
  for (const status of ["estimated", "inherited", "carried_forward"] as const) {
    const resolved = resolveAtlasLayerDatum(gdpLayer, datum(status));
    expect(resolved.status).toBe(status);
    expect(resolved.numericValue).toBe(1_234);
    expect(resolved.formattedValue).toBe("$1,234");
    expect(resolved.color).not.toBe(gdpLayer.missingData.styles.unavailable?.color);
  }

  expect(resolveAtlasLayerDatum(gdpLayer, datum("estimated")).tooltip).toContain("est. 2024");
  expect(resolveAtlasLayerDatum(gdpLayer, datum("inherited")).tooltip).toContain("parent value 2024");
  expect(resolveAtlasLayerDatum(gdpLayer, datum("carried_forward")).tooltip).toContain("carried forward 2024");
});

test("non-displayable observation statuses remain explicit missing-data states", () => {
  for (const status of ["suppressed", "not_applicable", "unavailable"] as const) {
    const resolved = resolveAtlasLayerDatum(gdpLayer, datum(status));
    expect(resolved.status).toBe(status);
    expect(resolved.numericValue).toBeNull();
    expect(resolved.color).toBe(gdpLayer.missingData.styles.unavailable?.color);
  }
});
