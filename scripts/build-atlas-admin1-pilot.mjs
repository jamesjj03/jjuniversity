#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ID = "natural-earth-admin-1-10m-repository-5.1.2";
const CENSUS_SOURCE_ID = "us-census-population-estimates-2024-admin1";
const SNAPSHOT_ID = "atlas-admin1-pilot-natural-earth-5.1.1";
const GEOMETRY_SET_ID = "natural-earth-admin1-10m-default-view-5.1.1";
const GENERATED_AT = process.env.ATLAS_GENERATED_AT || "2026-09-05T06:30:00Z";
const VIEWBOX = [0, 0, 1200, 650];
const LATITUDE_LIMIT = 85.0511287798066;
const PROJECTION_SCALE = 622 / (2 * Math.PI);
const PILOT_COUNTRIES = new Map([
  ["USA", "United States"], ["DEU", "Germany"], ["IND", "India"],
  ["CHN", "China"], ["CAN", "Canada"], ["NGA", "Nigeria"],
]);
const EXPECTED_COUNTS = new Map([
  ["USA", 51], ["DEU", 16], ["IND", 36], ["CHN", 31], ["CAN", 13], ["NGA", 37],
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const lock = JSON.parse(await readFile(path.join(root, "data/atlas/sources.lock.json"), "utf8"));
const source = lock.sources.find((entry) => entry.id === SOURCE_ID);
if (!source) throw new Error(`Atlas source lock is missing ${SOURCE_ID}.`);
const censusSource = lock.sources.find((entry) => entry.id === CENSUS_SOURCE_ID);
if (!censusSource) throw new Error(`Atlas source lock is missing ${CENSUS_SOURCE_ID}.`);
const sourcePath = path.join(root, lock.cacheDirectory, source.target);
const censusSourcePath = path.join(root, lock.cacheDirectory, censusSource.target);
const output = {
  canonical: path.join(root, "data/atlas/derived/admin1-pilot-wgs84.v1.geojson"),
  manifest: path.join(root, "lib/atlas-world/data/admin1-pilot.v1.json"),
  svg: path.join(root, "public/atlas-world/admin1-pilot-mercator.v1.svg"),
};

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const round = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
};

function project([longitude, latitude]) {
  const phi = Math.max(-LATITUDE_LIMIT, Math.min(LATITUDE_LIMIT, latitude)) * Math.PI / 180;
  return [
    round(600 + longitude * Math.PI / 180 * PROJECTION_SCALE),
    round(325 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) * PROJECTION_SCALE),
  ];
}

function visitCoordinates(value, callback) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    callback(value);
  } else {
    value.forEach((child) => visitCoordinates(child, callback));
  }
}

function bounds(geometry, transform = (coordinate) => coordinate) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  visitCoordinates(geometry.coordinates, (coordinate) => {
    const [x, y] = transform(coordinate);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  assert(Number.isFinite(x0), "Admin-1 source geometry has no coordinates.");
  return [[round(x0, 6), round(y0, 6)], [round(x1, 6), round(y1, 6)]];
}

function ringPath(ring) {
  return ring.map((coordinate, index) => {
    const [x, y] = project(coordinate);
    return `${index ? "L" : "M"}${x},${y}`;
  }).join("") + "Z";
}

function projectedPath(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates.map(ringPath).join("");
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.map(ringPath)).join("");
  throw new Error(`Unsupported Admin-1 geometry: ${geometry.type}.`);
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function nameFor(properties) {
  // Avoid the source's ambiguous English label "Washington", which collides
  // with Washington state. The primary name retains District of Columbia.
  if (properties.iso_3166_2 === "US-DC") return properties.name;
  return properties.name_en || properties.name;
}

function aliasesFor(properties, name) {
  const values = [properties.name, properties.name_en, properties.name_local,
    properties.gn_name, properties.woe_name, properties.abbrev, properties.postal,
    ...(typeof properties.name_alt === "string" ? properties.name_alt.split("|") : [])];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(
    (value) => value && value.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US"),
  ))].sort((left, right) => left.localeCompare(right, "en"));
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

const [sourceBytes, censusBytes] = await Promise.all([readFile(sourcePath), readFile(censusSourcePath)]);
assert(sourceBytes.byteLength === source.expectedBytes, "Admin-1 source byte length does not match the lock.");
assert(sha256(sourceBytes) === source.checksumSha256, "Admin-1 source checksum does not match the lock.");
assert(censusBytes.byteLength === censusSource.expectedBytes, "Census population source byte length does not match the lock.");
assert(sha256(censusBytes) === censusSource.checksumSha256, "Census population source checksum does not match the lock.");
const sourceGeoJson = JSON.parse(sourceBytes.toString("utf8"));
assert(sourceGeoJson.type === "FeatureCollection", "Admin-1 source is not GeoJSON.");
const censusPopulationByFips = new Map(parseCsv(censusBytes.toString("utf8"))
  .filter((row) => row.SUMLEV === "040" && /^\d{2}$/.test(row.STATE) && Number.isFinite(Number(row.POPESTIMATE2024)))
  .map((row) => [`US${row.STATE}`, { name: row.NAME, value: Number(row.POPESTIMATE2024) }]));

const considered = sourceGeoJson.features.filter((feature) => PILOT_COUNTRIES.has(feature.properties?.adm0_a3));
const eligible = (feature) => Number(feature.properties?.gadm_level) === 1
  && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(String(feature.properties?.iso_3166_2 ?? ""));
const excluded = considered.filter((feature) => !eligible(feature));
const records = considered.filter(eligible).map((rawFeature) => {
  const properties = rawFeature.properties;
  const parentCode = properties.adm0_a3;
  const isoCode = properties.iso_3166_2;
  const naturalEarthId = String(properties.ne_id);
  const name = nameFor(properties);
  const entityId = `admin1:${parentCode}:${isoCode}`;
  const featureId = `feature:natural-earth:admin1:${naturalEarthId}`;
  const assetId = `atlas-admin1-${naturalEarthId}`;
  const labelWgs84 = [Number(properties.longitude), Number(properties.latitude)];
  const sourceLabelRank = Number(properties.labelrank);
  const labelMinimumZoom = sourceLabelRank <= 2 ? 8 : sourceLabelRank <= 5 ? 12 : 16;
  const codes = [
    { scheme: "iso-3166-2", value: isoCode },
    { scheme: "natural-earth-adm1-code", value: String(properties.adm1_code) },
    { scheme: "natural-earth-ne-id", value: naturalEarthId },
    ...(properties.wikidataid ? [{ scheme: "wikidata", value: String(properties.wikidataid) }] : []),
    ...(Number(properties.gn_id) > 0 ? [{ scheme: "geonames", value: String(properties.gn_id) }] : []),
  ];
  const censusPopulation = parentCode === "USA" ? censusPopulationByFips.get(String(properties.fips)) ?? null : null;
  if (parentCode === "USA") {
    assert(censusPopulation, `${name}: no Census population matched Natural Earth FIPS ${String(properties.fips)}.`);
  }
  const common = {
    atlasEntityId: entityId,
    atlasParentId: `country:${parentCode}`,
    name,
    aliases: aliasesFor(properties, name),
    administrativeType: properties.type_en || properties.type || null,
    iso3166_2: isoCode,
    naturalEarthAdm1Code: properties.adm1_code || null,
    naturalEarthId,
    sourceId: SOURCE_ID,
  };
  return {
    canonical: { type: "Feature", id: featureId, properties: common, geometry: rawFeature.geometry },
    path: projectedPath(rawFeature.geometry),
    manifest: {
      featureId,
      kind: "administrative-unit",
      name,
      aliases: common.aliases,
      administrativeType: common.administrativeType,
      entity: {
        entityId, kind: "administrative-unit", parentId: `country:${parentCode}`,
        sovereignId: `country:${parentCode}`, countryId: `country:${parentCode}`,
        adminLevel: 1, codes, temporal: { validFrom: null, validTo: null },
      },
      sourceIds: [SOURCE_ID],
      sourceAdministrativeType: common.administrativeType,
      displayMinimumZoom: 6,
      labelMinimumZoom,
      label: { wgs84: labelWgs84, projected: project(labelWgs84) },
      temporal: { observedAt: null, validFrom: null, validTo: null, precision: "source_snapshot" },
      observations: {
        population: censusPopulation ? {
          value: censusPopulation.value,
          status: "estimated",
          unit: "people",
          temporal: { observedAt: "2024-07-01", validFrom: null, validTo: null, precision: "day" },
          sourceIds: [CENSUS_SOURCE_ID],
          sourceField: "POPESTIMATE2024",
          notes: [
            "U.S. Census Bureau Vintage 2024 estimate of resident population on July 1, 2024.",
            `Joined to ${name} through the Census state FIPS code retained by the Natural Earth boundary source.`,
          ],
        } : null,
      },
      geometry: {
        geometryId: `geometry:${featureId}:wgs84`, geometrySetId: GEOMETRY_SET_ID,
        geometryType: rawFeature.geometry.type.toLocaleLowerCase("en-US"), crs: "EPSG:4326",
        canonicalAsset: "data/atlas/derived/admin1-pilot-wgs84.v1.geojson",
        canonicalFeatureId: featureId, boundsWgs84: bounds(rawFeature.geometry),
        derived: {
          projectionId: "mercator", viewBox: VIEWBOX, transformationId: "wgs84-to-mercator-svg-v1",
          assetHref: "/atlas-world/admin1-pilot-mercator.v1.svg", assetId,
          bounds: bounds(rawFeature.geometry, project),
        },
      },
    },
  };
}).sort((left, right) => left.manifest.entity.entityId.localeCompare(right.manifest.entity.entityId));

for (const [countryCode, expected] of EXPECTED_COUNTS) {
  const actual = records.filter((record) => record.manifest.entity.countryId === `country:${countryCode}`).length;
  assert(actual === expected, `${countryCode}: expected ${expected} units; got ${actual}.`);
}
assert(records.length === 184, `Expected 184 Admin-1 units; got ${records.length}.`);
assert(excluded.length === 1 && excluded[0].properties.name === "Paracel Islands", "Unexpected pilot exclusion set.");

const canonical = {
  type: "FeatureCollection",
  name: "JJU Atlas bounded Admin-1 pilot - canonical WGS84 geometry",
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
  atlas: {
    schemaVersion: "1.0.0", snapshotId: SNAPSHOT_ID, generatedAt: GENERATED_AT,
    sourceLockId: lock.lockId, sourceId: SOURCE_ID, geometrySetId: GEOMETRY_SET_ID,
  },
  features: records.map((record) => record.canonical),
};
const canonicalText = `${JSON.stringify(canonical)}\n`;
const svg = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX.join(" ")}" data-snapshot-id="${SNAPSHOT_ID}"><defs>`,
  ...records.map((record) => `<path id="${record.manifest.geometry.derived.assetId}" d="${escapeXml(record.path)}" vector-effect="non-scaling-stroke"/>`),
  "</defs></svg>", "",
].join("\n");
const manifest = {
  schemaVersion: "1.0.0", snapshotId: SNAPSHOT_ID, generatedAt: GENERATED_AT,
  sourceLockId: lock.lockId,
  projection: { id: "mercator", viewBox: VIEWBOX, canonicalCrs: "EPSG:4326", transformationId: "wgs84-to-mercator-svg-v1" },
  pilot: {
    status: "bounded-pilot",
    countryIds: [...PILOT_COUNTRIES].map(([code]) => `country:${code}`),
    featureCount: records.length,
    coverageStatement: "First-order units for six pilot countries only; absence elsewhere means outside this pilot, not no subdivisions.",
    excludedSourceFeatures: excluded.map((feature) => ({
      sourceFeatureId: String(feature.properties.ne_id), sourceCode: feature.properties.iso_3166_2,
      name: feature.properties.name_en || feature.properties.name,
      reason: "Natural Earth classifies this record at GADM level 0 and supplies a non-standard provisional code.",
    })),
  },
  source: {
    id: source.id, title: source.title, publisher: source.publisher, version: source.version,
    url: source.url, retrievedAt: source.retrievedAt, license: source.license,
    checksumSha256: source.checksumSha256,
    sourcePerspective: "Natural Earth default de-facto cartographic view",
  },
  observationSources: [{
    id: censusSource.id, title: censusSource.title, publisher: censusSource.publisher,
    version: censusSource.version, url: censusSource.url, retrievedAt: censusSource.retrievedAt,
    license: censusSource.license, checksumSha256: censusSource.checksumSha256,
  }],
  observationDatasets: [{
    id: "us-admin1-population-2024", name: "United States state population",
    geographicResolution: "50 states and the District of Columbia in the bounded Admin-1 pilot",
    temporal: { support: "snapshot", observedAt: "2024-07-01", precision: "day", selectionPolicy: "exact" },
    sourceIds: [CENSUS_SOURCE_ID],
    coverage: { populatedFeatures: 51, totalPilotFeatures: records.length, countryIds: ["country:USA"] },
    caveats: [
      "This first observation pilot covers only United States states and the District of Columbia; other pilot countries remain explicitly unavailable.",
      "The values are Vintage 2024 estimates of resident population, not decennial census counts.",
      "Puerto Rico is a separate present-day Admin-0 Atlas entity and is not included among the United States Admin-1 features.",
    ],
  }],
  dataset: {
    id: "admin1-pilot-geography", name: "Subnational boundaries pilot",
    geographicResolution: "Natural Earth 1:10m first-order units in six pilot countries",
    conceptualResolution: "present-day cartographic Admin-1",
    temporal: { support: "snapshot", observedAt: null, validFrom: null, validTo: null, precision: "source_snapshot", selectionPolicy: "exact" },
    sourceIds: [SOURCE_ID], transformationId: "wgs84-to-mercator-svg-v1",
    canonicalAsset: {
      path: "data/atlas/derived/admin1-pilot-wgs84.v1.geojson", mediaType: "application/geo+json",
      bytes: Buffer.byteLength(canonicalText), checksumSha256: sha256(canonicalText), crs: "EPSG:4326",
    },
    derivedAsset: {
      href: "/atlas-world/admin1-pilot-mercator.v1.svg", mediaType: "image/svg+xml",
      bytes: Buffer.byteLength(svg), checksumSha256: sha256(svg), projectionId: "mercator", viewBox: VIEWBOX,
    },
    caveats: [
      "Natural Earth's default view is cartographic and de-facto; it is not an authority for legal claims.",
      "Administrative-type attributes can be stale or inconsistent. Atlas preserves source wording without turning it into a global legal taxonomy.",
      "This pilot covers six countries only. Missing geometry elsewhere means out of scope.",
    ],
  },
  features: records.map((record) => record.manifest),
};

await Promise.all(Object.values(output).map((filePath) => mkdir(path.dirname(filePath), { recursive: true })));
await Promise.all([
  writeFile(output.canonical, canonicalText),
  writeFile(output.manifest, `${JSON.stringify(manifest)}\n`),
  writeFile(output.svg, svg),
]);
const sizes = await Promise.all(Object.values(output).map(async (filePath) => (await stat(filePath)).size));
console.log(JSON.stringify({ snapshotId: SNAPSHOT_ID, countries: 6, features: 184, excluded: 1,
  canonicalBytes: sizes[0], manifestBytes: sizes[1], svgBytes: sizes[2] }, null, 2));
