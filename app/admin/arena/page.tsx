import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
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

type CandidateDecisionStatus = "new" | "approved" | "rejected" | "maybe" | "selected";

type CandidateDecision = {
  id: string;
  status: CandidateDecisionStatus;
  updatedAt: string;
  note?: string;
};

type CandidateDecisionFile = {
  generatedAt: string;
  decisions: CandidateDecision[];
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
  categories?: string[];
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
const DECISION_FILE = path.join(process.cwd(), "recall", "candidates", "brain-source-decisions.json");

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

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function setCandidateDecision(formData: FormData) {
  "use server";

  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "new") as CandidateDecisionStatus;
  if (!id || !["approved", "rejected", "maybe", "selected"].includes(status)) return;

  const file = await readJson<CandidateDecisionFile>(DECISION_FILE) || { generatedAt: "", decisions: [] };
  const others = (file.decisions || []).filter(item => item.id !== id);
  const decision: CandidateDecision = {
    id,
    status,
    updatedAt: new Date().toISOString(),
    note: String(formData.get("note") || ""),
  };

  await writeJson(DECISION_FILE, {
    generatedAt: new Date().toISOString(),
    decisions: [...others, decision].sort((a, b) => a.id.localeCompare(b.id)),
  });

  revalidatePath("/admin/arena");
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

async function loadDecisions() {
  const file = await readJson<CandidateDecisionFile>(DECISION_FILE);
  return new Map((file?.decisions || []).map(item => [item.id, item]));
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

function candidateType(candidate: DraftCandidate) {
  const haystack = `${candidate.title} ${candidate.description || ""} ${(candidate.categories || []).join(" ")}`.toLowerCase();
  if (/sagittal|midsag/i.test(haystack)) return "Sagittal";
  if (/lateral/i.test(haystack)) return "Lateral";
  if (/lobe|sulci|sulcus|gyri|gyrus|cortex/i.test(haystack)) return "Lobes";
  return "Other";
}

function groupCandidates(candidates: DraftCandidate[]) {
  const groups = ["Lateral", "Sagittal", "Lobes", "Other"].map(type => ({
    type,
    items: candidates.filter(candidate => candidateType(candidate) === type),
  }));

  return groups.filter(group => group.items.length);
}

function decisionFor(candidate: DraftCandidate, decisions: Map<string, CandidateDecision>) {
  return decisions.get(candidate.id)?.status || "new";
}

function candidateScore(candidate: DraftCandidate) {
  return candidate.curator?.score ?? candidate.heuristicQuality ?? candidate.score ?? 0;
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
  const [drafts, candidates, decisions] = await Promise.all([loadDrafts(), loadCandidates(), loadDecisions()]);
  const candidateGroups = groupCandidates(candidates);
  const selectedCandidates = candidates.filter(candidate => decisionFor(candidate, decisions) === "selected");
  const activeDrafts = drafts.filter(draft => draft.status !== "needs-rework");
  const parkedDrafts = drafts.filter(draft => draft.status === "needs-rework");

  return (
    <main className="page adminArenaPage">
      <section className="adminArenaTop">
        <div>
          <p className="kicker">Admin</p>
          <h1>Arena Factory</h1>
        </div>
        <Link className="btn secondary" href="/arena">Open Arena</Link>
      </section>

      {candidates.length ? (
        <section className="adminArenaSourcePicker" aria-label="Diagram source picker">
          <header>
            <div>
              <p className="kicker">Source Hunt</p>
              <h2>Pick The Diagram</h2>
            </div>
            <span>{candidates.length} ranked / {selectedCandidates.length} selected</span>
          </header>

          <div className="adminArenaCandidateGroups">
            {candidateGroups.map(group => (
              <section className="adminArenaCandidateGroup" key={group.type}>
                <div className="adminArenaGroupLabel">
                  <strong>{group.type}</strong>
                  <span>{group.items.length}</span>
                </div>
                <div className="adminArenaCandidateGallery">
                  {group.items.map(candidate => {
                    const decision = decisionFor(candidate, decisions);
                    return (
                      <article className={`adminArenaCandidateCard ${verdictClass(candidate.curator?.verdict)} ${decision}`} key={candidate.id}>
                        <div className="adminArenaCandidateImage">
                          {candidate.originalUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={candidate.originalUrl} alt={candidate.title.replace(/^File:/, "")} loading="lazy" />
                          ) : (
                            <span>No image</span>
                          )}
                        </div>
                        <div className="adminArenaCandidateBody">
                          <header>
                            <strong>{candidate.title.replace(/^File:/, "")}</strong>
                            <span>{decision}</span>
                          </header>
                          <p>{candidate.curator?.reason || candidate.description || candidate.artist || "No description in metadata."}</p>
                          <div className="adminArenaCandidateMeta">
                            <span>{candidate.kind}</span>
                            <span>{candidate.width} x {candidate.height}</span>
                            <span>{candidate.license?.shortName || "license unknown"}</span>
                            <span>score {candidateScore(candidate)}</span>
                          </div>
                          <form className="adminArenaDecisionRow" action={setCandidateDecision}>
                            <input type="hidden" name="id" value={candidate.id} />
                            <button type="submit" name="status" value="selected">Use</button>
                            <button type="submit" name="status" value="approved">Approve</button>
                            <button type="submit" name="status" value="maybe">Maybe</button>
                            <button type="submit" name="status" value="rejected">Reject</button>
                          </form>
                          <div className="adminArenaActionRow compact">
                            <a className="btn secondary" href={candidate.sourceUrl} target="_blank" rel="noreferrer">Source</a>
                            {candidate.license?.url && <a className="btn secondary" href={candidate.license.url} target="_blank" rel="noreferrer">License</a>}
                            {candidate.originalUrl && <a className="btn secondary" href={candidate.originalUrl} target="_blank" rel="noreferrer">Image</a>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      <section className="adminArenaDrafts compact" aria-label="Arena draft packs">
        <header className="adminArenaSectionHeader">
          <div>
            <p className="kicker">Drafts</p>
            <h2>Current Work</h2>
          </div>
          <span>{activeDrafts.length} active / {parkedDrafts.length} parked</span>
        </header>

        {activeDrafts.length ? activeDrafts.map(draft => (
          <article className="adminArenaDraft compact" key={draft.id}>
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
                  {draft.status}
                </span>
              </header>

              {draft.summary && <p>{draft.summary}</p>}

              <div className="adminArenaMetaGrid">
                <div><strong>Targets</strong><span>{draft.targets?.length || 0}</span></div>
                <div><strong>Corrections</strong><span>{draft.correctionQueue?.length || 0}</span></div>
                <div><strong>Overlay</strong><span>{draft.diagram?.overlayMode || "unset"}</span></div>
              </div>

              <div className="adminArenaActionRow" aria-label={`${draft.title} actions`}>
                <Link className="btn secondary" href="/arena">Open Arena</Link>
                {(draft.assetLedger || []).slice(0, 2).map(asset => (
                  <a className="btn secondary" href={asset.source} target="_blank" rel="noreferrer" key={`${asset.id}-source`}>
                    Source
                  </a>
                ))}
              </div>

              <details className="adminArenaDetails">
                <summary>Review Details</summary>
                <div className="adminArenaStatusGrid" aria-label="Approval gates">
                  {Object.entries(draft.approval || {}).map(([key, value]) => (
                    <span className={statusClass(value)} key={key}>
                      <strong>{key}</strong>
                      <em>{value}</em>
                    </span>
                  ))}
                </div>

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
                      {draft.correctionQueue.slice(0, 18).map((item, index) => (
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
              </details>
            </div>
          </article>
        )) : (
          <article className="adminArenaEmpty">
            <h2>No active draft packs yet.</h2>
          </article>
        )}

        {parkedDrafts.length ? (
          <details className="adminArenaParked">
            <summary>Parked / rejected drafts ({parkedDrafts.length})</summary>
            <div>
              {parkedDrafts.map(draft => (
                <article key={draft.id}>
                  <strong>{draft.title}</strong>
                  <span>{draft.status}</span>
                  <p>{draft.summary}</p>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </main>
  );
}
