#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "1.0.0";
const SNAPSHOT_DATE = process.env.ATLAS_SNAPSHOT_DATE || "2026-09-05";
const SNAPSHOT_ID = `atlas-world-${SNAPSHOT_DATE}`;
const GENERATED_AT = process.env.ATLAS_GENERATED_AT || "2026-09-05T05:58:58.533Z";
const RETRIEVED_AT = "2026-09-03";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const sourceCache = path.join(repositoryRoot, "data", "atlas", "source-cache");
const sourceLockPath = path.join(repositoryRoot, "data", "atlas", "sources.lock.json");

const inputs = {
  naturalEarth:
    process.env.ATLAS_NATURAL_EARTH_SOURCE ||
    path.join(sourceCache, "jju-atlas-ne-50m-v5.1.2.geojson"),
  worldBankCountries:
    process.env.ATLAS_WORLD_BANK_COUNTRIES_SOURCE ||
    path.join(sourceCache, "jju-atlas-wb-countries-20260903.json"),
  worldBankPopulation:
    process.env.ATLAS_WORLD_BANK_POPULATION_SOURCE ||
    path.join(sourceCache, "jju-atlas-wb-population-20260903.json"),
  worldBankGdp:
    process.env.ATLAS_WORLD_BANK_GDP_SOURCE ||
    path.join(sourceCache, "jju-atlas-wb-gdp-20260903.json"),
  worldBankGdpPerCapita:
    process.env.ATLAS_WORLD_BANK_GDP_PER_CAPITA_SOURCE ||
    path.join(sourceCache, "jju-atlas-wb-gdp-pc-20260903.json"),
  geonames:
    process.env.ATLAS_GEONAMES_SOURCE ||
    path.join(sourceCache, "jju-atlas-countryInfo-20260903.txt"),
  factbook:
    process.env.ATLAS_FACTBOOK_SOURCE ||
    path.join(sourceCache, "jju-atlas-factbook-20260903"),
};

const HOW_PEOPLE_LIVE_INDICATORS = [
  {
    factKey: "urbanPopulationPercent",
    sourceId: "world-bank-sp-urb-totl-in-zs-2026-07-13",
    sourceField: "SP.URB.TOTL.IN.ZS",
    title: "Urban population (% of total population)",
    input: process.env.ATLAS_WORLD_BANK_URBAN_SHARE_SOURCE
      || path.join(sourceCache, "jju-atlas-wb-urban-share-20260905.json"),
    retrievedAt: "2026-09-05",
    notes: [
      "Urban population follows each national statistical office's definition; national estimates are therefore not perfectly harmonized.",
      "The World Bank notes that the underlying United Nations Population Division series is collected and smoothed.",
    ],
  },
  {
    factKey: "populationGrowthAnnualPercent",
    sourceId: "world-bank-sp-pop-grow-2026-07-13",
    sourceField: "SP.POP.GROW",
    title: "Population growth (annual %)",
    input: process.env.ATLAS_WORLD_BANK_POPULATION_GROWTH_SOURCE
      || path.join(sourceCache, "jju-atlas-wb-population-growth-20260905.json"),
    retrievedAt: "2026-09-05",
    notes: [
      "The annual growth rate is the exponential rate of change in de facto midyear population from the prior year.",
    ],
  },
  {
    factKey: "populationAges0To14Percent",
    sourceId: "world-bank-sp-pop-0014-to-zs-2026-07-13",
    sourceField: "SP.POP.0014.TO.ZS",
    title: "Population ages 0–14 (% of total population)",
    input: process.env.ATLAS_WORLD_BANK_AGES_0_TO_14_SOURCE
      || path.join(sourceCache, "jju-atlas-wb-population-ages-0-14-20260905.json"),
    retrievedAt: "2026-09-05",
    notes: [
      "The denominator is de facto total population, which counts residents regardless of legal status or citizenship.",
    ],
  },
  {
    factKey: "populationAges65PlusPercent",
    sourceId: "world-bank-sp-pop-65up-to-zs-2026-07-13",
    sourceField: "SP.POP.65UP.TO.ZS",
    title: "Population ages 65 and above (% of total population)",
    input: process.env.ATLAS_WORLD_BANK_AGES_65_PLUS_SOURCE
      || path.join(sourceCache, "jju-atlas-wb-population-ages-65-plus-20260905.json"),
    retrievedAt: "2026-09-05",
    notes: [
      "The denominator is de facto total population, which counts residents regardless of legal status or citizenship.",
    ],
  },
  {
    factKey: "fertilityRateBirthsPerWoman",
    sourceId: "world-bank-sp-dyn-tfrt-in-2026-07-13",
    sourceField: "SP.DYN.TFRT.IN",
    title: "Fertility rate, total (births per woman)",
    input: process.env.ATLAS_WORLD_BANK_FERTILITY_SOURCE
      || path.join(sourceCache, "jju-atlas-wb-fertility-20260905.json"),
    retrievedAt: "2026-09-05",
    notes: [
      "This is a period total fertility rate: the implied number of births under the age-specific fertility rates of the stated year, not a count of births already experienced by an average woman.",
    ],
  },
  {
    factKey: "lifeExpectancyYears",
    sourceId: "world-bank-sp-dyn-le00-in-2026-07-13",
    sourceField: "SP.DYN.LE00.IN",
    title: "Life expectancy at birth, total (years)",
    input: process.env.ATLAS_WORLD_BANK_LIFE_EXPECTANCY_SOURCE
      || path.join(sourceCache, "jju-atlas-wb-life-expectancy-20260905.json"),
    retrievedAt: "2026-09-05",
    notes: [
      "This is a period life-expectancy measure under the mortality pattern of the stated year, not a prediction of an individual newborn's actual lifespan.",
    ],
  },
];

const outputDirectory = process.env.ATLAS_OUTPUT_DIRECTORY
  ? path.resolve(process.env.ATLAS_OUTPUT_DIRECTORY)
  : path.join(repositoryRoot, "lib", "atlas-world", "data");
const mapAssetDirectory = process.env.ATLAS_MAP_ASSET_DIRECTORY
  ? path.resolve(process.env.ATLAS_MAP_ASSET_DIRECTORY)
  : path.join(repositoryRoot, "public", "atlas-world");

const SOURCE_IDS = {
  naturalEarth: "natural-earth-admin-0-50m-5.1.2",
  worldBankCountries: "world-bank-country-metadata-2026-09-03",
  worldBankPopulation: "world-bank-sp-pop-totl-2026-07-13",
  worldBankGdp: "world-bank-ny-gdp-mktp-cd-2026-07-13",
  worldBankGdpPerCapita: "world-bank-ny-gdp-pcap-cd-2026-07-13",
  geonames: "geonames-country-info-2026-09-03",
  factbook: "cia-world-factbook-final-capture-2026-02",
};

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 650;
const PROJECTION_PADDING = 14;

const GOVERNMENT_CATEGORIES = [
  "presidential_republic",
  "parliamentary_republic",
  "semi_presidential_republic",
  "constitutional_monarchy",
  "absolute_monarchy",
  "one_party_state",
  "military_or_transitional",
  "theocracy",
  "territory_or_dependency",
  "other",
  "unknown",
];

const RELIGION_CATEGORIES = [
  "christianity",
  "islam",
  "hinduism",
  "buddhism",
  "judaism",
  "folk_or_traditional",
  "religiously_unaffiliated",
  "other",
  "mixed_or_no_clear_majority",
  "unknown",
];

/**
 * These are code-to-code exceptions, never name joins.
 *
 * FRA and NOR have valid ISO codes in Natural Earth's ISO_A3_EH field but -99
 * in ISO_A3. KOS has no assigned ISO 3166-1 alpha-3 code; XKX is the user-
 * assigned code used by World Bank and GeoNames and KV is the Factbook/FIPS
 * code. The official ISO fields therefore remain null for Kosovo.
 */
const NATURAL_EARTH_EXTERNAL_CODE_OVERRIDES = new Map([
  ["FRA", "FRA"],
  ["NOR", "NOR"],
  ["KOS", "XKX"],
]);

const OFFICIAL_ISO_OVERRIDES = new Map([
  ["FRA", "FRA"],
  ["NOR", "NOR"],
]);

/** Factbook code AT is a map unit omitted from GeoNames countryInfo. */
const FACTBOOK_TO_NATURAL_EARTH_OVERRIDES = new Map([["AT", "ATC"]]);

/**
 * GeoNames maps PSE to FIPS WE, but the matching Factbook profile is explicitly
 * West Bank only while Natural Earth's PSE/PSX geometry also includes Gaza.
 */
const FACTBOOK_EXTERNAL_CODES_BLOCKED = new Set(["PSE"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function geometryAssetId(entityId) {
  return `atlas-${entityId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function escapeXmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderGeometrySvgAsset(geometrySnapshot) {
  const paths = geometrySnapshot.features
    .map((feature) => (
      `<path id="${geometryAssetId(feature.entityId)}" d="${escapeXmlAttribute(feature.path)}" vector-effect="non-scaling-stroke"/>`
    ))
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geometrySnapshot.projection.viewBox.join(" ")}" data-snapshot-id="${escapeXmlAttribute(geometrySnapshot.snapshotId)}">`,
    "<defs>",
    `<path id="atlas-sphere" d="${escapeXmlAttribute(geometrySnapshot.spherePath)}" vector-effect="non-scaling-stroke"/>`,
    `<path id="atlas-graticule" d="${escapeXmlAttribute(geometrySnapshot.graticulePath)}" vector-effect="non-scaling-stroke"/>`,
    paths,
    "</defs>",
    "</svg>",
    "",
  ].join("\n");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function validCode(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("-");
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanSourceText(value) {
  if (typeof value !== "string") return "";

  const namedEntities = new Map([
    ["nbsp", " "],
    ["amp", "&"],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["ldquo", "“"],
    ["rdquo", "”"],
    ["lsquo", "‘"],
    ["rsquo", "’"],
    ["ndash", "–"],
    ["mdash", "—"],
    ["deg", "°"],
    ["aacute", "á"],
    ["eacute", "é"],
    ["iacute", "í"],
    ["oacute", "ó"],
    ["uacute", "ú"],
    ["agrave", "à"],
    ["egrave", "è"],
    ["igrave", "ì"],
    ["ograve", "ò"],
    ["ugrave", "ù"],
    ["acirc", "â"],
    ["ecirc", "ê"],
    ["icirc", "î"],
    ["ocirc", "ô"],
    ["ucirc", "û"],
    ["auml", "ä"],
    ["euml", "ë"],
    ["iuml", "ï"],
    ["ouml", "ö"],
    ["uuml", "ü"],
    ["atilde", "ã"],
    ["otilde", "õ"],
    ["ntilde", "ñ"],
    ["ccedil", "ç"],
  ]);

  return value
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<\/p\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities.get(name.toLowerCase()) ?? match)
    .replace(/\s*;\s*;/g, "; ")
    .replace(/(?:\s*;\s*)+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function temporal(observedAt, precision) {
  return {
    observedAt,
    validFrom: null,
    validTo: null,
    precision,
  };
}

function observation(value, sourceId, sourceField, options = {}) {
  return {
    value,
    status: options.status ?? "observed",
    temporal: temporal(options.observedAt ?? null, options.precision ?? "unknown"),
    sourceId,
    sourceField,
    notes: options.notes ?? [],
  };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function sha256FileSet(root, filePaths) {
  const hash = createHash("sha256");
  for (const filePath of [...filePaths].sort()) {
    hash.update(path.relative(root, filePath).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function parseGeonames(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const columns = line.split("\t");
      assert(columns.length >= 18, `Malformed GeoNames countryInfo row: ${line.slice(0, 80)}`);
      return {
        iso2: columns[0] || null,
        iso3: columns[1] || null,
        isoNumeric: columns[2] || null,
        fips: columns[3] || null,
        country: columns[4] || null,
        capital: columns[5] || null,
        areaKm2: columns[6] ? Number(columns[6]) : null,
        population: columns[7] ? Number(columns[7]) : null,
        continent: columns[8] || null,
        currencyCode: columns[10] || null,
        currencyName: columns[11] || null,
        languageCodes: columns[15] ? columns[15].split(",").filter(Boolean) : [],
        geonamesId: columns[16] || null,
        neighbours: columns[17] ? columns[17].split(",").filter(Boolean) : [],
      };
    });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  cells.push(current);
  return cells;
}

function factbookSnapshotMap(csvText) {
  const rows = csvText.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(rows.shift());
  return new Map(
    rows.map((line) => {
      const values = parseCsvLine(line);
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      return [record.slug, record];
    }),
  );
}

function timestamp14ToIso(value) {
  if (!/^\d{14}$/.test(value || "")) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
}

const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
const MONTHS = new Map(
  MONTH_NAMES.flatMap((month, index) => {
    const number = String(index + 1).padStart(2, "0");
    return [
      [month, number],
      [month.slice(0, 3), number],
    ];
  }),
);

function factbookUpdatedDate(value) {
  const match = /^(\w+) (\d{1,2}), (\d{4})$/.exec(value || "");
  if (!match || !MONTHS.has(match[1])) return null;
  return `${match[3]}-${MONTHS.get(match[1])}-${match[2].padStart(2, "0")}`;
}

function findFactbookField(nodes, name) {
  const field = nodes.find((candidate) => candidate?.name === name);
  const cleaned = cleanSourceText(field?.data);
  return cleaned || null;
}

function findFactbookLeadershipField(nodes, role) {
  const executiveBranch = nodes.find((candidate) => candidate?.name === "Executive branch");
  if (typeof executiveBranch?.data !== "string") return null;
  const pattern =
    role === "headOfState"
      ? /<strong>\s*chief of state\s*:?\s*<\/strong>\s*:?\s*([\s\S]*?)(?=(?:<br\s*\/?>\s*){1,2}<strong>|<strong>|$)/i
      : /<strong>\s*head of government\s*:?\s*<\/strong>\s*:?\s*([\s\S]*?)(?=(?:<br\s*\/?>\s*){1,2}<strong>|<strong>|$)/i;
  const match = pattern.exec(executiveBranch.data);
  const cleaned = cleanSourceText(match?.[1]);
  return cleaned || null;
}

async function parseFactbook(factbookRoot) {
  const jsonDirectory = path.join(factbookRoot, "country-jsons");
  const names = (await readdir(jsonDirectory)).filter((name) => name.endsWith(".json"));
  const snapshotLogPath = path.join(jsonDirectory, "snapshot_log.csv");
  const snapshotBySlug = factbookSnapshotMap(await readFile(snapshotLogPath, "utf8"));
  const records = [];
  const jsonPaths = [];

  for (const name of names.sort()) {
    const filePath = path.join(jsonDirectory, name);
    const json = await readJson(filePath);
    const country = json?.result?.data?.country;
    const fields = json?.result?.data?.fields?.nodes ?? [];
    const factbookCode = json?.result?.pageContext?.placeCode;
    const slug = json?.path?.split("/").filter(Boolean).at(-1) ?? slugify(country?.name || name);
    assert(country?.name && factbookCode, `Factbook profile lacks country name/code: ${name}`);
    const log = snapshotBySlug.get(slug);

    records.push({
      code: factbookCode,
      name: country.name,
      slug,
      pageUpdatedAt: factbookUpdatedDate(country.updated),
      archiveSnapshotAt: timestamp14ToIso(log?.snapshot_timestamp),
      governmentRaw: findFactbookField(fields, "Government type"),
      headOfStateRaw: findFactbookLeadershipField(fields, "headOfState"),
      headOfGovernmentRaw: findFactbookLeadershipField(fields, "headOfGovernment"),
      religionRaw: findFactbookField(fields, "Religions"),
    });
    jsonPaths.push(filePath);
  }

  return {
    records,
    filesForChecksum: [...jsonPaths, snapshotLogPath, path.join(factbookRoot, "LICENSE")],
  };
}

function normalizeGovernment(raw) {
  if (!raw) return "unknown";
  const value = raw.toLowerCase();

  if (/republic of cyprus.+turkish republic of northern cyprus/.test(value)) return "other";
  if (/military junta|military regime|military government|\bin transition\b|transitional government/.test(value)) {
    return "military_or_transitional";
  }
  if (
    /overseas territory|overseas collectivity|non-self-governing|territorial government|territory of|special administrative region|under the sovereignty of the us|part of the kingdom of/.test(
      value,
    )
  ) {
    return "territory_or_dependency";
  }
  if (/theocratic|ecclesiastical elective monarchy/.test(value)) return "theocracy";
  if (/one-party|single-party|communist party-led state|\bcommunist state\b/.test(value)) return "one_party_state";
  if (/absolute monarchy|\bsultanate\b/.test(value)) return "absolute_monarchy";
  if (
    /constitutional monarchy|democracy under a constitutional monarchy|democracy under a constitutional monarchy|commonwealth realm|co-principality/.test(
      value,
    )
  ) {
    return "constitutional_monarchy";
  }
  if (/semi-presidential|mixed presidential-parliamentary/.test(value)) return "semi_presidential_republic";
  if (value === "constitutional federal republic") return "presidential_republic";
  if (/parliamentary republic|parliamentary democratic republic|unitary parliamentary republic/.test(value)) {
    return "parliamentary_republic";
  }
  if (/presidential republic|federal presidential republic/.test(value)) return "presidential_republic";
  if (/parliamentary democracy/.test(value)) return "parliamentary_republic";
  return "other";
}

const LEADERSHIP_SINCE_DATE_PATTERN =
  /\bsince\s+((?:\d{1,2}\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\d{4})\b/gi;

function parseLeadershipDate(value) {
  const dayMatch = /^(\d{1,2})\s+(\w+)\s+(\d{4})$/.exec(value);
  if (dayMatch && MONTHS.has(dayMatch[2])) {
    return {
      value: `${dayMatch[3]}-${MONTHS.get(dayMatch[2])}-${dayMatch[1].padStart(2, "0")}`,
      precision: "day",
    };
  }

  const monthMatch = /^(\w+)\s+(\d{4})$/.exec(value);
  if (monthMatch && MONTHS.has(monthMatch[1])) {
    return {
      value: `${monthMatch[2]}-${MONTHS.get(monthMatch[1])}`,
      precision: "month",
    };
  }

  if (/^\d{4}$/.test(value)) return { value, precision: "year" };
  return { value: null, precision: "unknown" };
}

function splitLeadershipClauses(raw) {
  const normalized = raw
    .replace(/;\s*also (?:referred to as|spelled) [^(]+(\(since [^)]+\))/gi, " $1")
    .replace(/\)\s*,\s*(?=represented by\b)/gi, "); ")
    .replace(
      /\)\s+and\s+(?=(?:co-|president|prime minister|king|queen|governor|chairperson|captains? regent)\b)/gi,
      "); and ",
    );
  const clauses = [];
  let current = "";
  let depth = 0;

  for (const character of normalized) {
    if (character === "(") depth += 1;
    if (character === ")" && depth > 0) depth -= 1;
    if (character === ";" && depth === 0) {
      if (current.trim()) clauses.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (current.trim()) clauses.push(current.trim());
  return clauses;
}

function leadershipRelationship(clause, index) {
  if (/\brepresented by\b/i.test(clause)) return "representative";
  if (/\bpresidency member\b/i.test(clause)) return "member";
  if (index === 0 || /\bco-prince\b/i.test(clause)) return "principal";
  return "associated_official";
}

function normalizeLeadership(raw) {
  const isVacant = /\bvacant\b/i.test(raw);
  if (isVacant) return { raw, isVacant: true, officeholders: [] };

  const officeholders = [];
  const clauses = splitLeadershipClauses(raw);
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (/^note\b/i.test(clause)) break;
    if (/^former\b/i.test(clause)) continue;

    const sinceMatches = [...clause.matchAll(LEADERSHIP_SINCE_DATE_PATTERN)];
    const parsedTerm =
      sinceMatches.length === 1
        ? parseLeadershipDate(sinceMatches[0][1])
        : { value: null, precision: "unknown" };

    let nameAndTitle = clause
      .replace(/\s*\([^)]*\bsince\b[^)]*\)/gi, "")
      .replace(/\s*\(for the period [^)]+\)/gi, "")
      .replace(/^and\s+/i, "")
      .replace(/[;,]\s*$/, "")
      .trim();

    if (/^both reside\b/i.test(nameAndTitle) && /represented by\s+/i.test(nameAndTitle)) {
      nameAndTitle = nameAndTitle.slice(nameAndTitle.toLowerCase().lastIndexOf("represented by "));
    }
    nameAndTitle = nameAndTitle.replace(/\s+is the \[so-called\][\s\S]*$/i, "").trim();

    if (!nameAndTitle || /^(?:note\b|former\b)/i.test(nameAndTitle)) continue;
    const hasFactbookUppercaseName = /\b[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’-]{1,}\b/u.test(nameAndTitle);
    const looksLikeNarrative = /\b(?:will|was|were|dismissed|appointed|resigned|overthrown|elected|serves?)\b/i.test(
      nameAndTitle,
    );
    if (
      index > 0 &&
      sinceMatches.length === 0 &&
      (!hasFactbookUppercaseName || looksLikeNarrative)
    ) {
      continue;
    }

    officeholders.push({
      nameAndTitle,
      relationship: leadershipRelationship(clause, index),
      termStartedAt: parsedTerm.value,
      termStartPrecision: parsedTerm.precision,
    });
  }

  return { raw, isVacant: false, officeholders };
}

function splitTopLevel(value) {
  const normalizedValue = value.replace(/([\p{L})])\s*,\s*(?=\d+(?:\.\d+)?\s*%)/gu, "$1 ");
  const segments = [];
  let current = "";
  let depth = 0;

  for (const character of normalizedValue) {
    if (character === "(") depth += 1;
    if (character === ")" && depth > 0) depth -= 1;
    if ((character === "," || character === ";") && depth === 0) {
      if (current.trim()) segments.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function religionCategoryForLabel(label) {
  const value = label.toLowerCase();
  if (
    /unspecified|no answer|no response|undeclared|don['’]?t know|refused|objected to answering|not stated|not applicable|unknown|^less than$/.test(
      value,
    )
  ) {
    return "unknown";
  }
  if (
    /\bnone\b|unaffiliated|no religion|nonreligious|non-religious|atheis|agnostic|secular|non-believer|nothing in particular|ethical humanist/.test(
      value,
    )
  ) {
    return "religiously_unaffiliated";
  }
  if (
    /christ|catholic|protestant|orthodox|anglican|lutheran|pentecostal|apostolic|methodist|baptist|presbyterian|adventist|mormon|latter-day|coptic|maronite|unitarian|evangelical|jehovah|reformed|kimbangu|salvation army|church of|quaker|mennonite|calvinist|congregational|congregation|assembly of god|iglesia ni cristo|salutiste|universal kingdom of god|worship centre|old believer/.test(
      value,
    )
  ) {
    return "christianity";
  }
  if (/muslim|\bislam|sunni|shi['’]?a|shiite|ibadi|ahmadi|sufi|bektashi/.test(value)) return "islam";
  if (/hindu/.test(value)) return "hinduism";
  if (/buddh/.test(value)) return "buddhism";
  if (/jewish|judaism/.test(value)) return "judaism";
  if (
    /traditional|folk|animis|indigenous|shaman|voodoo|vodou|spiritist|ancestor|cargo cult|shinto|umbanda|candombl|ethnic religion|badimo|kirat|maori|modekngei|winti|pagan/.test(
      value,
    )
  ) {
    return "folk_or_traditional";
  }
  return "other";
}

function religionEstimateYears(raw) {
  const compositionText = raw.split(/\s*;\s*note\s*:/i)[0];
  const estimatedYears = [...compositionText.matchAll(/\b((?:19|20)\d{2})\s+est\./gi)].map(
    (match) => match[1],
  );
  if (estimatedYears.length) return uniqueStrings(estimatedYears).sort();
  return uniqueStrings(
    [...compositionText.matchAll(/\(((?:19|20)\d{2})\)/g)].map((match) => match[1]),
  ).sort();
}

function normalizeReligion(raw) {
  if (!raw) {
    return {
      value: {
        raw: "",
        dominantCategory: "unknown",
        composition: [],
        normalizationMethod: "unresolved",
      },
      estimateYears: [],
      diagnostic: null,
    };
  }

  const compositionText = raw.split(/\s*;\s*note\s*:/i)[0];
  const segments = splitTopLevel(compositionText);
  const aggregate = new Map();
  const labels = new Map();
  let parsedPercentSegments = 0;

  for (const segment of segments) {
    const match = /(<\s*|less than\s+)?(\d+(?:\.\d+)?|\.\d+)\s*(?:[-–]\s*(\d+(?:\.\d+)?|\.\d+))?\s*%/i.exec(
      segment,
    );
    if (!match) continue;
    const isUpperBound = Boolean(match[1]);
    const low = Number(match[2]);
    const high = match[3] ? Number(match[3]) : low;
    const share = isUpperBound ? high / 2 : (low + high) / 2;
    const isApproximate = isUpperBound || Boolean(match[3]);
    const rawLabel =
      segment.slice(0, match.index).replace(/[<>~]/g, "").trim().replace(/\.$/, "") ||
      "unspecified";
    const category = religionCategoryForLabel(rawLabel);
    parsedPercentSegments += 1;
    const aggregateValue = aggregate.get(category) ?? { sharePercent: 0, shareIsApproximate: false };
    aggregateValue.sharePercent += share;
    aggregateValue.shareIsApproximate ||= isApproximate;
    aggregate.set(category, aggregateValue);
    if (!labels.has(category)) labels.set(category, []);
    labels.get(category).push(rawLabel);
  }

  const composition = [...aggregate.entries()]
    .map(([category, aggregateValue]) => ({
      category,
      sharePercent: round(aggregateValue.sharePercent, 2),
      shareIsApproximate: aggregateValue.shareIsApproximate,
      rawLabels: uniqueStrings(labels.get(category) ?? []),
    }))
    .sort((a, b) => b.sharePercent - a.sharePercent || a.category.localeCompare(b.category));

  const total = composition.reduce((sum, item) => sum + item.sharePercent, 0);
  let dominantCategory = "unknown";
  let normalizationMethod = "unresolved";
  let diagnostic = null;

  if (parsedPercentSegments > 0) {
    normalizationMethod = "factbook-percent-composition-v1";
    if (total > 105) {
      diagnostic = `Top-level percentages sum to ${round(total, 2)}%; overlapping categories were not resolved.`;
      dominantCategory = "unknown";
      normalizationMethod = "unresolved";
    } else if (composition.find((item) => item.category !== "unknown")?.sharePercent > 50) {
      dominantCategory = composition.find((item) => item.category !== "unknown").category;
    } else if (total >= 80) {
      dominantCategory = "mixed_or_no_clear_majority";
    } else {
      diagnostic = `Parsed top-level percentages cover only ${round(total, 2)}%; no majority is asserted.`;
      dominantCategory = "unknown";
      normalizationMethod = "unresolved";

      const predominantMatch = /predominant(?:ly)?\s+([\p{L}'’ -]+)/iu.exec(compositionText);
      if (predominantMatch) {
        const predominantCategory = religionCategoryForLabel(predominantMatch[1]);
        if (predominantCategory !== "other" && predominantCategory !== "unknown") {
          dominantCategory = predominantCategory;
          normalizationMethod = "factbook-qualitative-label-v1";
          diagnostic = null;
        }
      }
    }
  } else {
    const qualitativeCategories = uniqueStrings(
      segments
        .map(religionCategoryForLabel)
        .filter((category) => category !== "other" && category !== "unknown"),
    );
    const strongQualitativeLanguage = /predominant|majority|virtually all|nearly all|almost all/i.test(raw);
    if (qualitativeCategories.length === 1) {
      dominantCategory = qualitativeCategories[0];
      normalizationMethod = "factbook-qualitative-label-v1";
    } else if (strongQualitativeLanguage) {
      const leadingCategory = religionCategoryForLabel(segments[0] ?? "");
      if (leadingCategory !== "other" && leadingCategory !== "unknown") {
        dominantCategory = leadingCategory;
        normalizationMethod = "factbook-qualitative-label-v1";
      }
    } else if (/small\s+[\p{L}'’ -]+\s+minority/iu.test(compositionText)) {
      const leadingCategory = religionCategoryForLabel(segments[0] ?? "");
      if (leadingCategory !== "other" && leadingCategory !== "unknown") {
        dominantCategory = leadingCategory;
        normalizationMethod = "factbook-qualitative-label-v1";
      }
    }

    if (/overwhelmingly\s+christian/i.test(raw)) {
      dominantCategory = "christianity";
      normalizationMethod = "factbook-qualitative-label-v1";
    }
  }

  return {
    value: {
      raw,
      dominantCategory,
      composition,
      normalizationMethod,
    },
    estimateYears: religionEstimateYears(raw),
    diagnostic,
  };
}

function languageName(code) {
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
    const name = displayNames.of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : null;
  } catch {
    try {
      const baseCode = code.split("-")[0];
      const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
      const name = displayNames.of(baseCode);
      return name && name.toLowerCase() !== baseCode.toLowerCase() ? name : null;
    } catch {
      return null;
    }
  }
}

function externalCodeForNaturalEarth(properties) {
  if (validCode(properties.ISO_A3)) return properties.ISO_A3;
  return NATURAL_EARTH_EXTERNAL_CODE_OVERRIDES.get(properties.ADM0_A3) ?? null;
}

function officialIso3ForNaturalEarth(properties) {
  if (validCode(properties.ISO_A3)) return properties.ISO_A3;
  return OFFICIAL_ISO_OVERRIDES.get(properties.ADM0_A3) ?? null;
}

function entityIdForNaturalEarth(properties) {
  assert(validCode(properties.ADM0_A3), `Natural Earth feature has no usable ADM0_A3: ${properties.ADMIN}`);
  return `country:${properties.ADM0_A3}`;
}

function worldBankRows(payload) {
  assert(Array.isArray(payload) && Array.isArray(payload[1]), "Unexpected World Bank JSON shape");
  return { metadata: payload[0], records: payload[1] };
}

function worldBankIndicatorMap(records, economyCodes) {
  return new Map(
    records
      .filter(
        (record) =>
          economyCodes.has(record.countryiso3code) &&
          record.value !== null &&
          Number.isFinite(Number(record.value)),
      )
      .map((record) => [record.countryiso3code, record]),
  );
}

function mercatorRaw([longitudeDegrees, latitudeDegrees]) {
  const lambda = (longitudeDegrees * Math.PI) / 180;
  const limit = 85.0511287798066;
  const phi = (Math.max(-limit, Math.min(limit, latitudeDegrees)) * Math.PI) / 180;
  return [lambda, -Math.log(Math.tan(Math.PI / 4 + phi / 2))];
}

function sphereCoordinates(step = 2) {
  const points = [];
  for (let longitude = -180; longitude <= 180; longitude += step) points.push([longitude, -90]);
  for (let latitude = -90 + step; latitude <= 90; latitude += step) points.push([180, latitude]);
  for (let longitude = 180 - step; longitude >= -180; longitude -= step) points.push([longitude, 90]);
  for (let latitude = 90 - step; latitude > -90; latitude -= step) points.push([-180, latitude]);
  return points;
}

function projectionForViewBox() {
  const rawOutline = sphereCoordinates().map(mercatorRaw);
  const xs = rawOutline.map((point) => point[0]);
  const ys = rawOutline.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (VIEWBOX_WIDTH - PROJECTION_PADDING * 2) / (maxX - minX),
    (VIEWBOX_HEIGHT - PROJECTION_PADDING * 2) / (maxY - minY),
  );
  const translateX = VIEWBOX_WIDTH / 2 - ((minX + maxX) / 2) * scale;
  const translateY = VIEWBOX_HEIGHT / 2 - ((minY + maxY) / 2) * scale;

  return (coordinate) => {
    const [x, y] = mercatorRaw(coordinate);
    return [x * scale + translateX, y * scale + translateY];
  };
}

function formatNumber(value) {
  return String(round(value, 2));
}

function linePath(points, close = false) {
  if (!points.length) return "";
  const commands = points.map(
    ([x, y], index) => `${index === 0 ? "M" : "L"}${formatNumber(x)},${formatNumber(y)}`,
  );
  return commands.join("") + (close ? "Z" : "");
}

function ringWithoutDuplicateEnd(ring) {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring.at(-1);
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

function projectedGeometry(geometry, project) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((polygon) =>
    polygon.map((ring) => ringWithoutDuplicateEnd(ring).map((coordinate) => project(coordinate))),
  );
}

function pathForProjectedPolygons(polygons) {
  return polygons.flatMap((polygon) => polygon.map((ring) => linePath(ring, true))).join("");
}

function boundsForProjectedPolygons(polygons) {
  const points = polygons.flat(2);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [
    [round(Math.min(...xs)), round(Math.min(...ys))],
    [round(Math.max(...xs)), round(Math.max(...ys))],
  ];
}

function ringMoment(ring) {
  let twiceArea = 0;
  let centroidXTimesSixArea = 0;
  let centroidYTimesSixArea = 0;

  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    centroidXTimesSixArea += (current[0] + next[0]) * cross;
    centroidYTimesSixArea += (current[1] + next[1]) * cross;
  }

  if (Math.abs(twiceArea) < 1e-9) return null;
  return {
    area: twiceArea / 2,
    centroid: [
      centroidXTimesSixArea / (3 * twiceArea),
      centroidYTimesSixArea / (3 * twiceArea),
    ],
  };
}

function centroidForProjectedPolygons(polygons, fallback) {
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;

  for (const polygon of polygons) {
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
      const moment = ringMoment(polygon[ringIndex]);
      if (!moment) continue;
      const weight = Math.abs(moment.area) * (ringIndex === 0 ? 1 : -1);
      weightedX += moment.centroid[0] * weight;
      weightedY += moment.centroid[1] * weight;
      totalWeight += weight;
    }
  }

  if (Math.abs(totalWeight) < 1e-9) return fallback.map((value) => round(value));
  return [round(weightedX / totalWeight), round(weightedY / totalWeight)];
}

function graticulePath(project) {
  const lines = [];
  for (let longitude = -150; longitude <= 150; longitude += 30) {
    const points = [];
    for (let latitude = -90; latitude <= 90; latitude += 2) points.push(project([longitude, latitude]));
    lines.push(linePath(points));
  }
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const points = [];
    for (let longitude = -180; longitude <= 180; longitude += 2) points.push(project([longitude, latitude]));
    lines.push(linePath(points));
  }
  return lines.join("");
}

function coverage(populated, total) {
  return {
    populated,
    total,
    percent: total ? round((populated / total) * 100, 1) : 0,
  };
}

function countCategories(countries, factName, valueName, categories) {
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));
  for (const country of countries) {
    const category = country.facts[factName]?.value?.[valueName] ?? "unknown";
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}

function joinAudit(sourceId, method, sourceCodes, entityIds, totalEntities) {
  return {
    sourceId,
    method,
    sourceRecords: sourceCodes.length,
    matchedEntities: new Set(entityIds).size,
    unmatchedSourceCodes: uniqueStrings(sourceCodes.filter((code) => !code.matched).map((code) => code.code)).sort(),
    entityCoverage: coverage(new Set(entityIds).size, totalEntities),
  };
}

async function main() {
  const [
    sourceLock,
    naturalEarth,
    worldBankCountriesPayload,
    worldBankPopulationPayload,
    worldBankGdpPayload,
    worldBankGdpPerCapitaPayload,
    geonamesText,
    factbook,
    howPeopleLivePayloads,
  ] = await Promise.all([
    readJson(sourceLockPath),
    readJson(inputs.naturalEarth),
    readJson(inputs.worldBankCountries),
    readJson(inputs.worldBankPopulation),
    readJson(inputs.worldBankGdp),
    readJson(inputs.worldBankGdpPerCapita),
    readFile(inputs.geonames, "utf8"),
    parseFactbook(inputs.factbook),
    Promise.all(HOW_PEOPLE_LIVE_INDICATORS.map((indicator) => readJson(indicator.input))),
  ]);

  assert(naturalEarth.type === "FeatureCollection", "Natural Earth input is not a FeatureCollection");
  assert(naturalEarth.features.every((feature) => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type)), "Natural Earth contains unsupported geometry");

  const geonames = parseGeonames(geonamesText);
  const geonamesByIso3 = new Map(geonames.map((record) => [record.iso3, record]));
  const geonamesByFips = new Map(geonames.filter((record) => record.fips).map((record) => [record.fips, record]));

  assert(geonamesByIso3.size === geonames.length, "GeoNames ISO3 values are not unique");
  assert(geonamesByFips.size === geonames.filter((record) => record.fips).length, "GeoNames FIPS values are not unique");

  const wbCountries = worldBankRows(worldBankCountriesPayload);
  const wbPopulation = worldBankRows(worldBankPopulationPayload);
  const wbGdp = worldBankRows(worldBankGdpPayload);
  const wbGdpPerCapita = worldBankRows(worldBankGdpPerCapitaPayload);
  const wbEconomies = wbCountries.records.filter(
    (record) => record.region?.value && record.region.value !== "Aggregates",
  );
  const wbEconomyCodes = new Set(wbEconomies.map((record) => record.id));
  const wbCountryByCode = new Map(wbEconomies.map((record) => [record.id, record]));
  const wbPopulationByCode = worldBankIndicatorMap(wbPopulation.records, wbEconomyCodes);
  const wbGdpByCode = worldBankIndicatorMap(wbGdp.records, wbEconomyCodes);
  const wbGdpPerCapitaByCode = worldBankIndicatorMap(wbGdpPerCapita.records, wbEconomyCodes);
  const howPeopleLiveRows = new Map(
    HOW_PEOPLE_LIVE_INDICATORS.map((indicator, index) => [
      indicator.factKey,
      worldBankRows(howPeopleLivePayloads[index]),
    ]),
  );
  const howPeopleLiveByCode = new Map(
    HOW_PEOPLE_LIVE_INDICATORS.map((indicator) => [
      indicator.factKey,
      worldBankIndicatorMap(howPeopleLiveRows.get(indicator.factKey).records, wbEconomyCodes),
    ]),
  );

  const naturalEarthCodes = naturalEarth.features.map((feature) => feature.properties.ADM0_A3);
  const naturalEarthCodeSet = new Set(naturalEarthCodes);
  assert(naturalEarthCodeSet.size === naturalEarth.features.length, "Natural Earth ADM0_A3 values are not unique");

  const externalCodeToEntityId = new Map();
  for (const feature of naturalEarth.features) {
    const externalCode = externalCodeForNaturalEarth(feature.properties);
    if (!externalCode) continue;
    assert(!externalCodeToEntityId.has(externalCode), `Duplicate external code ${externalCode} in Natural Earth`);
    externalCodeToEntityId.set(externalCode, entityIdForNaturalEarth(feature.properties));
  }

  const factbookByEntityId = new Map();
  const factbookJoinByCode = new Map();
  for (const record of factbook.records) {
    let entityId = null;
    const directNaturalEarthCode = FACTBOOK_TO_NATURAL_EARTH_OVERRIDES.get(record.code);
    if (directNaturalEarthCode && naturalEarthCodeSet.has(directNaturalEarthCode)) {
      entityId = `country:${directNaturalEarthCode}`;
    } else {
      const geonamesRecord = geonamesByFips.get(record.code);
      if (
        geonamesRecord &&
        !FACTBOOK_EXTERNAL_CODES_BLOCKED.has(geonamesRecord.iso3) &&
        externalCodeToEntityId.has(geonamesRecord.iso3)
      ) {
        entityId = externalCodeToEntityId.get(geonamesRecord.iso3);
      }
    }

    factbookJoinByCode.set(record.code, entityId);
    if (entityId) {
      assert(!factbookByEntityId.has(entityId), `Multiple Factbook profiles map to ${entityId}`);
      factbookByEntityId.set(entityId, record);
    }
  }

  const religionDiagnostics = [];
  const countries = naturalEarth.features.map((feature) => {
    const properties = feature.properties;
    const id = entityIdForNaturalEarth(properties);
    const externalCode = externalCodeForNaturalEarth(properties);
    const officialIso3 = officialIso3ForNaturalEarth(properties);
    const geonamesRecord = externalCode ? geonamesByIso3.get(externalCode) ?? null : null;
    const wbCountry = externalCode ? wbCountryByCode.get(externalCode) ?? null : null;
    const factbookRecord = factbookByEntityId.get(id) ?? null;
    const populationRecord = externalCode ? wbPopulationByCode.get(externalCode) ?? null : null;
    const gdpRecord = externalCode ? wbGdpByCode.get(externalCode) ?? null : null;
    const gdpPerCapitaRecord = externalCode ? wbGdpPerCapitaByCode.get(externalCode) ?? null : null;
    const howPeopleLiveFacts = Object.fromEntries(
      HOW_PEOPLE_LIVE_INDICATORS.map((indicator) => {
        const record = externalCode
          ? howPeopleLiveByCode.get(indicator.factKey).get(externalCode) ?? null
          : null;
        return [
          indicator.factKey,
          record
            ? observation(Number(record.value), indicator.sourceId, indicator.sourceField, {
                observedAt: record.date,
                precision: "year",
                notes: [record.indicator?.value || indicator.title, ...indicator.notes],
              })
            : null,
        ];
      }),
    );

    const commonName = properties.ADMIN || properties.NAME_EN || properties.NAME_LONG || properties.NAME;
    const aliases = uniqueStrings([
      properties.NAME,
      properties.NAME_LONG,
      properties.NAME_EN,
      properties.NAME_SORT,
      properties.NAME_ALT,
      wbCountry?.name,
      geonamesRecord?.country,
      factbookRecord?.name,
    ]).filter((name) => name !== commonName);

    let capitalFact = null;
    if (wbCountry?.capitalCity) {
      capitalFact = observation(
        wbCountry.capitalCity,
        SOURCE_IDS.worldBankCountries,
        "capitalCity",
        {
          observedAt: RETRIEVED_AT,
          precision: "source_snapshot",
          notes: ["World Bank country metadata does not expose a separate measurement date for this field."],
        },
      );
    } else if (geonamesRecord?.capital) {
      capitalFact = observation(geonamesRecord.capital, SOURCE_IDS.geonames, "Capital", {
        observedAt: RETRIEVED_AT,
        precision: "source_snapshot",
        notes: ["GeoNames countryInfo does not expose a separate measurement date for this field."],
      });
    }

    const areaFact =
      geonamesRecord && Number.isFinite(geonamesRecord.areaKm2) && geonamesRecord.areaKm2 > 0
        ? observation(geonamesRecord.areaKm2, SOURCE_IDS.geonames, "Area(in sq km)", {
            observedAt: RETRIEVED_AT,
            precision: "source_snapshot",
            notes: ["GeoNames countryInfo does not expose a separate measurement date for this field."],
          })
        : null;

    const languageFact = geonamesRecord?.languageCodes.length
      ? observation(
          geonamesRecord.languageCodes.map((code) => ({ code, name: languageName(code) })),
          SOURCE_IDS.geonames,
          "Languages",
          {
            observedAt: RETRIEVED_AT,
            precision: "source_snapshot",
            notes: [
              "GeoNames supplies language codes, not official-status claims; English labels are derived with Intl.DisplayNames.",
            ],
          },
        )
      : null;

    const currencyFact =
      geonamesRecord?.currencyCode && geonamesRecord?.currencyName
        ? observation(
            { code: geonamesRecord.currencyCode, name: geonamesRecord.currencyName },
            SOURCE_IDS.geonames,
            "CurrencyCode; CurrencyName",
            {
              observedAt: RETRIEVED_AT,
              precision: "source_snapshot",
              notes: ["GeoNames countryInfo does not expose a separate measurement date for these fields."],
            },
          )
        : null;

    const populationFact = populationRecord
      ? observation(Number(populationRecord.value), SOURCE_IDS.worldBankPopulation, "SP.POP.TOTL", {
          observedAt: populationRecord.date,
          precision: "year",
          notes: [populationRecord.indicator?.value || "Population, total"],
        })
      : null;

    const gdpFact = gdpRecord
      ? observation(Number(gdpRecord.value), SOURCE_IDS.worldBankGdp, "NY.GDP.MKTP.CD", {
          observedAt: gdpRecord.date,
          precision: "year",
          notes: [gdpRecord.indicator?.value || "GDP (current US$)"],
        })
      : null;

    const gdpPerCapitaFact = gdpPerCapitaRecord
      ? observation(
          Number(gdpPerCapitaRecord.value),
          SOURCE_IDS.worldBankGdpPerCapita,
          "NY.GDP.PCAP.CD",
          {
            observedAt: gdpPerCapitaRecord.date,
            precision: "year",
            notes: [gdpPerCapitaRecord.indicator?.value || "GDP per capita (current US$)"],
          },
        )
      : null;

    const archiveNote = factbookRecord?.archiveSnapshotAt
      ? [`Internet Archive snapshot: ${factbookRecord.archiveSnapshotAt}.`]
      : [];
    const governmentFact = factbookRecord?.governmentRaw
      ? observation(
          {
            raw: factbookRecord.governmentRaw,
            category: normalizeGovernment(factbookRecord.governmentRaw),
            normalizationMethod: "factbook-government-rules-v1",
          },
          SOURCE_IDS.factbook,
          "Government type",
          {
            observedAt: factbookRecord.pageUpdatedAt,
            precision: factbookRecord.pageUpdatedAt ? "day" : "unknown",
            notes: [
              "Observed date is the Factbook profile update date, not necessarily the date the government changed.",
              ...archiveNote,
            ],
          },
        )
      : null;

    const leadershipObservation = (raw, sourceField) =>
      raw
        ? observation(normalizeLeadership(raw), SOURCE_IDS.factbook, sourceField, {
            observedAt: factbookRecord.pageUpdatedAt,
            precision: factbookRecord.pageUpdatedAt ? "day" : "unknown",
            notes: [
              "Leadership reflects the archived Factbook profile update date and is not a live officeholder lookup.",
              "Names and titles remain in the source's combined wording to avoid heuristic name/title splits.",
              ...archiveNote,
            ],
          })
        : null;
    const headOfStateFact = leadershipObservation(
      factbookRecord?.headOfStateRaw,
      "Executive branch > chief of state",
    );
    const headOfGovernmentFact = leadershipObservation(
      factbookRecord?.headOfGovernmentRaw,
      "Executive branch > head of government",
    );

    let religionFact = null;
    if (factbookRecord?.religionRaw) {
      const normalized = normalizeReligion(factbookRecord.religionRaw);
      const estimateDate = normalized.estimateYears.length === 1 ? normalized.estimateYears[0] : null;
      const notes = [...archiveNote];
      if (normalized.estimateYears.length > 1) {
        notes.push(`The source field mixes estimate years: ${normalized.estimateYears.join(", ")}.`);
      } else if (!estimateDate) {
        notes.push("The source field does not expose a clear measurement year.");
      }
      if (normalized.diagnostic) {
        notes.push(normalized.diagnostic);
        religionDiagnostics.push({ entityId: id, message: normalized.diagnostic });
      }
      religionFact = observation(normalized.value, SOURCE_IDS.factbook, "Religions", {
        observedAt: estimateDate,
        precision: estimateDate ? "year" : "unknown",
        notes,
      });
    }

    const boundaryNotes = uniqueStrings([properties.NOTE_ADM0, properties.NOTE_BRK]);
    const iso2 = officialIso3 ? geonamesRecord?.iso2 ?? (validCode(properties.ISO_A2) ? properties.ISO_A2 : null) : null;
    const isoNumeric = officialIso3
      ? geonamesRecord?.isoNumeric ?? (validCode(properties.ISO_N3) ? properties.ISO_N3 : null)
      : null;

    return {
      id,
      slug: slugify(commonName),
      names: {
        common: commonName,
        official: properties.FORMAL_EN || null,
        aliases,
      },
      codes: {
        naturalEarthAdm0A3: properties.ADM0_A3,
        naturalEarthId: Number(properties.NE_ID),
        iso2: iso2 ?? null,
        iso3: officialIso3,
        isoNumeric: isoNumeric ?? null,
        worldBankIso2: wbCountry?.iso2Code || null,
        worldBankIso3: wbCountry?.id || null,
        geonamesIso2: geonamesRecord?.iso2 || null,
        geonamesIso3: geonamesRecord?.iso3 || null,
        geonamesId: geonamesRecord?.geonamesId || null,
        factbookCode: factbookRecord?.code || null,
        wikidataId: properties.WIKIDATAID || null,
      },
      geography: {
        continent: properties.CONTINENT,
        region: properties.REGION_UN,
        subregion: properties.SUBREGION,
        worldBankRegion: wbCountry?.region?.value || properties.REGION_WB || null,
        incomeLevel: wbCountry?.incomeLevel?.value || null,
        naturalEarthType: properties.TYPE,
        sovereignName: properties.SOVEREIGNT,
        boundaryNote: boundaryNotes.length ? boundaryNotes.join("; ") : null,
      },
      temporal: {
        validFrom: null,
        validTo: null,
      },
      facts: {
        capital: capitalFact,
        population: populationFact,
        areaKm2: areaFact,
        languages: languageFact,
        currency: currencyFact,
        gdpCurrentUsd: gdpFact,
        gdpPerCapitaCurrentUsd: gdpPerCapitaFact,
        ...howPeopleLiveFacts,
        government: governmentFact,
        headOfState: headOfStateFact,
        headOfGovernment: headOfGovernmentFact,
        religion: religionFact,
      },
      jjuLinks: [],
    };
  });

  countries.sort((a, b) => a.names.common.localeCompare(b.names.common));

  const project = projectionForViewBox();
  const geometryFeatures = naturalEarth.features
    .map((feature) => {
      const projected = projectedGeometry(feature.geometry, project);
      const fallback = project([Number(feature.properties.LABEL_X), Number(feature.properties.LABEL_Y)]);
      const tinyRank = Number(feature.properties.TINY);
      const mapColor7 = Number(feature.properties.MAPCOLOR7);
      return {
        entityId: entityIdForNaturalEarth(feature.properties),
        path: pathForProjectedPolygons(projected),
        centroid: centroidForProjectedPolygons(projected, fallback),
        bounds: boundsForProjectedPolygons(projected),
        tinyRank: Number.isFinite(tinyRank) && tinyRank >= 0 ? tinyRank : null,
        mapColor7: Number.isFinite(mapColor7) && mapColor7 >= 1 ? mapColor7 : null,
      };
    })
    .sort((a, b) => a.entityId.localeCompare(b.entityId));

  const factbookArchiveDates = factbook.records
    .map((record) => record.archiveSnapshotAt)
    .filter(Boolean)
    .sort();

  const howPeopleLiveSourceRecords = await Promise.all(
    HOW_PEOPLE_LIVE_INDICATORS.map(async (indicator) => {
      const rows = howPeopleLiveRows.get(indicator.factKey);
      return {
        id: indicator.sourceId,
        title: `${indicator.title} (${indicator.sourceField})`,
        publisher: "World Bank",
        url: `https://api.worldbank.org/v2/country/all/indicator/${indicator.sourceField}`,
        license: {
          name: "CC BY 4.0",
          url: "https://datacatalog.worldbank.org/public-licenses",
        },
        retrievedAt: indicator.retrievedAt,
        sourceUpdatedAt: rows.metadata.lastupdated || null,
        localInput: path.basename(indicator.input),
        checksumSha256: await sha256File(indicator.input),
        notes: [
          "The latest available non-empty observation is retained for each World Bank economy, together with its own year.",
          ...indicator.notes,
        ],
      };
    }),
  );

  const coreSourceRecords = await Promise.all([
    (async () => ({
      id: SOURCE_IDS.naturalEarth,
      title: "Natural Earth 1:50m Admin 0 – Countries",
      publisher: "Natural Earth",
      url: "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/",
      license: {
        name: "Public domain",
        url: "https://www.naturalearthdata.com/about/terms-of-use/",
      },
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: null,
      localInput: path.basename(inputs.naturalEarth),
      checksumSha256: await sha256File(inputs.naturalEarth),
      notes: [
        "Version 5.1.2, 1:50m scale.",
        "Admin-0 polygons are contemporary de facto cartography and include disputed or indeterminate map units.",
      ],
    }))(),
    (async () => ({
      id: SOURCE_IDS.worldBankCountries,
      title: "World Bank country metadata",
      publisher: "World Bank",
      url: "https://api.worldbank.org/v2/country",
      license: {
        name: "CC BY 4.0",
        url: "https://datacatalog.worldbank.org/public-licenses",
      },
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: null,
      localInput: path.basename(inputs.worldBankCountries),
      checksumSha256: await sha256File(inputs.worldBankCountries),
      notes: ["Aggregate regions and income groups are excluded before country-code joins."],
    }))(),
    (async () => ({
      id: SOURCE_IDS.worldBankPopulation,
      title: "Population, total (SP.POP.TOTL)",
      publisher: "World Bank",
      url: "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL",
      license: {
        name: "CC BY 4.0",
        url: "https://datacatalog.worldbank.org/public-licenses",
      },
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: wbPopulation.metadata.lastupdated || null,
      localInput: path.basename(inputs.worldBankPopulation),
      checksumSha256: await sha256File(inputs.worldBankPopulation),
      notes: ["Each entity keeps the year attached to its returned observation."],
    }))(),
    (async () => ({
      id: SOURCE_IDS.worldBankGdp,
      title: "GDP (current US$) (NY.GDP.MKTP.CD)",
      publisher: "World Bank",
      url: "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD",
      license: {
        name: "CC BY 4.0",
        url: "https://datacatalog.worldbank.org/public-licenses",
      },
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: wbGdp.metadata.lastupdated || null,
      localInput: path.basename(inputs.worldBankGdp),
      checksumSha256: await sha256File(inputs.worldBankGdp),
      notes: ["Latest available years differ by economy; the observation year is never overwritten."],
    }))(),
    (async () => ({
      id: SOURCE_IDS.worldBankGdpPerCapita,
      title: "GDP per capita (current US$) (NY.GDP.PCAP.CD)",
      publisher: "World Bank",
      url: "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD",
      license: {
        name: "CC BY 4.0",
        url: "https://datacatalog.worldbank.org/public-licenses",
      },
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: wbGdpPerCapita.metadata.lastupdated || null,
      localInput: path.basename(inputs.worldBankGdpPerCapita),
      checksumSha256: await sha256File(inputs.worldBankGdpPerCapita),
      notes: ["Latest available years differ by economy; the observation year is never overwritten."],
    }))(),
    (async () => ({
      id: SOURCE_IDS.geonames,
      title: "GeoNames countryInfo",
      publisher: "GeoNames",
      url: "https://download.geonames.org/export/dump/countryInfo.txt",
      license: {
        name: "CC BY 4.0",
        url: "https://www.geonames.org/export/",
      },
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: null,
      localInput: path.basename(inputs.geonames),
      checksumSha256: await sha256File(inputs.geonames),
      notes: [
        "Used for ISO/FIPS crosswalks, area, capital fallback, currency, language codes, and GeoNames IDs.",
        "The undated GeoNames population column is deliberately not imported.",
      ],
    }))(),
    (async () => ({
      id: SOURCE_IDS.factbook,
      title: "CIA World Factbook final content captures",
      publisher: "CIA World Factbook content preserved by pmusser via Internet Archive",
      url: "https://github.com/pmusser/cia-world-factbook-final",
      license: {
        name: "CC0 1.0 (repository license)",
        url: "https://github.com/pmusser/cia-world-factbook-final/blob/main/LICENSE",
      },
      retrievedAt: RETRIEVED_AT,
      sourceUpdatedAt: factbookArchiveDates.at(-1)?.slice(0, 10) ?? null,
      localInput: path.basename(inputs.factbook),
      checksumSha256: await sha256FileSet(inputs.factbook, factbook.filesForChecksum),
      notes: [
        "This is a rescued Internet Archive snapshot, not a live CIA API.",
        "Raw government, leadership, and religion wording is retained after stripping source presentation HTML; broad categories are separately normalized.",
      ],
    }))(),
  ]);
  const sourceRecords = [
    ...coreSourceRecords.slice(0, 5),
    ...howPeopleLiveSourceRecords,
    ...coreSourceRecords.slice(5),
  ];

  const lockedSources = new Map(sourceLock.sources.map((source) => [source.id, source]));
  assert(
    sourceLock.lockId === "jju-atlas-sources-2026-09-05",
    `Unexpected Atlas source lock ${String(sourceLock.lockId)}`,
  );
  for (const sourceRecord of sourceRecords) {
    const lockedSource = lockedSources.get(sourceRecord.id);
    assert(lockedSource, `Source ${sourceRecord.id} is absent from data/atlas/sources.lock.json`);
    assert(
      sourceRecord.checksumSha256 === lockedSource.checksumSha256,
      `Input ${sourceRecord.id} does not match data/atlas/sources.lock.json`,
    );
  }

  const countrySnapshot = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
    generatedAt: GENERATED_AT,
    sources: sourceRecords,
    countries,
  };

  const geometrySnapshot = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
    projection: {
      id: "mercator",
      viewBox: [0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT],
      width: VIEWBOX_WIDTH,
      height: VIEWBOX_HEIGHT,
    },
    sourceId: SOURCE_IDS.naturalEarth,
    temporal: {
      validFrom: null,
      validTo: null,
    },
    spherePath: linePath(sphereCoordinates().map(project), true),
    graticulePath: graticulePath(project),
    features: geometryFeatures,
  };

  const total = countries.length;
  const entityIdSet = new Set(countries.map((country) => country.id));
  const geometryEntityIdSet = new Set(geometryFeatures.map((feature) => feature.entityId));
  const errors = [];
  const issues = [];

  if (entityIdSet.size !== total) {
    errors.push({
      severity: "error",
      code: "DUPLICATE_ENTITY_ID",
      message: "Country entity IDs are not unique.",
      entityIds: [],
      sourceKeys: [],
    });
  }
  if (geometryEntityIdSet.size !== geometryFeatures.length || geometryFeatures.length !== total) {
    errors.push({
      severity: "error",
      code: "GEOMETRY_ENTITY_MISMATCH",
      message: "Geometry features do not map one-to-one to country entities.",
      entityIds: [],
      sourceKeys: [],
    });
  }
  const emptyPaths = geometryFeatures.filter((feature) => !feature.path).map((feature) => feature.entityId);
  if (emptyPaths.length) {
    errors.push({
      severity: "error",
      code: "EMPTY_GEOMETRY_PATH",
      message: "One or more geometry features produced an empty SVG path.",
      entityIds: emptyPaths,
      sourceKeys: [],
    });
  }

  const missingOfficialIso = countries.filter((country) => !country.codes.iso3).map((country) => country.id);
  issues.push({
    severity: "info",
    code: "NO_OFFICIAL_ISO3",
    message: "These Natural Earth map units do not have an official ISO 3166-1 alpha-3 code in this snapshot.",
    entityIds: missingOfficialIso,
    sourceKeys: [],
  });

  issues.push({
    severity: "warning",
    code: "FACTBOOK_PARTIAL_GEOMETRY_BLOCKED",
    message: "The Factbook West Bank profile was not applied to Natural Earth's combined Palestine map unit because it excludes Gaza.",
    entityIds: ["country:PSX"],
    sourceKeys: ["WE", "GZ"],
  });

  const governmentOther = countries
    .filter((country) => country.facts.government?.value.category === "other")
    .map((country) => country.id);
  if (governmentOther.length) {
    issues.push({
      severity: "info",
      code: "GOVERNMENT_CATEGORY_OTHER",
      message: "Raw government descriptions without an explicit match to the broad V1 taxonomy remain in other.",
      entityIds: governmentOther,
      sourceKeys: [],
    });
  }

  const leadershipVacancies = countries
    .filter(
      (country) =>
        country.facts.headOfState?.value.isVacant ||
        country.facts.headOfGovernment?.value.isVacant,
    )
    .map((country) => country.id);
  if (leadershipVacancies.length) {
    issues.push({
      severity: "info",
      code: "LEADERSHIP_ROLE_EXPLICITLY_VACANT",
      message: "The archived source explicitly marks at least one leadership role vacant for these entities.",
      entityIds: leadershipVacancies,
      sourceKeys: [],
    });
  }

  const leadershipWithoutOfficeholders = countries
    .filter((country) =>
      [country.facts.headOfState, country.facts.headOfGovernment].some(
        (fact) => fact && !fact.value.isVacant && fact.value.officeholders.length === 0,
      ),
    )
    .map((country) => country.id);
  if (leadershipWithoutOfficeholders.length) {
    issues.push({
      severity: "warning",
      code: "LEADERSHIP_OFFICEHOLDER_PARSE_EMPTY",
      message: "A leadership role has raw source text but no safely extractable officeholder clause.",
      entityIds: leadershipWithoutOfficeholders,
      sourceKeys: [],
    });
  }

  const leadershipTermsAfterProfileUpdate = countries.flatMap((country) =>
    [
      ["chief of state", country.facts.headOfState],
      ["head of government", country.facts.headOfGovernment],
    ].flatMap(([role, fact]) => {
      const observedAt = fact?.temporal.observedAt;
      if (!fact || !observedAt) return [];
      return fact.value.officeholders
        .filter((officeholder) => officeholder.termStartedAt && officeholder.termStartedAt > observedAt)
        .map((officeholder) => ({
          entityId: country.id,
          detail: `${country.id} ${role}: term ${officeholder.termStartedAt} follows profile update ${observedAt}`,
        }));
    }),
  );
  if (leadershipTermsAfterProfileUpdate.length) {
    issues.push({
      severity: "warning",
      code: "LEADERSHIP_TERM_AFTER_PROFILE_UPDATE",
      message: "The archived source reports a leadership term start after its own profile update date; Atlas retains both dates and flags the source sequence for review.",
      entityIds: [...new Set(leadershipTermsAfterProfileUpdate.map((record) => record.entityId))],
      sourceKeys: leadershipTermsAfterProfileUpdate.map((record) => record.detail),
    });
  }

  const religionUnresolved = countries
    .filter(
      (country) =>
        country.facts.religion && country.facts.religion.value.dominantCategory === "unknown",
    )
    .map((country) => country.id);
  if (religionUnresolved.length) {
    issues.push({
      severity: "info",
      code: "RELIGION_NORMALIZATION_UNRESOLVED",
      message: "A dominant broad religion is not asserted where percentages are partial, overlap, or lack a clear basis.",
      entityIds: religionUnresolved,
      sourceKeys: [],
    });
  }

  if (religionDiagnostics.length) {
    issues.push({
      severity: "warning",
      code: "RELIGION_PERCENTAGE_DIAGNOSTICS",
      message: `${religionDiagnostics.length} religion fields require manual review because their parsed percentages overlap or are incomplete.`,
      entityIds: religionDiagnostics.map((diagnostic) => diagnostic.entityId),
      sourceKeys: religionDiagnostics.map((diagnostic) => diagnostic.message),
    });
  }

  const valueCoverage = (predicate) => coverage(countries.filter(predicate).length, total);
  const geoMatchedIds = countries.filter((country) => country.codes.geonamesId).map((country) => country.id);
  const wbCountryMatchedIds = countries.filter((country) => country.codes.worldBankIso3).map((country) => country.id);
  const factbookMatchedIds = countries.filter((country) => country.codes.factbookCode).map((country) => country.id);
  const populationMatchedIds = countries.filter((country) => country.facts.population).map((country) => country.id);
  const gdpMatchedIds = countries.filter((country) => country.facts.gdpCurrentUsd).map((country) => country.id);
  const gdpPcMatchedIds = countries.filter((country) => country.facts.gdpPerCapitaCurrentUsd).map((country) => country.id);
  const howPeopleLiveMatchedIds = new Map(
    HOW_PEOPLE_LIVE_INDICATORS.map((indicator) => [
      indicator.factKey,
      countries.filter((country) => country.facts[indicator.factKey]).map((country) => country.id),
    ]),
  );

  const geoSourceCodes = geonames.map((record) => ({
    code: record.iso3,
    matched: externalCodeToEntityId.has(record.iso3),
  }));
  const wbCountrySourceCodes = wbEconomies.map((record) => ({
    code: record.id,
    matched: externalCodeToEntityId.has(record.id),
  }));
  const wbPopulationSourceCodes = [...wbPopulationByCode.keys()].map((code) => ({
    code,
    matched: externalCodeToEntityId.has(code),
  }));
  const wbGdpSourceCodes = [...wbGdpByCode.keys()].map((code) => ({
    code,
    matched: externalCodeToEntityId.has(code),
  }));
  const wbGdpPcSourceCodes = [...wbGdpPerCapitaByCode.keys()].map((code) => ({
    code,
    matched: externalCodeToEntityId.has(code),
  }));
  const howPeopleLiveSourceCodes = new Map(
    HOW_PEOPLE_LIVE_INDICATORS.map((indicator) => [
      indicator.factKey,
      [...howPeopleLiveByCode.get(indicator.factKey).keys()].map((code) => ({
        code,
        matched: externalCodeToEntityId.has(code),
      })),
    ]),
  );
  const factbookSourceCodes = factbook.records.map((record) => ({
    code: record.code,
    matched: Boolean(factbookJoinByCode.get(record.code)),
  }));

  const validationSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId: SNAPSHOT_ID,
    generatedAt: GENERATED_AT,
    status: errors.length ? "fail" : "pass",
    counts: {
      geometryFeatures: geometryFeatures.length,
      countryEntities: countries.length,
      uniqueEntityIds: entityIdSet.size,
      uniqueNaturalEarthCodes: naturalEarthCodeSet.size,
    },
    coverage: {
      officialIso3: valueCoverage((country) => Boolean(country.codes.iso3)),
      worldBankMetadata: valueCoverage((country) => Boolean(country.codes.worldBankIso3)),
      geonamesMetadata: valueCoverage((country) => Boolean(country.codes.geonamesId)),
      factbookProfile: valueCoverage((country) => Boolean(country.codes.factbookCode)),
      capital: valueCoverage((country) => Boolean(country.facts.capital)),
      population: valueCoverage((country) => Boolean(country.facts.population)),
      areaKm2: valueCoverage((country) => Boolean(country.facts.areaKm2)),
      languages: valueCoverage((country) => Boolean(country.facts.languages)),
      currency: valueCoverage((country) => Boolean(country.facts.currency)),
      gdpCurrentUsd: valueCoverage((country) => Boolean(country.facts.gdpCurrentUsd)),
      gdpPerCapitaCurrentUsd: valueCoverage((country) => Boolean(country.facts.gdpPerCapitaCurrentUsd)),
      ...Object.fromEntries(
        HOW_PEOPLE_LIVE_INDICATORS.map((indicator) => [
          indicator.factKey,
          valueCoverage((country) => Boolean(country.facts[indicator.factKey])),
        ]),
      ),
      governmentRaw: valueCoverage((country) => Boolean(country.facts.government)),
      governmentNormalized: valueCoverage(
        (country) => Boolean(country.facts.government) && country.facts.government.value.category !== "unknown",
      ),
      headOfState: valueCoverage((country) => Boolean(country.facts.headOfState)),
      headOfStateWithTermDate: valueCoverage((country) =>
        Boolean(
          country.facts.headOfState?.value.officeholders.some(
            (officeholder) => officeholder.termStartedAt,
          ),
        ),
      ),
      headOfGovernment: valueCoverage((country) => Boolean(country.facts.headOfGovernment)),
      headOfGovernmentWithTermDate: valueCoverage((country) =>
        Boolean(
          country.facts.headOfGovernment?.value.officeholders.some(
            (officeholder) => officeholder.termStartedAt,
          ),
        ),
      ),
      religionRaw: valueCoverage((country) => Boolean(country.facts.religion)),
      religionNormalized: valueCoverage(
        (country) => Boolean(country.facts.religion) && country.facts.religion.value.dominantCategory !== "unknown",
      ),
    },
    joins: [
      {
        sourceId: SOURCE_IDS.naturalEarth,
        method: "Natural Earth ADM0_A3 is the unique entity key; no cross-dataset join is performed.",
        sourceRecords: naturalEarth.features.length,
        matchedEntities: naturalEarth.features.length,
        unmatchedSourceCodes: [],
        entityCoverage: coverage(naturalEarth.features.length, total),
      },
      joinAudit(
        SOURCE_IDS.geonames,
        "GeoNames ISO3 -> official ISO3 or audited Natural Earth external-code override.",
        geoSourceCodes,
        geoMatchedIds,
        total,
      ),
      joinAudit(
        SOURCE_IDS.worldBankCountries,
        "World Bank economy ID -> official ISO3 or audited Natural Earth external-code override; aggregate rows excluded.",
        wbCountrySourceCodes,
        wbCountryMatchedIds,
        total,
      ),
      joinAudit(
        SOURCE_IDS.worldBankPopulation,
        "World Bank countryiso3code -> official ISO3 or audited Natural Earth external-code override.",
        wbPopulationSourceCodes,
        populationMatchedIds,
        total,
      ),
      joinAudit(
        SOURCE_IDS.worldBankGdp,
        "World Bank countryiso3code -> official ISO3 or audited Natural Earth external-code override.",
        wbGdpSourceCodes,
        gdpMatchedIds,
        total,
      ),
      joinAudit(
        SOURCE_IDS.worldBankGdpPerCapita,
        "World Bank countryiso3code -> official ISO3 or audited Natural Earth external-code override.",
        wbGdpPcSourceCodes,
        gdpPcMatchedIds,
        total,
      ),
      ...HOW_PEOPLE_LIVE_INDICATORS.map((indicator) => joinAudit(
        indicator.sourceId,
        "World Bank countryiso3code -> official ISO3 or audited Natural Earth external-code override; aggregate rows excluded.",
        howPeopleLiveSourceCodes.get(indicator.factKey),
        howPeopleLiveMatchedIds.get(indicator.factKey),
        total,
      )),
      joinAudit(
        SOURCE_IDS.factbook,
        "Factbook placeCode (FIPS) -> GeoNames FIPS -> GeoNames ISO3 -> Atlas external code; one audited AT -> ATC override.",
        factbookSourceCodes,
        factbookMatchedIds,
        total,
      ),
    ],
    governmentCategoryCounts: countCategories(
      countries,
      "government",
      "category",
      GOVERNMENT_CATEGORIES,
    ),
    religionCategoryCounts: countCategories(
      countries,
      "religion",
      "dominantCategory",
      RELIGION_CATEGORIES,
    ),
    issues: [...errors, ...issues],
  };

  await Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    mkdir(mapAssetDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(outputDirectory, "countries.v1.json"),
      `${JSON.stringify(countrySnapshot, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(outputDirectory, "geometry-mercator.v1.json"),
      `${JSON.stringify(geometrySnapshot, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(outputDirectory, "validation.v1.json"),
      `${JSON.stringify(validationSnapshot, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(mapAssetDirectory, "geometry-mercator.v1.svg"),
      renderGeometrySvgAsset(geometrySnapshot),
      "utf8",
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        status: validationSnapshot.status,
        outputDirectory,
        mapAssetDirectory,
        counts: validationSnapshot.counts,
        coverage: validationSnapshot.coverage,
        governmentCategoryCounts: validationSnapshot.governmentCategoryCounts,
        religionCategoryCounts: validationSnapshot.religionCategoryCounts,
      },
      null,
      2,
    ),
  );

  if (validationSnapshot.status !== "pass") process.exitCode = 1;
}

await main();
