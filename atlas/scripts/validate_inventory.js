const path = require("path");
const {
  ID_PATTERN,
  PLACEHOLDER_PATTERN,
  atlasRoot,
  readJson,
  walkJsonFiles
} = require("./atlas_utils");

const REQUIRED_INVENTORY_FIELDS = [
  "domain",
  "title",
  "generatedAt",
  "target",
  "sources",
  "terms"
];

const REQUIRED_TERM_FIELDS = [
  "id",
  "title",
  "domain",
  "subdomains",
  "aliases",
  "sourceNames",
  "sourceUrls",
  "status",
  "promoted"
];

function validateStringArray(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string") errors.push(`${label}[${index}] must be a string`);
  });
}

function main() {
  const files = walkJsonFiles(path.join(atlasRoot, "inventories"))
    .filter((filePath) => filePath.endsWith(`${path.sep}terms.json`));
  const errors = [];

  for (const file of files) {
    const inventory = readJson(file);
    const relativePath = path.relative(atlasRoot, file).replaceAll("\\", "/");

    REQUIRED_INVENTORY_FIELDS.forEach((field) => {
      if (!(field in inventory)) errors.push(`${relativePath}: missing ${field}`);
    });

    if (!ID_PATTERN.test(inventory.domain || "")) errors.push(`${relativePath}: invalid domain "${inventory.domain}"`);
    if (typeof inventory.title !== "string" || !inventory.title.trim()) errors.push(`${relativePath}: title is required`);
    if (!Number.isInteger(inventory.target) || inventory.target < 1) errors.push(`${relativePath}: target must be a positive integer`);
    if (!Array.isArray(inventory.sources)) errors.push(`${relativePath}: sources must be an array`);
    if (!Array.isArray(inventory.terms)) errors.push(`${relativePath}: terms must be an array`);

    const ids = new Set();
    for (const [index, term] of (inventory.terms || []).entries()) {
      const prefix = `${relativePath}: terms[${index}]`;
      REQUIRED_TERM_FIELDS.forEach((field) => {
        if (!(field in term)) errors.push(`${prefix}: missing ${field}`);
      });

      if (!ID_PATTERN.test(term.id || "")) errors.push(`${prefix}: invalid id "${term.id}"`);
      if (PLACEHOLDER_PATTERN.test(term.id || "")) errors.push(`${prefix}: placeholder id "${term.id}"`);
      if (ids.has(term.id)) errors.push(`${prefix}: duplicate id "${term.id}"`);
      ids.add(term.id);

      if (term.domain !== inventory.domain) errors.push(`${prefix}: domain "${term.domain}" does not match inventory domain "${inventory.domain}"`);
      if (typeof term.title !== "string" || !term.title.trim()) errors.push(`${prefix}: title is required`);
      validateStringArray(term.subdomains, `${prefix}.subdomains`, errors);
      validateStringArray(term.aliases, `${prefix}.aliases`, errors);
      validateStringArray(term.sourceNames, `${prefix}.sourceNames`, errors);
      validateStringArray(term.sourceUrls, `${prefix}.sourceUrls`, errors);
      if (!["candidate", "review", "rejected", "promoted"].includes(term.status)) errors.push(`${prefix}: invalid status "${term.status}"`);
      if (typeof term.promoted !== "boolean") errors.push(`${prefix}: promoted must be boolean`);
    }
  }

  if (errors.length) {
    console.error(`Atlas inventory validation failed with ${errors.length} error(s):`);
    errors.slice(0, 200).forEach((error) => console.error(`- ${error}`));
    if (errors.length > 200) console.error(`...and ${errors.length - 200} more`);
    process.exit(1);
  }

  console.log(`Atlas inventory validation passed for ${files.length} inventories.`);
}

main();
