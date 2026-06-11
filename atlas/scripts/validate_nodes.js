const {
  NODE_TYPES,
  REQUIRED_NODE_FIELDS,
  SOURCE_KEYS,
  ID_PATTERN,
  PLACEHOLDER_PATTERN,
  loadDomainMap,
  loadNodes
} = require("./atlas_utils");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateArrayOfIds(node, field, errors) {
  if (!Array.isArray(node[field])) {
    errors.push(`${node.id || "<missing id>"}: ${field} must be an array`);
    return;
  }

  const seen = new Set();
  for (const value of node[field]) {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      errors.push(`${node.id}: ${field} contains invalid id "${value}"`);
    }
    if (seen.has(value)) {
      errors.push(`${node.id}: ${field} contains duplicate id "${value}"`);
    }
    seen.add(value);
  }
}

function validateNodeShape(entry, domainIds, subdomainIds, errors) {
  const node = entry.node;
  if (!isPlainObject(node)) {
    errors.push(`${entry.relativePath}: node file must contain a JSON object`);
    return;
  }

  for (const field of REQUIRED_NODE_FIELDS) {
    if (!(field in node)) {
      errors.push(`${entry.relativePath}: missing required field "${field}"`);
    }
  }

  for (const field of Object.keys(node)) {
    if (!REQUIRED_NODE_FIELDS.includes(field)) {
      errors.push(`${entry.relativePath}: unexpected field "${field}"`);
    }
  }

  if (typeof node.id !== "string" || !ID_PATTERN.test(node.id)) {
    errors.push(`${entry.relativePath}: invalid id "${node.id}"`);
  }

  if (typeof node.id === "string" && PLACEHOLDER_PATTERN.test(node.id)) {
    errors.push(`${entry.relativePath}: numbered placeholder id is forbidden`);
  }

  if (typeof node.title !== "string" || node.title.trim().length === 0) {
    errors.push(`${node.id || entry.relativePath}: title must not be empty`);
  }

  if (!NODE_TYPES.has(node.type)) {
    errors.push(`${node.id}: invalid node type "${node.type}"`);
  }

  if (typeof node.summary !== "string" || node.summary.trim().length === 0) {
    errors.push(`${node.id}: summary must not be empty`);
  } else {
    const sentenceMarks = (node.summary.match(/[.!?]/g) || []).length;
    if (sentenceMarks > 1) {
      errors.push(`${node.id}: summary should be one sentence`);
    }
  }

  validateArrayOfIds(node, "domains", errors);
  validateArrayOfIds(node, "subdomains", errors);
  validateArrayOfIds(node, "prerequisites", errors);
  validateArrayOfIds(node, "unlocks", errors);
  validateArrayOfIds(node, "related", errors);

  for (const domainId of node.domains || []) {
    if (!domainIds.has(domainId)) {
      errors.push(`${node.id}: invalid domain "${domainId}"`);
    }
  }

  for (const subdomainId of node.subdomains || []) {
    if (!subdomainIds.has(subdomainId)) {
      errors.push(`${node.id}: invalid subdomain "${subdomainId}"`);
    }
  }

  if (!Array.isArray(node.aliases)) {
    errors.push(`${node.id}: aliases must be an array`);
  } else {
    const aliases = new Set();
    for (const alias of node.aliases) {
      if (typeof alias !== "string" || alias.trim().length === 0) {
        errors.push(`${node.id}: aliases must be non-empty strings`);
      }
      const normalized = typeof alias === "string" ? alias.trim().toLowerCase() : alias;
      if (aliases.has(normalized)) {
        errors.push(`${node.id}: duplicate alias "${alias}"`);
      }
      aliases.add(normalized);
    }
  }

  if (!Array.isArray(node.tags)) {
    errors.push(`${node.id}: tags must be an array`);
  } else {
    const tags = new Set();
    for (const tag of node.tags) {
      if (typeof tag !== "string" || !ID_PATTERN.test(tag)) {
        errors.push(`${node.id}: invalid tag "${tag}"`);
      }
      if (tags.has(tag)) {
        errors.push(`${node.id}: duplicate tag "${tag}"`);
      }
      tags.add(tag);
    }
  }

  if (!isPlainObject(node.sources)) {
    errors.push(`${node.id}: sources must be an object`);
  } else {
    for (const key of SOURCE_KEYS) {
      if (!(key in node.sources)) {
        errors.push(`${node.id}: sources missing "${key}"`);
      } else if (typeof node.sources[key] !== "string") {
        errors.push(`${node.id}: sources.${key} must be a string`);
      }
    }
  }

  if (!["stub", "draft", "reviewed", "published"].includes(node.status)) {
    errors.push(`${node.id}: invalid status "${node.status}"`);
  }
}

function main() {
  const { domainIds, subdomainIds } = loadDomainMap();
  const entries = loadNodes();
  const errors = [];
  const ids = new Map();

  for (const entry of entries) {
    validateNodeShape(entry, domainIds, subdomainIds, errors);
    if (entry.node && typeof entry.node.id === "string") {
      if (ids.has(entry.node.id)) {
        errors.push(`${entry.relativePath}: duplicate id also found in ${ids.get(entry.node.id)}`);
      } else {
        ids.set(entry.node.id, entry.relativePath);
      }
    }
  }

  for (const entry of entries) {
    const node = entry.node;
    if (!node || typeof node.id !== "string") {
      continue;
    }

    for (const field of ["prerequisites", "unlocks", "related"]) {
      if (!Array.isArray(node[field])) {
        continue;
      }
      for (const targetId of node[field]) {
        if (!ids.has(targetId)) {
          errors.push(`${node.id}: ${field} references missing node "${targetId}"`);
        }
        if (targetId === node.id) {
          errors.push(`${node.id}: ${field} must not reference itself`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Atlas validation failed with ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Atlas validation passed for ${entries.length} node(s).`);
}

main();
