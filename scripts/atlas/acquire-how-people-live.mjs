#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const seedDirectory = path.join(repositoryRoot, "data", "atlas", "source-seeds");
const snapshotDate = process.env.ATLAS_WORLD_BANK_SNAPSHOT_DATE || "20260905";
const replace = process.argv.includes("--replace");

const indicators = [
  { id: "SP.URB.TOTL.IN.ZS", slug: "urban-share" },
  { id: "SP.POP.GROW", slug: "population-growth" },
  { id: "SP.POP.0014.TO.ZS", slug: "population-ages-0-14" },
  { id: "SP.POP.65UP.TO.ZS", slug: "population-ages-65-plus" },
  { id: "SP.DYN.TFRT.IN", slug: "fertility" },
  { id: "SP.DYN.LE00.IN", slug: "life-expectancy" },
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/^\d{8}$/.test(snapshotDate), "ATLAS_WORLD_BANK_SNAPSHOT_DATE must use YYYYMMDD.");

await mkdir(seedDirectory, { recursive: true });

for (const indicator of indicators) {
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator.id}?format=json&per_page=400&mrnev=1`;
  const targetPath = path.join(
    seedDirectory,
    `jju-atlas-wb-${indicator.slug}-${snapshotDate}.json`,
  );
  if (!replace && await exists(targetPath)) {
    throw new Error(`Refusing to replace existing pinned snapshot ${path.basename(targetPath)}. Pass --replace deliberately.`);
  }

  const response = await fetch(url, { redirect: "follow" });
  assert(response.ok, `World Bank returned HTTP ${response.status} for ${indicator.id}.`);
  const payload = await response.json();
  assert(Array.isArray(payload) && Array.isArray(payload[1]), `Unexpected World Bank response for ${indicator.id}.`);
  assert(
    payload[1].every((record) => record.indicator?.id === indicator.id),
    `World Bank response mixed indicators for ${indicator.id}.`,
  );
  const codes = payload[1].map((record) => record.countryiso3code).filter(Boolean);
  assert(new Set(codes).size === codes.length, `World Bank returned duplicate economy rows for ${indicator.id}.`);

  await writeFile(targetPath, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(`${indicator.id.padEnd(20)} ${payload[1].length} rows -> ${path.relative(repositoryRoot, targetPath)}`);
}
