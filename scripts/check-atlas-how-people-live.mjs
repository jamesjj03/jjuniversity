#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const readJson = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8").then(JSON.parse);

const [snapshot, validation, catalog, sourceLock] = await Promise.all([
  readJson("lib/atlas-world/data/countries.v1.json"),
  readJson("lib/atlas-world/data/validation.v1.json"),
  readJson("lib/atlas-world/layers/catalog.v2.json"),
  readJson("data/atlas/sources.lock.json"),
]);

const definitions = [
  { fact: "urbanPopulationPercent", dataset: "admin0-urban-population-share", layer: "admin0-urban-population-share", view: "urbanization", source: "world-bank-sp-urb-totl-in-zs-2026-07-13", field: "SP.URB.TOTL.IN.ZS", year: "2025", min: 0, max: 100 },
  { fact: "populationGrowthAnnualPercent", dataset: "admin0-population-growth-annual", layer: "admin0-population-growth-annual", view: "population-growth", source: "world-bank-sp-pop-grow-2026-07-13", field: "SP.POP.GROW", year: "2025", min: -5, max: 5 },
  { fact: "populationAges0To14Percent", dataset: "admin0-population-ages-0-14", layer: "admin0-population-ages-0-14", view: "children-share", source: "world-bank-sp-pop-0014-to-zs-2026-07-13", field: "SP.POP.0014.TO.ZS", year: "2025", min: 0, max: 50 },
  { fact: "populationAges65PlusPercent", dataset: "admin0-population-ages-65-plus", layer: "admin0-population-ages-65-plus", view: "older-population", source: "world-bank-sp-pop-65up-to-zs-2026-07-13", field: "SP.POP.65UP.TO.ZS", year: "2025", min: 0, max: 40 },
  { fact: "fertilityRateBirthsPerWoman", dataset: "admin0-fertility-rate", layer: "admin0-fertility-rate", view: "fertility", source: "world-bank-sp-dyn-tfrt-in-2026-07-13", field: "SP.DYN.TFRT.IN", year: "2024", min: 0.5, max: 7 },
  { fact: "lifeExpectancyYears", dataset: "admin0-life-expectancy", layer: "admin0-life-expectancy", view: "life-expectancy", source: "world-bank-sp-dyn-le00-in-2026-07-13", field: "SP.DYN.LE00.IN", year: "2024", min: 50, max: 90 },
];

const datasets = new Map(catalog.datasets.map((definition) => [definition.id, definition]));
const layers = new Map(catalog.layers.map((definition) => [definition.id, definition]));
const views = new Map(catalog.viewPresets.map((definition) => [definition.id, definition]));
const snapshotSources = new Map(snapshot.sources.map((source) => [source.id, source]));
const lockedSources = new Map(sourceLock.sources.map((source) => [source.id, source]));

for (const definition of definitions) {
  const dataset = datasets.get(definition.dataset);
  const layer = layers.get(definition.layer);
  const view = views.get(definition.view);
  const source = snapshotSources.get(definition.source);
  const locked = lockedSources.get(definition.source);
  assert.ok(dataset, `Missing dataset ${definition.dataset}.`);
  assert.ok(layer, `Missing layer ${definition.layer}.`);
  assert.ok(view, `Missing view ${definition.view}.`);
  assert.ok(source, `Missing snapshot source ${definition.source}.`);
  assert.ok(locked, `Missing source-lock entry ${definition.source}.`);
  assert.equal(dataset.sourceField, definition.field, `${definition.dataset} has the wrong source field.`);
  assert.equal(dataset.access.kind, "api", `${definition.dataset} must expose the versioned layer-data endpoint.`);
  assert.equal(dataset.access.endpoint, `/api/atlas/layers/${definition.layer}`);
  assert.equal(layer.legend.kind, "continuous", `${definition.layer} must exercise the continuous-value renderer.`);
  assert.equal(layer.legend.scale, "linear", `${definition.layer} should preserve linear interpretation.`);
  assert.deepEqual(layer.legend.domain, [definition.min, definition.max], `${definition.layer} legend domain drifted.`);
  assert.equal(layer.missingData.defaultStatus, "unavailable");
  assert.ok(view.layerInstances.some((instance) => instance.layerId === definition.layer && instance.enabled));
  assert.ok(view.layerInstances.some((instance) => instance.layerId === "modern-borders" && instance.enabled));
  assert.ok(view.layerInstances.some((instance) => instance.layerId === "admin0-interaction" && instance.enabled));

  const facts = snapshot.countries.map((country) => country.facts[definition.fact]).filter(Boolean);
  assert.equal(facts.length, 215, `${definition.fact} coverage changed from the reviewed 215/242 join.`);
  assert.equal(validation.coverage[definition.fact].populated, facts.length);
  assert.ok(facts.every((fact) => fact.sourceId === definition.source));
  assert.ok(facts.every((fact) => fact.sourceField === definition.field));
  assert.ok(facts.every((fact) => fact.status === "observed"));
  assert.ok(facts.every((fact) => fact.temporal.precision === "year" && /^\d{4}$/.test(fact.temporal.observedAt)));
  assert.ok(facts.every((fact) => fact.temporal.observedAt === definition.year), `${definition.fact} observation years drifted.`);
  assert.ok(facts.every((fact) => Number.isFinite(fact.value)), `${definition.fact} contains a non-finite value.`);
  assert.ok(
    facts.every((fact) => fact.value >= definition.min && fact.value <= definition.max),
    `${definition.fact} contains a value outside its authored legend domain.`,
  );

  const seedPath = path.join(projectRoot, locked.embeddedSnapshot);
  const bytes = await readFile(seedPath);
  assert.equal(bytes.byteLength, locked.expectedBytes, `${definition.source} seed byte count drifted.`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), locked.checksumSha256, `${definition.source} seed checksum drifted.`);
  assert.equal(source.checksumSha256, locked.checksumSha256, `${definition.source} build input differs from the lock.`);
}

const joinedEntityIds = snapshot.countries
  .filter((country) => country.facts.urbanPopulationPercent)
  .map((country) => country.id)
  .sort();
for (const definition of definitions.slice(1)) {
  assert.deepEqual(
    snapshot.countries.filter((country) => country.facts[definition.fact]).map((country) => country.id).sort(),
    joinedEntityIds,
    `${definition.fact} no longer shares the reviewed World Bank economy join.`,
  );
}

const missingCount = snapshot.countries.length - joinedEntityIds.length;
assert.equal(missingCount, 27, "Atlas should preserve its broader 242-entity ontology and show honest gaps for 27 non-matching units.");

console.log(`Atlas How People Live OK: ${definitions.length} indicators, ${joinedEntityIds.length}/${snapshot.countries.length} observations each, ${missingCount} explicit gaps.`);
