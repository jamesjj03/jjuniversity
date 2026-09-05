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
const VECTOR_REQUIREMENTS_PATH = path.join(
  REPOSITORY_ROOT,
  "scripts",
  "atlas-vector-requirements.txt",
);

const EXPECTED_DATASET_COUNTS = {
  "major-rivers": 1311,
  "major-lakes": 511,
  "major-cities": 1140,
  "major-water-bodies": 112,
  "watershed-pilot": 5,
};
const EXPECTED_DATASET_IDS = new Set([
  "population-density-2025",
  "physical-relief",
  "major-rivers",
  "major-lakes",
  "major-cities",
  "major-water-bodies",
  "watershed-pilot",
]);
const EXPECTED_FEATURE_KINDS = {
  "major-rivers": "river",
  "major-lakes": "lake",
  "major-cities": "city",
  "major-water-bodies": "water",
  "watershed-pilot": "watershed",
};
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
  assert(derived?.projectionId === "mercator", `${label} has no Mercator derivative.`);
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
  const [x, y, width, height] = asset.viewBox;
  const extendsBeyondSphere = x < 289 || y < 14 || x + width > 911 || y + height > 636;
  if (extendsBeyondSphere) assert(metadata.hasAlpha === true, `${datasetId} asset must retain alpha outside the Mercator sphere.`);
}

async function checkRegisteredFile(asset, label) {
  const assetPath = assetPathFromHref(asset.href);
  let bytes;
  try {
    bytes = await readFile(assetPath);
  } catch {
    failures.push(`${label} does not exist: ${asset.href}`);
    return null;
  }
  assert(bytes.byteLength === asset.bytes, `${label} byte count does not match its manifest.`);
  assert(
    createHash("sha256").update(bytes).digest("hex") === asset.checksumSha256,
    `${label} checksum does not match its manifest.`,
  );
  return bytes;
}

async function checkPyramid(pyramid, datasetId) {
  const relief = datasetId === "physical-relief";
  assert(pyramid.projectionId === "mercator", `${datasetId} pyramid is not aligned to Mercator.`);
  if (relief) {
    assert(Math.abs(pyramid.sourceResolutionMetres - 3706.5) < 0.1, "Relief must preserve its approximate source pixel spacing, not claim DEM accuracy.");
    assert(JSON.stringify(pyramid.nativeSourceDimensions) === "[10800,5400]", "Relief lost its original source dimensions.");
    assert(pyramid.sourcePixelDegrees?.every((value) => Math.abs(value - 1 / 30) < 0.000001), "Relief source angular resolution is incorrect.");
    assert(pyramid.sourceCrs === "EPSG:4326" && pyramid.resampling === "bilinear", "Relief must be directly bilinearly resampled from the WGS84 source.");
    assert(pyramid.levels?.length === 1 && pyramid.levels[0].id === "source-detail", "Relief must expose the single bounded source-detail level.");
    assert(JSON.stringify(pyramid.levels?.map((level) => level.minimumZoom)) === "[8]", "Relief detail starts at the reviewed zoom-8 budget.");
    assert(pyramid.maximumDecodedTileBytes === 2_080_000, "Relief tiles must retain their 800×650 decode ceiling.");
  } else {
    assert(pyramid.sourceResolutionMetres === 1000, `${datasetId} lost its original one-kilometre source resolution.`);
    assert(pyramid.resampling === "average", `${datasetId} pyramid must preserve area-average resampling.`);
    assert(pyramid.levels?.length === 3, `${datasetId} must provide regional, country and close detail levels.`);
    assert(JSON.stringify(pyramid.levels?.map((level) => level.minimumZoom)) === "[4,10,20]", `${datasetId} detail activation must retain the verified viewport memory budget.`);
  }
  let previousWidth = 2400;
  let previousMinimumZoom = 1;
  const tileIds = new Set();
  for (const level of pyramid.levels ?? []) {
    assert(level.width > previousWidth, `${datasetId}/${level.id} does not improve source display resolution.`);
    assert(level.minimumZoom > previousMinimumZoom, `${datasetId}/${level.id} has an invalid activation threshold.`);
    assert(level.width / level.height === 1200 / 650, `${datasetId}/${level.id} has a mismatched projection aspect ratio.`);
    assert(level.displayMetresPerPixel >= pyramid.sourceResolutionMetres, `${datasetId}/${level.id} implies more detail than the original source provides.`);
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
    if (relief) {
      assert(levelBytes <= 35_000_000, "Relief detail exceeds its reviewed 35 MB global compressed budget.");
      assert(level.width === 19200 && level.height === 10400, "Relief source-detail dimensions changed without reviewing the source/decode budget.");
      for (const [name, viewportWidth, viewportHeight, maximumTiles] of [["desktop meet", 1200, 750, 16], ["phone slice", 320, 650, 8]]) {
        const width = viewportWidth / level.minimumZoom, height = viewportHeight / level.minimumZoom;
        const startsX = [...new Set(level.tiles.flatMap((tile) => [tile.viewBox[0] - .01, tile.viewBox[0] + .01]))];
        const startsY = [...new Set(level.tiles.flatMap((tile) => [tile.viewBox[1] - .01, tile.viewBox[1] + .01]))];
        let maximumCount = 0;
        for (const x of startsX) for (const y of startsY) {
          maximumCount = Math.max(maximumCount, level.tiles.filter((tile) => {
            const [left, top, tileWidth, tileHeight] = tile.viewBox;
            return left < x + width && left + tileWidth > x && top < y + height && top + tileHeight > y;
          }).length);
        }
        assert(maximumCount <= maximumTiles, `Relief ${name} exceeds the reviewed visible tile/decode budget: ${maximumCount}.`);
      }
    }
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
assert(geographyPack.buildStatus !== "development-overview-only", "Development overview-only pack must be replaced by a complete source-detail build before release.");
assert(patternNotes.schemaVersion === "1.0.0", "Unexpected contextual-annotation schema version.");
assert(
  geographyPack.sourceLockId === sourceLock.lockId,
  "Geography pack does not identify the checked-in source lock.",
);
assert(geographyPack.projection.id === "mercator", "Geography pack projection is not Mercator.");
assert(geographyPack.projection.crs === "+proj=merc +R=6371007.180918475 +units=m +no_defs", "Geography rasters must use the exact spherical Mercator formula used by SVG.");
assert(geographyPack.projection.registrationChecks?.length === 4, "Geography pack is missing raster/SVG landmark registration evidence.");
for (const check of geographyPack.projection.registrationChecks ?? []) {
  assert(check.maximumErrorViewBoxUnits <= 0.008, `Raster/SVG geometry is misaligned at ${check.name}.`);
}
assert(geographyPack.projection.canonicalCrs === "EPSG:4326", "Geography pack has an unexpected canonical CRS.");
assert(
  geographyPack.projection.transformationId === "wgs84-to-mercator-svg-v1",
  "Geography pack has an unexpected vector transformation.",
);

const lockedSources = new Map(sourceLock.sources.map((source) => [source.id, source]));
assert(lockedSources.size === sourceLock.sources.length, "Source lock contains duplicate source IDs.");
assert(sourceLock.sources.length >= 15, `Expected at least the 15 Phase 2 Atlas sources; found ${sourceLock.sources.length}.`);
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
  `Geography Python requirements no longer match the source-lock build recipe (lock ${geographyBuild?.requirements?.normalizedTextChecksumSha256 ?? "missing"}; file ${requirementsDigest}).`,
);
const vectorRequirementsBytes = await readFile(VECTOR_REQUIREMENTS_PATH);
const normalizedVectorRequirements = vectorRequirementsBytes.toString("utf8").replaceAll("\r\n", "\n");
const vectorRequirementsDigest = createHash("sha256").update(normalizedVectorRequirements).digest("hex");
assert(
  geographyBuild?.vectorOnlyRequirements?.normalizedTextChecksumSha256 === vectorRequirementsDigest,
  "Geography vector-only Python requirements no longer match the source-lock build recipe.",
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
assert(datasets.get("physical-relief")?.assetPyramid, "Relief has no genuine source-detail pyramid.");
assert(datasets.get("physical-relief")?.visualization?.shadowContrast === 1, "Relief must preserve source grayscale without added terrain-like contrast.");
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
    assert(feature.kind === EXPECTED_FEATURE_KINDS[collection.datasetId], `${label} has an unexpected kind.`);
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
for (const [name, minimumZoom] of [["Ivindo", 16], ["Ogooué", 20], ["Ngounie", 20]]) {
  const records = collectionByDatasetId.get("major-rivers")?.features.filter((feature) => feature.name === name) ?? [];
  assert(records.length > 0, `Gabon source detail is missing ${name}.`);
  assert(records.every((feature) => feature.displayMinimumZoom === minimumZoom && feature.sourceIds.includes("natural-earth-rivers-10m-5.1.2")), `${name} must retain its real source and close-scale visibility.`);
}

const waterFeatures = collectionByDatasetId.get("major-water-bodies")?.features ?? [];
const waterPlaceIds = new Set(waterFeatures.map((feature) => feature.placeId));
assert(waterPlaceIds.size < waterFeatures.length, "Major-water pack should preserve multipart logical identities.");
for (const feature of waterFeatures) {
  const label = `water feature ${feature.featureId}`;
  assert(["ocean", "sea", "gulf", "bay", "strait", "channel"].includes(feature.waterKind), `${label} has an unsupported class.`);
  assert(feature.sourceScaleRank <= 4, `${label} exceeds the bounded source rank.`);
  assert(feature.entityRelation?.kind === "coastline_adjacent_to_mapped_admin0_geometry", `${label} does not use explicit coastline-adjacency wording.`);
  assert(/not ownership/i.test(feature.entityRelation?.caveat ?? ""), `${label} does not explicitly reject ownership inference.`);
  assert(feature.label?.method === "representative-point-within-source-polygon", `${label} has no reproducible label-anchor method.`);
  assert(Number.isFinite(feature.label?.priority) && Number.isFinite(feature.label?.minimumZoom), `${label} lacks label priority/zoom metadata.`);
  for (const entityId of feature.adjacentEntityIds ?? []) assert(countryIds.has(entityId), `${label} has unknown adjacent entity ${entityId}.`);
}
for (const name of ["Atlantic Ocean", "Pacific Ocean", "Mediterranean Sea", "Gulf of Mexico", "Strait of Gibraltar", "English Channel"]) {
  assert(waterFeatures.some((feature) => feature.name === name), `Major-water pack is missing ${name}.`);
}

const watershedFeatures = collectionByDatasetId.get("watershed-pilot")?.features ?? [];
assert(
  JSON.stringify(watershedFeatures.map((feature) => feature.name).sort()) === JSON.stringify([
    "Amazon drainage basin",
    "Danube drainage basin",
    "Mississippi drainage basin",
    "Nile drainage basin",
    "Yangtze drainage basin",
  ]),
  "Watershed pilot does not contain the exact five approved logical basins.",
);
for (const feature of watershedFeatures) {
  assert(feature.entityRelation?.kind === "intersects_mapped_admin0_geometry", `${feature.name} has an unclear country relation.`);
  assert(/not imply ownership/i.test(feature.entityRelation?.caveat ?? ""), `${feature.name} does not reject ownership inference.`);
  assert(feature.linkedRiverPlaceId?.startsWith("place:natural-earth:river:"), `${feature.name} is not linked to a river place.`);
  assert(feature.sourceFeatureIds?.every((id) => /^BASWC4_ID:\d+$/.test(id)), `${feature.name} lost World Bank source IDs.`);
}

const riverFactFeatures = collectionByDatasetId.get("major-rivers")?.features.filter((feature) => feature.facts) ?? [];
assert(riverFactFeatures.length === 5, `Expected five River V2 fact anchors; found ${riverFactFeatures.length}.`);
for (const feature of riverFactFeatures) {
  const facts = feature.facts;
  assert(facts.lengthKm?.value > 0 && facts.basinAreaKm2?.value > 0, `${feature.placeId} lacks sourced length or basin area.`);
  assert(facts.mouthPlace?.value && facts.basinName?.value, `${feature.placeId} lacks sourced mouth or basin.`);
  assert(facts.headwaters?.value?.length > 0 && facts.majorTributaries?.value?.length > 0, `${feature.placeId} lacks headwater or tributary context.`);
  assert(!Object.hasOwn(facts, "discharge"), `${feature.placeId} publishes non-comparable discharge.`);
  for (const fact of Object.values(facts)) {
    if (!fact) continue;
    assert(fact.sourceIds?.length > 0 && fact.sourceStatementIds?.length > 0, `${feature.placeId} fact lost statement provenance.`);
  }
}

const relationshipIds = unique((geographyPack.placeRelationships ?? []).map((relationship) => relationship.id), "place relationship IDs");
assert(relationshipIds.size === 6, `Expected six bounded city/geography proximity relationships; found ${relationshipIds.size}.`);
for (const relationship of geographyPack.placeRelationships ?? []) {
  assert(relationship.kind === "near_mapped_geometry", `${relationship.id} overstates its relationship semantics.`);
  assert(relationship.distanceKm <= relationship.evidence?.thresholdKm, `${relationship.id} exceeds its reviewed distance threshold.`);
  assert(/does not by itself assert/i.test(relationship.evidence?.caveat ?? ""), `${relationship.id} lacks an epistemic caveat.`);
}

for (const level of ["overview", "detail"]) {
  const asset = geographyPack.physicalGeometryAssets?.[level];
  assert(Boolean(asset), `Physical geography is missing its separately cached ${level} SVG.`);
  if (!asset) continue;
  const bytes = await readFile(assetPathFromHref(asset.href));
  assert(bytes.length === asset.bytes, `Physical ${level} SVG byte count differs from its manifest.`);
  assert(createHash("sha256").update(bytes).digest("hex") === asset.checksumSha256, `Physical ${level} SVG checksum differs from its manifest.`);
  const expected = [...geographyPack.featureCollections.majorRivers.features, ...geographyPack.featureCollections.majorLakes.features]
    .filter((feature) => (feature.displayMaximumZoom != null) === (level === "overview"));
  assert(expected.length === asset.featureCount, `Physical ${level} SVG feature count is incorrect.`);
  const svg = bytes.toString("utf8");
  for (const feature of expected) {
    const id = feature.featureId.replace(/[^A-Za-z0-9_-]/g, "-");
    assert(svg.includes(`id="${id}" d="${feature.geometry.derived.path}"`), `${feature.featureId} differs from its cached SVG geometry.`);
  }
}

for (const [manifestKey, collectionId, label] of [
  ["waterGeometryAsset", "major-water-bodies", "Water geometry SVG"],
  ["watershedGeometryAsset", "watershed-pilot", "Watershed geometry SVG"],
]) {
  const asset = geographyPack[manifestKey];
  assert(Boolean(asset), `${label} is not registered.`);
  if (!asset) continue;
  const bytes = await checkRegisteredFile(asset, label);
  const expected = collectionByDatasetId.get(collectionId)?.features ?? [];
  assert(asset.featureCount === expected.length, `${label} feature count is incorrect.`);
  const svg = bytes?.toString("utf8") ?? "";
  for (const feature of expected) {
    const id = feature.featureId.replace(/[^A-Za-z0-9_-]/g, "-");
    assert(svg.includes(`id="${id}" d="${feature.geometry.derived.path}"`), `${feature.featureId} differs from ${label}.`);
  }
}

const globeContextManifest = geographyPack.globeContextAsset;
assert(Boolean(globeContextManifest), "Compact WGS84 globe context is not registered.");
if (globeContextManifest) {
  const bytes = await checkRegisteredFile(globeContextManifest, "WGS84 globe context");
  let globeContext;
  try {
    globeContext = JSON.parse(bytes?.toString("utf8") ?? "");
  } catch {
    failures.push("WGS84 globe context is not valid JSON.");
  }
  if (globeContext) {
    assert(globeContext.canonicalCrs === "EPSG:4326", "Globe context is not canonical WGS84.");
    assert(globeContext.sourceLockId === sourceLock.lockId, "Globe context does not identify the source lock.");
    assert(globeContext.rivers.length === globeContextManifest.riverCount, "Globe river count differs from its manifest.");
    assert(globeContext.cities.length === globeContextManifest.cityCount, "Globe city count differs from its manifest.");
    assert(globeContext.waterLabels.length === globeContextManifest.waterLabelCount, "Globe water-label count differs from its manifest.");
    assert(bytes.byteLength < 200_000, `Globe context exceeds the reviewed phone budget (${bytes.byteLength} bytes).`);
    for (const river of globeContext.rivers) visitCoordinates(river.geometry.coordinates, ([longitude, latitude]) => {
      assert(longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90, `${river.featureId} has invalid globe coordinates.`);
    });
    for (const point of [...globeContext.cities, ...globeContext.waterLabels]) {
      const coordinates = point.coordinates;
      assert(Array.isArray(coordinates) && coordinates[0] >= -180 && coordinates[0] <= 180 && coordinates[1] >= -90 && coordinates[1] <= 90, `${point.placeId} has invalid globe coordinates.`);
    }
  }
}

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
