"use client";

import { useState } from "react";
import type { AtlasBranch, AtlasGroup, AtlasMap, AtlasMapsData, AtlasTerritory } from "@/lib/atlasMaps";

type Selection = {
  territoryId: string;
  branchId: string;
  mapId: string;
  groupId: string;
};

type AtlasMapsClientProps = {
  data: AtlasMapsData;
};

function firstBranch(territory: AtlasTerritory | undefined) {
  return territory?.branches[0];
}

function firstMap(branch: AtlasBranch | undefined) {
  return branch?.maps[0];
}

function firstGroup(map: AtlasMap | undefined) {
  return map?.groups[0];
}

function initialSelection(data: AtlasMapsData): Selection {
  for (const territory of data.territories) {
    for (const branch of territory.branches) {
      const map = branch.maps.find(candidate => candidate.status === "live" && candidate.groups.length > 0);
      if (map) {
        return {
          territoryId: territory.id,
          branchId: branch.id,
          mapId: map.id,
          groupId: firstGroup(map)?.id || "",
        };
      }
    }
  }

  const territory = data.territories[0];
  const branch = firstBranch(territory);
  const map = firstMap(branch);

  return {
    territoryId: territory?.id || "",
    branchId: branch?.id || "",
    mapId: map?.id || "",
    groupId: firstGroup(map)?.id || "",
  };
}

function className(base: string, active: boolean) {
  return active ? `${base} active` : base;
}

function buildWebNodes(map: AtlasMap | undefined) {
  if (!map?.groups.length) return [];
  const centerX = 340;
  const centerY = 190;
  const radiusX = 250;
  const radiusY = 126;

  return map.groups.map((group, index) => {
    const angle = -Math.PI / 2 + (index / map.groups.length) * Math.PI * 2;
    return {
      id: group.id,
      label: group.shortTitle,
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  });
}

function DisclosureIcon({ open }: { open: boolean }) {
  return <span className="atlasMapsDisclosureIcon" aria-hidden="true">{open ? "−" : "+"}</span>;
}

export default function AtlasMapsClient({ data }: AtlasMapsClientProps) {
  const [selection, setSelection] = useState<Selection>(() => initialSelection(data));

  const selectedTerritory = data.territories.find(territory => territory.id === selection.territoryId);
  const selectedBranch = selectedTerritory?.branches.find(branch => branch.id === selection.branchId);
  const selectedMap = selectedBranch?.maps.find(map => map.id === selection.mapId);
  const selectedGroup = selectedMap?.groups.find(group => group.id === selection.groupId);
  const webNodes = buildWebNodes(selectedMap);
  const webNodeById = new Map(webNodes.map(node => [node.id, node]));

  const branchCount = data.territories.reduce((count, territory) => count + territory.branches.length, 0);
  const mapCount = data.territories.reduce(
    (count, territory) => count + territory.branches.reduce((branchTotal, branch) => branchTotal + branch.maps.length, 0),
    0,
  );
  const liveMapCount = data.territories.reduce(
    (count, territory) => count + territory.branches.reduce(
      (branchTotal, branch) => branchTotal + branch.maps.filter(map => map.status === "live").length,
      0,
    ),
    0,
  );

  function toggleTerritory(territory: AtlasTerritory) {
    setSelection(current => current.territoryId === territory.id
      ? { territoryId: "", branchId: "", mapId: "", groupId: "" }
      : { territoryId: territory.id, branchId: "", mapId: "", groupId: "" });
  }

  function toggleBranch(territory: AtlasTerritory, branch: AtlasBranch) {
    setSelection(current => current.branchId === branch.id
      ? { territoryId: territory.id, branchId: "", mapId: "", groupId: "" }
      : { territoryId: territory.id, branchId: branch.id, mapId: "", groupId: "" });
  }

  function toggleMap(territory: AtlasTerritory, branch: AtlasBranch, map: AtlasMap) {
    setSelection(current => current.mapId === map.id
      ? { territoryId: territory.id, branchId: branch.id, mapId: "", groupId: "" }
      : { territoryId: territory.id, branchId: branch.id, mapId: map.id, groupId: "" });
  }

  function toggleGroup(group: AtlasGroup) {
    setSelection(current => ({ ...current, groupId: current.groupId === group.id ? "" : group.id }));
  }

  function openGroup(group: AtlasGroup) {
    setSelection(current => ({ ...current, groupId: group.id }));
  }

  return (
    <main className="atlasMapsPage page">
      <section className="atlasMapsHeader" aria-labelledby="atlas-title">
        <div>
          <p className="atlasMapsKicker">Knowledge maps</p>
          <h1 id="atlas-title">Atlas</h1>
          <p className="pageTagline">
            One expanding route through fields, theories, people, and schools—organized by shape instead of alphabet.
          </p>
        </div>
        <dl className="atlasMapsHeaderStats" aria-label="Atlas coverage">
          <div><dt>Territories</dt><dd>{data.territories.length}</dd></div>
          <div><dt>Branches</dt><dd>{branchCount}</dd></div>
          <div><dt>Maps</dt><dd>{liveMapCount} live / {mapCount}</dd></div>
        </dl>
      </section>

      <section className="atlasMapsExplorer" aria-labelledby="atlas-explorer-title">
        <header className="atlasMapsExplorerHeader">
          <div>
            <p className="atlasMapsKicker">Atlas navigator</p>
            <h2 id="atlas-explorer-title">Open a path</h2>
            <p>Each choice unfolds inside the last one. Open only as much of the Atlas as you need.</p>
          </div>
          <button
            className="atlasMapsCollapseAll"
            type="button"
            onClick={() => setSelection({ territoryId: "", branchId: "", mapId: "", groupId: "" })}
            disabled={!selection.territoryId}
          >
            Collapse all
          </button>
        </header>

        <div className="atlasMapsTree">
          {data.territories.map((territory, territoryIndex) => {
            const territoryOpen = territory.id === selection.territoryId;
            const territoryPanelId = `atlas-territory-${territory.id}`;

            return (
              <article className={className("atlasMapsTreeNode atlasMapsTerritoryNode", territoryOpen)} key={territory.id}>
                <button
                  className="atlasMapsDisclosure atlasMapsTerritoryDisclosure"
                  type="button"
                  aria-expanded={territoryOpen}
                  aria-controls={territoryPanelId}
                  onClick={() => toggleTerritory(territory)}
                >
                  <DisclosureIcon open={territoryOpen} />
                  <span className="atlasMapsNodeIndex">{String(territoryIndex + 1).padStart(2, "0")}</span>
                  <span className="atlasMapsDisclosureCopy">
                    <small>Territory · {territory.branches.length} {territory.branches.length === 1 ? "branch" : "branches"}</small>
                    <strong>{territory.title}</strong>
                    <span>{territory.summary}</span>
                  </span>
                </button>

                {territoryOpen && (
                  <div className="atlasMapsTreeChildren atlasMapsBranchLayer" id={territoryPanelId}>
                    {territory.branches.map((branch, branchIndex) => {
                      const branchOpen = branch.id === selection.branchId;
                      const branchPanelId = `atlas-branch-${branch.id}`;

                      return (
                        <article className={className("atlasMapsTreeNode atlasMapsBranchNode", branchOpen)} key={branch.id}>
                          <button
                            className="atlasMapsDisclosure atlasMapsBranchDisclosure"
                            type="button"
                            aria-expanded={branchOpen}
                            aria-controls={branchPanelId}
                            onClick={() => toggleBranch(territory, branch)}
                          >
                            <DisclosureIcon open={branchOpen} />
                            <span className="atlasMapsNodeIndex">{String(branchIndex + 1).padStart(2, "0")}</span>
                            <span className="atlasMapsDisclosureCopy">
                              <small>Branch · {branch.maps.length} {branch.maps.length === 1 ? "map" : "maps"}</small>
                              <strong>{branch.title}</strong>
                              <span>{branch.summary}</span>
                            </span>
                          </button>

                          {branchOpen && (
                            <div className="atlasMapsTreeChildren atlasMapsMapLayer" id={branchPanelId}>
                              {branch.maps.map((map, mapIndex) => {
                                const mapOpen = map.id === selection.mapId;
                                const mapPanelId = `atlas-map-${map.id}`;

                                return (
                                  <article className={className("atlasMapsTreeNode atlasMapsMapNode", mapOpen)} key={map.id}>
                                    <button
                                      className="atlasMapsDisclosure atlasMapsMapDisclosure"
                                      type="button"
                                      aria-expanded={mapOpen}
                                      aria-controls={mapPanelId}
                                      onClick={() => toggleMap(territory, branch, map)}
                                    >
                                      <DisclosureIcon open={mapOpen} />
                                      <span className="atlasMapsNodeIndex">{String(mapIndex + 1).padStart(2, "0")}</span>
                                      <span className="atlasMapsDisclosureCopy">
                                        <small>Map · {map.status === "live" ? `${map.groups.length} families` : "In the pipeline"}</small>
                                        <strong>{map.title}</strong>
                                        <span>{map.question}</span>
                                      </span>
                                      <em className={`atlasMapsStatus ${map.status}`}>{map.status === "live" ? "Live" : "Next"}</em>
                                    </button>

                                    {mapOpen && (
                                      <div className="atlasMapsMapBody" id={mapPanelId}>
                                        <article className="atlasMapsOverview">
                                          <div className="atlasMapsOverviewText">
                                            <p className="atlasMapsKicker">{branch.title}</p>
                                            <h2>{map.title}</h2>
                                            <p>{map.summary || map.subtitle}</p>
                                          </div>
                                          <dl className="atlasMapsMapFacts">
                                            <div><dt>Families</dt><dd>{map.groups.length || "Pending"}</dd></div>
                                            <div><dt>Relations</dt><dd>{map.relations.length || "Pending"}</dd></div>
                                          </dl>
                                        </article>

                                        {map.groups.length ? (
                                          <>
                                            <section className="atlasMapsWebPanel" aria-label={`${map.title} relation web`}>
                                              <div className="atlasMapsSectionHeading">
                                                <div>
                                                  <p className="atlasMapsKicker">Shape of the debate</p>
                                                  <h3>Relation map</h3>
                                                </div>
                                                <p>Select a node or open a family below.</p>
                                              </div>
                                              <svg className="atlasMapsWeb" viewBox="0 0 680 380" role="group" aria-label={`${map.title} relation web`}>
                                                <line className="atlasMapsAxis" x1="68" y1="190" x2="612" y2="190" />
                                                <line className="atlasMapsAxis" x1="340" y1="54" x2="340" y2="326" />
                                                <circle className="atlasMapsCore" cx="340" cy="190" r="58" />
                                                <text className="atlasMapsCoreText" x="340" y="184">Relation</text>
                                                <text className="atlasMapsCoreSubtext" x="340" y="204">map</text>

                                                {map.relations.map(relation => {
                                                  const source = webNodeById.get(relation.source);
                                                  const target = webNodeById.get(relation.target);
                                                  if (!source || !target) return null;

                                                  return (
                                                    <line
                                                      className={className("atlasMapsRelationLine", selectedGroup?.id === relation.source || selectedGroup?.id === relation.target)}
                                                      key={relation.id}
                                                      x1={source.x}
                                                      y1={source.y}
                                                      x2={target.x}
                                                      y2={target.y}
                                                    />
                                                  );
                                                })}

                                                {webNodes.map(node => {
                                                  const group = map.groups.find(candidate => candidate.id === node.id);
                                                  if (!group) return null;
                                                  const nodeActive = node.id === selectedGroup?.id;

                                                  return (
                                                    <g
                                                      className={className("atlasMapsWebNode", nodeActive)}
                                                      key={node.id}
                                                      role="button"
                                                      tabIndex={0}
                                                      aria-label={`Open ${group.title}`}
                                                      onClick={() => openGroup(group)}
                                                      onKeyDown={event => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                          event.preventDefault();
                                                          openGroup(group);
                                                        }
                                                      }}
                                                    >
                                                      <circle cx={node.x} cy={node.y} r={nodeActive ? 34 : 28} />
                                                      <text x={node.x} y={node.y + 4}>{node.label}</text>
                                                    </g>
                                                  );
                                                })}
                                              </svg>
                                            </section>

                                            <section className="atlasMapsFamilies" aria-labelledby={`atlas-families-${map.id}`}>
                                              <div className="atlasMapsSectionHeading">
                                                <div>
                                                  <p className="atlasMapsKicker">Theory families</p>
                                                  <h3 id={`atlas-families-${map.id}`}>Open the ideas</h3>
                                                </div>
                                                <p>Each family carries its claim, significance, objections, names, and connections.</p>
                                              </div>

                                              <div className="atlasMapsFamilyList">
                                                {map.groups.map((group, groupIndex) => {
                                                  const groupOpen = group.id === selection.groupId;
                                                  const groupPanelId = `atlas-family-${group.id}`;
                                                  const relatedGroups = map.groups.filter(candidate => group.relatedGroupIds.includes(candidate.id));
                                                  const relationNotes = map.relations.filter(relation => relation.source === group.id || relation.target === group.id);

                                                  return (
                                                    <article className={className("atlasMapsFamily", groupOpen)} id={`atlas-family-row-${group.id}`} key={group.id}>
                                                      <button
                                                        className="atlasMapsDisclosure atlasMapsFamilyDisclosure"
                                                        type="button"
                                                        aria-expanded={groupOpen}
                                                        aria-controls={groupPanelId}
                                                        onClick={() => toggleGroup(group)}
                                                      >
                                                        <DisclosureIcon open={groupOpen} />
                                                        <span className="atlasMapsNodeIndex">{String(groupIndex + 1).padStart(2, "0")}</span>
                                                        <span className="atlasMapsDisclosureCopy">
                                                          <small>{group.family}</small>
                                                          <strong>{group.title}</strong>
                                                          <span>{group.stance}</span>
                                                        </span>
                                                      </button>

                                                      {groupOpen && (
                                                        <div className="atlasMapsFamilyDetail" id={groupPanelId}>
                                                          <div className="atlasMapsClaimGrid">
                                                            <section>
                                                              <h4>Central claim</h4>
                                                              <p>{group.centralClaim}</p>
                                                            </section>
                                                            <section>
                                                              <h4>Why it matters</h4>
                                                              <p>{group.whyItMatters}</p>
                                                            </section>
                                                          </div>

                                                          <section className="atlasMapsDetailBlock">
                                                            <h4>Names and texts</h4>
                                                            <div className="atlasMapsContributorList">
                                                              {group.contributors.map(contributor => (
                                                                <article key={contributor.id}>
                                                                  <strong>{contributor.name}</strong>
                                                                  <span>{contributor.role}</span>
                                                                  <p>{contributor.reason}</p>
                                                                  <small>{contributor.texts.map(text => text.title).join(", ")}</small>
                                                                </article>
                                                              ))}
                                                            </div>
                                                          </section>

                                                          {group.objections.length > 0 && (
                                                            <section className="atlasMapsDetailBlock">
                                                              <h4>Pressure points</h4>
                                                              <ul className="atlasMapsObjectionList">
                                                                {group.objections.map(objection => <li key={objection}>{objection}</li>)}
                                                              </ul>
                                                            </section>
                                                          )}

                                                          {relationNotes.length > 0 && (
                                                            <section className="atlasMapsDetailBlock">
                                                              <h4>Connections</h4>
                                                              <div className="atlasMapsRelationNotes">
                                                                {relationNotes.map(relation => (
                                                                  <article key={relation.id}>
                                                                    <span>{relation.kind}</span>
                                                                    <p>{relation.note}</p>
                                                                  </article>
                                                                ))}
                                                              </div>
                                                            </section>
                                                          )}

                                                          {relatedGroups.length > 0 && (
                                                            <section className="atlasMapsDetailBlock">
                                                              <h4>Continue through Atlas</h4>
                                                              <div className="atlasMapsRelatedList">
                                                                {relatedGroups.map(relatedGroup => (
                                                                  <button key={relatedGroup.id} type="button" onClick={() => openGroup(relatedGroup)}>
                                                                    {relatedGroup.shortTitle}
                                                                  </button>
                                                                ))}
                                                              </div>
                                                            </section>
                                                          )}
                                                        </div>
                                                      )}
                                                    </article>
                                                  );
                                                })}
                                              </div>
                                            </section>
                                          </>
                                        ) : (
                                          <section className="atlasMapsQueuedState" aria-label="Queued map status">
                                            <p className="atlasMapsKicker">Coming next</p>
                                            <h2>{map.title}</h2>
                                            <p>{map.subtitle}</p>
                                            <p>{map.summary}</p>
                                          </section>
                                        )}
                                      </div>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
