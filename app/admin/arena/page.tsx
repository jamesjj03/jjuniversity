import { readdir, readFile } from "fs/promises";
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
  targets?: unknown[];
  correctionQueue?: unknown[];
};

const DRAFT_ROOT = path.join(process.cwd(), "recall", "drafts");

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

function statusClass(status = "") {
  if (status === "approved" || status === "complete") return "approved";
  if (status === "blocked") return "blocked";
  if (status === "active" || status === "needs-review") return "review";
  return "queued";
}

export default async function ArenaFactoryPage() {
  const drafts = await loadDrafts();

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
                  className="adminArenaDiagram"
                  style={{
                    "--diagram-src": `url(${draft.diagram.imageSrc})`,
                    "--diagram-ratio": `${draft.diagram.width} / ${draft.diagram.height}`,
                  } as CSSProperties}
                />
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
            </div>
          </article>
        )) : (
          <article className="adminArenaEmpty">
            <h2>No draft packs yet.</h2>
          </article>
        )}
      </section>
    </main>
  );
}
