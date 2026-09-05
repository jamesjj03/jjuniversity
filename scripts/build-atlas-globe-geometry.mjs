import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceLockPath = path.join(root, "data", "atlas", "sources.lock.json");
const countrySnapshotPath = path.join(root, "lib", "atlas-world", "data", "countries.v1.json");
const outputPath = path.join(root, "public", "atlas-world", "geometry-wgs84.v1.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const sourceLock = JSON.parse(await readFile(sourceLockPath, "utf8"));
const countrySnapshot = JSON.parse(await readFile(countrySnapshotPath, "utf8"));
const source = sourceLock.sources.find((entry) => entry.id === "natural-earth-admin-0-50m-5.1.2");
assert(source, "The pinned Natural Earth Admin-0 source is missing from the Atlas source lock.");

const sourcePath = path.join(root, sourceLock.cacheDirectory, source.target);
const sourceBytes = await readFile(sourcePath);
assert(sourceBytes.byteLength === source.expectedBytes, `Natural Earth byte length changed: ${sourceBytes.byteLength}.`);
assert(sha256(sourceBytes) === source.checksumSha256, "Natural Earth checksum does not match the Atlas source lock.");

const input = JSON.parse(sourceBytes.toString("utf8"));
assert(input.type === "FeatureCollection", "Natural Earth Admin-0 input is not a FeatureCollection.");
assert(input.features.length === countrySnapshot.countries.length, "WGS84 and Atlas entity counts do not match.");

const countryIds = new Set(countrySnapshot.countries.map((country) => country.id));
const seenIds = new Set();
const features = input.features.map((feature) => {
  const code = feature.properties?.ADM0_A3;
  const entityId = `country:${code}`;
  assert(typeof code === "string" && /^[A-Z0-9]{3}$/.test(code), "Natural Earth feature has no stable ADM0_A3 code.");
  assert(countryIds.has(entityId), `Natural Earth feature ${entityId} has no Atlas entity.`);
  assert(!seenIds.has(entityId), `Natural Earth feature ${entityId} is duplicated.`);
  assert(["Polygon", "MultiPolygon"].includes(feature.geometry?.type), `${entityId} has unsupported geometry.`);
  seenIds.add(entityId);

  const labelLongitude = Number(feature.properties?.LABEL_X);
  const labelLatitude = Number(feature.properties?.LABEL_Y);
  const tinyRank = Number(feature.properties?.TINY);
  return {
    type: "Feature",
    id: entityId,
    properties: {
      entityId,
      labelWgs84: Number.isFinite(labelLongitude) && Number.isFinite(labelLatitude)
        ? [labelLongitude, labelLatitude]
        : null,
      tinyRank: Number.isFinite(tinyRank) && tinyRank >= 0 ? tinyRank : null,
    },
    geometry: feature.geometry,
  };
}).sort((left, right) => left.id.localeCompare(right.id));

assert(features.length === 242, `Expected 242 Atlas map units, found ${features.length}.`);
assert(seenIds.size === countryIds.size, "Some Atlas entity IDs are missing from the WGS84 asset.");

const output = {
  schemaVersion: "1.0.0",
  snapshotId: countrySnapshot.snapshotId,
  generatedAt: countrySnapshot.generatedAt,
  source: {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    version: source.version,
    url: source.url,
    retrievedAt: source.retrievedAt,
    checksumSha256: source.checksumSha256,
    license: source.license,
  },
  canonicalCrs: "EPSG:4326",
  geometrySemantics: "Present-day Natural Earth Admin-0 map units; not a recognition or sovereignty judgment.",
  features,
};

await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(`Wrote ${features.length} WGS84 Atlas features to ${path.relative(root, outputPath)}.`);
