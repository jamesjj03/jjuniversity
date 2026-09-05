#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(scriptDirectory, "..", "lib", "atlas-world", "data");
const mapAssetPath = path.join(scriptDirectory, "..", "public", "atlas-world", "geometry-mercator.v1.svg");

async function readJson(name) {
  return JSON.parse(await readFile(path.join(dataDirectory, name), "utf8"));
}

const [countries, geometry, validation, mapAsset] = await Promise.all([
  readJson("countries.v1.json"),
  readJson("geometry-mercator.v1.json"),
  readJson("validation.v1.json"),
  readFile(mapAssetPath, "utf8"),
]);

assert.equal(validation.status, "pass", "Atlas source validation must pass");
assert.equal(countries.snapshotId, geometry.snapshotId, "Country and geometry snapshots must match");
assert.equal(countries.snapshotId, validation.snapshotId, "Validation must describe the committed snapshot");
assert.equal(countries.countries.length, geometry.features.length, "Every map feature needs one country record");
assert.ok(countries.countries.length >= 240, "The world snapshot must retain global geometry coverage");

const countryIds = new Set(countries.countries.map((country) => country.id));
const featureIds = new Set(geometry.features.map((feature) => feature.entityId));
const observationStatuses = new Set([
  "observed",
  "estimated",
  "inherited",
  "carried_forward",
  "suppressed",
  "not_applicable",
  "unavailable",
]);
assert.equal(countryIds.size, countries.countries.length, "Country IDs must be unique");
assert.equal(featureIds.size, geometry.features.length, "Geometry entity IDs must be unique");
assert.deepEqual([...featureIds].sort(), [...countryIds].sort(), "Country and geometry IDs must align exactly");
assert.ok(
  mapAsset.includes(`data-snapshot-id="${geometry.snapshotId}"`),
  "The browser geometry asset must match the committed snapshot",
);
for (const feature of geometry.features) {
  const assetId = `atlas-${feature.entityId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  assert.ok(mapAsset.includes(`id="${assetId}"`), `${feature.entityId} is missing from the browser geometry asset`);
}

for (const key of [
  "population",
  "urbanPopulationPercent",
  "populationGrowthAnnualPercent",
  "populationAges0To14Percent",
  "populationAges65PlusPercent",
  "fertilityRateBirthsPerWoman",
  "lifeExpectancyYears",
  "governmentNormalized",
  "religionNormalized",
  "headOfState",
  "headOfGovernment",
]) {
  assert.ok(validation.coverage[key]?.populated >= 200, `${key} must retain useful global coverage`);
}

for (const country of countries.countries) {
  for (const fact of Object.values(country.facts)) {
    if (!fact) continue;
    assert.ok(fact.sourceId, `${country.id} fact is missing its source`);
    assert.ok(fact.temporal, `${country.id} fact is missing time metadata`);
    assert.ok(
      observationStatuses.has(fact.status ?? "observed"),
      `${country.id} fact has an unknown observation status`,
    );
  }
}

console.log(
  `Atlas snapshot OK: ${countries.countries.length} mapped places, ` +
    `${validation.coverage.governmentNormalized.populated} government classifications, ` +
    `${validation.coverage.religionNormalized.populated} religion classifications.`,
);
