const path = require("path");
const {
  atlasRoot,
  readJson,
  titleFromId,
  walkJsonFiles
} = require("./atlas_utils");

function main() {
  const domain = process.argv.find((arg) => arg.startsWith("--domain="))?.split("=")[1];
  const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 50);
  const dryRun = !process.argv.includes("--write");

  if (!domain) {
    console.error("Usage: node atlas/scripts/promote_inventory_nodes.js --domain=physics --limit=100 [--write]");
    process.exit(1);
  }

  const inventoryFile = path.join(atlasRoot, "inventories", domain, "terms.json");
  const inventory = readJson(inventoryFile);
  const existingNodeIds = new Set(walkJsonFiles(path.join(atlasRoot, "foundations")).concat(walkJsonFiles(path.join(atlasRoot, "nodes"))).map((filePath) => path.basename(filePath, ".json")));
  function promotionScore(term) {
    const title = String(term.title || "");
    const lowerTitle = title.toLowerCase();
    let score = 0;
    score += (term.sourceNames || []).length * 8;
    if ((term.sourceNames || []).some((sourceName) => /glossary/i.test(sourceName))) score += 8;
    if ((term.sourceNames || []).some((sourceName) => /outline/i.test(sourceName))) score += 3;
    if ((term.subdomains || []).length) score += 2;
    if (title.length <= 48) score += 3;
    if (title.length > 70) score -= 10;
    if (/^(a|an|the)\s+.{20,}/i.test(title)) score -= 18;
    if (/\b(treatise|handbook|manual|journal|proceedings|textbook|encyclopedia)\b/i.test(title)) score -= 18;
    if (/\b(history of|list of|outline of|glossary of)\b/i.test(lowerTitle)) score -= 20;
    return score;
  }

  const promotable = (inventory.terms || [])
    .filter((term) => !term.promoted && !existingNodeIds.has(term.id))
    .sort((a, b) => promotionScore(b) - promotionScore(a) || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map((term) => ({
      id: term.id,
      title: term.title || titleFromId(term.id),
      type: "concept",
      domains: [domain],
      subdomains: term.subdomains || [],
      summary: `${term.title || titleFromId(term.id)} is a candidate ${domain.replace(/_/g, " ")} concept awaiting relationship mapping.`,
      prerequisites: [],
      unlocks: [],
      related: [],
      aliases: term.aliases || [],
      tags: [domain, ...(term.subdomains || [])],
      sources: {
        wikipedia: (term.sourceUrls || []).find((url) => url.includes("wikipedia.org")) || "",
        britannica: "",
        openstax: (term.sourceUrls || []).find((url) => url.includes("openstax.org")) || "",
        stanford_encyclopedia: (term.sourceUrls || []).find((url) => url.includes("plato.stanford.edu")) || ""
      },
      status: "stub"
    }));

  console.log(JSON.stringify({
    dryRun,
    domain,
    limit,
    promotable: promotable.length,
    firstTen: promotable.slice(0, 10).map((node) => node.id),
    note: dryRun
      ? "Dry run only. Add --write after adding relationship rules for this domain."
      : "Write mode is intentionally disabled until the domain relationship mapper exists."
  }, null, 2));

  if (!dryRun) {
    console.error("Write mode is blocked for now: build the relationship mapper before promoting candidate inventories.");
    process.exit(1);
  }
}

main();
