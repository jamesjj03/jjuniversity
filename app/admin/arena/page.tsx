import { readdir, readFile } from "fs/promises";
import Image from "next/image";
import Link from "next/link";
import path from "path";
import type { CSSProperties } from "react";

type DraftPack = {
  id: string;
  title: string;
  category?: string;
  domain: string;
  status: string;
  publishable?: boolean;
  blockReasons?: string[];
  summary?: string;
  diagram?: {
    sourceId: string;
    imageSrc: string;
    width: number;
    height: number;
    mime: string;
    overlayMode: string;
  };
  approval?: Record<string, string>;
  automation?: {
    stages?: Array<{
      id: string;
      label: string;
      status: string;
      owner: string;
      detail: string;
    }>;
  };
  assetLedger?: Array<{
    id: string;
    source: string;
    license: string;
    licenseUrl?: string;
    attribution?: string;
    status: string;
    notes?: string;
  }>;
  targets?: DraftTarget[];
  correctionQueue?: DraftCorrection[];
};

type DraftTarget = {
  id: string;
  label: string;
  kind?: string;
  reviewStatus?: string;
  sourceShapeId?: string;
  confidence?: number;
  color?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
    cx: number;
    cy: number;
  };
  shape?: {
    type: "path";
    d: string;
  } | {
    type: "circle";
    cx: number;
    cy: number;
    r: number;
  } | {
    type: "ellipse";
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  };
  functions?: string[];
};

type DraftCorrection = {
  targetId?: string;
  field: string;
  message: string;
  status: string;
};

type CandidateFile = {
  generatedAt: string;
  candidates: DraftCandidate[];
};

type CandidateShortlistFile = {
  generatedAt: string;
  model?: string;
  criteria?: string[];
  shortlist: DraftCandidate[];
};

type DraftCandidate = {
  id: string;
  title: string;
  sourceUrl: string;
  kind: string;
  width: number;
  height: number;
  score: number;
  heuristicQuality?: number;
  allowed: boolean;
  originalUrl?: string;
  artist?: string;
  credit?: string;
  description?: string;
  curator?: {
    verdict: string;
    score: number;
    reason: string;
    useCase: string;
  };
  license?: {
    shortName?: string;
    url?: string;
  };
};

const DRAFT_ROOT = path.join(process.cwd(), "recall", "drafts");
const CANDIDATE_FILE = path.join(process.cwd(), "recall", "candidates", "wikimedia-brain-candidates.json");
const SHORTLIST_FILE = path.join(process.cwd(), "recall", "candidates", "wikimedia-brain-shortlist.json");

export const metadata = {
  title: "Arena Factory | JJ University",
  description: "Draft diagram packs for Arena review.",
};

export const dynamic = "force-dynamic";

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadDrafts() {
  try {
    const files = (await readdir(DRAFT_ROOT)).filter(file => file.endsWith(".json"));
    const drafts = await Promise.all(files.map(file => readJson<DraftPack>(path.join(DRAFT_ROOT, file))));
    return drafts
      .filter((draft): draft is DraftPack => Boolean(draft))
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch {
    return [];
  }
}

async function loadCandidates() {
  const shortlist = await readJson<CandidateShortlistFile>(SHORTLIST_FILE);
  if (shortlist?.shortlist?.length) return shortlist.shortlist;

  const file = await readJson<CandidateFile>(CANDIDATE_FILE);
  return (file?.candidates || [])
    .filter(candidate => candidate.allowed)
    .filter(candidate => /brain|cerebr|lobe|sagittal|lateral|cortex|gyri|neuro/i.test(`${candidate.title} ${candidate.description || ""}`))
    .slice(0, 16);
}

function statusClass(status = "") {
  if (status === "approved" || status === "complete") return "approved";
  if (status === "blocked") return "blocked";
  if (status === "active" || status === "needs-review") return "review";
  return "queued";
}

function verdictClass(verdict = "") {
  if (verdict === "promote") return "promote";
  if (verdict === "reject") return "reject";
  return "maybe";
}

function renderDraftTarget(target: DraftTarget) {
  const className = `adminArenaTarget ${target.kind === "dot" ? "dot" : ""}`;
  const shared = {
    className,
    "aria-label": target.label,
  };

  if (!target.shape) return null;

  if (target.shape.type === "path") {
    return (
      <a href={`#target-${target.id}`} key={target.id}>
        <path d={target.shape.d} {...shared}>
          <title>{target.label}</title>
        </path>
      </a>
    );
  }

  if (target.shape.type === "circle") {
    return (
      <a href={`#target-${target.id}`} key={target.id}>
        <circle cx={target.shape.cx} cy={target.shape.cy} r={target.shape.r} {...shared}>
          <title>{target.label}</title>
        </circle>
      </a>
    );
  }

  return (
    <a href={`#target-${target.id}`} key={target.id}>
      <ellipse cx={target.shape.cx} cy={target.shape.cy} rx={target.shape.rx} ry={target.shape.ry} {...shared}>
        <title>{target.label}</title>
      </ellipse>
    </a>
  );
}

export default async function ArenaFactoryPage() {
  const [drafts, candidates] = await Promise.all([loadDrafts(), loadCandidates()]);

  return (
    <main className="page adminArenaPage">
      <section className="adminArenaTop">
        <div>
          <p className="kicker">Admin</p>
          <h1>Arena Factory</h1>
        </div>
        <Link className="btn secondary" href="/arena">Open Arena</Link>
      </section>

      <section className="adminArenaDrafts" aria-label="Arena draft packs">
        {drafts.length ? drafts.map(draft => (
          <article className="adminArenaDraft" key={draft.id}>
            <div className="adminArenaDraftMedia">
              {draft.diagram ? (
                <div
                  className="adminArenaDiagramFrame"
                  style={{ "--diagram-ratio": `${draft.diagram.width} / ${draft.diagram.height}` } as CSSProperties}
                >
                  <Image
                    className="adminArenaDiagramImage"
                    src={draft.diagram.imageSrc}
                    alt={`${draft.title} source diagram`}
                    width={draft.diagram.width}
                    height={draft.diagram.height}
                    unoptimized
                  />
                  <svg
                    className="adminArenaOverlay"
                    viewBox={`0 0 ${draft.diagram.width} ${draft.diagram.height}`}
                    aria-label="Proposed hit zones"
                  >
                    {(draft.targets || []).map(renderDraftTarget)}
                  </svg>
                </div>
              ) : (
                <div className="adminArenaDiagram empty">No diagram</div>
              )}
            </div>

            <div className="adminArenaDraftBody">
              <header>
                <div>
                  <p className="kicker">{draft.category || "uncategorized"} / {draft.domain}</p>
                  <h2>{draft.title}</h2>
                </div>
                <span className={`adminArenaStatus ${draft.publishable ? "approved" : "blocked"}`}>
                  {draft.publishable ? "publishable" : "blocked"}
                </span>
              </header>

              {draft.summary && <p>{draft.summary}</p>}

              <div className="adminArenaActionRow" aria-label={`${draft.title} actions`}>
                <Link className="btn secondary" href="/arena">Open Arena</Link>
                {(draft.assetLedger || []).map(asset => (
                  <a className="btn secondary" href={asset.source} target="_blank" rel="noreferrer" key={`${asset.id}-source`}>
                    Source
                  </a>
                ))}
                {(draft.assetLedger || []).filter(asset => asset.licenseUrl).map(asset => (
                  <a className="btn secondary" href={asset.licenseUrl} target="_blank" rel="noreferrer" key={`${asset.id}-license`}>
                    License
                  </a>
                ))}
              </div>

              <div className="adminArenaStatusGrid" aria-label="Approval gates">
                {Object.entries(draft.approval || {}).map(([key, value]) => (
                  <span className={statusClass(value)} key={key}>
                    <strong>{key}</strong>
                    <em>{value}</em>
                  </span>
                ))}
              </div>

              <div className="adminArenaMetaGrid">
                <div>
                  <strong>Targets</strong>
                  <span>{draft.targets?.length || 0}</span>
                </div>
                <div>
                  <strong>Corrections</strong>
                  <span>{draft.correctionQueue?.length || 0}</span>
                </div>
                <div>
                  <strong>Overlay</strong>
                  <span>{draft.diagram?.overlayMode || "unset"}</span>
                </div>
              </div>

              <section className="adminArenaSource" aria-label="Source and license">
                {(draft.assetLedger || []).map(asset => (
                  <div key={asset.id}>
                    <strong>{asset.attribution || asset.id}</strong>
                    <span>{asset.license}</span>
                    <a href={asset.source} target="_blank" rel="noreferrer">Source</a>
                    {asset.licenseUrl && <a href={asset.licenseUrl} target="_blank" rel="noreferrer">License</a>}
                  </div>
                ))}
              </section>

              <section className="adminArenaStages" aria-label="Pipeline stages">
                {(draft.automation?.stages || []).map(stage => (
                  <div className={statusClass(stage.status)} key={stage.id}>
                    <strong>{stage.label}</strong>
                    <span>{stage.status}</span>
                  </div>
                ))}
              </section>

              {draft.blockReasons?.length ? (
                <div className="adminArenaBlocks">
                  {draft.blockReasons.map(reason => <span key={reason}>{reason}</span>)}
                </div>
              ) : null}

              {draft.targets?.length ? (
                <section className="adminArenaReviewList" aria-label="Proposed targets">
                  <header>
                    <h3>Proposed Targets</h3>
                    <span>{draft.targets.length} found</span>
                  </header>
                  <div>
                    {draft.targets.map(target => (
                      <article id={`target-${target.id}`} key={target.id}>
                        <strong>{target.label}</strong>
                        <span>{target.sourceShapeId || target.id}</span>
                        <em>{target.reviewStatus || "needs-review"}</em>
                        <p>
                          {target.bounds
                            ? `x ${Math.round(target.bounds.x)}, y ${Math.round(target.bounds.y)}, ${Math.round(target.bounds.width)} x ${Math.round(target.bounds.height)}`
                            : "No bounds recorded."}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {draft.correctionQueue?.length ? (
                <section className="adminArenaReviewList" aria-label="Correction queue">
                  <header>
                    <h3>Correction Queue</h3>
                    <span>{draft.correctionQueue.length} open</span>
                  </header>
                  <div>
                    {draft.correctionQueue.map((item, index) => (
                      <article key={`${item.targetId || "draft"}-${item.field}-${index}`}>
                        <strong>{item.field}</strong>
                        <span>{item.targetId || draft.id}</span>
                        <em>{item.status}</em>
                        <p>{item.message}</p>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </article>
        )) : (
          <article className="adminArenaEmpty">
            <h2>No draft packs yet.</h2>
          </article>
        )}
      </section>

      {candidates.length ? (
        <section className="adminArenaCandidates" aria-label="Curated diagram candidates">
          <header>
            <div>
              <p className="kicker">Source Hunt</p>
              <h2>Curated Shortlist</h2>
            </div>
            <span>{candidates.length} ranked</span>
          </header>

          <div>
            {candidates.map(candidate => (
              <article className={verdictClass(candidate.curator?.verdict)} key={candidate.id}>
                {candidate.curator?.verdict && (
                  <span className="adminArenaCandidateVerdict">{candidate.curator.verdict}</span>
                )}
                <strong>{candidate.title.replace(/^File:/, "")}</strong>
                <p>{candidate.description || candidate.artist || candidate.credit || "No description in metadata."}</p>
                {candidate.curator?.reason && <p className="adminArenaCuratorNote">{candidate.curator.reason}</p>}
                <div>
                  <span>{candidate.kind}</span>
                  <span>{candidate.width} x {candidate.height}</span>
                  <span>{candidate.license?.shortName || "license unknown"}</span>
                  <span>score {candidate.curator?.score ?? candidate.score}</span>
                </div>
                <div className="adminArenaActionRow compact">
                  <a className="btn secondary" href={candidate.sourceUrl} target="_blank" rel="noreferrer">Source</a>
                  {candidate.license?.url && <a className="btn secondary" href={candidate.license.url} target="_blank" rel="noreferrer">License</a>}
                  {candidate.originalUrl && <a className="btn secondary" href={candidate.originalUrl} target="_blank" rel="noreferrer">Image</a>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
