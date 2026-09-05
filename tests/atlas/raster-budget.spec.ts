import { expect, test } from "@playwright/test";
import geography from "../../lib/atlas-world/data/geography-pack.v1.json";

const pyramid = geography.datasets.find((dataset) => dataset.id === "population-density-2025")!.assetPyramid!;

test("source detail starts only at the reviewed regional, country and close thresholds", () => {
  expect(pyramid.levels.map((level) => [level.id, level.minimumZoom])).toEqual([
    ["regional", 4], ["country", 10], ["close", 20],
  ]);
  expect(pyramid.levels.at(-1)!.displayMetresPerPixel).toBeGreaterThanOrEqual(1000);
});

for (const [name, svgWidth, svgHeight] of [["desktop meet", 1200, 750], ["phone slice", 320, 650]] as const) {
  test(`${name} cannot load an entire global raster at a detail threshold`, () => {
    for (const level of pyramid.levels) {
      const width = svgWidth / level.minimumZoom, height = svgHeight / level.minimumZoom;
      const xCandidates = [...new Set(level.tiles.flatMap((tile) => [tile.viewBox[0] - .01, tile.viewBox[0] + .01]))];
      const yCandidates = [...new Set(level.tiles.flatMap((tile) => [tile.viewBox[1] - .01, tile.viewBox[1] + .01]))];
      let maximumCount = 0;
      for (const x of xCandidates) for (const y of yCandidates) {
        const count = level.tiles.filter((tile) => {
          const [left, top, tileWidth, tileHeight] = tile.viewBox;
          return left < x + width && left + tileWidth > x && top < y + height && top + tileHeight > y;
        }).length;
        maximumCount = Math.max(maximumCount, count);
      }
      expect(maximumCount, `${name} / ${level.id} decoded tile count`).toBeLessThanOrEqual(20);
      expect(maximumCount * pyramid.maximumDecodedTileBytes).toBeLessThanOrEqual(124_800_000);
    }
  });
}
