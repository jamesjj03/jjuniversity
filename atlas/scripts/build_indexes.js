const path = require("path");
const {
  atlasRoot,
  loadNodes,
  normalizeAlias,
  writeJson
} = require("./atlas_utils");

function pushIndex(index, key, nodeId) {
  if (!index[key]) {
    index[key] = [];
  }
  index[key].push(nodeId);
}

function main() {
  const entries = loadNodes().sort((a, b) => a.node.id.localeCompare(b.node.id));
  const allNodes = entries.map((entry) => ({
    id: entry.node.id,
    title: entry.node.title,
    type: entry.node.type,
    domains: entry.node.domains,
    subdomains: entry.node.subdomains,
    path: entry.relativePath
  }));

  const byDomain = {};
  const byType = {};
  const aliases = {};
  const graphEdges = [];

  for (const entry of entries) {
    const node = entry.node;

    for (const domain of node.domains) {
      pushIndex(byDomain, domain, node.id);
    }

    pushIndex(byType, node.type, node.id);

    for (const alias of node.aliases) {
      const normalized = normalizeAlias(alias);
      if (!aliases[normalized]) {
        aliases[normalized] = [];
      }
      aliases[normalized].push(node.id);
    }

    for (const relation of ["prerequisites", "unlocks", "related"]) {
      for (const target of node[relation]) {
        graphEdges.push({
          source: node.id,
          target,
          relation
        });
      }
    }
  }

  for (const index of [byDomain, byType, aliases]) {
    for (const key of Object.keys(index)) {
      index[key] = Array.from(new Set(index[key])).sort();
    }
  }

  graphEdges.sort((a, b) => `${a.source}:${a.relation}:${a.target}`.localeCompare(`${b.source}:${b.relation}:${b.target}`));

  const indexRoot = path.join(atlasRoot, "indexes");
  writeJson(path.join(indexRoot, "all_nodes.json"), allNodes);
  writeJson(path.join(indexRoot, "by_domain.json"), byDomain);
  writeJson(path.join(indexRoot, "by_type.json"), byType);
  writeJson(path.join(indexRoot, "aliases.json"), aliases);
  writeJson(path.join(indexRoot, "graph_edges.json"), graphEdges);

  console.log(`Built Atlas indexes for ${allNodes.length} node(s) and ${graphEdges.length} edge(s).`);
}

main();
