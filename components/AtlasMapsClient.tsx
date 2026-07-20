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

function firstBranch(territory: AtlasTerritory) {
  return territory.branches[0];
}

function firstMap(branch: AtlasBranch | undefined) {
  return branch?.maps[0];
}

function firstGroup(map: AtlasMap | undefined) {
  return map?.groups[0];
}

function selectionFrom(territory: AtlasTerritory, branch = firstBranch(territory), map = firstMap(branch)): Selection {
  return {
    territoryId: territory.id,
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

export default function AtlasMapsClient({ data }: AtlasMapsClientProps) {
  const [selection, setSelection] = useState<Selection>(() => selectionFrom(data.territories[0]));

  const selectedTerritory = data.territories.find(territory => territory.id === selection.territoryId) || data.territories[0];
  const selectedBranch = selectedTerritory.branches.find(branch => branch.id === selection.branchId) || firstBranch(selectedTerritory);
  const selectedMap = selectedBranch.maps.find(map => map.id === selection.mapId) || firstMap(selectedBranch);
  const selectedGroup = selectedMap?.groups.find(group => group.id === selection.groupId) || firstGroup(selectedMap);
  const relatedGroups = selectedMap?.groups.filter(group => selectedGroup?.relatedGroupIds.includes(group.id)) || [];

  const webNodes = buildWebNodes(selectedMap);
  const webNodeById = new Map(webNodes.map(node => [node.id, node]));

  function selectTerritory(territory: AtlasTerritory) {
    setSelection(selectionFrom(territory));
  }

  function selectBranch(branch: AtlasBranch) {
    setSelection(selectionFrom(selectedTerritory, branch));
  }

  function selectMap(map: AtlasMap) {
    setSelection({
      territoryId: selectedTerritory.id,
      branchId: selectedBranch.id,
      mapId: map.id,
      groupId: firstGroup(map)?.id || "",
    });
  }

  function selectGroup(group: AtlasGroup) {
    setSelection(current => ({ ...current, groupId: group.id }));
  }

  return (
    <main className="atlasMapsPage page">
      <section className="atlasMapsHeader" aria-labelledby="atlas-title">
        <div>
          <p className="atlasMapsKicker">Knowledge maps</p>
          <h1 id="atlas-title">Atlas</h1>
          <p className="pageTagline">
            Fields, theories, people, and schools arranged by shape instead of alphabet.
          </p>
        </div>
      </section>

      <section className="atlasMapsWorkbench" aria-label="Atlas map workbench">
        <aside className="atlasMapsRail" aria-label="Atlas territories">
          <div className="atlasMapsPanelHeading">
            <span>Browse</span>
            <h2>Territory</h2>
          </div>

          <div className="atlasMapsTerritories">
            {data.territories.map(territory => (
              <button
                className={className("atlasMapsTerritoryButton", territory.id === selectedTerritory.id)}
                key={territory.id}
                type="button"
                onClick={() => selectTerritory(territory)}
              >
                <span>{territory.title}</span>
                <small>{territory.branches.length} branches</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="atlasMapsMain" aria-label="Selected atlas map">
          <nav className="atlasMapsPath" aria-label="Atlas path">
            <span>{selectedTerritory.title}</span>
            <span>{selectedBranch.title}</span>
            <span>{selectedMap?.title || "No map"}</span>
          </nav>

          <div className="atlasMapsBranchStrip" aria-label="Branches">
            {selectedTerritory.branches.map(branch => (
              <button
                className={className("atlasMapsBranchButton", branch.id === selectedBranch.id)}
                key={branch.id}
                type="button"
                onClick={() => selectBranch(branch)}
              >
                <span>{branch.title}</span>
              </button>
            ))}
          </div>

          <div className="atlasMapsMapStrip" aria-label="Maps">
            {selectedBranch.maps.map(map => (
              <button
                className={className("atlasMapsMapButton", map.id === selectedMap?.id)}
                key={map.id}
                type="button"
                onClick={() => selectMap(map)}
              >
                <span>{map.title}</span>
                <small>{map.status === "live" ? "Open" : "Next"}</small>
              </button>
            ))}
          </div>

          {selectedMap && (
            <article className="atlasMapsOverview">
              <div className="atlasMapsOverviewText">
                <p className="atlasMapsKicker">{selectedMap.status === "live" ? selectedBranch.title : "Coming next"}</p>
                <h2>{selectedMap.title}</h2>
                <p>{selectedMap.question}</p>
              </div>

              <dl className="atlasMapsMapFacts">
                <div>
                  <dt>Families</dt>
                  <dd>{selectedMap.groups.length || "Pending"}</dd>
                </div>
                <div>
                  <dt>Relations</dt>
                  <dd>{selectedMap.relations.length || "Pending"}</dd>
                </div>
              </dl>
            </article>
          )}

          {selectedMap?.groups.length ? (
            <>
              <section className="atlasMapsWebPanel" aria-label="Theory relation web">
                <svg className="atlasMapsWeb" viewBox="0 0 680 380" role="img" aria-label={`${selectedMap.title} relation web`}>
                  <line className="atlasMapsAxis" x1="68" y1="190" x2="612" y2="190" />
                  <line className="atlasMapsAxis" x1="340" y1="54" x2="340" y2="326" />
                  <circle className="atlasMapsCore" cx="340" cy="190" r="58" />
                  <text className="atlasMapsCoreText" x="340" y="184">Consciousness</text>
                  <text className="atlasMapsCoreSubtext" x="340" y="204">problem space</text>

                  {selectedMap.relations.map(relation => {
                    const source = webNodeById.get(relation.source);
                    const target = webNodeById.get(relation.target);
                    if (!source || !target) return null;

                    return (
                      <line
                        className={className("atlasMapsRelationLine", selectedGroup?.id === relation.source || selectedGroup?.id === relation.target)}
                        key={`${relation.source}-${relation.target}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                      />
                    );
                  })}

                  {webNodes.map(node => (
                    <g className={className("atlasMapsWebNode", node.id === selectedGroup?.id)} key={node.id}>
                      <circle cx={node.x} cy={node.y} r={node.id === selectedGroup?.id ? 34 : 28} />
                      <text x={node.x} y={node.y + 4}>{node.label}</text>
                    </g>
                  ))}
                </svg>
              </section>

              <section className="atlasMapsGroupGrid" aria-label="Theory families">
                {selectedMap.groups.map(group => (
                  <button
                    className={className("atlasMapsTheoryCard", group.id === selectedGroup?.id)}
                    key={group.id}
                    type="button"
                    onClick={() => selectGroup(group)}
                  >
                    <span>{group.family}</span>
                    <strong>{group.title}</strong>
                  </button>
                ))}
              </section>
            </>
          ) : (
            <section className="atlasMapsQueuedState" aria-label="Queued map status">
              <p className="atlasMapsKicker">Coming next</p>
              <h2>{selectedMap?.title}</h2>
              <p>{selectedMap?.subtitle}</p>
            </section>
          )}
        </section>

        <aside className="atlasMapsDetail" aria-label="Selected theory detail">
          {selectedGroup ? (
            <>
              <div className="atlasMapsPanelHeading">
                <span>Selected family</span>
                <h2>{selectedGroup.title}</h2>
              </div>

              <p className="atlasMapsDetailStance">{selectedGroup.stance}</p>

              <section className="atlasMapsDetailBlock">
                <h3>Claim</h3>
                <p>{selectedGroup.centralClaim}</p>
              </section>

              <section className="atlasMapsDetailBlock">
                <h3>Signal</h3>
                <p>{selectedGroup.whyItMatters}</p>
              </section>

              <section className="atlasMapsDetailBlock">
                <h3>Names</h3>
                <div className="atlasMapsContributorList">
                  {selectedGroup.contributors.map(contributor => (
                    <article key={contributor.id}>
                      <strong>{contributor.name}</strong>
                      <span>{contributor.role}</span>
                      <p>{contributor.reason}</p>
                      <small>{contributor.texts.map(text => text.title).join(", ")}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section className="atlasMapsDetailBlock">
                <h3>Related</h3>
                <div className="atlasMapsRelatedList">
                  {relatedGroups.map(group => (
                    <button key={group.id} type="button" onClick={() => selectGroup(group)}>
                      {group.shortTitle}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="atlasMapsEmptyDetail">
              <p className="atlasMapsKicker">No family selected</p>
              <h2>Pick a live map family.</h2>
              <p>Maps open here when they have real structure.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
