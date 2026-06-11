const path = require("path");
const {
  atlasRoot,
  loadDomainMap,
  readJson,
  titleFromId,
  unique,
  writeJson
} = require("./atlas_utils");

const sourcesConfig = readJson(path.join(atlasRoot, "inventories", "sources.json"));
const { domainMap } = loadDomainMap();
const domainsById = new Map(domainMap.domains.map((domain) => [domain.id, domain]));

const STOP_TERMS = new Set([
  "a",
  "about",
  "article",
  "articles",
  "book",
  "books",
  "category",
  "citation",
  "commons",
  "contents",
  "edit",
  "external links",
  "file",
  "glossary",
  "help",
  "history",
  "isbn",
  "main page",
  "navigation",
  "notes",
  "outline",
  "portal",
  "references",
  "read",
  "retrieved",
  "see also",
  "source",
  "sources",
  "talk",
  "template",
  "terms",
  "view source",
  "wikibooks",
  "wikidata",
  "wikimedia commons",
  "wikipedia",
  "wikiquote",
  "wikiversity"
]);

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function cleanTitle(value) {
  return stripTags(value)
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+\((?:disambiguation|identifier|journal|magazine|website)\)$/i, "")
    .replace(/^[§•*\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

function isCandidateTitle(title) {
  const clean = title.trim();
  const lower = clean.toLowerCase();
  const id = normalizeTermId(clean);

  if (clean.length < 3 || clean.length > 80) return false;
  if (id.length < 3) return false;
  if (STOP_TERMS.has(lower) || STOP_TERMS.has(id)) return false;
  if (/^(ch\.|chapter|section|appendix|figure|table)\b/i.test(clean)) return false;
  if (/^(list of|index of|outline of|glossary of)\b/i.test(clean)) return false;
  if (/(privacy policy|terms of use|cookie|license|copyright|all rights reserved)/i.test(clean)) return false;
  if (/(doi:|isbn|issn|pmid|arxiv|retrieved|citation needed)/i.test(clean)) return false;
  if (/^\d/.test(clean)) return false;
  if (/^[a-z]\s+[a-z]$/i.test(clean)) return false;
  if (/^[a-z]_[a-z]$/i.test(id)) return false;
  if (/[Ââ�]/.test(clean) || id.startsWith("and_160")) return false;
  if (/^[A-Z]{2,}$/.test(clean) && clean.length > 8) return false;
  if ((clean.match(/[|{}[\]<>]/g) || []).length) return false;
  if ((clean.match(/\//g) || []).length > 1) return false;
  if (!/[a-zA-Z]/.test(clean)) return false;

  return Boolean(id);
}

function relevantHtml(html) {
  const main = html.match(/<main\b[\s\S]*?<\/main>/i);
  if (main) return main[0];
  const content = html.match(/<div[^>]+id=["']mw-content-text["'][\s\S]*?(?:<footer|<\/main>|<div[^>]+id=["']catlinks["'])/i);
  return content ? content[0] : html;
}

function extractTermsFromHtml(html, sourceUrl) {
  const content = relevantHtml(html);
  const terms = [];
  const seen = new Set();

  function add(value) {
    const title = cleanTitle(value);
    const id = normalizeTermId(title);
    if (!isCandidateTitle(title) || seen.has(id)) return;
    seen.add(id);
    terms.push(title);
  }

  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorPattern.exec(content))) {
    const attributes = anchorMatch[1];
    const hrefMatch = attributes.match(/\bhref=["']([^"']+)["']/i);
    const href = hrefMatch ? decodeEntities(hrefMatch[1]) : "";
    if (sourceUrl.includes("plato.stanford.edu")) {
      if (!href.includes("entries/")) continue;
    } else if (href) {
      if (!href.includes("/wiki/") && !href.startsWith("#")) continue;
      if (/\/wiki\/(?:File|Help|Special|Talk|Template|Category|Portal|Wikipedia|User):/i.test(href)) continue;
    }
    add(anchorMatch[2]);
  }

  const dtPattern = /<dt\b[^>]*>([\s\S]*?)<\/dt>/gi;
  let dtMatch;
  while ((dtMatch = dtPattern.exec(content))) {
    add(dtMatch[1]);
  }

  const boldPattern = /<(?:b|strong)\b[^>]*>([\s\S]{3,120}?)<\/(?:b|strong)>/gi;
  let boldMatch;
  while ((boldMatch = boldPattern.exec(content))) {
    add(boldMatch[1]);
  }

  return terms;
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AtlasInventoryBot/0.1 (local educational term inventory)"
      }
    });
    if (!response.ok) {
      return { ...source, status: `failed:${response.status}`, terms: [] };
    }
    const html = await response.text();
    const terms = extractTermsFromHtml(html, source.url);
    return { ...source, status: "ok", terms };
  } catch (error) {
    return { ...source, status: `failed:${error instanceof Error ? error.message : "unknown"}`, terms: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function seedSubdomainTerms(domainId) {
  const domain = domainsById.get(domainId);
  if (!domain) return [];
  return [
    domain.title,
    ...(domain.subdomains || []).map((subdomain) => subdomain.title)
  ];
}

function inferSubdomains(termTitle, domainId) {
  const domain = domainsById.get(domainId);
  if (!domain) return [];
  const normalized = normalizeTermId(termTitle);
  const matches = (domain.subdomains || [])
    .filter((subdomain) => {
      const subdomainId = subdomain.id;
      return normalized.includes(subdomainId) || subdomainId.split("_").some((part) => part.length > 4 && normalized.includes(part));
    })
    .map((subdomain) => subdomain.id);
  return unique(matches).slice(0, 4);
}

function buildInventory(domainConfig, fetchedSources) {
  const termsById = new Map();

  function addTerm(title, sourceName, sourceUrl) {
    const cleanedTitle = cleanTitle(title);
    if (!isCandidateTitle(cleanedTitle)) return;
    const id = normalizeTermId(cleanedTitle);
    if (!id || id === domainConfig.id) return;

    const existing = termsById.get(id);
    if (existing) {
      if (!existing.aliases.includes(cleanedTitle) && existing.title !== cleanedTitle) existing.aliases.push(cleanedTitle);
      if (sourceName && !existing.sourceNames.includes(sourceName)) existing.sourceNames.push(sourceName);
      if (sourceUrl && !existing.sourceUrls.includes(sourceUrl)) existing.sourceUrls.push(sourceUrl);
      return;
    }

    termsById.set(id, {
      id,
      title: cleanedTitle,
      domain: domainConfig.id,
      subdomains: inferSubdomains(cleanedTitle, domainConfig.id),
      aliases: [],
      sourceNames: sourceName ? [sourceName] : ["Atlas domain map"],
      sourceUrls: sourceUrl ? [sourceUrl] : [],
      status: "candidate",
      promoted: false
    });
  }

  seedSubdomainTerms(domainConfig.id).forEach((title) => addTerm(title, "Atlas domain map", ""));

  for (const source of fetchedSources) {
    source.terms.forEach((title) => addTerm(title, source.name, source.url));
  }

  const terms = Array.from(termsById.values())
    .sort((a, b) => {
      const connectionBias = Number(b.sourceNames.length > 1) - Number(a.sourceNames.length > 1);
      return connectionBias || a.title.localeCompare(b.title);
    })
    .slice(0, domainConfig.target)
    .map((term) => ({
      ...term,
      aliases: unique(term.aliases).sort(),
      sourceNames: unique(term.sourceNames).sort(),
      sourceUrls: unique(term.sourceUrls).filter(Boolean).sort()
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return {
    domain: domainConfig.id,
    title: domainConfig.title,
    generatedAt: new Date().toISOString(),
    target: domainConfig.target,
    sources: fetchedSources.map((source) => ({
      name: source.name,
      url: source.url,
      status: source.status,
      count: source.terms.length
    })),
    terms
  };
}

async function main() {
  const onlyDomain = process.argv.find((arg) => arg.startsWith("--domain="))?.split("=")[1];
  const domainConfigs = sourcesConfig.domains.filter((domain) => !onlyDomain || domain.id === onlyDomain);
  if (!domainConfigs.length) {
    throw new Error(`No inventory domains matched ${onlyDomain}`);
  }

  const summary = [];

  for (const domainConfig of domainConfigs) {
    console.log(`Building ${domainConfig.id} inventory...`);
    const fetchedSources = [];
    for (const source of domainConfig.sources) {
      const fetched = await fetchSource(source);
      fetchedSources.push(fetched);
      console.log(`  ${source.name}: ${fetched.status}, ${fetched.terms.length} candidate terms`);
    }

    const inventory = buildInventory(domainConfig, fetchedSources);
    const inventoryDir = path.join(atlasRoot, "inventories", domainConfig.id);
    writeJson(path.join(inventoryDir, "terms.json"), inventory);
    summary.push({
      domain: domainConfig.id,
      target: domainConfig.target,
      terms: inventory.terms.length,
      sources: inventory.sources
    });
  }

  writeJson(path.join(atlasRoot, "inventories", "summary.json"), {
    generatedAt: new Date().toISOString(),
    totalTerms: summary.reduce((sum, item) => sum + item.terms, 0),
    domains: summary
  });

  console.log(`Built ${summary.length} inventories with ${summary.reduce((sum, item) => sum + item.terms, 0)} total candidate terms.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
