"use client";

import { useState } from "react";
import type { AtlasBranch, AtlasMap, AtlasMapsData, AtlasTerritory, AtlasTheoryGroup } from "@/lib/atlasMaps";

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

function countLiveMaps(data: AtlasMapsData) {
  return data.territories.reduce((total, territory) => (
    total + territory.branches.reduce((branchTotal, branch) => (
      branchTotal + branch.maps.filter(map => map.status === "live").length
    ), 0)
  ), 0);
}

function countQueuedMaps(data: AtlasMapsData) {
  return data.territories.reduce((total, territory) => (
    total + territory.branches.reduce((branchTotal, branch) => (
      branchTotal + branch.maps.filter(map => map.status === "queued").length
    ), 0)
  ), 0);
}

function className(base: string, active: boolean) {
  return active ? `${base} active` : base;
}

function relationLabel(kind: string) {
  return kind.replace(/-/g, " ");
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
  const liveMaps = countLiveMaps(data);
  const queuedMaps = countQueuedMaps(data);

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

  function selectGroup(group: AtlasTheoryGroup) {
    setSelection(current => ({ ...current, groupId: group.id }));
  }

  return (
    <main className="atlasMapsPage page">
      <section className="atlasMapsHeader" aria-labelledby="atlas-title">
        <div>
          <p className="atlasMapsKicker">Atlas system</p>
          <h1 id="atlas-title">Atlas</h1>
          <p className="pageTagline">
            A branching map engine for fields, theories, people, schools, influence chains, and the reasons each node matters.
          </p>
        </div>

        <dl className="atlasMapsStats" aria-label="Atlas status">
          <div>
            <dt>Territories</dt>
            <dd>{data.territories.length}</dd>
          </div>
          <div>
            <dt>Live maps</dt>
            <dd>{liveMaps}</dd>
          </div>
          <div>
            <dt>Pipeline</dt>
            <dd>{queuedMaps}</dd>
          </div>
        </dl>
      </section>

      <section className="atlasMapsWorkbench" aria-label="Atlas map workbench">
        <aside className="atlasMapsRail" aria-label="Atlas territories">
          <div className="atlasMapsPanelHeading">
            <span>Layer 1</span>
            <h2>Territories</h2>
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
                <small>{territory.summary}</small>
              </button>
            ))}
          </div>

          <div className="atlasMapsPipeline">
            <strong>Pipeline target</strong>
            <p>Ingest sources, cluster names and schools, review collisions, then publish maps as stable Atlas branches.</p>
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
                <small>{branch.maps.length} map{branch.maps.length === 1 ? "" : "s"}</small>
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
                <small>{map.status}</small>
              </button>
            ))}
          </div>

          {selectedMap && (
            <article className="atlasMapsOverview">
              <div className="atlasMapsOverviewText">
                <p className="atlasMapsKicker">{selectedMap.status === "live" ? "Live map" : "Queued map"}</p>
                <h2>{selectedMap.title}</h2>
                <p>{selectedMap.subtitle}</p>
                <q>{selectedMap.question}</q>
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
                <div>
                  <dt>Mode</dt>
                  <dd>{selectedMap.buildMode}</dd>
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
                    <small>{group.stance}</small>
                  </button>
                ))}
              </section>
            </>
          ) : (
            <section className="atlasMapsQueuedState" aria-label="Queued map status">
              <p className="atlasMapsKicker">Pipeline-ready shell</p>
              <h2>{selectedMap?.title} is staged, not populated.</h2>
              <p>{selectedMap?.summary}</p>
              <div>
                <span>Source ingest</span>
                <span>Model clustering</span>
                <span>Review pass</span>
                <span>Publish map</span>
              </div>
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
                <h3>Core claim</h3>
                <p>{selectedGroup.centralClaim}</p>
              </section>

              <section className="atlasMapsDetailBlock">
                <h3>Why it matters</h3>
                <p>{selectedGroup.whyItMatters}</p>
              </section>

              <section className="atlasMapsDetailBlock">
                <h3>Contributors</h3>
                <div className="atlasMapsContributorList">
                  {selectedGroup.contributors.map(contributor => (
                    <article key={contributor.name}>
                      <strong>{contributor.name}</strong>
                      <span>{contributor.role}</span>
                      <p>{contributor.reason}</p>
                      <small>{contributor.texts.join(", ")}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section className="atlasMapsDetailBlock">
                <h3>Pressure points</h3>
                <ul className="atlasMapsObjectionList">
                  {selectedGroup.objections.map(objection => (
                    <li key={objection}>{objection}</li>
                  ))}
                </ul>
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

              <section className="atlasMapsDetailBlock">
                <h3>Relation notes</h3>
                <div className="atlasMapsRelationNotes">
                  {selectedMap?.relations
                    .filter(relation => relation.source === selectedGroup.id || relation.target === selectedGroup.id)
                    .map(relation => (
                      <article key={`${relation.source}-${relation.target}-${relation.kind}`}>
                        <span>{relationLabel(relation.kind)}</span>
                        <p>{relation.note}</p>
                      </article>
                    ))}
                </div>
              </section>
            </>
          ) : (
            <div className="atlasMapsEmptyDetail">
              <p className="atlasMapsKicker">No family selected</p>
              <h2>Pick a live map family.</h2>
              <p>Queued maps will fill this panel once the source and model pipeline produces reviewed nodes.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
