import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

const SOURCE_LOCK_PATH = path.join(REPOSITORY_ROOT, "data", "atlas", "sources.lock.json");
const GEOGRAPHY_PACK_PATH = path.join(
  REPOSITORY_ROOT,
  "lib",
  "atlas-world",
  "data",
  "geography-pack.v1.json",
);
const PATTERN_NOTES_PATH = path.join(
  REPOSITORY_ROOT,
  "lib",
  "atlas-world",
  "data",
  "pattern-notes.v1.json",
);
const COUNTRIES_PATH = path.join(
  REPOSITORY_ROOT,
  "lib",
  "atlas-world",
  "data",
  "countries.v1.json",
);
const LAYER_CATALOG_PATH = path.join(REPOSITORY_ROOT, "lib", "atlas-world", "layers", "catalog.v2.json");
const WORLD_BUILDER_PATH = path.join(REPOSITORY_ROOT, "scripts", "build-atlas-world-snapshot.mjs");
const GEOGRAPHY_REQUIREMENTS_PATH = path.join(
  REPOSITORY_ROOT,
  "scripts",
  "atlas-geography-requirements.txt",
);

const EXPECTED_DATASET_COUNTS = {
  "major-rivers": 94,
  "major-lakes": 77,
  "major-cities": 319,
};
const EXPECTED_DATASET_IDS = new Set([
  "population-density-2025",
  "physical-relief",
  "major-rivers",
  "major-lakes",
  "major-cities",
]);
const EXPECTED_NOTE_IDS = new Set([
  "pattern-note:population:nile-valley",
  "pattern-note:population:java",
  "pattern-note:population:heihe-tengchong",
  "pattern-note:population:indo-gangetic-plain",
]);

const failures = [];
const warnings = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function unique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(typeof value === "string" && value.length > 0, `${label} contains an empty or non-string ID.`);
    assert(!seen.has(value), `${label} contains duplicate ID ${String(value)}.`);
    seen.add(value);
  }
  return seen;
}

function validateTemporal(temporal, label) {
  assert(temporal && typeof temporal === "object", `${label} has no temporal contract.`);
  if (!temporal || typeof temporal !== "object") return;
  assert(Object.hasOwn(temporal, "validFrom"), `${label}.temporal is missing validFrom.`);
  assert(Object.hasOwn(temporal, "validTo"), `${label}.temporal is missing validTo.`);
  if (temporal.validFrom && temporal.validTo) {
    assert(temporal.validFrom <= temporal.validTo, `${label} has an inverted validity interval.`);
  }
}

function visitCoordinates(value, callback) {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    callback(value);
    return;
  }
  for (const child of value) visitCoordinates(child, callback);
}

function validateGeometry(geometry, label) {
  assert(geometry && typeof geometry === "object", `${label} has no geometry.`);
  if (!geometry || typeof geometry !== "object") return;
  assert(geometry.crs === "EPSG:4326", `${label} canonical geometry is not EPSG:4326.`);
  assert(
    typeof geometry.geometryId === "string" && geometry.geometryId.length > 0,
    `${label} has no stable geometryId.`,
  );

  const canonical = geometry.canonicalWgs84;
  assert(canonical && typeof canonical.type === "string", `${label} has no canonical WGS84 geometry.`);
  let coordinateCount = 0;
  visitCoordinates(canonical?.coordinates, ([longitude, latitude]) => {
    coordinateCount += 1;
    assert(
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180,
      `${label} contains invalid longitude ${longitude}.`,
    );
    assert(
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90,
      `${label} contains invalid latitude ${latitude}.`,
    );
  });
  assert(coordinateCount > 0, `${label} has no canonical coordinates.`);

  const derived = geometry.derived;
  assert(derived?.projectionId === "equal-earth", `${label} has no Equal Earth derivative.`);
  assert(
    Array.isArray(derived?.viewBox) && derived.viewBox.join(",") === "0,0,1200,650",
    `${label} has an unexpected derived viewBox.`,
  );
  if (canonical?.type === "Point") {
    assert(Array.isArray(derived?.point) && derived.point.length === 2, `${label} has no projected point.`);
  } else {
    assert(typeof derived?.path === "string" && derived.path.length > 0, `${label} has no projected path.`);
  }

  const projectedBounds = derived?.bounds;
  if (Array.isArray(projectedBounds)) {
    visitCoordinates(projectedBounds, ([x, y]) => {
      assert(x >= -0.1 && x <= 1200.1, `${label} projects outside the Atlas viewBox on x (${x}).`);
      assert(y >= -0.1 && y <= 650.1, `${label} projects outside the Atlas viewBox on y (${y}).`);
    });
  }
}

function assetPathFromHref(href) {
  assert(typeof href === "string" && href.startsWith("/atlas-world/"), `Invalid Atlas asset href ${href}.`);
  const relativePath = href.replace(/^\/+/, "").split("/");
  const resolved = path.resolve(REPOSITORY_ROOT, "public", ...relativePath);
  const publicRoot = path.resolve(REPOSITORY_ROOT, "public");
  assert(
    resolved === publicRoot || resolved.startsWith(`${publicRoot}${path.sep}`),
    `Asset href escapes public/: ${href}`,
  );
  return resolved;
}

async function checkAsset(asset, datasetId) {
  const assetPath = assetPathFromHref(asset.href);
  let bytes;
  try {
    bytes = await readFile(assetPath);
  } catch {
    failures.push(`${datasetId} asset does not exist: ${asset.href}`);
    return;
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  assert(bytes.byteLength === asset.bytes, `${datasetId} asset byte count does not match its manifest.`);
  assert(digest === asset.checksumSha256, `${datasetId} asset checksum does not match its manifest.`);

  const metadata = await sharp(bytes).metadata();
  assert(metadata.format === "webp", `${datasetId} asset is not WebP.`);
  assert(metadata.width === asset.width && metadata.height === asset.height, `${datasetId} asset dimensions do not match its manifest.`);
  assert(metadata.hasAlpha === true, `${datasetId} asset must retain alpha outside the Equal Earth sphere.`);
}

async function checkPyramid(pyramid, datasetId) {
  assert(pyramid.projectionId === "equal-earth", `${datasetId} pyramid is not aligned to Equal Earth.`);
  assert(pyramid.sourceResolutionMetres === 1000, `${datasetId} lost its original one-kilometre source resolution.`);
  assert(pyramid.resampling === "average", `${datasetId} pyramid must preserve area-average resampling.`);
  assert(pyramid.levels?.length === 2, `${datasetId} must provide regional and country detail levels.`);
  let previousWidth = 2400;
  let previousMinimumZoom = 1;
  const tileIds = new Set();
  for (const level of pyramid.levels ?? []) {
    assert(level.width > previousWidth, `${datasetId}/${level.id} does not improve source display resolution.`);
    assert(level.minimumZoom > previousMinimumZoom, `${datasetId}/${level.id} has an invalid activation threshold.`);
    assert(level.width / level.height === 1200 / 650, `${datasetId}/${level.id} has a mismatched projection aspect ratio.`);
    assert(level.displayMetresPerPixel >= 1000, `${datasetId}/${level.id} implies more detail than the original source provides.`);
    let levelBytes = 0;
    for (const tile of level.tiles ?? []) {
      assert(!tileIds.has(tile.id), `${datasetId} has duplicate tile ${tile.id}.`);
      tileIds.add(tile.id);
      assert(tile.width <= 1200 && tile.height <= 1300, `${datasetId}/${tile.id} exceeds its bounded decode size.`);
      assert(tile.width * tile.height * 4 <= pyramid.maximumDecodedTileBytes, `${datasetId}/${tile.id} exceeds the documented memory bound.`);
      const [x, y, width, height] = tile.viewBox;
      assert(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1200 && y + height <= 650, `${datasetId}/${tile.id} has an invalid destination rectangle.`);
      assert(Math.abs(tile.width / width - level.width / 1200) < 0.0001, `${datasetId}/${tile.id} has a misaligned x scale.`);
      assert(Math.abs(tile.height / height - level.height / 650) < 0.0001, `${datasetId}/${tile.id} has a misaligned y scale.`);
      await checkAsset(tile, `${datasetId}/${tile.id}`);
      levelBytes += tile.bytes;
    }
    assert(levelBytes === level.bytes, `${datasetId}/${level.id} has a mismatched payload budget.`);
    previousWidth = level.width;
    previousMinimumZoom = level.minimumZoom;
  }
  assert(tileIds.size > 0, `${datasetId} has no independently generated detail tiles.`);
  return tileIds.size;
}

const sourceLock = await readJson(SOURCE_LOCK_PATH);
const geographyPack = await readJson(GEOGRAPHY_PACK_PATH);
const patternNotes = await readJson(PATTERN_NOTES_PATH);
const countrySnapshot = await readJson(COUNTRIES_PATH);
const layerCatalog = await readJson(LAYER_CATALOG_PATH);

assert(sourceLock.schemaVersion === "1.0.0", "Unexpected Atlas source-lock schema version.");
assert(geographyPack.schemaVersion === "1.0.0", "Unexpected geography-pack schema version.");
assert(patternNotes.schemaVersion === "1.0.0", "Unexpected contextual-annotation schema version.");
assert(
  geographyPack.sourceLockId === sourceLock.lockId,
  "Geography pack does not identify the checked-in source lock.",
);
assert(geographyPack.projection.id === "equal-earth", "Geography pack projection is not Equal Earth.");
assert(geographyPack.projection.crs === "+proj=eqearth +R=6371007.180918475 +units=m +no_defs", "Geography rasters must use the exact spherical Equal Earth formula used by SVG, not ellipsoidal EPSG:8857.");
assert(geographyPack.projection.registrationChecks?.length === 4, "Geography pack is missing raster/SVG landmark registration evidence.");
for (const check of geographyPack.projection.registrationChecks ?? []) {
  assert(check.maximumErrorViewBoxUnits <= 0.008, `Raster/SVG geometry is misaligned at ${check.name}.`);
}
assert(geographyPack.projection.canonicalCrs === "EPSG:4326", "Geography pack has an unexpected canonical CRS.");
assert(
  geographyPack.projection.transformationId === "wgs84-to-equal-earth-svg-v1",
  "Geography pack has an unexpected vector transformation.",
);

const lockedSources = new Map(sourceLock.sources.map((source) => [source.id, source]));
assert(lockedSources.size === sourceLock.sources.length, "Source lock contains duplicate source IDs.");
assert(sourceLock.sources.length === 12, `Expected 12 locked Atlas sources; found ${sourceLock.sources.length}.`);
const sourceSeedRoot = path.resolve(REPOSITORY_ROOT, "data", "atlas", "source-seeds");
for (const source of sourceLock.sources.filter((candidate) => candidate.embeddedSnapshot)) {
  const seedPath = path.resolve(REPOSITORY_ROOT, source.embeddedSnapshot);
  const relativeSeed = path.relative(sourceSeedRoot, seedPath);
  assert(
    Boolean(relativeSeed) && !relativeSeed.startsWith("..") && !path.isAbsolute(relativeSeed),
    `Embedded snapshot for ${source.id} escapes data/atlas/source-seeds.`,
  );
  let seedBytes;
  try {
    seedBytes = await readFile(seedPath);
  } catch {
    failures.push(`Embedded snapshot for ${source.id} does not exist.`);
    continue;
  }
  assert(seedBytes.byteLength === source.expectedBytes, `Embedded snapshot for ${source.id} has the wrong byte count.`);
  assert(
    createHash("sha256").update(seedBytes).digest("hex") === source.checksumSha256,
    `Embedded snapshot for ${source.id} has the wrong checksum.`,
  );
}
const lockedBuildIds = unique(sourceLock.builds.map((build) => build.id), "source-lock build IDs");
assert(lockedBuildIds.has("atlas-world-snapshot-v1"), "Source lock is missing the V1 build recipe.");
assert(lockedBuildIds.has("atlas-geography-pack-v1"), "Source lock is missing the geography build recipe.");
for (const build of sourceLock.builds) {
  assert(Array.isArray(build.transformations) && build.transformations.length > 0, `Build ${build.id} has no transformation metadata.`);
  assert(Array.isArray(build.outputs) && build.outputs.length > 0, `Build ${build.id} has no declared outputs.`);
  for (const sourceId of build.sourceIds ?? []) {
    assert(lockedSources.has(sourceId), `Build ${build.id} references unknown source ${sourceId}.`);
  }
}
const geographyBuild = sourceLock.builds.find((build) => build.id === "atlas-geography-pack-v1");
const requirementsBytes = await readFile(GEOGRAPHY_REQUIREMENTS_PATH);
const normalizedRequirements = requirementsBytes.toString("utf8").replaceAll("\r\n", "\n");
const requirementsDigest = createHash("sha256").update(normalizedRequirements).digest("hex");
assert(
  geographyBuild?.requirements?.normalizedTextChecksumSha256 === requirementsDigest,
  "Geography Python requirements no longer match the source-lock build recipe.",
);

for (const source of geographyPack.sources) {
  const locked = lockedSources.get(source.id);
  assert(Boolean(locked), `Geography pack source ${source.id} is not in sources.lock.json.`);
  if (!locked) continue;
  assert(
    locked.checksumSha256 === source.checksumSha256,
    `Geography pack source ${source.id} checksum differs from the source lock.`,
  );
  assert(locked.url === source.url, `Geography pack source ${source.id} URL differs from the source lock.`);
  assert(locked.version === source.version, `Geography pack source ${source.id} version differs from the source lock.`);
  assert(Boolean(locked.license?.name && locked.license?.url), `Locked source ${source.id} has no license metadata.`);
}

const datasets = new Map(geographyPack.datasets.map((dataset) => [dataset.id, dataset]));
assert(datasets.size === geographyPack.datasets.length, "Geography pack contains duplicate dataset IDs.");
for (const expectedId of EXPECTED_DATASET_IDS) {
  assert(datasets.has(expectedId), `Geography pack is missing dataset ${expectedId}.`);
}

const transformations = new Map(
  geographyPack.transformations.map((transformation) => [transformation.id, transformation]),
);
assert(
  transformations.size === geographyPack.transformations.length,
  "Geography pack contains duplicate transformation IDs.",
);
let detailTileCount = 0;
for (const dataset of geographyPack.datasets) {
  validateTemporal(dataset.temporal, `dataset ${dataset.id}`);
  assert(Boolean(dataset.measure), `Dataset ${dataset.id} has no measure description.`);
  assert(Boolean(dataset.geographicResolution), `Dataset ${dataset.id} has no geographic resolution.`);
  assert(Boolean(dataset.conceptualResolution), `Dataset ${dataset.id} has no conceptual resolution.`);
  assert(
    transformations.has(dataset.transformationId),
    `Dataset ${dataset.id} references unknown transformation ${dataset.transformationId}.`,
  );
  assert(Array.isArray(dataset.caveats) && dataset.caveats.length > 0, `Dataset ${dataset.id} has no caveats.`);
  assert(Array.isArray(dataset.sourceIds) && dataset.sourceIds.length > 0, `Dataset ${dataset.id} has no source IDs.`);
  for (const sourceId of dataset.sourceIds ?? []) {
    assert(lockedSources.has(sourceId), `Dataset ${dataset.id} references unknown source ${sourceId}.`);
  }
  if (dataset.asset) await checkAsset(dataset.asset, dataset.id);
  if (dataset.assetPyramid) detailTileCount += await checkPyramid(dataset.assetPyramid, dataset.id);
}
assert(datasets.get("population-density-2025")?.assetPyramid, "Population density has no genuine source-detail pyramid.");
const populationColorStops = datasets.get("population-density-2025")?.visualization?.stops ?? [];
const populationLegend = layerCatalog.layers.find((layer) => layer.id === "population-density-2025")?.legend;
assert(
  JSON.stringify(populationColorStops.map((stop) => stop.color)) === JSON.stringify(populationLegend?.stops?.map((stop) => stop.color)),
  "Population density legend colors disagree with the generated raster palette.",
);

const countryIds = new Set(countrySnapshot.countries.map((country) => country.id));
assert(countryIds.size === 242, `Expected the preserved 242-country ontology; found ${countryIds.size}.`);

const collectionByDatasetId = new Map();
const featureIds = [];
for (const collection of Object.values(geographyPack.featureCollections)) {
  collectionByDatasetId.set(collection.datasetId, collection);
  const dataset = datasets.get(collection.datasetId);
  assert(Boolean(dataset), `Feature collection references unknown dataset ${collection.datasetId}.`);
  assert(
    dataset?.featureCount === collection.features.length,
    `${collection.datasetId} featureCount does not match the collection.`,
  );
  assert(
    collection.features.length === EXPECTED_DATASET_COUNTS[collection.datasetId],
    `${collection.datasetId} expected ${EXPECTED_DATASET_COUNTS[collection.datasetId]} features; found ${collection.features.length}.`,
  );

  for (const feature of collection.features) {
    const label = `${collection.datasetId} feature ${feature.featureId ?? "<missing>"}`;
    featureIds.push(feature.featureId);
    assert(feature.kind === dataset.dataType.replace("line", "river").replace("polygon", "lake").replace("point", "city"), `${label} has an unexpected kind.`);
    assert(Array.isArray(feature.sourceIds) && feature.sourceIds.length > 0, `${label} has no source IDs.`);
    for (const sourceId of feature.sourceIds ?? []) {
      assert(dataset.sourceIds.includes(sourceId), `${label} source ${sourceId} is not owned by its dataset.`);
    }
    validateTemporal(feature.temporal, label);
    validateGeometry(feature.geometry, label);
    if (collection.datasetId === "major-cities" && feature.population) {
      assert(feature.population.status === "estimated", `${label} population must remain marked estimated.`);
      assert(feature.population.unit === "people", `${label} population is not normalized to people.`);
      assert(
        Number.isInteger(feature.population.value) && feature.population.value >= 1_000,
        `${label} has an implausible normalized population value.`,
      );
      assert(
        feature.population.value % 1_000 === 0,
        `${label} POP2025 value was not converted from Natural Earth's thousands-of-people series.`,
      );
      assert(
        feature.population.sourceField === "POP2025 (thousands; converted to people)",
        `${label} does not preserve the POP2025 unit conversion in provenance.`,
      );
    }
    if (feature.entity?.parentId) {
      assert(countryIds.has(feature.entity.parentId), `${label} has unknown parent ${feature.entity.parentId}.`);
      validateTemporal(feature.entity.temporal, `${label} entity`);
    }
  }
}

const paris = collectionByDatasetId.get("major-cities")?.features
  .find((feature) => feature.name === "Paris");
assert(
  paris?.population?.value === 10_031_000,
  "Paris POP2025 should verify the thousands-to-people conversion (10,031,000).",
);
const knownFeatureIds = unique(featureIds, "geography feature IDs");

const noteIds = unique(patternNotes.notes.map((note) => note.id), "contextual annotation IDs");
assert(noteIds.size === 4, `Expected four reviewed contextual annotations; found ${noteIds.size}.`);
for (const expectedId of EXPECTED_NOTE_IDS) {
  assert(noteIds.has(expectedId), `Missing contextual annotation ${expectedId}.`);
}

for (const note of patternNotes.notes) {
  const label = `contextual annotation ${note.id}`;
  assert(note.modelName === undefined, `${label} should not define a user-facing model name.`);
  assert(note.review?.status === "source-reviewed", `${label} is not source-reviewed.`);
  assert(note.review?.reviewerKind === "ai-assisted", `${label} does not identify its review method.`);
  assert(
    note.review?.humanEditorialReview === "not-performed",
    `${label} overstates human editorial review.`,
  );
  assert(note.review?.publicationStatus === "atlas-visible", `${label} is not explicitly approved for the Atlas surface.`);
  validateTemporal(note.temporal, label);
  assert(Array.isArray(note.evidence) && note.evidence.length > 0, `${label} has no evidence.`);
  for (const evidence of note.evidence ?? []) {
    assert(/^https:\/\//.test(evidence.url), `${label} evidence ${evidence.id} does not use HTTPS.`);
    assert(Boolean(evidence.publisher && evidence.title && evidence.supports), `${label} has incomplete evidence metadata.`);
  }
  for (const datasetId of note.triggers?.datasetIds ?? []) {
    assert(datasets.has(datasetId), `${label} triggers unknown dataset ${datasetId}.`);
  }
  for (const observationRef of note.observationRefs ?? []) {
    assert(datasets.has(observationRef.datasetId), `${label} references unknown observation dataset ${observationRef.datasetId}.`);
  }
  for (const entityId of note.spatial?.entityIds ?? []) {
    assert(countryIds.has(entityId), `${label} references unknown country ${entityId}.`);
  }
  for (const layerId of note.relatedLayerIds ?? []) {
    assert(datasets.has(layerId), `${label} references unknown supporting layer dataset ${layerId}.`);
  }

  const authoredIds = new Set();
  if (note.spatial?.highlight?.type === "authored-geometry") {
    const authoredGeometry = note.spatial.highlight.geometry;
    const authoredFeatureId = authoredGeometry?.geometryId?.replace(/^geometry:/, "").replace(/:wgs84$/, "");
    if (authoredFeatureId) authoredIds.add(authoredFeatureId);
    validateGeometry(authoredGeometry, `${label} authored highlight`);
  }
  for (const featureId of note.spatial?.featureIds ?? []) {
    assert(
      knownFeatureIds.has(featureId) || authoredIds.has(featureId),
      `${label} references unknown feature ${featureId}.`,
    );
  }
}

const worldBuilder = await readFile(WORLD_BUILDER_PATH, "utf8");
assert(
  worldBuilder.includes('"data", "atlas", "source-cache"'),
  "World snapshot builder no longer defaults to the repository-local source cache.",
);
assert(!/LOCALAPPDATA|\\bTemp\\b/.test(worldBuilder), "World snapshot builder still contains a temp-directory dependency.");

for (const filePath of [SOURCE_LOCK_PATH, GEOGRAPHY_PACK_PATH, PATTERN_NOTES_PATH]) {
  const details = await stat(filePath);
  assert(details.size > 0, `${path.relative(REPOSITORY_ROOT, filePath)} is empty.`);
}

if (warnings.length > 0) {
  for (const warning of warnings) console.warn(`warning: ${warning}`);
}

if (failures.length > 0) {
  console.error(`Atlas geography validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Atlas geography validation passed: ${datasets.size} datasets, ${knownFeatureIds.size} vector features, ${noteIds.size} contextual annotations, 2 overview rasters, ${detailTileCount} source-detail tiles.`,
  );
}
