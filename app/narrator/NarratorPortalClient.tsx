"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import type { NarratorAssignmentView, NarratorPortalData } from "@/lib/narratorPortal";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import styles from "./NarratorPortal.module.css";

const OPEN_UPLOAD_STATUSES = new Set(["accepted", "recording", "changes-requested"]);

function humanStatus(value: string) {
  return value.replace(/-/g, " ");
}

export default function NarratorPortalClient({ initialData }: { initialData: NarratorPortalData }) {
  const [assignments, setAssignments] = useState(initialData.assignments);
  const [selectedId, setSelectedId] = useState(initialData.assignments.find(item => OPEN_UPLOAD_STATUSES.has(item.status))?.id || initialData.assignments[0]?.id || "");
  const [trackPosition, setTrackPosition] = useState("1");
  const [trackTitle, setTrackTitle] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const uploadAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const selected = assignments.find(item => item.id === selectedId) || null;
  const canMutate = initialData.status === "active";

  async function updateAssignment(assignment: NarratorAssignmentView, action: "accept" | "submit") {
    if (!canMutate) {
      setMessage("This narrator account is read-only right now.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await fetch("/api/narrator/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id, action }),
      });
      const payload = await result.json().catch(() => ({})) as { error?: string; status?: string };
      if (!result.ok) throw new Error(payload.error || "That assignment could not be updated.");
      const status = payload.status || (action === "accept" ? "accepted" : "submitted");
      setAssignments(current => current.map(item => item.id === assignment.id ? { ...item, status } : item));
      setSelectedId(assignment.id);
      setMessage(action === "accept" ? "Assignment accepted. You can upload tracks below." : "Submitted to JJ for review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That assignment could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      setMessage("This narrator account is read-only right now.");
      return;
    }
    if (!selected || !file || !OPEN_UPLOAD_STATUSES.has(selected.status)) {
      setMessage("Choose an assignment and audio file first.");
      return;
    }
    const assignment = selected;
    const selectedFile = file;
    const position = Number(trackPosition);
    const title = trackTitle;
    const narratorNote = note;
    const signature = JSON.stringify([
      assignment.id,
      position,
      title,
      selectedFile.name,
      selectedFile.size,
      selectedFile.type,
      selectedFile.lastModified,
      narratorNote,
    ]);
    if (uploadAttemptRef.current?.signature !== signature) {
      uploadAttemptRef.current = { signature, idempotencyKey: crypto.randomUUID() };
    }
    const idempotencyKey = uploadAttemptRef.current.idempotencyKey;
    setBusy(true);
    setMessage("Preparing the private upload…");
    try {
      const prepareResult = await fetch("/api/narrator/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          assignmentId: assignment.id,
          idempotencyKey,
          trackPosition: position,
          trackTitle: title,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type,
          narratorNote,
        }),
      });
      const prepared = await prepareResult.json().catch(() => ({})) as {
        error?: string;
        submissionId?: string;
        bucket?: string;
        path?: string;
        token?: string;
        objectPresent?: boolean;
        alreadyComplete?: boolean;
      };
      if (!prepareResult.ok || !prepared.submissionId || !prepared.bucket || !prepared.path) {
        throw new Error(prepared.error || "Could not prepare that upload.");
      }

      if (!prepared.alreadyComplete && !prepared.objectPresent) {
        if (!prepared.token) throw new Error("Could not prepare that upload.");
        setMessage(`Uploading ${selectedFile.name}…`);
        const supabase = createSupabaseBrowserClient();
        const uploadResult = await supabase.storage
          .from(prepared.bucket)
          .uploadToSignedUrl(prepared.path, prepared.token, selectedFile, { contentType: selectedFile.type });
        if (uploadResult.error) throw uploadResult.error;
      }

      if (!prepared.alreadyComplete) {
        const completeResult = await fetch("/api/narrator/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", submissionId: prepared.submissionId }),
        });
        const completed = await completeResult.json().catch(() => ({})) as { error?: string };
        if (!completeResult.ok) throw new Error(completed.error || "The upload finished but could not be finalized.");
      }

      setAssignments(current => current.map(item => item.id === assignment.id ? {
        ...item,
        status: "recording",
        submissions: [{
          id: prepared.submissionId || "",
          trackPosition: position,
          trackTitle: title,
          fileName: selectedFile.name,
          status: "uploaded",
          uploadedAt: new Date().toISOString(),
        }, ...item.submissions.filter(existing => existing.id !== prepared.submissionId)],
      } : item));
      uploadAttemptRef.current = null;
      setFile(null);
      setTrackPosition(String(position + 1));
      setTrackTitle("");
      setNote("");
      const input = document.getElementById("narrator-audio-file") as HTMLInputElement | null;
      if (input) input.value = "";
      setMessage("Track uploaded. It is private and ready for review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The track could not be uploaded.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/account?next=/narrator");
  }

  return (
    <main className={styles.portal}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Link className={styles.brand} href="/">
            <strong>JJ University</strong>
            <span>Narrator desk</span>
          </Link>
          <button className={styles.signout} type="button" disabled={busy} onClick={signOut}>Sign out</button>
        </header>

        <section className={styles.intro}>
          <p>Narrator desk</p>
          <h1>Hey, {initialData.displayName}.</h1>
          <p className={styles.muted}>Your assignments, uploads, and review status are all in one place.</p>
        </section>

        {message && <div className={styles.notice} role="status">{message}</div>}
        {!canMutate && (
          <div className={styles.notice} role="status">
            This narrator account is {humanStatus(initialData.status)}. Assignments are view-only until JJ activates it.
          </div>
        )}

        <div className={styles.grid}>
          <section className={styles.panel}>
            <h2>Your books</h2>
            {!assignments.length ? <p className={styles.empty}>Nothing is assigned right now.</p> : (
              <ol className={styles.assignmentList}>
                {assignments.map(assignment => (
                  <li className={styles.assignment} data-selected={assignment.id === selectedId} key={assignment.id}>
                    <div className={styles.assignmentHeader}>
                      <h3>{assignment.bookTitle}</h3>
                      <span className={styles.status}>{humanStatus(assignment.status)}</span>
                    </div>
                    {assignment.brief && <p className={styles.brief}>{assignment.brief}</p>}
                    {assignment.dueAt && <p className={styles.brief}>Due {assignment.dueAt.slice(0, 10)}</p>}
                    <div className={styles.assignmentActions}>
                      {canMutate && assignment.status === "offered" ? (
                        <button className={styles.primary} type="button" disabled={busy} onClick={() => updateAssignment(assignment, "accept")}>Accept assignment</button>
                      ) : canMutate && OPEN_UPLOAD_STATUSES.has(assignment.status) ? (
                        <>
                          <button className={styles.primary} type="button" disabled={busy} onClick={() => setSelectedId(assignment.id)}>Upload tracks</button>
                          <button type="button" disabled={busy || !assignment.submissions.some(item => item.status === "uploaded")} onClick={() => updateAssignment(assignment, "submit")}>Submit for review</button>
                        </>
                      ) : null}
                      <Link href={`/books/${assignment.bookSlug}`} target="_blank" rel="noreferrer">View book</Link>
                    </div>
                    {!!assignment.submissions.length && (
                      <div className={styles.submissions}>
                        {assignment.submissions.slice(0, 5).map(item => (
                          <p className={styles.submissionLine} key={item.id}>Track {item.trackPosition}: {item.trackTitle} · {humanStatus(item.status)}</p>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={styles.panel}>
            <h2>Upload a track</h2>
            {!canMutate ? (
              <p className={styles.empty}>Uploads are disabled while this narrator account is {humanStatus(initialData.status)}.</p>
            ) : !selected || !OPEN_UPLOAD_STATUSES.has(selected.status) ? (
              <p className={styles.empty}>Accept an assignment to start uploading.</p>
            ) : (
              <form className={styles.form} onSubmit={upload}>
                <label>
                  Book
                  <select value={selectedId} disabled={busy} onChange={event => setSelectedId(event.target.value)}>
                    {assignments.filter(item => OPEN_UPLOAD_STATUSES.has(item.status)).map(item => (
                      <option value={item.id} key={item.id}>{item.bookTitle}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Track number
                  <input type="number" min="1" max="999" value={trackPosition} disabled={busy} onChange={event => setTrackPosition(event.target.value)} required />
                </label>
                <label>
                  Track title
                  <input value={trackTitle} disabled={busy} onChange={event => setTrackTitle(event.target.value)} placeholder="Chapter 1 — Title" maxLength={160} required />
                </label>
                <label>
                  Audio file
                  <input id="narrator-audio-file" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/flac,.mp3,.m4a,.wav,.flac" disabled={busy} onChange={event => setFile(event.target.files?.[0] || null)} required />
                </label>
                <p className={styles.fileHelp}>One track per file. MP3, M4A, WAV, or FLAC; 50 MB maximum.</p>
                <label>
                  Note for JJ (optional)
                  <textarea value={note} disabled={busy} onChange={event => setNote(event.target.value)} maxLength={1000} />
                </label>
                <button className={styles.primary} type="submit" disabled={busy || !file}>{busy ? "Working…" : "Upload track"}</button>
              </form>
            )}
            <p className={styles.help}>Uploads stay private. Nothing becomes a public audiobook until JJ approves the finished edition.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
