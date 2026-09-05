import { expect, test } from "@playwright/test";
import { projectAtlasWgs84, ATLAS_WORLD_BOUNDS, ATLAS_INITIAL_BOUNDS } from "../../lib/atlas-world/projection";
import geography from "../../lib/atlas-world/data/geometry-mercator.v1.json";
import canonicalCountries from "../../lib/atlas-world/data/countries.v1.json";

test("Mercator representation preserves all 242 entities and their stable joins", () => {
  expect(geography.projection.id).toBe("mercator");
  expect(geography.features).toHaveLength(242);
  expect(geography.features.map((f) => f.entityId).sort()).toEqual(canonicalCountries.countries.map((c) => c.id).sort());
  expect(geography.features.find((f) => f.entityId === "country:ATA")?.path.length).toBeGreaterThan(0);
});

test("east stays right and north stays up at Japan, India, China and Europe", () => {
  for (const [lon, lat] of [[140, 36], [78, 23], [110, 34], [6, 51]]) {
    const p = projectAtlasWgs84([lon, lat]);
    const north = projectAtlasWgs84([lon, lat + 1]);
    const east = projectAtlasWgs84([lon + 1, lat]);
    expect(north[0]).toBe(p[0]);
    expect(north[1]).toBeLessThan(p[1]);
    expect(east[0]).toBeGreaterThan(p[0]);
    expect(east[1]).toBe(p[1]);
  }
});

test("initial inhabited-world framing is distinct from the full navigable extent", () => {
  expect(ATLAS_INITIAL_BOUNDS[0][1]).toBeGreaterThan(ATLAS_WORLD_BOUNDS[0][1]);
  expect(ATLAS_INITIAL_BOUNDS[1][1]).toBeLessThan(ATLAS_WORLD_BOUNDS[1][1]);
  const antarctica = projectAtlasWgs84([0, -80]);
  expect(antarctica[1]).toBeGreaterThan(ATLAS_INITIAL_BOUNDS[1][1]);
  expect(antarctica[1]).toBeLessThan(ATLAS_WORLD_BOUNDS[1][1]);
});

test("projection stays finite at the poles without changing canonical latitude", () => {
  expect(projectAtlasWgs84([180, 90])[0]).toBeCloseTo(911, 6);
  expect(projectAtlasWgs84([0, 90])[1]).toBeCloseTo(14, 6);
  expect(projectAtlasWgs84([0, -90])[1]).toBeCloseTo(636, 6);
});
