#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (filePath) => JSON.parse(await readFile(path.join(root, filePath), "utf8"));
const [lock, countries, canonical, manifest, svgBytes] = await Promise.all([
  readJson("data/atlas/sources.lock.json"),
  readJson("lib/atlas-world/data/countries.v1.json"),
  readJson("data/atlas/derived/admin1-pilot-wgs84.v1.geojson"),
  readJson("lib/atlas-world/data/admin1-pilot.v1.json"),
  readFile(path.join(root, "public/atlas-world/admin1-pilot-mercator.v1.svg")),
]);
const canonicalBytes = await readFile(path.join(root, "data/atlas/derived/admin1-pilot-wgs84.v1.geojson"));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expected = new Map([
  ["country:USA", 51], ["country:DEU", 16], ["country:IND", 36],
  ["country:CHN", 31], ["country:CAN", 13], ["country:NGA", 37],
]);

assert(lock.sources.some((source) => source.id === manifest.source.id), "Pilot source is absent from the source lock.");
for (const source of manifest.observationSources) {
  assert(lock.sources.some((candidate) => candidate.id === source.id), `Observation source ${source.id} is absent from the source lock.`);
}
assert(lock.builds.some((build) => build.id === "atlas-admin1-pilot-v1"), "Pilot build is absent from the source lock.");
assert(manifest.sourceLockId === lock.lockId, "Pilot refers to the wrong source lock.");
assert(manifest.pilot.status === "bounded-pilot", "Pilot is not marked as bounded.");
assert(manifest.features.length === 184, `Expected 184 features; got ${manifest.features.length}.`);
assert(canonical.features.length === manifest.features.length, "Canonical and runtime feature counts differ.");
assert(manifest.pilot.excludedSourceFeatures.length === 1, "Pilot exclusion count changed.");
assert(manifest.pilot.excludedSourceFeatures[0]?.name === "Paracel Islands", "Paracel exclusion is missing.");
assert(manifest.dataset.canonicalAsset.bytes === canonicalBytes.byteLength, "Canonical byte receipt is stale.");
assert(manifest.dataset.canonicalAsset.checksumSha256 === sha256(canonicalBytes), "Canonical checksum is stale.");
assert(manifest.dataset.derivedAsset.bytes === svgBytes.byteLength, "Mercator SVG byte receipt is stale.");
assert(manifest.dataset.derivedAsset.checksumSha256 === sha256(svgBytes), "Mercator SVG checksum is stale.");
assert(!JSON.stringify(manifest.features).includes("canonicalWgs84"), "Runtime manifest duplicates canonical coordinate arrays.");

const countryIds = new Set(countries.countries.map((country) => country.id));
const canonicalById = new Map(canonical.features.map((feature) => [feature.id, feature]));
const svg = svgBytes.toString("utf8");
const entityIds = new Set();
const featureIds = new Set();
for (const feature of manifest.features) {
  const label = feature.entity.entityId;
  assert(!entityIds.has(label), `Duplicate entity ID ${label}.`);
  assert(!featureIds.has(feature.featureId), `Duplicate feature ID ${feature.featureId}.`);
  entityIds.add(label); featureIds.add(feature.featureId);
  assert(label.startsWith("admin1:"), `${label} is not a typed Admin-1 ID.`);
  assert(feature.entity.kind === "administrative-unit" && feature.entity.adminLevel === 1, `${label} has the wrong entity type.`);
  assert(countryIds.has(feature.entity.parentId), `${label} has unknown parent ${feature.entity.parentId}.`);
  assert(feature.entity.parentId === feature.entity.countryId, `${label} has inconsistent parentage.`);
  const iso = feature.entity.codes.find((code) => code.scheme === "iso-3166-2")?.value;
  assert(/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(iso ?? ""), `${label} has no valid-shaped ISO 3166-2 code.`);
  assert(feature.geometry.crs === "EPSG:4326", `${label} canonical geometry is not WGS84.`);
  assert(feature.geometry.derived.projectionId === "mercator", `${label} has no Mercator derivative.`);
  assert(feature.geometry.derived.viewBox.join(",") === "0,0,1200,650", `${label} has the wrong viewBox.`);
  assert(canonicalById.has(feature.geometry.canonicalFeatureId), `${label} cannot resolve its canonical feature.`);
  assert(svg.includes(`id="${feature.geometry.derived.assetId}"`), `${label} cannot resolve its projected path.`);
  const population = feature.observations?.population ?? null;
  if (feature.entity.countryId === "country:USA") {
    assert(population?.status === "estimated" && population.value > 0, `${label} has no valid Census population estimate.`);
    assert(population?.temporal.observedAt === "2024-07-01", `${label} has the wrong population date.`);
    assert(population?.sourceIds.includes("us-census-population-estimates-2024-admin1"), `${label} has the wrong population source.`);
  } else {
    assert(population === null, `${label} should not inherit or fabricate a subdivision population.`);
  }
}
for (const [countryId, count] of expected) {
  const actual = manifest.features.filter((feature) => feature.entity.countryId === countryId).length;
  assert(actual === count, `${countryId}: expected ${count}, got ${actual}.`);
}
assert(manifest.dataset.caveats.some((caveat) => caveat.includes("not an authority for legal claims")),
  "Legal-status caveat is missing.");
assert(manifest.dataset.caveats.some((caveat) => caveat.includes("stale or inconsistent")),
  "Administrative-type quality caveat is missing.");
assert(manifest.observationDatasets.length === 1, "Expected one bounded subdivision observation dataset.");
assert(manifest.observationDatasets[0]?.coverage.populatedFeatures === 51, "Expected 51 official U.S. population observations.");
assert(manifest.features.filter((feature) => feature.observations?.population).length === 51,
  "Subdivision population coverage changed.");

if (failures.length) {
  console.error("Atlas Admin-1 pilot validation failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Atlas Admin-1 pilot validated: 184 sourced units across six countries; 51 U.S. population estimates; canonical WGS84 and Mercator assets match.");
}
