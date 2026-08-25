"use client";

import { useEffect, useMemo, useState } from "react";
import { GuardedAdminLink, useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import type {
  PrintReviewDecision,
  PrintReviewDraftEnvelope,
  PrintReviewQueue,
  PrintReviewSurface,
} from "@/lib/printReviewTypes";
import coreStyles from "@/app/admin/WorkshopCore.module.css";
import styles from "@/app/admin/print/PrintReview.module.css";

const STORAGE_KEY = "jju.workshop.print-review.v1";
const SOURCE_KEY = "print-review-draft";

type RecoveryCandidate =
  | {
    kind: "draft";
    envelope: PrintReviewDraftEnvelope;
    compatible: boolean;
    reason: string;
  }
  | {
    kind: "blocked";
    raw: string;
    reason: string;
  };

function emptyDecisions(queues: PrintReviewQueue[]) {
  return Object.fromEntries(queues.map(queue => [queue.id, { optionId: "", note: "" }])) as Record<string, PrintReviewDecision>;
}

function cloneDecisions(decisions: Record<string, PrintReviewDecision>) {
  return Object.fromEntries(Object.entries(decisions).map(([id, decision]) => [id, { ...decision }])) as Record<string, PrintReviewDecision>;
}

function sameDecisions(left: Record<string, PrintReviewDecision>, right: Record<string, PrintReviewDecision>) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseDraftEnvelope(value: unknown, surface: PrintReviewSurface): PrintReviewDraftEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schemaVersion !== 1
    || typeof envelope.contractVersion !== "string"
    || typeof envelope.baseDigest !== "string"
    || !Number.isInteger(envelope.revision)
    || Number(envelope.revision) < 1
    || typeof envelope.revisionLabel !== "string"
    || typeof envelope.savedAt !== "string"
    || !Number.isFinite(Date.parse(envelope.savedAt))
    || !envelope.decisions
    || typeof envelope.decisions !== "object"
    || Array.isArray(envelope.decisions)
  ) return null;

  const rawDecisions = envelope.decisions as Record<string, unknown>;
  const decisions = emptyDecisions(surface.queues);
  for (const queue of surface.queues) {
    const valueForQueue = rawDecisions[queue.id];
    if (!valueForQueue || typeof valueForQueue !== "object" || Array.isArray(valueForQueue)) return null;
    const rawDecision = valueForQueue as Record<string, unknown>;
    const optionId = typeof rawDecision.optionId === "string" ? rawDecision.optionId : "";
    const note = typeof rawDecision.note === "string" ? rawDecision.note : "";
    if (optionId && !queue.options.some(option => option.id === optionId)) return null;
    decisions[queue.id] = { optionId, note };
  }

  return {
    schemaVersion: 1,
    contractVersion: envelope.contractVersion,
    baseDigest: envelope.baseDigest,
    revision: Number(envelope.revision),
    revisionLabel: envelope.revisionLabel,
    savedAt: envelope.savedAt,
    decisions,
  };
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 12)}…` : "not recorded";
}

function formatTimestamp(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "not recorded";
  return `${new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function sourceStatusLabel(status: PrintReviewSurface["releaseSources"][number]["status"]) {
  if (status === "candidate") return "Candidate only";
  if (status === "missing") return "Unavailable here";
  if (status === "blocked") return "Blocked";
  return "Stale or unsealed";
}

function makeEnvelope(
  surface: PrintReviewSurface,
  decisions: Record<string, PrintReviewDecision>,
  revision: number,
  revisionPrefix = "local",
): PrintReviewDraftEnvelope {
  return {
    schemaVersion: 1,
    contractVersion: surface.contractVersion,
    baseDigest: surface.baseDigest,
    revision,
    revisionLabel: `${revisionPrefix}-r${revision}`,
    savedAt: new Date().toISOString(),
    decisions: cloneDecisions(decisions),
  };
}

function downloadEnvelope(envelope: PrintReviewDraftEnvelope) {
  const blob = new Blob([`${JSON.stringify(envelope, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `jju-print-review-${envelope.revisionLabel}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadBlockedDraft(raw: string) {
  const blob = new Blob([raw], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "jju-print-review-unreadable-draft.txt";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function PrintReviewEditor({ surface }: { surface: PrintReviewSurface }) {
  const defaults = useMemo(() => emptyDecisions(surface.queues), [surface.queues]);
  const { setUnsaved } = useAdminUnsavedChanges();
  const [decisions, setDecisions] = useState<Record<string, PrintReviewDecision>>(() => cloneDecisions(defaults));
  const [baseline, setBaseline] = useState<Record<string, PrintReviewDecision>>(() => cloneDecisions(defaults));
  const [revision, setRevision] = useState(0);
  const [savedAt, setSavedAt] = useState("");
  const [recovery, setRecovery] = useState<RecoveryCandidate | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [notice, setNotice] = useState("");
  const [openQueues, setOpenQueues] = useState<Record<string, boolean>>(() => ({ [surface.queues[0]?.id || "release"]: true }));
  const dirty = !sameDecisions(decisions, baseline);
  const completedChoices = Object.values(decisions).filter(decision => Boolean(decision.optionId)).length;
  const editorLocked = Boolean(recovery);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          setRecovery({
            kind: "blocked",
            raw,
            reason: "This local copy is not valid JSON. It was not opened or overwritten.",
          });
          return;
        }
        const envelope = parseDraftEnvelope(parsed, surface);
        if (!envelope) {
          setRecovery({
            kind: "blocked",
            raw,
            reason: "This local copy uses an unknown or damaged review format. It was not opened or overwritten.",
          });
          return;
        }
        const compatible = envelope.contractVersion === surface.contractVersion && envelope.baseDigest === surface.baseDigest;
        setRecovery({
          kind: "draft",
          envelope,
          compatible,
          reason: compatible
            ? "Its exact review contract and evidence digest match this screen."
            : "The print evidence or review contract changed after this draft was saved, so automatic restoration is blocked.",
        });
      } catch {
        setNotice("Local draft storage is unavailable in this browser. Nothing was deleted.");
      } finally {
        setRecoveryChecked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [surface]);

  useEffect(() => {
    setUnsaved(SOURCE_KEY, dirty, "the Print review draft");
  }, [dirty, setUnsaved]);

  useEffect(() => () => setUnsaved(SOURCE_KEY, false), [setUnsaved]);

  function patchDecision(queueId: string, patch: Partial<PrintReviewDecision>) {
    if (editorLocked) return;
    setNotice("");
    setDecisions(current => ({
      ...current,
      [queueId]: { ...current[queueId], ...patch },
    }));
  }

  function restoreRecovery() {
    if (!recovery || recovery.kind !== "draft" || !recovery.compatible) return;
    const next = cloneDecisions(recovery.envelope.decisions);
    setDecisions(next);
    setBaseline(cloneDecisions(next));
    setRevision(recovery.envelope.revision);
    setSavedAt(recovery.envelope.savedAt);
    setRecovery(null);
    setNotice(`Restored ${recovery.envelope.revisionLabel}. These are local review choices only; no approval or external action occurred.`);
  }

  function discardRecovery() {
    if (!recovery) return;
    if (!window.confirm("Permanently discard this device's stored Print review draft? This removes the only recovery copy held by the Workshop on this device and cannot be undone.")) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      setNotice("This browser could not discard the stored print-review draft.");
      return;
    }
    setRecovery(null);
    setDecisions(cloneDecisions(defaults));
    setBaseline(cloneDecisions(defaults));
    setRevision(0);
    setSavedAt("");
    setNotice("Discarded the local print-review draft. No print metadata or external system changed.");
  }

  function saveDraft() {
    if (!dirty || editorLocked) return;
    const nextRevision = revision + 1;
    const envelope = makeEnvelope(surface, decisions, nextRevision);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      setNotice("This browser could not save the local print-review draft. Nothing external changed.");
      return;
    }
    setRevision(nextRevision);
    setSavedAt(envelope.savedAt);
    setBaseline(cloneDecisions(decisions));
    setNotice(`Saved ${envelope.revisionLabel} on this device against evidence digest ${shortHash(surface.baseDigest)}. It is not an approval.`);
  }

  function exportCurrentDraft() {
    const exportRevision = Math.max(1, revision + (dirty ? 1 : 0));
    downloadEnvelope(makeEnvelope(surface, decisions, exportRevision, "export"));
    setNotice("Downloaded a local review handoff. No print, upload, order, charge, or sale action occurred.");
  }

  function resetUnsavedChanges() {
    if (!dirty) return;
    setDecisions(cloneDecisions(baseline));
    setNotice("Reset unsaved choices to the last local draft state.");
  }

  function openQueue(queueId: string) {
    setOpenQueues(current => ({ ...current, [queueId]: true }));
  }

  function toggleQueue(queueId: string) {
    setOpenQueues(current => ({ ...current, [queueId]: !current[queueId] }));
  }

  return (
    <main className={`${coreStyles.page} ${styles.page}`}>
      <section className={styles.stopBanner} role="alert" aria-labelledby="print-stop-title">
        <span className={styles.stopMark} aria-hidden="true">!</span>
        <div>
          <p>Permanent production gate</p>
          <h1 id="print-stop-title">NOT FOR SALE</h1>
          <strong>No approved release · no order placed in the available record · no order control on this page</strong>
        </div>
      </section>

      <header className={coreStyles.pageHeader}>
        <div>
          <p className={coreStyles.eyebrow}>JJU Workshop · Print</p>
          <h1>Look at every decision that still needs you.</h1>
          <p className={coreStyles.intro}>
            This is a review desk, not a production console. It compares the conflicting print evidence, keeps your choices on this device, and cannot upload files, call Lulu, charge a card, place an order, or enable a sale.
          </p>
        </div>
        <div className={styles.snapshotStamp}>
          <span>Evidence digest</span>
          <code title={surface.baseDigest}>{shortHash(surface.baseDigest)}</code>
          <small>Loaded {formatTimestamp(surface.loadedAt)}</small>
          <GuardedAdminLink className={coreStyles.primaryButton} href="/admin/print/proofs">Look at actual proofs</GuardedAdminLink>
        </div>
      </header>

      <section className={styles.releaseBlocker} aria-labelledby="release-blocker-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={coreStyles.eyebrow}>Release-split blocker</p>
            <h2 id="release-blocker-title">Four versions tell four different stories.</h2>
          </div>
          <span className={styles.blockedBadge}>Everything downstream locked</span>
        </div>
        <div className={styles.sourceGrid}>
          {surface.releaseSources.map(source => (
            <article className={styles.sourceCard} data-status={source.status} key={source.id}>
              <header>
                <span>{sourceStatusLabel(source.status)}</span>
                <h3>{source.title}</h3>
              </header>
              <p>{source.summary}</p>
              <dl className={styles.sourceMetrics}>
                <div><dt>Volume I</dt><dd>{source.volumeOnePages ?? "?"} pages</dd></div>
                <div><dt>Volume II</dt><dd>{source.volumeTwoPages ?? "?"} pages</dd></div>
              </dl>
              <details>
                <summary>Exact metadata</summary>
                <dl className={styles.hashList}>
                  <div><dt>Volume I hash</dt><dd><code title={source.volumeOneHash}>{shortHash(source.volumeOneHash)}</code></dd></div>
                  <div><dt>Volume II hash</dt><dd><code title={source.volumeTwoHash}>{shortHash(source.volumeTwoHash)}</code></dd></div>
                  <div><dt>Observed</dt><dd>{formatTimestamp(source.observedAt)}</dd></div>
                </dl>
                <ul>{source.details.map(detail => <li key={detail}>{detail}</li>)}</ul>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.productSection} aria-labelledby="products-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={coreStyles.eyebrow}>Edition status</p>
            <h2 id="products-title">Volume I, Volume II, and the set</h2>
          </div>
          <div className={styles.proofActions}>
            <GuardedAdminLink className={coreStyles.primaryButton} href="/admin/print/proofs">Open actual proof gallery</GuardedAdminLink>
            <span className={styles.metadataOnly}>Selected-page previews · source PDFs withheld</span>
          </div>
        </div>
        <div className={styles.productGrid}>
          {surface.products.map(product => (
            <article className={styles.productCard} id={product.slug} key={product.slug}>
              <header>
                <div>
                  <span>{product.kicker}</span>
                  <h3>{product.title}</h3>
                </div>
                <span className={styles.notForSale}>{product.salesStatus === "not-for-sale" ? "Not for sale" : `Unexpected: ${product.salesStatus}`}</span>
              </header>
              <div className={styles.productStats}>
                <div><span>Public claim</span><strong>{product.publicPages ?? "?"}</strong><small>pages</small></div>
                <div><span>Newest proof</span><strong>{product.newestProofPages ?? "?"}</strong><small>pages</small></div>
                <div><span>Last validated</span><strong>{product.lastValidatedPages ?? "?"}</strong><small>pages</small></div>
              </div>
              <dl className={styles.productFacts}>
                <div><dt>Included</dt><dd>{product.includedBooks} books</dd></div>
                <div><dt>Review profiles</dt><dd>{product.disclaimerReviews.profiled} profiled · {product.disclaimerReviews.approved} approved</dd></div>
                <div><dt>Format</dt><dd>{product.format}</dd></div>
                <div><dt>Price</dt><dd>{product.targetPrice}</dd></div>
                <div><dt>Catalog date</dt><dd>{product.generatedAt || "not recorded"}</dd></div>
                <div><dt>Print state</dt><dd>{product.printStatus}</dd></div>
              </dl>
              <div className={styles.blockerList}>
                <strong>What blocks this edition</strong>
                <ul>{product.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
              </div>
              <details>
                <summary>Proof metadata and hashes</summary>
                {product.proofMetadataAvailable ? (
                  <dl className={styles.hashList}>
                    <div><dt>Newest interior</dt><dd><code title={product.newestProofHash}>{shortHash(product.newestProofHash)}</code></dd></div>
                    <div><dt>Paperback cover</dt><dd><code title={product.newestPaperbackCoverHash}>{shortHash(product.newestPaperbackCoverHash)}</code></dd></div>
                    <div><dt>Casewrap cover</dt><dd><code title={product.newestCasewrapCoverHash}>{shortHash(product.newestCasewrapCoverHash)}</code></dd></div>
                    <div><dt>Validated interior</dt><dd><code title={product.lastValidatedHash}>{shortHash(product.lastValidatedHash)}</code></dd></div>
                  </dl>
                ) : (
                  <p>Proof metadata is unavailable in this deployment. No local proof path was exposed as a fallback.</p>
                )}
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.integrityPanel} aria-labelledby="integrity-title">
        <div>
          <p className={coreStyles.eyebrow}>Manifest honesty</p>
          <h2 id="integrity-title">Stale and missing states stay visible.</h2>
          <p>
            Manifest: {surface.manifest.available ? surface.manifest.status || "present" : "unavailable"}. Lulu record: {surface.validation.available ? surface.validation.environment || "present" : "unavailable"}. Protected selected-page gallery: configured. Full source-PDF delivery: not configured.
          </p>
        </div>
        <details>
          <summary>Review integrity problems</summary>
          <div className={styles.integrityColumns}>
            <div>
              <strong>Input mismatches</strong>
              {surface.manifest.inputMismatches.length ? <ul>{surface.manifest.inputMismatches.map(item => <li key={item}>{item}</li>)}</ul> : <p>None detected in available files.</p>}
            </div>
            <div>
              <strong>Output mismatches</strong>
              {surface.manifest.outputMismatches.length ? <ul>{surface.manifest.outputMismatches.map(item => <li key={item}>{item}</li>)}</ul> : <p>None detected in available files.</p>}
            </div>
          </div>
        </details>
      </section>

      <section className={styles.reviewSection} aria-labelledby="needs-eyes-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={coreStyles.eyebrow}>Finite human queue</p>
            <h2 id="needs-eyes-title">Needs your eyes</h2>
            <p>Nine decisions. Each choice is a local draft note—not an approval, publication instruction, or order authorization.</p>
          </div>
          <div className={styles.progressBadge}><strong>{completedChoices}</strong><span>of {surface.queues.length} drafted</span></div>
        </div>

        <nav className={styles.queueJump} aria-label="Jump to a print review decision">
          {surface.queues.map(queue => <a href={`#queue-${queue.id}`} key={queue.id} onClick={() => openQueue(queue.id)}>{queue.number}. {queue.eyebrow}</a>)}
        </nav>

        {recovery && (
          <section className={styles.recoveryBanner} role="status">
            <div>
              <strong>{recovery.kind === "blocked" ? "Unreadable local draft held for safety" : recovery.compatible ? "Local print-review draft found" : "Older local draft held for safety"}</strong>
              {recovery.kind === "draft" ? (
                <span>
                  {recovery.envelope.revisionLabel} · saved {formatTimestamp(recovery.envelope.savedAt)} · base {shortHash(recovery.envelope.baseDigest)}. {recovery.reason}
                </span>
              ) : <span>{recovery.reason}</span>}
            </div>
            <div className={coreStyles.inlineActions}>
              {recovery.kind === "draft" && recovery.compatible && <button className={coreStyles.primaryButton} type="button" onClick={restoreRecovery}>Restore matching draft</button>}
              {recovery.kind === "draft" && !recovery.compatible && <button className={coreStyles.secondaryButton} type="button" onClick={() => downloadEnvelope(recovery.envelope)}>Download old draft</button>}
              {recovery.kind === "blocked" && <button className={coreStyles.secondaryButton} type="button" onClick={() => downloadBlockedDraft(recovery.raw)}>Download unreadable copy</button>}
              <button className={coreStyles.quietButton} type="button" onClick={discardRecovery}>Discard local copy</button>
            </div>
          </section>
        )}

        {!recoveryChecked && <div className={styles.localNotice} role="status">Checking this device for a saved print-review draft…</div>}
        {notice && <div className={styles.localNotice} role="status" aria-live="polite">{notice}</div>}

        <div className={styles.queueList}>
          {surface.queues.map(queue => {
            const decision = decisions[queue.id] || { optionId: "", note: "" };
            const queueOpen = Boolean(openQueues[queue.id]);
            return (
              <section className={styles.queueCard} id={`queue-${queue.id}`} key={queue.id}>
                <button className={styles.queueToggle} type="button" aria-expanded={queueOpen} aria-controls={`queue-body-${queue.id}`} onClick={() => toggleQueue(queue.id)}>
                  <span className={styles.queueNumber}>{queue.number}</span>
                  <div>
                    <p>{queue.eyebrow}</p>
                    <h3>{queue.title}</h3>
                  </div>
                  <span className={decision.optionId ? styles.draftedState : styles.openState}>{decision.optionId ? "Draft choice made" : "Needs review"}</span>
                  <span className={styles.queueChevron} aria-hidden="true">{queueOpen ? "−" : "+"}</span>
                </button>
                <div className={styles.queueBody} id={`queue-body-${queue.id}`} hidden={!queueOpen}>
                  <div className={styles.queueContext}>
                    <p className={styles.queueSummary}>{queue.summary}</p>
                    <div><strong>Why you need to see it</strong><p>{queue.why}</p></div>
                    <div className={styles.recommendation}><strong>Safest next move</strong><p>{queue.recommended}</p></div>
                    <details>
                      <summary>Evidence on this screen</summary>
                      <ul>{queue.evidence.map(item => <li key={item}>{item}</li>)}</ul>
                    </details>
                  </div>
                  <fieldset className={styles.decisionFieldset} disabled={editorLocked}>
                    <legend>Draft your direction</legend>
                    <div className={styles.optionList}>
                      {queue.options.map(option => (
                        <label className={styles.optionCard} data-selected={decision.optionId === option.id ? "true" : "false"} key={option.id}>
                          {queue.id === "cover" && !["defer"].includes(option.id) && <span className={styles.coverSwatch} data-direction={option.id} aria-hidden="true" />}
                          <input
                            type="radio"
                            name={`print-review-${queue.id}`}
                            value={option.id}
                            checked={decision.optionId === option.id}
                            onChange={() => patchDecision(queue.id, { optionId: option.id })}
                          />
                          <span><strong>{option.label}</strong><small>{option.help}</small></span>
                        </label>
                      ))}
                    </div>
                    <label className={styles.noteField}>
                      Notes for this decision
                      <textarea
                        value={decision.note}
                        onChange={event => patchDecision(queue.id, { note: event.target.value })}
                        placeholder="What looks right, what feels wrong, or what must be checked next?"
                      />
                    </label>
                  </fieldset>
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <section className={styles.noActionPanel} aria-label="Production actions unavailable">
        <strong>No production controls by design</strong>
        <p>Source-PDF delivery, upload, Lulu quote, proof order, checkout, and sale activation are all unavailable here. This page saves review drafts only to this browser or a downloaded JSON handoff.</p>
      </section>

      <div className={styles.saveDock} role="status" aria-live="polite">
        <div>
          <strong>{dirty ? "Unsaved local review choices" : revision ? `${revision ? `local-r${revision}` : "Local draft"} saved on this device` : "No local review draft saved yet"}</strong>
          <span>
            Base {shortHash(surface.baseDigest)} · {completedChoices}/{surface.queues.length} draft choices
            {savedAt ? ` · saved ${formatTimestamp(savedAt)}` : ""}
          </span>
        </div>
        <div className={styles.saveActions}>
          <button className={coreStyles.quietButton} type="button" disabled={!dirty || editorLocked} onClick={resetUnsavedChanges}>Reset unsaved</button>
          <button className={coreStyles.secondaryButton} type="button" disabled={editorLocked} onClick={exportCurrentDraft}>Download JSON</button>
          <button className={coreStyles.primaryButton} type="button" disabled={!dirty || editorLocked} onClick={saveDraft}>Save on this device</button>
        </div>
      </div>
    </main>
  );
}
