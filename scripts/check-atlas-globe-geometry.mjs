import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const geometry = JSON.parse(await readFile(path.join(root, "public", "atlas-world", "geometry-wgs84.v1.json"), "utf8"));
const countries = JSON.parse(await readFile(path.join(root, "lib", "atlas-world", "data", "countries.v1.json"), "utf8"));
const sourceLock = JSON.parse(await readFile(path.join(root, "data", "atlas", "sources.lock.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function visitCoordinates(value, visit) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value);
    return;
  }
  for (const child of value) visitCoordinates(child, visit);
}

assert(geometry.schemaVersion === "1.0.0", "Unexpected Atlas globe geometry schema.");
assert(geometry.canonicalCrs === "EPSG:4326", "Globe geometry is not canonical WGS84.");
assert(geometry.snapshotId === countries.snapshotId, "Globe and country snapshots do not match.");
assert(geometry.features.length === 242, `Expected 242 globe map units, found ${geometry.features.length}.`);

const countryIds = new Set(countries.countries.map((country) => country.id));
const featureIds = new Set();
let coordinateCount = 0;
for (const feature of geometry.features) {
  assert(feature.type === "Feature", `${feature.id} is not a GeoJSON feature.`);
  assert(feature.id === feature.properties?.entityId, `${feature.id} has inconsistent identity metadata.`);
  assert(countryIds.has(feature.id), `${feature.id} does not join to an Atlas entity.`);
  assert(!featureIds.has(feature.id), `${feature.id} is duplicated.`);
  assert(["Polygon", "MultiPolygon"].includes(feature.geometry?.type), `${feature.id} has unsupported geometry.`);
  featureIds.add(feature.id);
  visitCoordinates(feature.geometry.coordinates, ([longitude, latitude]) => {
    assert(Number.isFinite(longitude) && longitude >= -180 && longitude <= 180, `${feature.id} has an invalid longitude.`);
    assert(Number.isFinite(latitude) && latitude >= -90 && latitude <= 90, `${feature.id} has an invalid latitude.`);
    coordinateCount += 1;
  });
}
assert(featureIds.size === countryIds.size, "The globe does not cover every Atlas entity.");
assert(coordinateCount > 90_000, "The globe asset appears unexpectedly simplified or empty.");

const source = sourceLock.sources.find((entry) => entry.id === geometry.source.id);
assert(source, "Globe geometry references an unknown source.");
assert(source.checksumSha256 === geometry.source.checksumSha256, "Globe geometry source checksum is stale.");
assert(source.license.name === geometry.source.license.name, "Globe geometry license metadata is stale.");

console.log(`Atlas globe geometry check passed: ${featureIds.size} entities, ${coordinateCount.toLocaleString("en-US")} WGS84 positions.`);
