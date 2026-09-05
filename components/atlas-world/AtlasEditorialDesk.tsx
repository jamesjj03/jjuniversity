"use client";

import { useEffect, useMemo, useState } from "react";
import { GuardedAdminLink, useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import type {
  AtlasAnnotationEditorialState,
} from "@/lib/atlas-world/annotations/types";
import type {
  AtlasJjuAssociationReviewState,
  AtlasJjuAssociationSalience,
  AtlasJjuAssociationPlace,
  AtlasJjuRelationship,
} from "@/lib/atlas-world/associations/types";
import type {
  AtlasAnnotationReviewSnapshot,
  AtlasAssociationReviewSnapshot,
} from "@/lib/atlas-world/editorialReview";
import type { AtlasAnnotationDraftSnapshot } from "@/lib/atlas-world/annotations/draftTypes";
import AtlasAnnotationDraftEditor from "./AtlasAnnotationDraftEditor";
import styles from "./AtlasEditorialDesk.module.css";

type Props = {
  initialDrafts: AtlasAnnotationDraftSnapshot;
  initialAnnotations: AtlasAnnotationReviewSnapshot;
  initialAssociations: AtlasAssociationReviewSnapshot;
};

type Tab = "drafts" | "annotations" | "associations";
type QueueFilter = "all" | "proposed" | "decided" | "stale";

const relationshipLabels: Record<AtlasJjuRelationship, string> = {
  primary_subject: "Primary subject",
  substantial_coverage: "Substantial coverage",
  contextual_coverage: "Contextual coverage",
  born_in: "Born in",
  died_in: "Died in",
  lived_in: "Lived in",
  active_in: "Active in",
  governed_in: "Governed in",
  occurred_in: "Occurred in",
  began_in: "Began in",
  ended_in: "Ended in",
  affected: "Affected",
  originated_in: "Originated in",
  institutionally_centered: "Institutionally centered",
  historically_prominent: "Historically prominent",
};

const stateLabels: Record<AtlasAnnotationEditorialState | AtlasJjuAssociationReviewState, string> = {
  proposed: "Awaiting decision",
  approved: "Human approved",
  rejected: "Rejected",
  retired: "Retired",
  superseded: "Superseded",
};

function cleanEtag(value: string | null) {
  return String(value || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

function readableDate(value: string | null) {
  if (!value) return "Not reviewed";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : value;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function atlasPlaceReviewHref(place: AtlasJjuAssociationPlace) {
  const focus = place.featureId ? `feature:${place.featureId}` : `entity:${place.entityId}`;
  return `/atlas?focus=${encodeURIComponent(focus)}`;
}

export default function AtlasEditorialDesk({ initialDrafts, initialAnnotations, initialAssociations }: Props) {
  const { setUnsaved } = useAdminUnsavedChanges();
  const [tab, setTab] = useState<Tab>("drafts");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [reviewer, setReviewer] = useState("");
  const [drafts, setDrafts] = useState(initialDrafts);
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [associations, setAssociations] = useState(initialAssociations);
  const [draftVersion, setDraftVersion] = useState(initialDrafts.version);
  const [annotationVersion, setAnnotationVersion] = useState(initialAnnotations.version);
  const [associationVersion, setAssociationVersion] = useState(initialAssociations.version);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [relationships, setRelationships] = useState<Record<string, AtlasJjuRelationship>>(() => Object.fromEntries(
    initialAssociations.items.map((item) => [item.association.id, item.association.relationship]),
  ));
  const [saliences, setSaliences] = useState<Record<string, AtlasJjuAssociationSalience>>(() => Object.fromEntries(
    initialAssociations.items.map((item) => [item.association.id, item.association.salience]),
  ));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);

  const dirty = useMemo(() => {
    if (Object.values(notes).some((value) => value.trim())) return true;
    return associations.items.some(({ association }) => (
      relationships[association.id] !== association.relationship
      || saliences[association.id] !== association.salience
    ));
  }, [associations.items, notes, relationships, saliences]);

  useEffect(() => setUnsaved("atlas-editorial", dirty), [dirty, setUnsaved]);
  useEffect(() => () => setUnsaved("atlas-editorial", false), [setUnsaved]);

  const visibleAnnotations = useMemo(() => annotations.items.filter((item) => {
    if (filter === "proposed") return item.review.state === "proposed";
    if (filter === "decided") return item.review.state !== "proposed";
    if (filter === "stale") return item.stale;
    return true;
  }), [annotations.items, filter]);

  const visibleAssociations = useMemo(() => associations.items.filter((item) => {
    if (filter === "proposed") return item.association.review.state === "proposed";
    if (filter === "decided") return item.association.review.state !== "proposed";
    if (filter === "stale") return !item.sourceCurrent;
    return true;
  }), [associations.items, filter]);

  const canDecide = reviewer.trim().length > 0;

  function selectTab(nextTab: Tab) {
    if (nextTab === tab) return;
    if (tab === "drafts" && draftDirty && !window.confirm("Discard the unsaved annotation changes in this form?")) return;
    setDraftDirty(false);
    setTab(nextTab);
    setFilter("all");
  }

  async function saveAnnotation(noteId: string, state: AtlasAnnotationEditorialState) {
    const item = annotations.items.find((candidate) => candidate.note.id === noteId);
    if (!item || busyId) return;
    const decisionNote = String(notes[noteId] || "").trim();
    if (!canDecide || !decisionNote) {
      setNotice("Add your name and a short decision note before saving a human decision.");
      return;
    }
    setBusyId(noteId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/atlas/annotations", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": annotationVersion,
        },
        body: JSON.stringify({
          noteId,
          state,
          reviewedBy: reviewer,
          decisionNote,
          supersededByNoteId: state === "superseded" ? replacements[noteId] || null : null,
          currentNoteRevision: item.note.revision,
          sourceVersion: annotations.sourceVersion,
        }),
      });
      const payload = await response.json() as {
        error?: string;
        note?: string;
        snapshot?: Omit<AtlasAnnotationReviewSnapshot, "version">;
      };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "The annotation decision could not be saved.");
      const version = cleanEtag(response.headers.get("etag"));
      if (!version) throw new Error("The save returned no exact source version. Reload before making another decision.");
      setAnnotations({ ...payload.snapshot, version });
      setAnnotationVersion(version);
      setNotes((current) => ({ ...current, [noteId]: "" }));
      setReplacements((current) => ({ ...current, [noteId]: "" }));
      setNotice(payload.note || "Annotation decision saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The annotation decision could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveAssociation(associationId: string, state: AtlasJjuAssociationReviewState) {
    const item = associations.items.find((candidate) => candidate.association.id === associationId);
    if (!item || busyId) return;
    const decisionNote = String(notes[associationId] || "").trim();
    if (!canDecide || !decisionNote) {
      setNotice("Add your name and a short decision note before saving a human decision.");
      return;
    }
    setBusyId(associationId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/atlas/associations", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": associationVersion,
        },
        body: JSON.stringify({
          associationId,
          state,
          reviewedBy: reviewer,
          decisionNote,
          relationship: relationships[associationId] || item.association.relationship,
          salience: saliences[associationId] || item.association.salience,
          sourceCurrent: item.sourceCurrent,
          evidenceCurrent: item.evidenceCurrent,
          evidenceSupportsRelationship: item.evidenceSupportsRelationship,
          sourceVersion: associations.sourceVersion,
        }),
      });
      const payload = await response.json() as {
        error?: string;
        note?: string;
        snapshot?: Omit<AtlasAssociationReviewSnapshot, "version">;
      };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "The association decision could not be saved.");
      const version = cleanEtag(response.headers.get("etag"));
      if (!version) throw new Error("The save returned no exact source version. Reload before making another decision.");
      setAssociations({ ...payload.snapshot, version });
      setAssociationVersion(version);
      setRelationships(Object.fromEntries(payload.snapshot.items.map((candidate) => [candidate.association.id, candidate.association.relationship])));
      setSaliences(Object.fromEntries(payload.snapshot.items.map((candidate) => [candidate.association.id, candidate.association.salience])));
      setNotes((current) => ({ ...current, [associationId]: "" }));
      setNotice(payload.note || "Association decision saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The association decision could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Atlas editorial authority</p>
          <h1>Decide what Atlas can say</h1>
          <p className={styles.intro}>Review explanations and JJU-to-place links with their evidence in view. AI proposals never count as human approval.</p>
        </div>
        <div className={styles.headerActions}>
          <GuardedAdminLink href="/admin/reviews">Back to Needs you</GuardedAdminLink>
          <a href="/atlas" target="_blank" rel="noreferrer">Open Atlas ↗</a>
        </div>
      </header>

      <section className={styles.boundary} aria-label="Publication boundary">
        <strong>No automatic publishing</strong>
        <p>New explanations live in a separate private draft authority. Approval here never writes to public pattern notes. Existing note decisions remain separate from their older source-review visibility gate, and JJU links require explicit human approval plus a current build.</p>
      </section>

      <section className={styles.metrics} aria-label="Atlas review snapshot">
        <div><strong>{drafts.counts.draft + drafts.counts.proposed}</strong><span>private explanation drafts</span></div>
        <div><strong>{annotations.counts.proposed}</strong><span>annotations awaiting you</span></div>
        <div><strong>{associations.counts.proposed}</strong><span>links awaiting you</span></div>
        <div><strong>{drafts.drafts.filter((item) => item.stale).length + annotations.stale + associations.stale}</strong><span>source changes needing refresh</span></div>
      </section>

      <section className={styles.controls} data-tab={tab} aria-label="Review controls">
        <div className={styles.tabs} role="tablist" aria-label="Atlas review queues">
          <button type="button" role="tab" aria-selected={tab === "drafts"} onClick={() => selectTab("drafts")}>Draft explanations <span>{drafts.drafts.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === "annotations"} onClick={() => selectTab("annotations")}>Explanations <span>{annotations.items.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === "associations"} onClick={() => selectTab("associations")}>JJU links <span>{associations.items.length}</span></button>
        </div>
        <label className={styles.field}>
          <span>Your name</span>
          <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Required for every decision" autoComplete="name" />
        </label>
        {tab !== "drafts" && <label className={styles.field}>
          <span>Show</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)}>
            <option value="all">Everything</option>
            <option value="proposed">Awaiting decision</option>
            <option value="decided">Decided</option>
            <option value="stale">Stale source</option>
          </select>
        </label>}
      </section>

      {notice && <div className={styles.notice} role="status" aria-live="polite">{notice}</div>}

      {tab === "drafts" ? (
        <AtlasAnnotationDraftEditor
          snapshot={drafts}
          version={draftVersion}
          actor={reviewer}
          onSaved={(nextSnapshot, nextVersion, nextNotice) => {
            setDrafts(nextSnapshot);
            setDraftVersion(nextVersion);
            setNotice(nextNotice);
          }}
          onNotice={setNotice}
          onDirtyChange={setDraftDirty}
        />
      ) : tab === "annotations" ? (
        <section className={styles.queue} role="tabpanel" aria-label="Atlas explanation review queue">
          <div className={styles.queueIntro}>
            <div><h2>Contextual explanations</h2><p>These four Phase 2 notes are visible through a source-review gate, but none has been represented as human-approved.</p></div>
            <span>{annotations.persistence.boundary}</span>
          </div>
          {visibleAnnotations.map(({ note, review, stale, visibleNow }) => (
            <article className={styles.card} key={note.id} data-review-state={review.state}>
              <header className={styles.cardHeader}>
                <div>
                  <div className={styles.badgeRow}>
                    <span className={styles.stateBadge}>{stateLabels[review.state]}</span>
                    <span className={visibleNow ? styles.liveBadge : styles.offBadge}>{visibleNow ? "Visible now" : "Not public"}</span>
                    {stale && <span className={styles.warningBadge}>Stale revision</span>}
                  </div>
                  <h3>{note.headline}</h3>
                  <p>{note.summary}</p>
                </div>
                <a href={`/atlas?view=${encodeURIComponent(note.triggers.viewPresetIds[0] || "population-density")}&focus=${encodeURIComponent(`feature:${note.id}`)}`} target="_blank" rel="noreferrer">Inspect on map ↗</a>
              </header>

              <div className={styles.factStrip}>
                <span><b>Scene</b>{note.triggers.viewPresetIds.map(humanize).join(", ")}</span>
                <span><b>Layers</b>{note.triggers.datasetIds.map(humanize).join(", ")}</span>
                <span><b>Geography</b>{note.spatial.entityIds.join(", ")}</span>
                <span><b>Human review</b>{note.review.humanEditorialReview === "not-performed" ? "Not performed" : humanize(note.review.humanEditorialReview)}</span>
              </div>

              <details className={styles.evidence}>
                <summary>Evidence, caveats, and source-review record</summary>
                <div className={styles.evidenceGrid}>
                  <div>
                    <h4>Evidence</h4>
                    {note.evidence.map((source) => <div className={styles.source} key={source.id}>
                      <a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a>
                      <p>{source.supports}</p>
                      <small>Published {source.publishedAt || "date unavailable"} · retrieved {source.retrievedAt}</small>
                    </div>)}
                  </div>
                  <div>
                    <h4>Caveats</h4>
                    <ul>{note.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
                    <p className={styles.auditLine}>AI-assisted source review by {note.review.reviewedBy} on {note.review.reviewedAt}. Human editorial review was not performed.</p>
                  </div>
                </div>
              </details>

              <div className={styles.decisionArea}>
                <label className={styles.decisionNote}>
                  <span>Decision note</span>
                  <textarea value={notes[note.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [note.id]: event.target.value }))} placeholder="What you checked, what needs revision, or why this should leave Atlas" />
                </label>
                <label className={styles.replacementField}>
                  <span>Replacement, if superseded</span>
                  <select value={replacements[note.id] || ""} onChange={(event) => setReplacements((current) => ({ ...current, [note.id]: event.target.value }))}>
                    <option value="">Choose another annotation</option>
                    {annotations.items.filter((candidate) => candidate.note.id !== note.id).map((candidate) => <option key={candidate.note.id} value={candidate.note.id}>{candidate.note.headline}</option>)}
                  </select>
                </label>
                <div className={styles.actions} aria-label={`Decide ${note.headline}`}>
                  <button type="button" className={styles.approve} disabled={busyId !== null || !canDecide} onClick={() => void saveAnnotation(note.id, "approved")}>Approve</button>
                  <button type="button" disabled={busyId !== null || !canDecide} onClick={() => void saveAnnotation(note.id, "proposed")}>Request revision</button>
                  <button type="button" disabled={busyId !== null || !canDecide} onClick={() => void saveAnnotation(note.id, "rejected")}>Reject</button>
                  <button type="button" disabled={busyId !== null || !canDecide} onClick={() => void saveAnnotation(note.id, "retired")}>Retire</button>
                  <button type="button" disabled={busyId !== null || !canDecide || !replacements[note.id]} onClick={() => void saveAnnotation(note.id, "superseded")}>Supersede</button>
                </div>
              </div>
              {review.reviewedBy && <footer className={styles.reviewReceipt}>Last decision by {review.reviewedBy} · {readableDate(review.reviewedAt)} · {review.decisionNote}</footer>}
            </article>
          ))}
          {!visibleAnnotations.length && <div className={styles.empty}>No explanations match this filter.</div>}
        </section>
      ) : (
        <section className={styles.queue} role="tabpanel" aria-label="JJU geographic association review queue">
          <div className={styles.queueIntro}>
            <div><h2>JJU geographic links</h2><p>Ten AI-assisted Mapmakers pilot proposals. Exact evidence and relationship meaning stay attached to every decision.</p></div>
            <span>{associations.persistence.boundary}</span>
          </div>
          {visibleAssociations.map(({ association, sourceCurrent, evidenceCurrent, evidenceSupportsRelationship, subjectReadable, publicEligible }) => (
            <article className={styles.card} key={association.id} data-review-state={association.review.state}>
              <header className={styles.cardHeader}>
                <div>
                  <div className={styles.badgeRow}>
                    <span className={styles.stateBadge}>{stateLabels[association.review.state]}</span>
                    <span className={styles.confidenceBadge}>{Math.round(association.proposal.confidence * 100)}% proposal confidence</span>
                    {!sourceCurrent && <span className={styles.warningBadge}>Source changed</span>}
                    {!evidenceCurrent && <span className={styles.warningBadge}>Evidence changed</span>}
                    {!evidenceSupportsRelationship && <span className={styles.warningBadge}>Relationship evidence missing</span>}
                    {publicEligible && <span className={styles.liveBadge}>Public-eligible</span>}
                  </div>
                  <h3>{association.subject.title} <span>→</span> {association.place.name}</h3>
                  <p>{association.proposal.rationale}</p>
                </div>
                <div className={styles.cardLinks}>
                  <a href={association.subject.href} target="_blank" rel="noreferrer">Open JJU subject ↗</a>
                  <a href={atlasPlaceReviewHref(association.place)} target="_blank" rel="noreferrer">Inspect place ↗</a>
                </div>
              </header>

              <div className={styles.associationFields}>
                <label className={styles.field}>
                  <span>Relationship</span>
                  <select value={relationships[association.id] || association.relationship} onChange={(event) => setRelationships((current) => ({ ...current, [association.id]: event.target.value as AtlasJjuRelationship }))}>
                    {Object.entries(relationshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Salience</span>
                  <select value={saliences[association.id] || association.salience} onChange={(event) => setSaliences((current) => ({ ...current, [association.id]: event.target.value as AtlasJjuAssociationSalience }))}>
                    <option value="primary">Primary</option>
                    <option value="substantial">Substantial</option>
                    <option value="contextual">Contextual</option>
                  </select>
                </label>
                <div className={styles.sourceState}><span>Approval gate</span><strong>{sourceCurrent && evidenceCurrent && evidenceSupportsRelationship ? "Evidence ready" : "Approval blocked"}</strong><small>{subjectReadable ? "Publicly readable subject" : "Subject is not publicly readable"}</small></div>
              </div>

              <section className={styles.quoteBlock} aria-label="Exact proposal evidence">
                <h4>Exact evidence</h4>
                {association.evidence.map((evidence) => <figure key={`${association.id}-${evidence.locator}`}>
                  <blockquote>“{evidence.exactText}”</blockquote>
                  <figcaption>{evidence.sourceId} · {evidence.locator} · supports {evidence.supports.map(humanize).join(", ")}</figcaption>
                  {evidence.note && <p>{evidence.note}</p>}
                </figure>)}
              </section>

              <div className={styles.factStrip}>
                <span><b>Place identity</b>{association.place.entityId}</span>
                <span><b>Proposed by</b>{association.proposal.proposedBy}</span>
                <span><b>Source observation</b>{association.temporal.observedAt || "Unknown"}</span>
                <span><b>Pilot</b>{association.pilotCollectionId || "None"}</span>
              </div>

              <div className={styles.decisionArea}>
                <label className={styles.decisionNote}>
                  <span>Decision note</span>
                  <textarea value={notes[association.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [association.id]: event.target.value }))} placeholder="Why this relationship and salience are right, wrong, or need deeper manuscript review" />
                </label>
                <div className={styles.actions} aria-label={`Decide ${association.subject.title} and ${association.place.name}`}>
                  <button type="button" className={styles.approve} disabled={busyId !== null || !canDecide || !sourceCurrent || !evidenceCurrent || !evidenceSupportsRelationship || !subjectReadable} onClick={() => void saveAssociation(association.id, "approved")}>Approve for Atlas</button>
                  <button type="button" disabled={busyId !== null || !canDecide} onClick={() => void saveAssociation(association.id, "proposed")}>Defer</button>
                  <button type="button" disabled={busyId !== null || !canDecide} onClick={() => void saveAssociation(association.id, "rejected")}>Reject</button>
                  <button type="button" disabled={busyId !== null || !canDecide} onClick={() => void saveAssociation(association.id, "superseded")}>Mark superseded</button>
                </div>
              </div>
              {association.review.reviewedBy && <footer className={styles.reviewReceipt}>Last decision by {association.review.reviewedBy} · {readableDate(association.review.reviewedAt)} · {association.review.decisionNote}</footer>}
            </article>
          ))}
          {!visibleAssociations.length && <div className={styles.empty}>No JJU links match this filter.</div>}
        </section>
      )}
    </main>
  );
}
