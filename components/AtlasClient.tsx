"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type AtlasNode = {
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
  status: string;
};

type AtlasDomain = {
  id: string;
  title: string;
  subdomains: Array<{
    id: string;
    title: string;
  }>;
};

type AtlasDiagnostics = {
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

type AtlasPayload = {
  generatedAt: string;
  nodes: AtlasNode[];
  domains: AtlasDomain[];
  indexes: {
    byDomain: Record<string, string[]>;
    byType: Record<string, string[]>;
    aliases: Record<string, string[]>;
  };
  diagnostics: AtlasDiagnostics;
  inventory?: AtlasInventoryPayload;
};

type AtlasInventoryTerm = {
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

type AtlasInventory = {
  domain: string;
  title: string;
  target: number;
  sources: Array<{
    name: string;
    url: string;
    status?: string;
    count?: number;
  }>;
  terms: AtlasInventoryTerm[];
};

type AtlasInventoryPayload = {
  summary: {
    totalTerms: number;
    domains: Array<{
      domain: string;
      target: number;
      terms: number;
    }>;
  } | null;
  duplicates: {
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

type AtlasClientProps = {
  admin?: boolean;
  atlasVisible?: boolean;
  onAtlasVisibleChange?: (visible: boolean) => void;
};

const NODE_TYPE_LABELS: Record<string, string> = {
  foundation: "Foundation",
  concept: "Concept",
  object: "Object",
  process: "Process",
  theory: "Theory",
  person: "Person",
  event: "Event",
  place: "Place",
  tool: "Tool",
  text: "Text",
  institution: "Institution",
};

const NODE_TYPE_ORDER = [
  "all",
  "foundation",
  "concept",
  "object",
  "process",
  "theory",
  "tool",
  "text",
  "institution",
  "person",
  "event",
  "place",
];

const DOMAIN_COLORS = [
  "#67d7c1",
  "#f3c766",
  "#ef8d68",
  "#9fb7ff",
  "#79e08d",
  "#d6a2ff",
  "#f07aa8",
  "#82c7ff",
  "#d8dd72",
  "#f0a35d",
  "#b6d7a8",
  "#caa6ff",
  "#f6d365",
  "#85e3ff",
  "#ff9f9f",
  "#a7f3d0",
  "#c4b5fd",
  "#f9a8d4",
];

function labelFor(id: string, domains?: AtlasDomain[]) {
  const domain = domains?.find(item => item.id === id);
  return domain?.title || id.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function nodeMatches(node: AtlasNode, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    node.id,
    node.title,
    node.summary,
    node.type,
    ...node.domains,
    ...node.subdomains,
    ...node.aliases,
    ...node.tags,
  ].join(" ").toLowerCase().includes(q);
}

function connectionCount(node: AtlasNode) {
  return node.prerequisites.length + node.unlocks.length + node.related.length;
}

function promotionScore(term: AtlasInventoryTerm) {
  let score = 0;
  score += term.sourceNames.length * 8;
  if (term.sourceNames.some(sourceName => /glossary/i.test(sourceName))) score += 8;
  if (term.sourceNames.some(sourceName => /outline/i.test(sourceName))) score += 3;
  if (term.subdomains.length) score += 2;
  if (term.title.length <= 48) score += 3;
  if (term.title.length > 70) score -= 10;
  if (/^(a|an|the)\s+.{20,}/i.test(term.title)) score -= 18;
  if (/\b(treatise|handbook|manual|journal|proceedings|textbook|encyclopedia)\b/i.test(term.title)) score -= 18;
  return score;
}

function stableDomainColor(domain: string) {
  let total = 0;
  for (let index = 0; index < domain.length; index += 1) total += domain.charCodeAt(index);
  return DOMAIN_COLORS[total % DOMAIN_COLORS.length];
}

function mixDomainColor(node: AtlasNode) {
  const domains = node.domains.length ? node.domains : ["foundations"];
  const colors = domains.map(stableDomainColor).map(hex => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }));
  const mixed = colors.reduce((sum, color) => ({
    r: sum.r + color.r,
    g: sum.g + color.g,
    b: sum.b + color.b,
  }), { r: 0, g: 0, b: 0 });

  return `rgb(${Math.round(mixed.r / colors.length)}, ${Math.round(mixed.g / colors.length)}, ${Math.round(mixed.b / colors.length)})`;
}

export default function AtlasClient({ admin = false, atlasVisible = false, onAtlasVisibleChange }: AtlasClientProps) {
  const [data, setData] = useState<AtlasPayload | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("all");
  const [type, setType] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<"dependencies" | "catalog" | "quality" | "inventory">("dependencies");
  const [inventoryDomain, setInventoryDomain] = useState("physics");
  const [inventoryStatus, setInventoryStatus] = useState("candidate");
  const [inventoryMessage, setInventoryMessage] = useState("");

  useEffect(() => {
    fetch(admin ? "/api/atlas?inventories=1" : "/api/atlas")
      .then(response => response.json())
      .then((payload: AtlasPayload) => {
        setData(payload);
        setSelectedId(current => current || payload.nodes.find(node => node.id === "energy")?.id || payload.nodes[0]?.id || "");
        setInventoryDomain(current => payload.inventory?.domains.some(item => item.domain === current) ? current : payload.inventory?.domains[0]?.domain || current);
      })
      .catch(() => setData(null));
  }, [admin]);

  const nodeMap = useMemo(() => new Map((data?.nodes || []).map(node => [node.id, node])), [data]);
  const selected = selectedId ? nodeMap.get(selectedId) : undefined;
  const filteredNodes = useMemo(() => {
    const nodes = data?.nodes || [];
    return nodes
      .filter(node => nodeMatches(node, query))
      .filter(node => domain === "all" || node.domains.includes(domain))
      .filter(node => type === "all" || node.type === type)
      .sort((a, b) => connectionCount(b) - connectionCount(a) || a.title.localeCompare(b.title));
  }, [data, domain, query, type]);

  const domainOptions = useMemo(() => data?.domains || [], [data]);
  const typeOptions = useMemo(() => NODE_TYPE_ORDER.filter(item => item === "all" || data?.indexes.byType[item]?.length), [data]);
  const selectedLinks = selected ? {
    prerequisites: selected.prerequisites.map(id => nodeMap.get(id)).filter(Boolean) as AtlasNode[],
    unlocks: selected.unlocks.map(id => nodeMap.get(id)).filter(Boolean) as AtlasNode[],
    related: selected.related.map(id => nodeMap.get(id)).filter(Boolean) as AtlasNode[],
  } : { prerequisites: [], unlocks: [], related: [] };
  const statusCounts = data ? {
    nodes: data.nodes.length,
    domains: data.domains.length,
    links: data.nodes.reduce((sum, node) => sum + connectionCount(node), 0),
    issues: data.diagnostics.duplicateIds.length + data.diagnostics.brokenLinks.length + data.diagnostics.circularPrerequisites.length,
  } : { nodes: 0, domains: 0, links: 0, issues: 0 };
  const selectedInventory = data?.inventory?.domains.find(item => item.domain === inventoryDomain);
  const inventoryTerms = useMemo(() => {
    const terms = selectedInventory?.terms || [];
    return terms
      .filter(term => inventoryStatus === "all" || term.status === inventoryStatus)
      .filter(term => {
        const q = query.trim().toLowerCase();
        if (!q || view !== "inventory") return true;
        return [term.id, term.title, ...term.aliases, ...term.subdomains, ...term.sourceNames].join(" ").toLowerCase().includes(q);
      })
      .sort((a, b) => promotionScore(b) - promotionScore(a) || a.title.localeCompare(b.title));
  }, [inventoryStatus, query, selectedInventory, view]);
  const inventoryCounts = useMemo(() => {
    const terms = selectedInventory?.terms || [];
    return {
      candidate: terms.filter(term => term.status === "candidate").length,
      review: terms.filter(term => term.status === "review").length,
      rejected: terms.filter(term => term.status === "rejected").length,
      promoted: terms.filter(term => term.status === "promoted").length,
    };
  }, [selectedInventory]);

  async function setInventoryTermStatus(term: AtlasInventoryTerm, status: "candidate" | "review" | "rejected") {
    if (!data?.inventory) return;
    setInventoryMessage(`Saving ${term.title}...`);
    try {
      const response = await fetch("/api/admin/atlas-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: term.domain, id: term.id, status }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Inventory update failed.");
      setData(current => {
        if (!current?.inventory) return current;
        return {
          ...current,
          inventory: {
            ...current.inventory,
            domains: current.inventory.domains.map(inventory => inventory.domain === term.domain ? {
              ...inventory,
              terms: inventory.terms.map(item => item.id === term.id ? { ...item, status } : item),
            } : inventory),
          },
        };
      });
      setInventoryMessage(`${term.title} marked ${status === "review" ? "approved" : status}.`);
    } catch (error) {
      setInventoryMessage(error instanceof Error ? error.message : "Inventory update failed.");
    }
  }

  const Shell = admin ? "section" : "main";

  if (!data) {
    return (
      <Shell className={`atlasExplorer ${admin ? "adminAtlasExplorer" : ""}`}>
        <div className="atlasExplorerHero">
          <p className="kicker">Atlas</p>
          <h1>Loading Atlas.</h1>
        </div>
      </Shell>
    );
  }

  return (
    <Shell className={`atlasExplorer ${admin ? "adminAtlasExplorer" : ""}`}>
      <header className="atlasExplorerHero">
        <div>
          <p className="kicker">{admin ? "Atlas Admin" : "JJ University Atlas"}</p>
          <h1>What stands between me and understanding this?</h1>
          <p className="pageTagline">A dependency map for concepts, domains, prerequisites, unlocks, and nearby ideas.</p>
        </div>
        <div className="atlasOperatorPanel">
          <div><strong>{statusCounts.nodes}</strong><span>Nodes</span></div>
          <div><strong>{statusCounts.links}</strong><span>Links</span></div>
          <div><strong>{statusCounts.issues}</strong><span>Hard issues</span></div>
          {admin && (
            <label className="adminToggle atlasVisibilityToggle">
              <input
                type="checkbox"
                checked={atlasVisible}
                onChange={event => onAtlasVisibleChange?.(event.target.checked)}
              />
              <span>{atlasVisible ? "Public" : "Hidden"}</span>
            </label>
          )}
        </div>
      </header>

      <nav className="atlasModeTabs" aria-label="Atlas views">
        {[
          ["dependencies", "Dependencies"],
          ["catalog", "Catalog"],
          ["quality", "Quality"],
          ...(admin ? [["inventory", "Inventory"]] : []),
        ].map(([id, label]) => (
          <button className={view === id ? "active" : ""} key={id} type="button" onClick={() => setView(id as typeof view)}>
            {label}
          </button>
        ))}
      </nav>

      <section className="atlasControls">
        <label>
          <span>Search</span>
          <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="entropy, memory, power, language..." />
        </label>
        <label>
          <span>Domain</span>
          <select className="select" value={domain} onChange={event => setDomain(event.target.value)}>
            <option value="all">All domains</option>
            {domainOptions.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select>
        </label>
        <label>
          <span>Layer type</span>
          <select className="select" value={type} onChange={event => setType(event.target.value)}>
            {typeOptions.map(item => <option value={item} key={item}>{item === "all" ? "All types" : NODE_TYPE_LABELS[item] || item}</option>)}
          </select>
        </label>
      </section>

      {view === "dependencies" && (
        <section className="atlasDependencyGrid">
          <aside className="atlasNodeList" aria-label="Atlas nodes">
            <div className="atlasListHeader">
              <strong>{filteredNodes.length}</strong>
              <span>matching nodes</span>
            </div>
            {filteredNodes.slice(0, 180).map(node => (
              <button
                className={node.id === selectedId ? "active" : ""}
                key={node.id}
                type="button"
                onClick={() => setSelectedId(node.id)}
              >
                <span className="atlasColorDot" style={{ background: mixDomainColor(node) }} />
                <strong>{node.title}</strong>
                <small>{NODE_TYPE_LABELS[node.type] || node.type} / {connectionCount(node)} links</small>
              </button>
            ))}
          </aside>

          <section className="atlasNodeDetail">
            {selected ? (
              <>
                <div className="atlasSelectedNode" style={{ "--nodeColor": mixDomainColor(selected) } as CSSProperties & Record<string, string>}>
                  <p className="kicker">{NODE_TYPE_LABELS[selected.type] || selected.type}</p>
                  <h2>{selected.title}</h2>
                  <p>{selected.summary}</p>
                  <div className="atlasPillRow">
                    {selected.domains.map(item => <span key={item}>{labelFor(item, data.domains)}</span>)}
                    {selected.subdomains.slice(0, 4).map(item => <span key={item}>{labelFor(item)}</span>)}
                  </div>
                </div>

                <div className="atlasFlow">
                  <LinkColumn title="What you need first" nodes={selectedLinks.prerequisites} empty="No strict prerequisites yet." onPick={setSelectedId} />
                  <div className="atlasFlowFocus">
                    <span className="atlasColorDot large" style={{ background: mixDomainColor(selected) }} />
                    <strong>{selected.title}</strong>
                    <small>{selected.id}</small>
                  </div>
                  <LinkColumn title="What this unlocks" nodes={selectedLinks.unlocks} empty="No unlocks mapped yet." onPick={setSelectedId} />
                </div>

                <section className="atlasRelatedPanel">
                  <div>
                    <h3>Nearby Ideas</h3>
                    <div className="atlasChipGrid">
                      {selectedLinks.related.length ? selectedLinks.related.map(node => (
                        <button key={node.id} type="button" onClick={() => setSelectedId(node.id)}>{node.title}</button>
                      )) : <p>No related ideas mapped yet.</p>}
                    </div>
                  </div>
                  <div>
                    <h3>Aliases and Tags</h3>
                    <div className="atlasChipGrid quiet">
                      {[...selected.aliases, ...selected.tags].slice(0, 18).map(item => <span key={item}>{item}</span>)}
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <div className="atlasSelectedNode">
                <h2>Select a node</h2>
              </div>
            )}
          </section>
        </section>
      )}

      {view === "catalog" && (
        <section className="atlasCatalogGrid">
          {filteredNodes.slice(0, 240).map(node => (
            <button className="atlasCatalogCard" key={node.id} type="button" onClick={() => {
              setSelectedId(node.id);
              setView("dependencies");
            }}>
              <span className="atlasColorDot" style={{ background: mixDomainColor(node) }} />
              <strong>{node.title}</strong>
              <p>{node.summary}</p>
              <small>{NODE_TYPE_LABELS[node.type] || node.type} / {node.domains.map(item => labelFor(item, data.domains)).join(", ")}</small>
            </button>
          ))}
        </section>
      )}

      {view === "quality" && (
        <section className="atlasQualityGrid">
          <QualityCard title="Broken Links" count={data.diagnostics.brokenLinks.length}>
            {data.diagnostics.brokenLinks.slice(0, 12).map(item => <li key={`${item.source}-${item.target}-${item.relation}`}>{item.source} / {item.relation} / {item.target}</li>)}
          </QualityCard>
          <QualityCard title="Duplicate IDs" count={data.diagnostics.duplicateIds.length}>
            {data.diagnostics.duplicateIds.slice(0, 12).map(item => <li key={item}>{item}</li>)}
          </QualityCard>
          <QualityCard title="Circular Prereqs" count={data.diagnostics.circularPrerequisites.length}>
            {data.diagnostics.circularPrerequisites.slice(0, 8).map(item => <li key={item.join("-")}>{item.join(" -> ")}</li>)}
          </QualityCard>
          <QualityCard title="Broad Prereq Pressure" count={data.diagnostics.broadPrerequisiteUse.length}>
            {data.diagnostics.broadPrerequisiteUse.slice(0, 12).map(item => <li key={item.id}>{item.id}: {item.inbound} inbound prereqs</li>)}
          </QualityCard>
          <QualityCard title="Disconnected Nodes" count={data.diagnostics.noConnections.length}>
            {data.diagnostics.noConnections.slice(0, 12).map(item => <li key={item}>{item}</li>)}
          </QualityCard>
        </section>
      )}

      {view === "inventory" && admin && data.inventory && (
        <section className="atlasInventoryShell">
          <div className="atlasInventoryStats">
            <div><strong>{data.inventory.summary?.totalTerms || 0}</strong><span>candidate terms</span></div>
            <div><strong>{data.inventory.domains.length}</strong><span>inventories</span></div>
            <div><strong>{data.inventory.duplicates?.senseCollisions.length || 0}</strong><span>sense collisions</span></div>
            <div><strong>{data.inventory.duplicates?.perDomainDuplicates.length || 0}</strong><span>duplicate errors</span></div>
          </div>

          {inventoryMessage && <div className="adminNotice atlasInventoryNotice">{inventoryMessage}</div>}

          <div className="atlasInventoryGrid">
            <aside className="atlasInventoryDomains">
              {data.inventory.domains.map(inventory => {
                const approved = inventory.terms.filter(term => term.status === "review").length;
                const rejected = inventory.terms.filter(term => term.status === "rejected").length;
                return (
                  <button
                    className={inventory.domain === inventoryDomain ? "active" : ""}
                    key={inventory.domain}
                    type="button"
                    onClick={() => setInventoryDomain(inventory.domain)}
                  >
                    <strong>{inventory.title}</strong>
                    <span>{inventory.terms.length}/{inventory.target} terms</span>
                    <small>{approved} approved / {rejected} rejected</small>
                  </button>
                );
              })}
            </aside>

            <section className="atlasInventoryReview">
              <header>
                <div>
                  <p className="kicker">Promotion Queue</p>
                  <h2>{selectedInventory?.title || "Inventory"}</h2>
                </div>
                <div className="atlasInventoryStatusTabs">
                  {[
                    ["candidate", `Candidates ${inventoryCounts.candidate}`],
                    ["review", `Approved ${inventoryCounts.review}`],
                    ["rejected", `Rejected ${inventoryCounts.rejected}`],
                    ["all", "All"],
                  ].map(([id, label]) => (
                    <button className={inventoryStatus === id ? "active" : ""} key={id} type="button" onClick={() => setInventoryStatus(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </header>

              <div className="atlasInventoryTerms">
                {inventoryTerms.slice(0, 80).map(term => (
                  <article className={`atlasInventoryTerm ${term.status}`} key={term.id}>
                    <div>
                      <strong>{term.title}</strong>
                      <span>{term.id}</span>
                      <small>{term.sourceNames.slice(0, 2).join(" / ") || "No source"}</small>
                    </div>
                    <div className="atlasInventoryTermActions">
                      <button disabled={term.status === "review"} type="button" onClick={() => setInventoryTermStatus(term, "review")}>Approve</button>
                      <button disabled={term.status === "rejected"} type="button" onClick={() => setInventoryTermStatus(term, "rejected")}>Reject</button>
                      {term.status !== "candidate" && <button type="button" onClick={() => setInventoryTermStatus(term, "candidate")}>Reset</button>}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <aside className="atlasInventoryCollisions">
              <p className="kicker">Collision Queue</p>
              <h3>Same ID, multiple domains</h3>
              {(data.inventory.duplicates?.senseCollisions || []).slice(0, 40).map(collision => (
                <article key={collision.id}>
                  <strong>{collision.id}</strong>
                  <span>{collision.domains.join(", ")}</span>
                </article>
              ))}
            </aside>
          </div>
        </section>
      )}
    </Shell>
  );
}

function LinkColumn({ title, nodes, empty, onPick }: { title: string; nodes: AtlasNode[]; empty: string; onPick: (id: string) => void }) {
  return (
    <section className="atlasFlowColumn">
      <h3>{title}</h3>
      <div>
        {nodes.length ? nodes.map(node => (
          <button key={node.id} type="button" onClick={() => onPick(node.id)}>
            <strong>{node.title}</strong>
            <small>{NODE_TYPE_LABELS[node.type] || node.type}</small>
          </button>
        )) : <p>{empty}</p>}
      </div>
    </section>
  );
}

function QualityCard({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <article className={count ? "atlasQualityCard needsWork" : "atlasQualityCard"}>
      <div>
        <h3>{title}</h3>
        <strong>{count}</strong>
      </div>
      <ul>{count ? children : <li>Clear.</li>}</ul>
    </article>
  );
}
