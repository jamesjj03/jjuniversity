const fs = require("fs");
const path = require("path");

const atlasRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(atlasRoot, "..");

const NODE_TYPES = new Set([
  "foundation",
  "concept",
  "object",
  "process",
  "theory",
  "person",
  "event",
  "place",
  "tool",
  "text",
  "institution"
]);

const REQUIRED_NODE_FIELDS = [
  "id",
  "title",
  "type",
  "domains",
  "subdomains",
  "summary",
  "prerequisites",
  "unlocks",
  "related",
  "aliases",
  "tags",
  "sources",
  "status"
];

const SOURCE_KEYS = [
  "wikipedia",
  "britannica",
  "openstax",
  "stanford_encyclopedia"
];

const ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const PLACEHOLDER_PATTERN = /(^|_)(node|placeholder|concept|item|entry)_\d+$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function walkJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return walkJsonFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".json") ? [fullPath] : [];
  });
}

function loadDomainMap() {
  const domainFile = path.join(atlasRoot, "domains", "domains.json");
  const domainMap = readJson(domainFile);
  const domainIds = new Set();
  const subdomainIds = new Set();

  for (const domain of domainMap.domains || []) {
    domainIds.add(domain.id);
    for (const subdomain of domain.subdomains || []) {
      subdomainIds.add(subdomain.id);
    }
  }

  return { domainFile, domainMap, domainIds, subdomainIds };
}

function collectNodeFiles() {
  return [
    ...walkJsonFiles(path.join(atlasRoot, "foundations")),
    ...walkJsonFiles(path.join(atlasRoot, "nodes"))
  ].sort();
}

function loadNodes() {
  return collectNodeFiles().map((filePath) => ({
    filePath,
    relativePath: path.relative(repoRoot, filePath).replaceAll("\\", "/"),
    node: readJson(filePath)
  }));
}

function normalizeAlias(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function titleFromId(id) {
  return id.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function unique(values) {
  return Array.from(new Set(values));
}

module.exports = {
  atlasRoot,
  repoRoot,
  NODE_TYPES,
  REQUIRED_NODE_FIELDS,
  SOURCE_KEYS,
  ID_PATTERN,
  PLACEHOLDER_PATTERN,
  readJson,
  writeJson,
  walkJsonFiles,
  loadDomainMap,
  collectNodeFiles,
  loadNodes,
  normalizeAlias,
  titleFromId,
  unique
};
