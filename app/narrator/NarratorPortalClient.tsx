"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { NarratorAssignmentView, NarratorPortalData } from "@/lib/narratorPortal";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import styles from "./NarratorPortal.module.css";

const OPEN_UPLOAD_STATUSES = new Set(["accepted", "recording", "changes-requested"]);
const READY_SUBMISSION_STATUSES = new Set(["uploaded", "in-review", "approved", "complete", "completed"]);
const LISTENABLE_SUBMISSION_STATUSES = new Set(["uploaded", "in-review", "changes-requested", "approved", "superseded", "complete", "completed"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;

type PortalSubmission = NarratorAssignmentView["submissions"][number] & {
  audioTrackId: string;
  narratorFeedback: string;
};

type PortalTrack = {
  id: string;
  position: number;
  sectionKey: string;
  title: string;
  required: boolean;
  latestSubmission: PortalSubmission | null;
};

type PortalAssignment = NarratorAssignmentView & {
  tracks: PortalTrack[];
  submissions: PortalSubmission[];
};

type UploadPhase = "selected" | "preparing" | "uploading" | "finalizing" | "done" | "error";

type TrackNotice = {
  trackId: string;
  phase: UploadPhase;
  text: string;
};

function humanStatus(value: string) {
  return value.replace(/-/g, " ");
}

function pageLabel(position: number) {
  return `Page ${String(position).padStart(2, "0")}`;
}

function isSubmissionReady(submission: PortalSubmission | null) {
  return Boolean(submission && READY_SUBMISSION_STATUSES.has(submission.status));
}

function isSubmissionListenable(submission: PortalSubmission | null) {
  return Boolean(submission && LISTENABLE_SUBMISSION_STATUSES.has(submission.status));
}

function progressFor(assignment: PortalAssignment) {
  const required = assignment.tracks.filter(track => track.required);
  return {
    ready: required.filter(track => isSubmissionReady(track.latestSubmission)).length,
    total: required.length,
  };
}

function trackStatus(track: PortalTrack) {
  const submission = track.latestSubmission;
  if (!submission) return track.required ? "Recording needed" : "Optional";
  if (["uploaded", "complete", "completed"].includes(submission.status)) return "Ready";
  if (submission.status === "in-review") return "In review";
  if (submission.status === "approved") return "Approved";
  if (submission.status === "changes-requested") return "Changes requested";
  if (submission.status === "awaiting-upload") return "Upload not finished";
  if (submission.status === "upload-failed") return "Upload failed";
  return humanStatus(submission.status);
}

function normalizedMimeType(file: File) {
  const supplied = file.type.split(";", 1)[0].trim().toLowerCase();
  if (["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/flac"].includes(supplied)) {
    return supplied;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "wav" || extension === "wave") return "audio/wav";
  if (extension === "flac") return "audio/flac";
  return supplied;
}

function displayFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NarratorPortalClient({ initialData }: { initialData: NarratorPortalData }) {
  const initialAssignments = initialData.assignments as PortalAssignment[];
  const [assignments, setAssignments] = useState<PortalAssignment[]>(initialAssignments);
  const [selectedId, setSelectedId] = useState(
    initialAssignments.find(item => OPEN_UPLOAD_STATUSES.has(item.status))?.id || initialAssignments[0]?.id || "",
  );
  const [activeTrackId, setActiveTrackId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [trackNotice, setTrackNotice] = useState<TrackNotice | null>(null);
  const [message, setMessage] = useState("");
  const [listeningSubmissionId, setListeningSubmissionId] = useState("");
  const uploadAttemptRef = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  const fileInputRefs = useRef(new Map<string, HTMLInputElement>());
  const recordButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const selected = assignments.find(item => item.id === selectedId) || null;
  const canMutate = initialData.status === "active";
  const uploadBusy = trackNotice?.phase === "preparing"
    || trackNotice?.phase === "uploading"
    || trackNotice?.phase === "finalizing";
  const busy = actionBusy || uploadBusy;

  const selectedProgress = useMemo(
    () => selected ? progressFor(selected) : { ready: 0, total: 0 },
    [selected],
  );
  const canSubmitSelected = Boolean(
    selected
    && OPEN_UPLOAD_STATUSES.has(selected.status)
    && selectedProgress.total > 0
    && selectedProgress.ready === selectedProgress.total,
  );
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function clearSelectedFile(trackId?: string) {
    if (trackId) {
      const input = fileInputRefs.current.get(trackId);
      if (input) input.value = "";
    }
    setFile(null);
    setNote("");
    uploadAttemptRef.current = null;
  }

  function chooseAssignment(assignmentId: string) {
    if (assignmentId === selectedId) return;
    clearSelectedFile(activeTrackId);
    setActiveTrackId("");
    setTrackNotice(null);
    setListeningSubmissionId("");
    setMessage("");
    setSelectedId(assignmentId);
  }

  async function updateAssignment(assignment: PortalAssignment, action: "accept" | "submit") {
    if (!canMutate) {
      setMessage("This narrator account is read-only right now.");
      return;
    }
    if (action === "submit") {
      const progress = progressFor(assignment);
      if (!progress.total || progress.ready !== progress.total) {
        setMessage("Finish every required page before submitting the book.");
        return;
      }
    }
    setActionBusy(true);
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
      setMessage(action === "accept"
        ? "Assignment accepted. Start with the first page that needs a recording."
        : "Book submitted to JJ for review. Your recordings are now read-only.");

      if (action === "accept") {
        const firstMissing = assignment.tracks.find(track => track.required && !isSubmissionReady(track.latestSubmission));
        if (firstMissing) {
          setActiveTrackId(firstMissing.id);
          window.setTimeout(() => recordButtonRefs.current.get(firstMissing.id)?.focus(), 0);
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That assignment could not be updated.");
    } finally {
      setActionBusy(false);
    }
  }

  function chooseFile(track: PortalTrack) {
    if (!selected || !canMutate || !OPEN_UPLOAD_STATUSES.has(selected.status) || busy) return;
    if (activeTrackId !== track.id) clearSelectedFile(activeTrackId);
    setActiveTrackId(track.id);
    setTrackNotice(null);
    setListeningSubmissionId("");
    fileInputRefs.current.get(track.id)?.click();
  }

  function fileChanged(track: PortalTrack, event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] || null;
    setActiveTrackId(track.id);
    uploadAttemptRef.current = null;
    if (!selectedFile) {
      setFile(null);
      setTrackNotice(null);
      return;
    }
    const mimeType = normalizedMimeType(selectedFile);
    if (!mimeType || !["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/flac"].includes(mimeType)) {
      setFile(null);
      event.target.value = "";
      setTrackNotice({ trackId: track.id, phase: "error", text: "Choose an MP3, M4A, WAV, or FLAC audio file." });
      return;
    }
    if (selectedFile.size < 1 || selectedFile.size > MAX_FILE_SIZE) {
      setFile(null);
      event.target.value = "";
      setTrackNotice({ trackId: track.id, phase: "error", text: "Choose an audio file that is 50 MB or smaller." });
      return;
    }
    setFile(selectedFile);
    setTrackNotice({ trackId: track.id, phase: "selected", text: "Listen once, then upload when it sounds right." });
    window.setTimeout(() => uploadButtonRef.current?.focus(), 0);
  }

  async function uploadTrack(assignment: PortalAssignment, track: PortalTrack) {
    if (!canMutate) {
      setMessage("This narrator account is read-only right now.");
      return;
    }
    if (!file || activeTrackId !== track.id || !OPEN_UPLOAD_STATUSES.has(assignment.status)) {
      setTrackNotice({ trackId: track.id, phase: "error", text: "Choose an audio file first." });
      return;
    }

    const selectedFile = file;
    const narratorNote = note.trim();
    const mimeType = normalizedMimeType(selectedFile);
    const signature = JSON.stringify([
      assignment.id,
      track.id,
      selectedFile.name,
      selectedFile.size,
      mimeType,
      selectedFile.lastModified,
      narratorNote,
    ]);
    if (uploadAttemptRef.current?.signature !== signature) {
      uploadAttemptRef.current = { signature, idempotencyKey: crypto.randomUUID() };
    }
    const idempotencyKey = uploadAttemptRef.current.idempotencyKey;
    setMessage("");
    setTrackNotice({ trackId: track.id, phase: "preparing", text: "Preparing a private upload…" });

    try {
      const prepareResult = await fetch("/api/narrator/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          assignmentId: assignment.id,
          audioTrackId: track.id,
          idempotencyKey,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          mimeType,
          narratorNote,
        }),
      });
      const prepared = await prepareResult.json().catch(() => ({})) as {
        error?: string;
        submissionId?: string;
        bucket?: string;
        path?: string;
        token?: string;
        mimeType?: string;
        objectPresent?: boolean;
        alreadyComplete?: boolean;
      };
      if (!prepareResult.ok || !prepared.submissionId || !prepared.bucket || !prepared.path) {
        throw new Error(prepared.error || "Could not prepare that upload.");
      }

      if (!prepared.alreadyComplete && !prepared.objectPresent) {
        if (!prepared.token) throw new Error("Could not prepare that upload.");
        setTrackNotice({ trackId: track.id, phase: "uploading", text: `Uploading ${selectedFile.name}… Keep this page open.` });
        const supabase = createSupabaseBrowserClient();
        const uploadResult = await supabase.storage
          .from(prepared.bucket)
          .uploadToSignedUrl(prepared.path, prepared.token, selectedFile, { contentType: prepared.mimeType || mimeType });
        if (uploadResult.error) throw uploadResult.error;
      }

      if (!prepared.alreadyComplete) {
        setTrackNotice({ trackId: track.id, phase: "finalizing", text: "Checking the finished upload…" });
        const completeResult = await fetch("/api/narrator/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", submissionId: prepared.submissionId }),
        });
        const completed = await completeResult.json().catch(() => ({})) as { error?: string };
        if (!completeResult.ok) throw new Error(completed.error || "The upload finished but could not be finalized.");
      }

      const submission: PortalSubmission = {
        id: prepared.submissionId,
        audioTrackId: track.id,
        trackPosition: track.position,
        trackTitle: track.title,
        fileName: selectedFile.name,
        status: "uploaded",
        uploadedAt: new Date().toISOString(),
        narratorFeedback: "",
      };
      const updatedTracks = assignment.tracks.map(item => item.id === track.id
        ? { ...item, latestSubmission: submission }
        : item);
      setAssignments(current => current.map(item => item.id === assignment.id ? {
        ...item,
        status: "recording",
        tracks: updatedTracks,
        submissions: [submission, ...item.submissions.filter(existing => existing.id !== submission.id)],
      } : item));

      const orderedTracks = [...updatedTracks].sort((a, b) => a.position - b.position);
      const currentIndex = orderedTracks.findIndex(item => item.id === track.id);
      const searchOrder = [
        ...orderedTracks.slice(currentIndex + 1),
        ...orderedTracks.slice(0, Math.max(0, currentIndex)),
      ];
      const nextMissing = searchOrder.find(item => item.required && !isSubmissionReady(item.latestSubmission));

      clearSelectedFile(track.id);
      setTrackNotice({ trackId: track.id, phase: "done", text: `${pageLabel(track.position)} is uploaded and ready.` });
      if (nextMissing) {
        setActiveTrackId(nextMissing.id);
        setMessage(`Nice. Next up: ${pageLabel(nextMissing.position)}, ${nextMissing.title}.`);
        window.setTimeout(() => {
          const button = recordButtonRefs.current.get(nextMissing.id);
          button?.focus();
          button?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
      } else {
        setActiveTrackId("");
        setMessage("Every required page is ready. Submit the book whenever you’re happy with it.");
        window.setTimeout(() => submitButtonRef.current?.focus(), 0);
      }
    } catch (error) {
      setTrackNotice({
        trackId: track.id,
        phase: "error",
        text: error instanceof Error ? error.message : "The recording could not be uploaded. Retry the same file.",
      });
    }
  }

  async function signOut() {
    setActionBusy(true);
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
          <p className={styles.muted}>Pick a book, record its pages in order, and listen back before you send anything.</p>
        </section>

        {message && <div className={styles.notice} role="status" aria-live="polite">{message}</div>}
        {!canMutate && (
          <div className={styles.notice} role="status">
            This narrator account is {humanStatus(initialData.status)}. Assignments are view-only until JJ activates it.
          </div>
        )}

        <div className={styles.grid}>
          <section className={styles.panel} aria-labelledby="narrator-books-heading">
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Step 1</p>
                <h2 id="narrator-books-heading">Choose a book</h2>
              </div>
              <span className={styles.count}>{assignments.length}</span>
            </div>
            {!assignments.length ? <p className={styles.empty}>Nothing is assigned right now.</p> : (
              <ol className={styles.assignmentList}>
                {assignments.map(assignment => {
                  const progress = progressFor(assignment);
                  const selectedAssignment = assignment.id === selectedId;
                  return (
                    <li className={styles.assignment} data-selected={selectedAssignment} key={assignment.id}>
                      <button
                        className={styles.assignmentSelect}
                        type="button"
                        aria-current={selectedAssignment ? "true" : undefined}
                        onClick={() => chooseAssignment(assignment.id)}
                      >
                        <span className={styles.assignmentTitle}>{assignment.bookTitle}</span>
                        <span className={styles.assignmentMeta}>
                          <span>{progress.ready} of {progress.total} required ready</span>
                          <span className={styles.status}>{humanStatus(assignment.status)}</span>
                        </span>
                      </button>
                      {selectedAssignment && (
                        <div className={styles.assignmentDetails}>
                          {assignment.brief && <p className={styles.brief}>{assignment.brief}</p>}
                          {assignment.dueAt && <p className={styles.brief}>Due {assignment.dueAt.slice(0, 10)}</p>}
                          <div className={styles.assignmentActions}>
                            {canMutate && assignment.status === "offered" && (
                              <button className={styles.primary} type="button" disabled={busy} onClick={() => updateAssignment(assignment, "accept")}>Accept assignment</button>
                            )}
                            <Link href={`/books/${assignment.bookSlug}`} target="_blank" rel="noreferrer">Open the book</Link>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className={`${styles.panel} ${styles.recordingPanel}`} aria-labelledby="narrator-recording-heading">
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Step 2</p>
                <h2 id="narrator-recording-heading">Record the pages</h2>
              </div>
            </div>

            {!selected ? (
              <p className={styles.empty}>Choose an assigned book to see its pages.</p>
            ) : (
              <>
                <div className={styles.progressCard}>
                  <div className={styles.progressCopy}>
                    <strong>{selected.bookTitle}</strong>
                    <span>{selectedProgress.ready} of {selectedProgress.total} required ready</span>
                  </div>
                  <progress
                    className={styles.progress}
                    max={Math.max(1, selectedProgress.total)}
                    value={selectedProgress.ready}
                    aria-label={`${selectedProgress.ready} of ${selectedProgress.total} required recordings ready`}
                  />
                </div>

                {selected.status === "offered" ? (
                  <div className={styles.emptyState}>
                    <p>Accept this assignment when you’re ready to begin.</p>
                    {canMutate && (
                      <button className={styles.primary} type="button" disabled={busy} onClick={() => updateAssignment(selected, "accept")}>Accept assignment</button>
                    )}
                  </div>
                ) : !selected.tracks.length ? (
                  <p className={styles.empty}>JJ hasn’t prepared the page checklist for this book yet.</p>
                ) : (
                  <ol className={styles.trackList}>
                    {[...selected.tracks].sort((a, b) => a.position - b.position).map(track => {
                      const submission = track.latestSubmission;
                      const ready = isSubmissionReady(submission);
                      const active = track.id === activeTrackId;
                      const rowNotice = trackNotice?.trackId === track.id ? trackNotice : null;
                      const mutable = canMutate && OPEN_UPLOAD_STATUSES.has(selected.status);
                      const listening = Boolean(submission && listeningSubmissionId === submission.id);
                      return (
                        <li className={styles.track} data-active={active} data-ready={ready} key={track.id}>
                          <div className={styles.trackTopline}>
                            <div className={styles.trackIdentity}>
                              <span className={styles.pageNumber}>{pageLabel(track.position)}</span>
                              <h3>{track.title}</h3>
                              {!track.required && <span className={styles.optional}>Optional</span>}
                            </div>
                            <span className={styles.trackStatus} data-ready={ready}>{trackStatus(track)}</span>
                          </div>

                          {submission?.narratorFeedback && (
                            <div className={styles.feedback}>
                              <strong>Note from JJ</strong>
                              <p>{submission.narratorFeedback}</p>
                            </div>
                          )}

                          <div className={styles.trackActions}>
                            {mutable && (
                              <>
                                <input
                                  ref={element => {
                                    if (element) fileInputRefs.current.set(track.id, element);
                                    else fileInputRefs.current.delete(track.id);
                                  }}
                                  className={styles.visuallyHidden}
                                  id={`narrator-file-${track.id}`}
                                  type="file"
                                  accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/flac,.mp3,.m4a,.wav,.wave,.flac"
                                  disabled={busy}
                                  onChange={event => fileChanged(track, event)}
                                />
                                <button
                                  ref={element => {
                                    if (element) recordButtonRefs.current.set(track.id, element);
                                    else recordButtonRefs.current.delete(track.id);
                                  }}
                                  className={submission ? styles.secondary : styles.primary}
                                  type="button"
                                  disabled={busy}
                                  aria-label={`${submission ? "Replace" : "Add"} recording for ${pageLabel(track.position)}, ${track.title}`}
                                  onClick={() => chooseFile(track)}
                                >
                                  {submission ? "Replace recording" : "Add recording"}
                                </button>
                              </>
                            )}
                            {isSubmissionListenable(submission) && submission && (
                              <button
                                className={styles.secondary}
                                type="button"
                                aria-expanded={listening}
                                aria-controls={`listen-${submission.id}`}
                                onClick={() => setListeningSubmissionId(current => current === submission.id ? "" : submission.id)}
                              >
                                {listening ? "Close player" : "Listen back"}
                              </button>
                            )}
                          </div>

                          {listening && submission && (
                            <div className={styles.listenBack} id={`listen-${submission.id}`}>
                              <p>Private uploaded recording</p>
                              <audio
                                controls
                                preload="none"
                                src={`/api/narrator/submissions/${encodeURIComponent(submission.id)}/audio`}
                                aria-label={`Private recording for ${pageLabel(track.position)}, ${track.title}`}
                                onError={() => setTrackNotice({ trackId: track.id, phase: "error", text: "That recording couldn’t be loaded. Try Listen back again." })}
                              >
                                Your browser does not support audio playback.
                              </audio>
                            </div>
                          )}

                          {active && file && (
                            <div className={styles.uploadComposer}>
                              <div className={styles.fileSummary}>
                                <div>
                                  <strong>{file.name}</strong>
                                  <span>{displayFileSize(file.size)}</span>
                                </div>
                                <button type="button" disabled={busy} onClick={() => {
                                  clearSelectedFile(track.id);
                                  setTrackNotice(null);
                                  recordButtonRefs.current.get(track.id)?.focus();
                                }}>Choose a different file</button>
                              </div>
                              {previewUrl && (
                                <div className={styles.localPreview}>
                                  <p>Listen before uploading</p>
                                  <audio
                                    controls
                                    preload="metadata"
                                    src={previewUrl}
                                    aria-label={`Preview selected recording for ${pageLabel(track.position)}, ${track.title}`}
                                  >
                                    Your browser does not support audio playback.
                                  </audio>
                                </div>
                              )}
                              <label className={styles.noteField}>
                                Note for JJ <span>(optional)</span>
                                <textarea
                                  value={note}
                                  disabled={busy}
                                  maxLength={1000}
                                  placeholder="Anything JJ should know about this take?"
                                  onChange={event => {
                                    setNote(event.target.value);
                                    uploadAttemptRef.current = null;
                                  }}
                                />
                              </label>
                              <button
                                ref={uploadButtonRef}
                                className={styles.primary}
                                type="button"
                                disabled={busy}
                                onClick={() => uploadTrack(selected, track)}
                              >
                                {uploadBusy ? "Uploading…" : `Upload ${pageLabel(track.position)}`}
                              </button>
                              <p className={styles.fileHelp}>Private upload. MP3, M4A, WAV, or FLAC; 50 MB maximum. Keep this page open until it finishes.</p>
                            </div>
                          )}

                          {rowNotice && (
                            <div
                              className={styles.trackNotice}
                              data-phase={rowNotice.phase}
                              role={rowNotice.phase === "error" ? "alert" : "status"}
                              aria-live="polite"
                            >
                              {uploadBusy && <span className={styles.activity} aria-hidden="true" />}
                              <span>{rowNotice.text}</span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                <div className={styles.submitDock}>
                  <div>
                    <strong>{selectedProgress.ready} of {selectedProgress.total} required ready</strong>
                    <span>{canSubmitSelected ? "Everything is ready for JJ." : "Finish every required page to submit."}</span>
                  </div>
                  {canMutate && OPEN_UPLOAD_STATUSES.has(selected.status) ? (
                    <button
                      ref={submitButtonRef}
                      className={styles.primary}
                      type="button"
                      disabled={busy || !canSubmitSelected}
                      onClick={() => updateAssignment(selected, "submit")}
                    >
                      Submit book for review
                    </button>
                  ) : (
                    <span className={styles.readOnlyState}>{selected.status === "submitted" ? "Submitted to JJ" : humanStatus(selected.status)}</span>
                  )}
                </div>
              </>
            )}
            <p className={styles.help}>Recordings stay private. Nothing becomes a public audiobook until JJ approves the finished edition.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
