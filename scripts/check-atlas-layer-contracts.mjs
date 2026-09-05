import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const catalogPath = path.join(projectRoot, "lib", "atlas-world", "layers", "catalog.v2.json");
const countriesPath = path.join(projectRoot, "lib", "atlas-world", "data", "countries.v1.json");
const geographyPath = path.join(projectRoot, "lib", "atlas-world", "data", "geography-pack.v1.json");
const patternNotesPath = path.join(projectRoot, "lib", "atlas-world", "data", "pattern-notes.v1.json");
const sourceLockPath = path.join(projectRoot, "data", "atlas", "sources.lock.json");
const [catalog, snapshot, geography, patternNotes, sourceLock] = await Promise.all([
  readFile(catalogPath, "utf8").then(JSON.parse),
  readFile(countriesPath, "utf8").then(JSON.parse),
  readFile(geographyPath, "utf8").then(JSON.parse),
  readFile(patternNotesPath, "utf8").then(JSON.parse),
  readFile(sourceLockPath, "utf8").then(JSON.parse),
]);

assert.equal(catalog.schemaVersion, "2.0.0", "Unexpected layer catalog schema version.");

function uniqueById(records, label) {
  const ids = records.map((record) => record.id);
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique.`);
  return new Map(records.map((record) => [record.id, record]));
}

const datasets = uniqueById(catalog.datasets, "Dataset");
const layers = uniqueById(catalog.layers, "Layer");
const presets = uniqueById(catalog.viewPresets, "View preset");
const snapshotSources = new Map(snapshot.sources.map((source) => [source.id, source]));
const geographySources = new Map(geography.sources.map((source) => [source.id, source]));
const lockedSources = new Map(sourceLock.sources.map((source) => [source.id, source]));
const knownSourceIds = new Set([...snapshotSources.keys(), ...geographySources.keys()]);

for (const [sourceId, source] of geographySources) {
  const locked = lockedSources.get(sourceId);
  assert.ok(locked, `Geography source ${sourceId} is absent from the reproducible source lock.`);
  assert.equal(locked?.checksumSha256, source.checksumSha256, `${sourceId} checksum differs from the source lock.`);
  assert.equal(locked?.url, source.url, `${sourceId} URL differs from the source lock.`);
}

for (const dataset of catalog.datasets) {
  assert.equal(dataset.schemaVersion, catalog.schemaVersion, `${dataset.id} has a mismatched schema version.`);
  assert.ok(dataset.sourceIds.length > 0, `${dataset.id} must declare provenance.`);
  for (const sourceId of dataset.sourceIds) {
    assert.ok(knownSourceIds.has(sourceId), `${dataset.id} references missing source ${sourceId}.`);
  }
  if (dataset.temporal.kind === "timeless") {
    assert.equal(dataset.temporal.selectionPolicy, "timeless", `${dataset.id} timeless data needs a timeless selection policy.`);
    assert.equal(dataset.temporal.supportsArbitraryTime, true, `${dataset.id} timeless data should coexist with any time cursor.`);
  }
}

const knownResolverIds = new Set([
  "political-authored-palette-v1",
  "government-broad-form-v1",
  "religion-dominant-broad-v1",
  "population-total-bins-v1",
  "gdp-per-capita-current-usd-v1",
  "urban-population-share-v1",
  "population-growth-annual-v1",
  "population-ages-0-14-share-v1",
  "population-ages-65-plus-share-v1",
  "fertility-rate-v1",
  "life-expectancy-v1",
  "geometry-presence-v1",
  "raster-asset-v1",
  "feature-geometry-v1",
  "city-symbol-v1",
  "contextual-annotation-v1",
]);

for (const layer of catalog.layers) {
  assert.equal(layer.schemaVersion, catalog.schemaVersion, `${layer.id} has a mismatched schema version.`);
  assert.ok(datasets.has(layer.datasetId), `${layer.id} references missing dataset ${layer.datasetId}.`);
  assert.ok(layer.defaultOpacity >= 0 && layer.defaultOpacity <= 1, `${layer.id} opacity is outside 0–1.`);
  assert.ok(knownResolverIds.has(layer.resolverId), `${layer.id} references unregistered resolver ${layer.resolverId}.`);
  assert.ok(layer.provenance.methodology.trim(), `${layer.id} must explain its methodology.`);
  assert.ok(layer.provenance.authoredVisualChoices.length > 0, `${layer.id} must preserve authored display choices.`);
  const minimumZoom = layer.style?.minimumZoom;
  const maximumZoom = layer.style?.maximumZoom;
  if (minimumZoom != null) {
    assert.ok(Number.isFinite(minimumZoom) && minimumZoom >= 1, `${layer.id} has an invalid minimum zoom.`);
  }
  if (maximumZoom != null) {
    assert.ok(Number.isFinite(maximumZoom) && maximumZoom <= 128, `${layer.id} has an invalid maximum zoom.`);
  }
  if (minimumZoom != null && maximumZoom != null) {
    assert.ok(minimumZoom <= maximumZoom, `${layer.id} zoom interval is inverted.`);
  }
  for (const required of layer.compatibility.requiresLayerIds) {
    assert.ok(layers.has(required), `${layer.id} requires unknown layer ${required}.`);
  }
  for (const conflict of layer.compatibility.conflictsWithLayerIds) {
    assert.ok(layers.has(conflict), `${layer.id} conflicts with unknown layer ${conflict}.`);
  }
  if (layer.legend.kind === "continuous") {
    assert.ok(layer.legend.domain[0] < layer.legend.domain[1], `${layer.id} has an invalid continuous domain.`);
    assert.equal(layer.legend.stops[0]?.position, 0, `${layer.id} continuous legend must begin at zero.`);
    assert.equal(layer.legend.stops.at(-1)?.position, 1, `${layer.id} continuous legend must end at one.`);
    assert.deepEqual(
      [...layer.legend.stops].sort((a, b) => a.position - b.position),
      layer.legend.stops,
      `${layer.id} legend stops must be ordered.`,
    );
  }
}

const aliases = new Set();
for (const preset of catalog.viewPresets) {
  assert.equal(preset.schemaVersion, catalog.schemaVersion, `${preset.id} has a mismatched schema version.`);
  assert.ok(preset.layerInstances.length > 0, `${preset.id} must contain layers.`);
  const instanceIds = new Set();
  const exclusiveGroups = new Map();
  for (const instance of preset.layerInstances.filter((candidate) => candidate.enabled)) {
    assert.ok(layers.has(instance.layerId), `${preset.id} references missing layer ${instance.layerId}.`);
    assert.ok(!instanceIds.has(instance.id), `${preset.id} duplicates instance ${instance.id}.`);
    instanceIds.add(instance.id);
    assert.ok(instance.opacity >= 0 && instance.opacity <= 1, `${instance.id} opacity is outside 0–1.`);
    const group = layers.get(instance.layerId).compatibility.exclusiveGroup;
    if (group) exclusiveGroups.set(group, [...(exclusiveGroups.get(group) ?? []), instance.layerId]);
  }
  assert.equal(exclusiveGroups.get("admin0-fill")?.length, 1, `${preset.id} must own exactly one admin0 fill.`);
  assert.equal(exclusiveGroups.get("admin0-interaction")?.length, 1, `${preset.id} must own exactly one admin0 interaction layer.`);
  assert.ok(
    preset.layerInstances.some((instance) => instance.enabled && instance.layerId === "modern-borders"),
    `${preset.id} must preserve modern borders.`,
  );
  for (const alias of [preset.id, ...preset.legacyModeAliases]) {
    const normalized = alias.toLocaleLowerCase("en-US");
    assert.ok(!aliases.has(normalized) || normalized === preset.id, `Legacy view alias ${normalized} is ambiguous.`);
    aliases.add(normalized);
  }
}

for (const requiredPreset of ["political", "government", "religion", "population", "gdp-per-capita", "population-density"]) {
  assert.ok(presets.has(requiredPreset), `Missing required Atlas view ${requiredPreset}.`);
}

const geographyDatasetIds = [
  "physical-relief",
  "population-density-2025",
  "major-lakes",
  "major-rivers",
  "major-cities",
  "major-water-bodies",
  "watershed-pilot",
];
for (const datasetId of geographyDatasetIds) {
  const definition = datasets.get(datasetId);
  const packed = geography.datasets.find((dataset) => dataset.id === datasetId);
  assert.ok(definition, `Layer catalog is missing geography dataset ${datasetId}.`);
  assert.ok(packed, `Geography pack is missing registered dataset ${datasetId}.`);
  assert.deepEqual(definition?.sourceIds, packed?.sourceIds, `${datasetId} catalog provenance differs from the built pack.`);
}

const densityDataset = datasets.get("population-density-2025");
const densityLayer = layers.get("population-density-2025");
const packedDensity = geography.datasets.find((dataset) => dataset.id === "population-density-2025");
assert.equal(densityDataset.access.href, packedDensity.asset.href, "Population-density layer points at the wrong raster asset.");
assert.equal(densityLayer.renderer, "raster-field");
assert.equal(densityLayer.legend.kind, "continuous");
assert.equal(densityLayer.legend.scale, "log1p");
assert.deepEqual(
  densityLayer.legend.ticks.map((tick) => tick.value),
  packedDensity.visualization.stops.map((stop) => stop.value),
  "Population-density legend values differ from the authored raster scale.",
);
assert.deepEqual(
  densityLayer.legend.stops.map((stop) => stop.color),
  packedDensity.visualization.stops.map((stop) => stop.color),
  "Population-density legend colors differ from the authored raster scale.",
);

const reliefDataset = datasets.get("physical-relief");
const reliefLayer = layers.get("physical-relief");
const packedRelief = geography.datasets.find((dataset) => dataset.id === "physical-relief");
assert.equal(reliefDataset.access.href, packedRelief.asset.href, "Physical-relief layer points at the wrong raster asset.");
assert.equal(reliefLayer.defaultOpacity, packedRelief.visualization.recommendedOpacity);
assert.equal(reliefLayer.style.blendMode, packedRelief.visualization.recommendedBlendMode);

const expectedGeographyLayerOrder = [
  "physical-relief",
  "population-density-2025",
  "admin0-political",
  "major-water-bodies",
  "major-lakes",
  "modern-borders",
  "major-rivers",
  "major-cities",
  "population-geography-annotations",
  "admin0-interaction",
];
const peopleView = presets.get("population-density");
assert.deepEqual(
  peopleView.layerInstances.filter((instance) => instance.enabled).map((instance) => instance.layerId),
  expectedGeographyLayerOrder,
  "Where People Live scene drifted from its authored layer composition.",
);
assert.equal(
  peopleView.layerInstances.filter((instance) => layers.get(instance.layerId)?.compatibility.exclusiveGroup === "admin0-fill").length,
  1,
  "Where People Live must have exactly one contextual admin0 fill.",
);
assert.ok(
  peopleView.layerInstances.find((instance) => instance.layerId === "admin0-political")?.opacity <= 0.12,
  "Where People Live country context should remain subtle enough to reveal the density raster.",
);

const annotationDataset = datasets.get("population-geography-annotations");
const annotationLayer = layers.get("population-geography-annotations");
assert.equal(annotationDataset.access.resourceId, "atlas-pattern-notes.v1");
assert.equal(annotationLayer.renderer, "annotation");
assert.ok(annotationLayer.compatibility.requiresLayerIds.includes("population-density-2025"));
assert.equal(patternNotes.notes.length, 4, "Expected the four reviewed initial population explanations.");
assert.ok(
  patternNotes.notes.every((note) => note.triggers.viewPresetIds.includes("population-density")),
  "Every initial population explanation should trigger in Where People Live.",
);
assert.ok(
  Number.isFinite(annotationLayer.style.minimumZoom)
    && Number.isFinite(annotationLayer.style.maximumZoom),
  "The annotation surface needs an executable zoom interval.",
);
for (const note of patternNotes.notes) {
  assert.ok(
    Number.isFinite(note.triggers.minimumZoom) && Number.isFinite(note.triggers.maximumZoom),
    `${note.id} must declare finite zoom triggers.`,
  );
  assert.ok(
    note.triggers.minimumZoom <= note.triggers.maximumZoom,
    `${note.id} zoom trigger interval is inverted.`,
  );
  assert.ok(
    note.triggers.minimumZoom >= annotationLayer.style.minimumZoom
      && note.triggers.maximumZoom <= annotationLayer.style.maximumZoom,
    `${note.id} zoom triggers fall outside its layer surface interval.`,
  );
}

const gdpDataset = datasets.get("admin0-gdp-per-capita");
const gdpLayer = layers.get("admin0-gdp-per-capita");
assert.equal(gdpDataset.sourceField, "NY.GDP.PCAP.CD");
assert.equal(gdpDataset.access.kind, "api");
assert.equal(gdpLayer.legend.kind, "continuous");
assert.equal(gdpLayer.legend.scale, "log");
assert.equal(gdpLayer.missingData.defaultStatus, "unavailable");

const gdpFacts = snapshot.countries
  .map((country) => country.facts.gdpPerCapitaCurrentUsd)
  .filter(Boolean);
assert.ok(gdpFacts.length >= 200, `GDP per-capita coverage unexpectedly fell to ${gdpFacts.length}.`);
assert.ok(gdpFacts.every((fact) => Number.isFinite(fact.value) && fact.value >= 0), "GDP per-capita values must be finite and non-negative.");
assert.ok(gdpFacts.every((fact) => fact.sourceField === "NY.GDP.PCAP.CD"), "GDP per-capita source fields drifted.");
assert.ok(gdpFacts.every((fact) => fact.temporal.observedAt), "GDP per-capita observations must retain their year.");
assert.ok(
  gdpFacts.every((fact) => (fact.status ?? "observed") === "observed"),
  "Legacy GDP facts may default to observed, but an explicit non-observed status must survive.",
);
assert.ok(new Set(gdpFacts.map((fact) => fact.temporal.observedAt)).size > 1, "GDP per-capita years must not be silently flattened.");
const gdpValues = gdpFacts.map((fact) => fact.value);
assert.ok(Math.min(...gdpValues) >= gdpLayer.legend.domain[0], "GDP legend domain no longer covers its minimum value.");
assert.ok(Math.max(...gdpValues) <= gdpLayer.legend.domain[1], "GDP legend domain no longer covers its maximum value.");

console.log(
  `Atlas layer contracts OK: ${catalog.datasets.length} datasets, ${catalog.layers.length} layers, `
  + `${catalog.viewPresets.length} views, ${gdpFacts.length}/${snapshot.countries.length} GDP-per-capita observations, `
  + `${geography.datasets.length} geography datasets and ${patternNotes.notes.length} contextual annotations.`,
);
