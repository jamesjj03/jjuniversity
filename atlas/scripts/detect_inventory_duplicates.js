const path = require("path");
const {
  atlasRoot,
  readJson,
  walkJsonFiles,
  writeJson
} = require("./atlas_utils");

function loadInventories() {
  return walkJsonFiles(path.join(atlasRoot, "inventories"))
    .filter((filePath) => filePath.endsWith(`${path.sep}terms.json`))
    .map((filePath) => readJson(filePath));
}

function main() {
  const inventories = loadInventories();
  const byId = new Map();
  const collisions = [];
  const perDomainDuplicates = [];

  for (const inventory of inventories) {
    const seen = new Set();
    for (const term of inventory.terms || []) {
      if (seen.has(term.id)) {
        perDomainDuplicates.push({ domain: inventory.domain, id: term.id });
      }
      seen.add(term.id);

      if (!byId.has(term.id)) byId.set(term.id, []);
      byId.get(term.id).push({
        domain: inventory.domain,
        title: term.title,
        sourceNames: term.sourceNames
      });
    }
  }

  for (const [id, entries] of byId.entries()) {
    const domains = Array.from(new Set(entries.map((entry) => entry.domain)));
    if (domains.length > 1) {
      collisions.push({
        id,
        domains,
        titles: Array.from(new Set(entries.map((entry) => entry.title))).sort()
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    domains: inventories.length,
    totalTerms: inventories.reduce((sum, inventory) => sum + (inventory.terms || []).length, 0),
    perDomainDuplicates,
    senseCollisions: collisions.sort((a, b) => b.domains.length - a.domains.length || a.id.localeCompare(b.id))
  };

  writeJson(path.join(atlasRoot, "inventories", "duplicates.json"), report);

  if (perDomainDuplicates.length) {
    console.error(`Inventory duplicate IDs inside a domain: ${perDomainDuplicates.length}`);
    process.exit(1);
  }

  console.log(`Inventory duplicate scan passed: ${report.totalTerms} terms, ${report.senseCollisions.length} cross-domain sense collisions flagged.`);
}

main();
