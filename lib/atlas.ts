import { readdir, readFile } from "fs/promises";
import path from "path";

export type AtlasNode = {
  id: string;
  title: string;
  type: string;
  domains: string[];
  subdomains: string[];
  summary: string;
  prerequisites: string[];
  unlocks: string[];
  related: string[];
  aliases: string[];
  tags: string[];
  sources: {
    wikipedia: string;
    britannica: string;
    openstax: string;
    stanford_encyclopedia: string;
  };
  status: string;
};

export type AtlasDomain = {
  id: string;
  title: string;
  subdomains: Array<{
    id: string;
    title: string;
  }>;
};

export type AtlasEdge = {
  source: string;
  target: string;
  relation: "prerequisite" | "unlock" | "related";
};

export type AtlasDiagnostics = {
  duplicateIds: string[];
  brokenLinks: Array<{
    source: string;
    target: string;
    relation: string;
  }>;
  circularPrerequisites: string[][];
  noConnections: string[];
  broadPrerequisiteUse: Array<{
    id: string;
    inbound: number;
  }>;
};

export type AtlasPayload = {
  generatedAt: string;
  nodes: AtlasNode[];
  domains: AtlasDomain[];
  edges: AtlasEdge[];
  indexes: {
    byDomain: Record<string, string[]>;
    byType: Record<string, string[]>;
    aliases: Record<string, string[]>;
  };
  diagnostics: AtlasDiagnostics;
  inventory?: AtlasInventoryPayload;
};

export type AtlasInventoryTerm = {
  id: string;
  title: string;
  domain: string;
  subdomains: string[];
  aliases: string[];
  sourceNames: string[];
  sourceUrls: string[];
  status: "candidate" | "review" | "rejected" | "promoted";
  promoted: boolean;
};

export type AtlasInventory = {
  domain: string;
  title: string;
  generatedAt: string;
  target: number;
  sources: Array<{
    name: string;
    url: string;
    status?: string;
    count?: number;
  }>;
  terms: AtlasInventoryTerm[];
};

export type AtlasInventoryPayload = {
  summary: {
    generatedAt: string;
    totalTerms: number;
    domains: Array<{
      domain: string;
      target: number;
      terms: number;
    }>;
  } | null;
  duplicates: {
    generatedAt: string;
    totalTerms: number;
    perDomainDuplicates: unknown[];
    senseCollisions: Array<{
      id: string;
      domains: string[];
      titles: string[];
    }>;
  } | null;
  domains: AtlasInventory[];
};

const ATLAS_ROOT = path.join(process.cwd(), "atlas");

async function walkJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkJsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".json") ? [fullPath] : [];
  }));

  return nested.flat().sort();
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function pushIndex(index: Record<string, string[]>, key: string, id: string) {
  if (!index[key]) index[key] = [];
  index[key].push(id);
}

function normalizeAlias(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function findCycles(nodes: AtlasNode[]) {
  const prereqById = new Map(nodes.map(node => [node.id, node.prerequisites || []]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(id: string, trail: string[]) {
    if (visiting.has(id)) {
      const start = trail.indexOf(id);
      cycles.push([...trail.slice(start), id]);
      return;
    }

    if (visited.has(id)) return;

    visiting.add(id);
    (prereqById.get(id) || []).forEach(prerequisiteId => visit(prerequisiteId, [...trail, prerequisiteId]));
    visiting.delete(id);
    visited.add(id);
  }

  nodes.forEach(node => visit(node.id, [node.id]));
  return cycles;
}

async function getInventoryPayload(): Promise<AtlasInventoryPayload> {
  const inventoryRoot = path.join(ATLAS_ROOT, "inventories");
  const summary = await readJson<AtlasInventoryPayload["summary"]>(path.join(inventoryRoot, "summary.json")).catch(() => null);
  const duplicates = await readJson<AtlasInventoryPayload["duplicates"]>(path.join(inventoryRoot, "duplicates.json")).catch(() => null);
  const inventoryDirs = await readdir(inventoryRoot, { withFileTypes: true }).catch(() => []);
  const inventories = await Promise.all(inventoryDirs
    .filter(entry => entry.isDirectory())
    .map(entry => readJson<AtlasInventory>(path.join(inventoryRoot, entry.name, "terms.json")).catch(() => null)));

  return {
    summary,
    duplicates,
    domains: inventories
      .filter((inventory): inventory is AtlasInventory => Boolean(inventory))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export async function getAtlasPayload(options: { includeInventory?: boolean } = {}): Promise<AtlasPayload> {
  const domainData = await readJson<{ domains: AtlasDomain[] }>(path.join(ATLAS_ROOT, "domains", "domains.json"));
  const nodeFiles = [
    ...(await walkJsonFiles(path.join(ATLAS_ROOT, "foundations"))),
    ...(await walkJsonFiles(path.join(ATLAS_ROOT, "nodes"))),
  ];
  const nodes = (await Promise.all(nodeFiles.map(file => readJson<AtlasNode>(file)))).sort((a, b) => a.title.localeCompare(b.title));
  const nodeIds = new Set<string>();
  const duplicateIds: string[] = [];
  const byDomain: Record<string, string[]> = {};
  const byType: Record<string, string[]> = {};
  const aliases: Record<string, string[]> = {};
  const edges: AtlasEdge[] = [];
  const brokenLinks: AtlasDiagnostics["brokenLinks"] = [];
  const inboundPrerequisites = new Map<string, number>();

  nodes.forEach(node => {
    if (nodeIds.has(node.id)) duplicateIds.push(node.id);
    nodeIds.add(node.id);
  });

  nodes.forEach(node => {
    node.domains.forEach(domain => pushIndex(byDomain, domain, node.id));
    pushIndex(byType, node.type, node.id);
    node.aliases.forEach(alias => pushIndex(aliases, normalizeAlias(alias), node.id));

    ([
      ["prerequisites", "prerequisite"],
      ["unlocks", "unlock"],
      ["related", "related"],
    ] as const).forEach(([field, relation]) => {
      node[field].forEach(target => {
        edges.push({ source: node.id, target, relation });
        if (!nodeIds.has(target)) brokenLinks.push({ source: node.id, target, relation });
        if (relation === "prerequisite") inboundPrerequisites.set(target, (inboundPrerequisites.get(target) || 0) + 1);
      });
    });
  });

  const sortIndex = (index: Record<string, string[]>) => {
    Object.keys(index).forEach(key => {
      index[key] = Array.from(new Set(index[key])).sort((a, b) => a.localeCompare(b));
    });
  };

  sortIndex(byDomain);
  sortIndex(byType);
  sortIndex(aliases);

  const noConnections = nodes
    .filter(node => !node.prerequisites.length && !node.unlocks.length && !node.related.length)
    .map(node => node.id);

  const broadPrerequisiteUse = Array.from(inboundPrerequisites.entries())
    .filter(([, inbound]) => inbound >= 20)
    .map(([id, inbound]) => ({ id, inbound }))
    .sort((a, b) => b.inbound - a.inbound || a.id.localeCompare(b.id));

  const payload: AtlasPayload = {
    generatedAt: new Date().toISOString(),
    nodes,
    domains: domainData.domains,
    edges: edges.sort((a, b) => `${a.source}:${a.relation}:${a.target}`.localeCompare(`${b.source}:${b.relation}:${b.target}`)),
    indexes: {
      byDomain,
      byType,
      aliases,
    },
    diagnostics: {
      duplicateIds,
      brokenLinks,
      circularPrerequisites: findCycles(nodes),
      noConnections,
      broadPrerequisiteUse,
    },
  };

  if (options.includeInventory) {
    payload.inventory = await getInventoryPayload();
  }

  return payload;
}
