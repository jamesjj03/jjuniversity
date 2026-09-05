import { expect, test } from "@playwright/test";
import { deriveAtlasLabelGeometry } from "../../lib/atlas-world/labelGeometry";
import type { AtlasProjectedFeature } from "../../lib/atlas-world/types";
import geometrySnapshot from "../../lib/atlas-world/data/geometry-mercator.v1.json";

function feature(path: string, overrides: Partial<AtlasProjectedFeature> = {}): AtlasProjectedFeature {
  return {
    entityId: "country:TEST",
    path,
    centroid: [600, 325],
    bounds: [[0, 0], [1200, 650]],
    tinyRank: null,
    mapColor7: 1,
    ...overrides,
  };
}

test("closed rings include the closing edge and keep area independent of winding", () => {
  // A translated right triangle catches a missed last→first edge; unlike an
  // origin-anchored rectangle, that edge contributes to its signed area.
  for (const path of [
    "M10,10L20,10L20,20Z",
    "M20,20L20,10L10,10Z",
    "M10,10L20,10L20,20L10,10Z",
  ]) {
    const geometry = deriveAtlasLabelGeometry(feature(path));
    expect(geometry.labelArea).toBe(50);
    expect(geometry.focusBounds).toEqual([[10, 10], [20, 20]]);
  }
});

test("largest geographic part owns the label, not the longest or first fragment", () => {
  const mainland = "M10,10L30,10L30,30L10,30Z";
  const longThinIsland = "M800,5L1000,5L1000,6L800,6Z";
  for (const path of [mainland + longThinIsland, longThinIsland + mainland]) {
    const geometry = deriveAtlasLabelGeometry(feature(path));
    expect(geometry.labelArea).toBe(400);
    expect(geometry.labelPoint).toEqual([20, 20]);
    expect(geometry.focusBounds).toEqual([[10, 10], [30, 30]]);
  }
});

test("a concave country's label stays on its land instead of its bounding-box void", () => {
  // U-shaped land, with a 6×9 inlet cut from its center. Its bounding-box center
  // (6,6) is outside the polygon even though it lies within the overall extent.
  const geometry = deriveAtlasLabelGeometry(feature("M0,0L12,0L12,12L9,12L9,3L3,3L3,12L0,12Z"));
  const [x, y] = geometry.labelPoint;
  expect(geometry.labelArea).toBe(90);
  expect(x).toBeGreaterThan(0);
  expect(x).toBeLessThan(12);
  expect(y).toBeGreaterThan(0);
  expect(y).toBeLessThan(12);
  expect(x < 3 || x > 9 || y < 3).toBe(true);
  expect(geometry.labelPoint).not.toEqual([6, 6]);
});

test("date-line fragments focus one usable part instead of almost the whole world", () => {
  const geometry = deriveAtlasLabelGeometry(feature(
    "M5,290L15,290L15,310L5,310Z M1180,290L1185,290L1185,295L1180,295Z",
    { centroid: [595, 300], bounds: [[5, 290], [1185, 310]] },
  ));
  expect(geometry.focusBounds).toEqual([[5, 290], [15, 310]]);
  expect(geometry.labelPoint).toEqual([10, 300]);
  expect(geometry.focusBounds[1][0] - geometry.focusBounds[0][0]).toBeLessThan(20);
});

test("the real Kiribati and Netherlands features no longer focus their scattered overall extents", () => {
  for (const id of ["country:KIR", "country:NLD"]) {
    const source = geometrySnapshot.features.find((entry) => entry.entityId === id) as AtlasProjectedFeature | undefined;
    expect(source, `Bundled geometry must retain ${id}`).toBeDefined();
    const before = JSON.stringify(source);
    const geometry = deriveAtlasLabelGeometry(source!);
    const originalWidth = source!.bounds[1][0] - source!.bounds[0][0];
    const focusedWidth = geometry.focusBounds[1][0] - geometry.focusBounds[0][0];
    expect(focusedWidth).toBeLessThan(originalWidth / 4);
    expect(geometry.labelArea).toBeGreaterThan(0);
    expect(geometry.labelPoint[0]).toBeGreaterThanOrEqual(geometry.focusBounds[0][0]);
    expect(geometry.labelPoint[0]).toBeLessThanOrEqual(geometry.focusBounds[1][0]);
    expect(geometry.labelPoint[1]).toBeGreaterThanOrEqual(geometry.focusBounds[0][1]);
    expect(geometry.labelPoint[1]).toBeLessThanOrEqual(geometry.focusBounds[1][1]);
    expect(JSON.stringify(source)).toBe(before);
  }
});

test("missing drawn geometry keeps the supplied fallback without inventing an anchor", () => {
  const input = feature("", { centroid: [31, 42], bounds: [[20, 30], [40, 50]] });
  expect(deriveAtlasLabelGeometry(input)).toEqual({
    labelPoint: [31, 42],
    labelArea: 0,
    focusBounds: [[20, 30], [40, 50]],
  });
});
