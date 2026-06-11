const path = require("path");
const {
  atlasRoot,
  readJson,
  titleFromId,
  unique,
  walkJsonFiles,
  writeJson
} = require("./atlas_utils");

function normalizeTermId(title) {
  return title
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeInventory(inventory) {
  const termsById = new Map();

  for (const term of inventory.terms || []) {
    const id = normalizeTermId(term.title || term.id);
    if (!id) continue;
    const existing = termsById.get(id);
    if (existing) {
      existing.aliases = unique([...existing.aliases, term.title, ...(term.aliases || [])].filter((alias) => alias && alias !== existing.title));
      existing.sourceNames = unique([...existing.sourceNames, ...(term.sourceNames || [])]);
      existing.sourceUrls = unique([...existing.sourceUrls, ...(term.sourceUrls || [])]);
      existing.subdomains = unique([...existing.subdomains, ...(term.subdomains || [])]);
      existing.promoted = Boolean(existing.promoted || term.promoted);
      existing.status = existing.promoted ? "promoted" : existing.status;
      continue;
    }
    termsById.set(id, {
      id,
      title: String(term.title || titleFromId(id)).trim(),
      domain: inventory.domain,
      subdomains: unique((term.subdomains || []).map(String)).sort(),
      aliases: unique((term.aliases || []).map(String).filter(Boolean)).sort(),
      sourceNames: unique((term.sourceNames || []).map(String).filter(Boolean)).sort(),
      sourceUrls: unique((term.sourceUrls || []).map(String).filter(Boolean)).sort(),
      status: term.promoted ? "promoted" : term.status || "candidate",
      promoted: Boolean(term.promoted)
    });
  }

  return {
    ...inventory,
    generatedAt: new Date().toISOString(),
    terms: Array.from(termsById.values()).sort((a, b) => a.title.localeCompare(b.title))
  };
}

function main() {
  const files = walkJsonFiles(path.join(atlasRoot, "inventories"))
    .filter((filePath) => filePath.endsWith(`${path.sep}terms.json`));
  for (const file of files) {
    writeJson(file, normalizeInventory(readJson(file)));
  }
  console.log(`Normalized ${files.length} Atlas inventory file(s).`);
}

main();
