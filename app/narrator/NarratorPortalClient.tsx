"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { NarratorAssignmentView, NarratorPortalData } from "@/lib/narratorPortal";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import styles from "./NarratorPortal.module.css";

const OPEN_UPLOAD_STATUSES = new Set(["accepted", "recording", "changes-requested"]);
const READY_SUBMISSION_STATUSES = new Set(["uploaded", "in-review", "approved", "complete", "completed"]);
const LISTENABLE_SUBMISSION_STATUSES = new Set(["uploaded", "in-review", "changes-requested", "approved", "superseded", "complete", "completed"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UPLOAD_ATTEMPT_STORAGE_KEY = "jju.narratorUploadAttempts.v1";
const UPLOAD_ATTEMPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  loaded?: number;
  total?: number;
};

type UploadAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  savedAt: number;
};

type StoredUploadAttempts = Record<string, UploadAttempt>;

function humanStatus(value: string) {
  return value.replace(/-/g, " ");
}

function sectionTitle(track: PortalTrack) {
  return track.title.trim() || "Untitled section";
}

function sectionKeyLabel(track: PortalTrack) {
  return track.sectionKey.trim() || "No section key";
}

function sectionNumber(position: number) {
  return String(position).padStart(2, "0");
}

function uploadAttemptSlot(assignmentId: string, trackId: string) {
  return `${assignmentId}:${trackId}`;
}

function readUploadAttempts(): StoredUploadAttempts {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UPLOAD_ATTEMPT_STORAGE_KEY) || "{}") as StoredUploadAttempts;
    const cutoff = Date.now() - UPLOAD_ATTEMPT_MAX_AGE_MS;
    return Object.fromEntries(Object.entries(parsed).filter(([, attempt]) => (
      attempt
      && typeof attempt.fingerprint === "string"
      && typeof attempt.idempotencyKey === "string"
      && Number(attempt.savedAt) >= cutoff
    )));
  } catch {
    return {};
  }
}

function persistUploadAttempt(assignmentId: string, trackId: string, fingerprint: string) {
  const attempts = readUploadAttempts();
  const slot = uploadAttemptSlot(assignmentId, trackId);
  const existing = attempts[slot];
  const attempt = existing?.fingerprint === fingerprint
    ? existing
    : { fingerprint, idempotencyKey: crypto.randomUUID(), savedAt: Date.now() };
  attempts[slot] = { ...attempt, savedAt: Date.now() };
  try {
    window.localStorage.setItem(UPLOAD_ATTEMPT_STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // The in-memory attempt below still prevents duplicate taps in this session.
  }
  return attempts[slot];
}

function forgetUploadAttempt(assignmentId: string, trackId: string) {
  const attempts = readUploadAttempts();
  delete attempts[uploadAttemptSlot(assignmentId, trackId)];
  try {
    window.localStorage.setItem(UPLOAD_ATTEMPT_STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // Storage may be unavailable in private browsing; the completed server state remains authoritative.
  }
}

async function uploadSignedFileWithProgress({
  bucket,
  path,
  token,
  file,
  onProgress,
}: {
  bucket: string;
  path: string;
  token: string;
  file: File;
  onProgress: (loaded: number, total: number) => void;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
  if (!supabaseUrl || !publishableKey) throw new Error("Private uploads are not configured on this site.");

  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Your sign-in expired. Sign in again, then retry this file.");

  const encodedPath = [bucket, ...path.split("/")].map(part => encodeURIComponent(part)).join("/");
  const uploadUrl = new URL(`/storage/v1/object/upload/sign/${encodedPath}`, supabaseUrl);
  uploadUrl.searchParams.set("token", token);
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl.toString());
    request.setRequestHeader("apikey", publishableKey);
    request.setRequestHeader("Authorization", `Bearer ${data.session.access_token}`);
    request.setRequestHeader("x-upsert", "false");
    request.upload.addEventListener("progress", event => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      onProgress(Math.min(event.loaded, total), total);
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size, file.size);
        resolve();
        return;
      }
      let detail = "";
      try {
        const payload = JSON.parse(request.responseText || "{}") as { message?: string; error?: string };
        detail = payload.message || payload.error || "";
      } catch {
        detail = "";
      }
      reject(new Error(detail || `Private upload failed (${request.status}).`));
    });
    request.addEventListener("error", () => reject(new Error("The connection dropped during upload. Choose the same file and retry.")));
    request.addEventListener("abort", () => reject(new Error("The upload was stopped. Choose the same file and retry.")));
    request.send(body);
  });
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

function displayTransferSize(bytes: number) {
  return bytes > 0 ? displayFileSize(bytes) : "0 KB";
}

export default function NarratorPortalClient({ initialData }: { initialData: NarratorPortalData }) {
  const router = useRouter();
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
  const uploadAttemptRef = useRef<UploadAttempt | null>(null);
  const uploadInFlightRef = useRef(false);
  const fileInputRefs = useRef(new Map<string, HTMLInputElement>());
  const recordButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const queueButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const recordingPanelRef = useRef<HTMLElement | null>(null);
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
  const orderedTracks = useMemo(
    () => selected ? [...selected.tracks].sort((a, b) => a.position - b.position) : [],
    [selected],
  );
  const firstMissingTrack = orderedTracks.find(track => track.required && !isSubmissionReady(track.latestSubmission))
    || orderedTracks.find(track => !isSubmissionReady(track.latestSubmission))
    || orderedTracks[0]
    || null;
  const focusedTrack = orderedTracks.find(track => track.id === activeTrackId) || firstMissingTrack;
  const focusedTrackId = focusedTrack?.id || "";
  const focusedSubmission = focusedTrack?.latestSubmission || null;
  const focusedReady = isSubmissionReady(focusedSubmission);
  const focusedMutable = Boolean(selected && canMutate && OPEN_UPLOAD_STATUSES.has(selected.status));
  const focusedListening = Boolean(focusedSubmission && listeningSubmissionId === focusedSubmission.id);
  const focusedNotice = focusedTrack && trackNotice?.trackId === focusedTrack.id ? trackNotice : null;
  const remainingRequired = Math.max(0, selectedProgress.total - selectedProgress.ready);
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!focusedTrackId) return;
    const frame = window.requestAnimationFrame(() => {
      const button = queueButtonRefs.current.get(focusedTrackId);
      const queue = button?.closest("ol");
      if (!button || !queue) return;
      const queueRect = queue.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const left = queue.scrollLeft + buttonRect.left - queueRect.left - (queue.clientWidth - button.clientWidth) / 2;
      queue.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedTrackId]);

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
    if (uploadInFlightRef.current || actionBusy) return;
    if (assignmentId === selectedId) return;
    clearSelectedFile(activeTrackId);
    setActiveTrackId("");
    setTrackNotice(null);
    setListeningSubmissionId("");
    setMessage("");
    setSelectedId(assignmentId);
    window.setTimeout(() => recordingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function focusTrack(track: PortalTrack) {
    if (uploadInFlightRef.current || actionBusy) return;
    if (track.id === focusedTrack?.id) return;
    clearSelectedFile(activeTrackId);
    setActiveTrackId(track.id);
    setTrackNotice(null);
    setListeningSubmissionId("");
    window.setTimeout(() => recordingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function updateAssignment(assignment: PortalAssignment, action: "accept" | "submit") {
    if (uploadInFlightRef.current) return;
    if (!canMutate) {
      setMessage("This narrator account is read-only right now.");
      return;
    }
    if (action === "submit") {
      const progress = progressFor(assignment);
      if (!progress.total || progress.ready !== progress.total) {
        setMessage("Finish every required section before submitting the book.");
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
        ? "Assignment accepted. Start with the first section that needs a recording."
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
    if (uploadInFlightRef.current) return;
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
    const fingerprint = JSON.stringify([
      assignment.id,
      track.id,
      selectedFile.name,
      selectedFile.size,
      mimeType,
      selectedFile.lastModified,
    ]);
    if (uploadAttemptRef.current?.fingerprint !== fingerprint) {
      uploadAttemptRef.current = persistUploadAttempt(assignment.id, track.id, fingerprint);
    }
    const idempotencyKey = uploadAttemptRef.current.idempotencyKey;
    uploadInFlightRef.current = true;
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
        setTrackNotice({
          trackId: track.id,
          phase: "uploading",
          text: `Uploading ${selectedFile.name}… Keep this page open.`,
          loaded: 0,
          total: selectedFile.size,
        });
        let lastPercent = -1;
        await uploadSignedFileWithProgress({
          bucket: prepared.bucket,
          path: prepared.path,
          token: prepared.token,
          file: selectedFile,
          onProgress: (loaded, total) => {
            const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0;
            if (percent === lastPercent) return;
            lastPercent = percent;
            setTrackNotice({
              trackId: track.id,
              phase: "uploading",
              text: `Uploading ${selectedFile.name}… Keep this page open.`,
              loaded,
              total,
            });
          },
        });
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

      forgetUploadAttempt(assignment.id, track.id);
      clearSelectedFile(track.id);
      setTrackNotice({ trackId: track.id, phase: "done", text: `${sectionTitle(track)} is uploaded and ready.` });
      if (nextMissing) {
        setActiveTrackId(nextMissing.id);
        setMessage(`Nice. Next up: ${sectionTitle(nextMissing)} (${sectionKeyLabel(nextMissing)}).`);
        window.setTimeout(() => {
          const button = recordButtonRefs.current.get(nextMissing.id);
          button?.focus();
          button?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
      } else {
        setActiveTrackId("");
        setMessage("Every required section is ready. Submit the book whenever you’re happy with it.");
        window.setTimeout(() => submitButtonRef.current?.focus(), 0);
      }
    } catch (error) {
      setTrackNotice({
        trackId: track.id,
        phase: "error",
        text: error instanceof Error ? error.message : "The recording could not be uploaded. Retry the same file.",
      });
    } finally {
      uploadInFlightRef.current = false;
    }
  }

  async function signOut() {
    setActionBusy(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/account?next=/narrator");
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
          <p className={styles.muted}>Pick a book, record its Reader sections in order, and listen back before you send anything.</p>
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
                        disabled={busy}
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
                            <Link href={`/reader?book=${encodeURIComponent(assignment.bookSlug || assignment.bookId)}`} target="_blank" rel="noreferrer">Open in Reader</Link>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section ref={recordingPanelRef} className={`${styles.panel} ${styles.recordingPanel}`} aria-labelledby="narrator-recording-heading">
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Step 2</p>
                <h2 id="narrator-recording-heading">Record the sections</h2>
              </div>
            </div>

            {!selected ? (
              <p className={styles.empty}>Choose an assigned book to see its section queue.</p>
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
                  <p className={styles.empty}>JJ hasn’t prepared the section checklist for this book yet.</p>
                ) : (
                  <div className={styles.sectionWorkspace}>
                    <div className={styles.queueHeader}>
                      <div>
                        <p className={styles.eyebrow}>Section queue</p>
                        <strong>{remainingRequired ? `${remainingRequired} required left` : "Required sections ready"}</strong>
                      </div>
                      <Link
                        className={styles.readerLink}
                        href={`/reader?book=${encodeURIComponent(selected.bookSlug || selected.bookId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open book in Reader
                      </Link>
                    </div>

                    <ol className={styles.sectionQueue} aria-label={`Sections for ${selected.bookTitle}`}>
                      {orderedTracks.map(track => {
                        const ready = isSubmissionReady(track.latestSubmission);
                        const current = track.id === focusedTrack?.id;
                        return (
                          <li key={track.id}>
                            <button
                              ref={element => {
                                if (element) queueButtonRefs.current.set(track.id, element);
                                else queueButtonRefs.current.delete(track.id);
                              }}
                              type="button"
                              disabled={busy}
                              data-active={current}
                              data-ready={ready}
                              aria-current={current ? "step" : undefined}
                              onClick={() => focusTrack(track)}
                            >
                              <span className={styles.queueNumber}>{sectionNumber(track.position)}</span>
                              <span className={styles.queueCopy}>
                                <strong>{sectionTitle(track)}</strong>
                                <code>{sectionKeyLabel(track)}</code>
                              </span>
                              <span className={styles.queueState}>{ready ? "Ready" : track.required ? "Needed" : "Optional"}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>

                    {focusedTrack && (
                      <article className={styles.track} data-active="true" data-ready={focusedReady}>
                        <div className={styles.trackTopline}>
                          <div className={styles.trackIdentity}>
                            <span className={styles.sectionPosition}>Section {sectionNumber(focusedTrack.position)}</span>
                            <h3>{sectionTitle(focusedTrack)}</h3>
                            <code className={styles.sectionKey}>{sectionKeyLabel(focusedTrack)}</code>
                            {!focusedTrack.required && <span className={styles.optional}>Optional</span>}
                          </div>
                          <span className={styles.trackStatus} data-ready={focusedReady}>{trackStatus(focusedTrack)}</span>
                        </div>

                        {focusedSubmission?.narratorFeedback && (
                          <div className={styles.feedback}>
                            <strong>Note from JJ</strong>
                            <p>{focusedSubmission.narratorFeedback}</p>
                          </div>
                        )}

                        <div className={styles.trackActions}>
                          {isSubmissionListenable(focusedSubmission) && focusedSubmission && (
                            <button
                              className={styles.listenButton}
                              type="button"
                              aria-expanded={focusedListening}
                              aria-controls={`listen-${focusedSubmission.id}`}
                              onClick={() => setListeningSubmissionId(current => current === focusedSubmission.id ? "" : focusedSubmission.id)}
                            >
                              {focusedListening ? "Close listen-back" : "Listen back to upload"}
                            </button>
                          )}
                          {focusedMutable && (
                            <>
                              <input
                                ref={element => {
                                  if (element) fileInputRefs.current.set(focusedTrack.id, element);
                                  else fileInputRefs.current.delete(focusedTrack.id);
                                }}
                                className={styles.visuallyHidden}
                                id={`narrator-file-${focusedTrack.id}`}
                                type="file"
                                accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/flac,.mp3,.m4a,.wav,.wave,.flac"
                                disabled={busy}
                                onChange={event => fileChanged(focusedTrack, event)}
                              />
                              <button
                                ref={element => {
                                  if (element) recordButtonRefs.current.set(focusedTrack.id, element);
                                  else recordButtonRefs.current.delete(focusedTrack.id);
                                }}
                                className={focusedSubmission ? styles.secondary : styles.primary}
                                type="button"
                                disabled={busy}
                                aria-label={`${focusedSubmission ? "Replace" : "Add"} recording for ${sectionTitle(focusedTrack)}, ${sectionKeyLabel(focusedTrack)}`}
                                onClick={() => chooseFile(focusedTrack)}
                              >
                                {focusedSubmission ? "Replace recording" : "Add recording"}
                              </button>
                            </>
                          )}
                        </div>

                        {focusedListening && focusedSubmission && (
                          <div className={styles.listenBack} id={`listen-${focusedSubmission.id}`}>
                            <p>Private uploaded recording · {sectionKeyLabel(focusedTrack)}</p>
                            <audio
                              controls
                              preload="none"
                              src={`/api/narrator/submissions/${encodeURIComponent(focusedSubmission.id)}/audio`}
                              aria-label={`Private recording for ${sectionTitle(focusedTrack)}, ${sectionKeyLabel(focusedTrack)}`}
                              onError={() => setTrackNotice({ trackId: focusedTrack.id, phase: "error", text: "That recording couldn’t be loaded. Close Listen back, then try again." })}
                            >
                              Your browser does not support audio playback.
                            </audio>
                          </div>
                        )}

                        {activeTrackId === focusedTrack.id && file && (
                          <div className={styles.uploadComposer}>
                            <div className={styles.fileSummary}>
                              <div>
                                <strong>{file.name}</strong>
                                <span>{displayFileSize(file.size)}</span>
                              </div>
                              <button type="button" disabled={busy} onClick={() => {
                                clearSelectedFile(focusedTrack.id);
                                setTrackNotice(null);
                                recordButtonRefs.current.get(focusedTrack.id)?.focus();
                              }}>Choose a different file</button>
                            </div>
                            {previewUrl && (
                              <div className={styles.localPreview}>
                                <p>Listen before uploading</p>
                                <audio
                                  controls
                                  preload="metadata"
                                  src={previewUrl}
                                  aria-label={`Preview selected recording for ${sectionTitle(focusedTrack)}, ${sectionKeyLabel(focusedTrack)}`}
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
                                onChange={event => setNote(event.target.value)}
                              />
                            </label>
                            <button
                              ref={uploadButtonRef}
                              className={styles.primary}
                              type="button"
                              disabled={busy}
                              onClick={() => uploadTrack(selected, focusedTrack)}
                            >
                              {uploadBusy ? "Uploading…" : focusedNotice?.phase === "error" ? "Retry upload" : "Upload this section"}
                            </button>
                            <p className={styles.fileHelp}>Private upload. MP3, M4A, WAV, or FLAC; 50 MB maximum. This is not resumable yet. If the connection drops, reselect the same file and retry; the saved attempt prevents a duplicate submission.</p>
                          </div>
                        )}

                        {focusedNotice && (
                          <div
                            className={styles.trackNotice}
                            data-phase={focusedNotice.phase}
                            role={focusedNotice.phase === "error" ? "alert" : "status"}
                            aria-live="polite"
                          >
                            {uploadBusy && <span className={styles.activity} aria-hidden="true" />}
                            <span>{focusedNotice.text}</span>
                            {focusedNotice.phase === "uploading" && Number(focusedNotice.total) > 0 && (
                              <span className={styles.uploadProgress}>
                                <progress
                                  max={focusedNotice.total}
                                  value={focusedNotice.loaded || 0}
                                  aria-label={`Uploading ${Math.round(((focusedNotice.loaded || 0) / Number(focusedNotice.total)) * 100)} percent`}
                                />
                                <span className={styles.uploadBytes} aria-hidden="true">
                                  {displayTransferSize(focusedNotice.loaded || 0)} / {displayFileSize(Number(focusedNotice.total))}
                                </span>
                                <strong aria-hidden="true">{Math.round(((focusedNotice.loaded || 0) / Number(focusedNotice.total)) * 100)}%</strong>
                              </span>
                            )}
                          </div>
                        )}
                      </article>
                    )}
                  </div>
                )}

                <div className={styles.submitDock}>
                  <div>
                    <strong>{selectedProgress.ready} of {selectedProgress.total} required ready</strong>
                    <span>{canSubmitSelected ? "Everything is ready for JJ." : "Finish every required section to submit."}</span>
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
