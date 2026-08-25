"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  NarratorAdminBook,
  NarratorAdminSnapshot,
  NarratorAdminSubmission,
} from "@/lib/narratorAdmin";
import styles from "./NarratorControlRoom.module.css";

type Props = {
  snapshot: NarratorAdminSnapshot;
};

type Notice = {
  tone: "success" | "error";
  message: string;
} | null;

function formatDate(value: string) {
  if (!value) return "No due date";
  const calendarDate = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const date = new Date(calendarDate ? `${calendarDate}T00:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", ...(calendarDate ? { timeZone: "UTC" } : {}) }).format(date);
}

function formatBytes(bytes: number) {
  if (!bytes) return "Size unavailable";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function postAction(payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/narrators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || "The action failed safely.");
  return result;
}

function SubmissionReview({ submission, onChanged }: { submission: NarratorAdminSubmission; onChanged: () => void }) {
  const [feedback, setFeedback] = useState(submission.narratorFeedback);
  const [privateNote, setPrivateNote] = useState(submission.reviewNote);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const reviewable = ["uploaded", "in-review"].includes(submission.status);

  async function review(decision: "approve" | "request-changes") {
    setBusy(true);
    setNotice(null);
    try {
      await postAction({
        action: "review-submission",
        submissionId: submission.id,
        expectedUpdatedAt: submission.updatedAt,
        decision,
        narratorFeedback: feedback,
        reviewNote: privateNote,
      });
      setNotice({ tone: "success", message: decision === "approve" ? "Track approved. Release is still separate." : "Changes requested. The narrator can replace this track." });
      onChanged();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Review failed safely." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={styles.submissionCard}>
      <header className={styles.cardHeader}>
        <div>
          <span className={styles.status}>{submission.status}</span>
          <h3>{submission.bookTitle}</h3>
          <p>Track {String(submission.trackPosition).padStart(2, "0")} · {submission.trackTitle}</p>
        </div>
        <span className={styles.smallMeta}>{submission.narratorName}</span>
      </header>
      <audio className={styles.audio} controls preload="none" src={`/api/admin/narrators/submissions/${submission.id}/audio`}>
        Your browser cannot play this private recording.
      </audio>
      <div className={styles.fileLine}>
        <span>{submission.fileName || "Private recording"}</span>
        <span>{formatBytes(submission.fileSizeBytes)}</span>
      </div>
      {submission.narratorNote ? <blockquote className={styles.narratorNote}>{submission.narratorNote}</blockquote> : null}
      <div className={styles.reviewFields}>
        <label>
          <span>Message the narrator</span>
          <textarea value={feedback} onChange={event => setFeedback(event.target.value)} maxLength={2000} placeholder="What worked, or exactly what needs another take?" />
        </label>
        <label>
          <span>Private Workshop note</span>
          <textarea value={privateNote} onChange={event => setPrivateNote(event.target.value)} maxLength={2000} placeholder="Optional. Narrators never see this field." />
        </label>
      </div>
      <div className={styles.buttonRow}>
        <button className={styles.primaryButton} type="button" disabled={!reviewable || busy} onClick={() => review("approve")}>Approve track</button>
        <button className={styles.secondaryButton} type="button" disabled={!reviewable || busy || !feedback.trim()} onClick={() => review("request-changes")}>Request changes</button>
      </div>
      {notice ? <p className={notice.tone === "success" ? styles.successNotice : styles.errorNotice} role="status">{notice.message}</p> : null}
      {!reviewable ? <p className={styles.readOnlyNote}>This version is read-only in its current state.</p> : null}
    </article>
  );
}

export default function NarratorControlRoom({ snapshot }: Props) {
  const router = useRouter();
  const [profileUserId, setProfileUserId] = useState(snapshot.accounts[0]?.id || "");
  const profileByUser = useMemo(() => new Map(snapshot.profiles.map(profile => [profile.userId, profile])), [snapshot.profiles]);
  const selectedProfile = profileByUser.get(profileUserId);
  const selectedAccount = snapshot.accounts.find(account => account.id === profileUserId);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [profileStatusDraft, setProfileStatusDraft] = useState("");
  const displayName = displayNameDraft || selectedProfile?.displayName || selectedAccount?.email.split("@")[0] || "";
  const profileStatus = profileStatusDraft || selectedProfile?.status || "active";
  const activeProfiles = snapshot.profiles.filter(profile => profile.status === "active");
  const [assignmentUserId, setAssignmentUserId] = useState(activeProfiles[0]?.userId || "");
  const effectiveAssignmentUserId = activeProfiles.some(profile => profile.userId === assignmentUserId)
    ? assignmentUserId
    : activeProfiles[0]?.userId || "";
  const [bookQuery, setBookQuery] = useState("");
  const [selectedBook, setSelectedBook] = useState<NarratorAdminBook | null>(null);
  const [editionKey, setEditionKey] = useState("standard");
  const [dueAt, setDueAt] = useState("");
  const [brief, setBrief] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busyAction, setBusyAction] = useState<"profile" | "assignment" | "">("");

  const bookResults = useMemo(() => {
    const query = bookQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    return snapshot.books.filter(book => `${book.title} ${book.id}`.toLowerCase().includes(query)).slice(0, 10);
  }, [bookQuery, snapshot.books]);

  function selectProfileUser(userId: string) {
    setProfileUserId(userId);
    setDisplayNameDraft("");
    setProfileStatusDraft("");
    setNotice(null);
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("profile");
    setNotice(null);
    try {
      await postAction({
        action: "save-profile",
        userId: profileUserId,
        displayName,
        status: profileStatus,
        expectedUpdatedAt: selectedProfile?.updatedAt || "",
      });
      setNotice({ tone: "success", message: selectedProfile ? "Narrator profile updated." : "Narrator account activated." });
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Profile save failed safely." });
    } finally {
      setBusyAction("");
    }
  }

  async function createAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("assignment");
    setNotice(null);
    try {
      await postAction({
        action: "create-assignment-plan",
        userId: effectiveAssignmentUserId,
        bookId: selectedBook?.id || "",
        editionKey,
        dueAt,
        brief,
      });
      setNotice({ tone: "success", message: "Assignment offered with one exact track per Reader section." });
      setSelectedBook(null);
      setBookQuery("");
      setBrief("");
      router.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Assignment setup failed safely." });
    } finally {
      setBusyAction("");
    }
  }

  if (!snapshot.available) {
    return (
      <section className={styles.errorPanel} role="alert">
        <strong>Control room unavailable</strong>
        <p>{snapshot.message}</p>
      </section>
    );
  }

  return (
    <>
      <section className={styles.portalBanner} aria-labelledby="portal-state-title">
        <span className={snapshot.portalEnabled ? styles.enabledBadge : styles.disabledBadge}>{snapshot.portalEnabled ? "Narrator portal on" : "Narrator portal off"}</span>
        <div>
          <h2 id="portal-state-title">The private workroom is {snapshot.portalEnabled ? "available to active narrators" : "currently hidden from narrators"}.</h2>
          <p>This desk creates work and reviews intake. It cannot publish an audiobook, approve rights, or declare a production master.</p>
        </div>
      </section>

      <section className={styles.releaseFence} aria-label="Audio approval boundaries">
        <div><strong>Reader plan</strong><span>Pinned here</span></div>
        <div><strong>Performance</strong><span>Track review here</span></div>
        <div><strong>Rights + master</strong><span>Separate approval</span></div>
        <div><strong>Publication</strong><span>Unavailable here</span></div>
      </section>

      {notice ? <p className={notice.tone === "success" ? styles.successNotice : styles.errorNotice} role="status">{notice.message}</p> : null}

      <div className={styles.setupGrid}>
        <section className={styles.panel} aria-labelledby="profile-title">
          <header className={styles.panelHeader}>
            <span>Step 1</span>
            <h2 id="profile-title">Activate an existing account</h2>
            <p>No invitation or email is sent. The person must already have a confirmed JJ University account.</p>
          </header>
          {snapshot.accounts.length ? (
            <form className={styles.form} onSubmit={saveProfile}>
              <label>
                <span>Confirmed account</span>
                <select value={profileUserId} onChange={event => selectProfileUser(event.target.value)}>
                  {snapshot.accounts.map(account => {
                    const profile = profileByUser.get(account.id);
                    return <option key={account.id} value={account.id}>{account.email}{profile ? ` · ${profile.status}` : ""}</option>;
                  })}
                </select>
              </label>
              <label>
                <span>Narrator name</span>
                <input value={displayName} onChange={event => setDisplayNameDraft(event.target.value)} maxLength={80} required />
              </label>
              <label>
                <span>Portal status</span>
                <select value={profileStatus} onChange={event => setProfileStatusDraft(event.target.value)}>
                  <option value="active">Active</option>
                  <option value="invited">Invited</option>
                  <option value="paused">Paused</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <button className={styles.primaryButton} disabled={busyAction === "profile" || !profileUserId} type="submit">{selectedProfile ? "Update narrator" : "Activate narrator"}</button>
            </form>
          ) : <p className={styles.emptyText}>No confirmed JJ University accounts are available.</p>}
          {snapshot.profiles.length ? (
            <div className={styles.profileList}>
              <h3>Current narrator profiles</h3>
              <ul>{snapshot.profiles.map(profile => <li key={profile.userId}><span>{profile.displayName}</span><strong>{profile.status}</strong></li>)}</ul>
            </div>
          ) : <p className={styles.zeroLine}>0 narrator profiles right now.</p>}
        </section>

        <section className={styles.panel} aria-labelledby="assignment-title">
          <header className={styles.panelHeader}>
            <span>Step 2</span>
            <h2 id="assignment-title">Offer a Reader-mapped book</h2>
            <p>One required audio track is created for each current Reader section. The exact manuscript hash is stored with the edition.</p>
          </header>
          {activeProfiles.length ? (
            <form className={styles.form} onSubmit={createAssignment}>
              <label>
                <span>Active narrator</span>
                <select value={effectiveAssignmentUserId} onChange={event => setAssignmentUserId(event.target.value)}>
                  {activeProfiles.map(profile => <option key={profile.userId} value={profile.userId}>{profile.displayName}</option>)}
                </select>
              </label>
              <div className={styles.bookPicker}>
                <label>
                  <span>Find a book</span>
                  <input value={bookQuery} onChange={event => { setBookQuery(event.target.value); setSelectedBook(null); }} placeholder="Type at least 2 letters" autoComplete="off" />
                </label>
                {selectedBook ? <p className={styles.selectedBook}><span>Selected</span><strong>{selectedBook.title}</strong><button type="button" onClick={() => { setSelectedBook(null); setBookQuery(""); }}>Change</button></p> : null}
                {!selectedBook && bookResults.length ? (
                  <div className={styles.bookResults} role="listbox" aria-label="Matching books">
                    {bookResults.map(book => (
                      <button key={book.id} type="button" role="option" aria-selected="false" onClick={() => { setSelectedBook(book); setBookQuery(book.title); }}>
                        <strong>{book.title}</strong><span>{book.id}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className={styles.splitFields}>
                <label><span>Edition key</span><input value={editionKey} onChange={event => setEditionKey(event.target.value)} maxLength={48} required /></label>
                <label><span>Due date</span><input type="date" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
              </div>
              <label><span>Narrator brief</span><textarea value={brief} onChange={event => setBrief(event.target.value)} maxLength={4000} placeholder="Pronunciation, tone, pacing, and delivery notes." /></label>
              <button className={styles.primaryButton} disabled={busyAction === "assignment" || !selectedBook || !effectiveAssignmentUserId} type="submit">Create plan and offer assignment</button>
            </form>
          ) : <p className={styles.emptyText}>Activate a narrator first. Nothing has been offered.</p>}
        </section>
      </div>

      <section className={styles.section} aria-labelledby="motion-title">
        <header className={styles.sectionHeader}>
          <div><span>Private workflow</span><h2 id="motion-title">Work in motion</h2></div>
          <p>{snapshot.assignments.length} assignment{snapshot.assignments.length === 1 ? "" : "s"} · {snapshot.editions.length} edition{snapshot.editions.length === 1 ? "" : "s"}</p>
        </header>
        {snapshot.editions.length ? (
          <div className={styles.assignmentList}>
            {snapshot.editions.map(edition => {
              const assignment = snapshot.assignments.find(item => item.editionId === edition.id);
              return (
                <article className={styles.assignmentCard} key={edition.id}>
                  <header className={styles.cardHeader}>
                    <div>
                      <span className={styles.status}>{assignment?.status || edition.status}</span>
                      <h3>{edition.bookTitle}</h3>
                      <p>{assignment ? `${assignment.narratorName} · ${formatDate(assignment.dueAt)}` : `${edition.narratorName || "No narrator"} · No assignment attached`}</p>
                    </div>
                    <span className={styles.smallMeta}>{edition.tracks.length} Reader tracks</span>
                  </header>
                  {assignment?.brief ? <p className={styles.brief}>{assignment.brief}</p> : null}
                  <details className={styles.trackDetails}>
                    <summary>See exact Reader track plan</summary>
                    <ol>
                      {edition.tracks.map(track => <li key={track.id}><span>{String(track.position).padStart(2, "0")}</span><div><strong>{track.title}</strong><small>{track.sectionKey}</small></div></li>)}
                    </ol>
                  </details>
                  <p className={styles.hash}>Manuscript: {edition.sourceContentVersion ? `Supabase v${edition.sourceContentVersion} · ` : ""}{edition.sourceContentSha256.slice(0, 12) || "hash unavailable"}</p>
                </article>
              );
            })}
          </div>
        ) : <div className={styles.emptyState}><strong>No narrator editions or assignments yet.</strong><p>This is a real zero, not a hidden or estimated count.</p></div>}
      </section>

      <section className={styles.section} aria-labelledby="submissions-title">
        <header className={styles.sectionHeader}>
          <div><span>Listen-back</span><h2 id="submissions-title">Private submissions</h2></div>
          <p>{snapshot.submissions.length} submitted file{snapshot.submissions.length === 1 ? "" : "s"}</p>
        </header>
        {snapshot.submissions.length ? (
          <div className={styles.submissionList}>{snapshot.submissions.map(submission => <SubmissionReview key={submission.id} submission={submission} onChanged={() => router.refresh()} />)}</div>
        ) : <div className={styles.emptyState}><strong>No narrator submissions yet.</strong><p>Recordings will appear only after an active narrator accepts an assignment and uploads a verified private file.</p></div>}
      </section>
    </>
  );
}
