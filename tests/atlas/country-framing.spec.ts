import { expect, test } from "@playwright/test";
import geometrySnapshot from "../../lib/atlas-world/data/geometry-mercator.v1.json";
import { deriveAtlasCountryFocusBounds } from "../../lib/atlas-world/countryFraming";
import { deriveAtlasLabelGeometry } from "../../lib/atlas-world/labelGeometry";
import { projectAtlasWgs84 } from "../../lib/atlas-world/projection";
import type { AtlasProjectedFeature } from "../../lib/atlas-world/types";

function source(code: string): AtlasProjectedFeature {
  const feature = geometrySnapshot.features.find((entry) => entry.entityId === `country:${code}`);
  expect(feature, `Bundled geometry must retain ${code}`).toBeDefined();
  return feature as AtlasProjectedFeature;
}

function expectContains(bounds: AtlasProjectedFeature["bounds"], coordinate: [number, number]) {
  const [x, y] = projectAtlasWgs84(coordinate);
  expect(x).toBeGreaterThanOrEqual(bounds[0][0]);
  expect(x).toBeLessThanOrEqual(bounds[1][0]);
  expect(y).toBeGreaterThanOrEqual(bounds[0][1]);
  expect(y).toBeLessThanOrEqual(bounds[1][1]);
}

test("reviewed compact archipelagos use their whole source extent without changing labels or geography", () => {
  for (const code of ["JPN", "IDN", "PHL", "MYS", "GBR", "DNK", "GRC", "SLB"]) {
    const feature = source(code);
    const before = JSON.stringify(feature);
    const label = deriveAtlasLabelGeometry(feature);
    const focus = deriveAtlasCountryFocusBounds(feature, label.focusBounds);
    expect(focus).toBe(feature.bounds);
    expect(deriveAtlasLabelGeometry(feature)).toEqual(label);
    expect(JSON.stringify(feature)).toBe(before);
  }
});

test("Japan framing contains its four main islands and Ryukyus, not only the Honshu label ring", () => {
  const feature = source("JPN");
  const label = deriveAtlasLabelGeometry(feature);
  const focus = deriveAtlasCountryFocusBounds(feature, label.focusBounds);
  for (const coordinate of [[141.35, 43], [138, 36], [130.6, 32], [133.5, 33.7], [127.9, 26.5]] as [number, number][]) {
    expectContains(focus, coordinate);
  }
  expect(focus[0][1]).toBeLessThan(label.focusBounds[0][1]);
  expect(focus[1][1]).toBeGreaterThan(label.focusBounds[1][1]);
});

test("Malaysia framing includes both peninsular and eastern regions", () => {
  const feature = source("MYS");
  const label = deriveAtlasLabelGeometry(feature);
  const focus = deriveAtlasCountryFocusBounds(feature, label.focusBounds);
  expectContains(focus, [101.7, 3.14]);
  expectContains(focus, [110.35, 1.55]);
  expectContains(focus, [116, 5.98]);
  expect(focus[0][0]).toBeLessThan(label.focusBounds[0][0]);
});

test("New Zealand uses actual primary-island vertices while retaining remote source fragments", () => {
  const feature = source("NZL");
  const before = JSON.stringify(feature);
  const label = deriveAtlasLabelGeometry(feature);
  const focus = deriveAtlasCountryFocusBounds(feature, label.focusBounds);
  for (const coordinate of [[175, -39], [170, -44], [167.85, -47]] as [number, number][]) expectContains(focus, coordinate);
  expect(focus[0][1]).toBeLessThan(label.focusBounds[0][1]);
  expect(focus[1][0] - focus[0][0]).toBeLessThan(25);
  expect(feature.bounds[1][0] - feature.bounds[0][0]).toBeGreaterThan(600);
  const sourceValues = new Set(feature.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number));
  for (const coordinate of focus.flat()) expect(sourceValues.has(coordinate)).toBe(true);
  expect(JSON.stringify(feature)).toBe(before);
});

test("Kiribati, Netherlands, Fiji, and unreviewed countries retain their exact previous focus", () => {
  for (const code of ["KIR", "NLD", "FJI", "USA", "FRA"]) {
    const feature = source(code);
    const before = JSON.stringify(feature);
    const fallback = deriveAtlasLabelGeometry(feature).focusBounds;
    expect(deriveAtlasCountryFocusBounds(feature, fallback)).toBe(fallback);
    expect(JSON.stringify(feature)).toBe(before);
  }
});

test("an unavailable New Zealand source window preserves the supplied fallback", () => {
  const feature = { ...source("NZL"), path: "" };
  const fallback = feature.bounds;
  expect(deriveAtlasCountryFocusBounds(feature, fallback)).toBe(fallback);
});
