"use client";

import Image from "next/image";
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
  readerHref: string;
  readerLinkKind: "section" | "book" | "unavailable";
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
type WorkspaceView = "production" | "brief" | "activity";

const PROJECT_STAGES = ["Offer", "Production", "JJ review", "Approved"] as const;

function assignmentStage(status: string) {
  if (["approved", "complete", "completed"].includes(status)) return 3;
  if (["submitted", "in-review"].includes(status)) return 2;
  if (["accepted", "recording", "changes-requested"].includes(status)) return 1;
  return 0;
}

function displayStatus(value: string) {
  if (value === "changes-requested") return "Changes requested";
  if (value === "in-review" || value === "submitted") return "With JJ";
  if (value === "offered") return "New offer";
  return humanStatus(value).replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatDeadline(value: string) {
  if (!value) return "No deadline set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatActivityDate(value: string) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function narratorInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] || ""}` : parts[0]?.slice(0, 2) || "NA").toUpperCase();
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3.75 6.75A1.75 1.75 0 0 1 5.5 5h4l2 2h7A1.75 1.75 0 0 1 20.25 8.75v8.75a1.75 1.75 0 0 1-1.75 1.75h-13a1.75 1.75 0 0 1-1.75-1.75V6.75Z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 4.75h8.25A2.75 2.75 0 0 1 16 7.5v11.75H7.5A2.5 2.5 0 0 1 5 16.75v-12Z" />
      <path d="M7.5 16.75H19V7.5a2.75 2.75 0 0 0-2.75-2.75H16" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3.75A1.75 1.75 0 0 0 6.75 20h10.5A1.75 1.75 0 0 0 19 18.25V14.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m9 7 8 5-8 5V7Z" />
    </svg>
  );
}

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
  if (["uploaded", "complete", "completed"].includes(submission.status)) return "Uploaded";
  if (submission.status === "in-review") return "In review";
  if (submission.status === "approved") return "Approved";
  if (submission.status === "changes-requested") return "Changes requested";
  if (submission.status === "awaiting-upload") return "Upload not finished";
  if (submission.status === "upload-failed") return "Upload failed";
  return humanStatus(submission.status);
}

function transitionAssignment(
  assignment: PortalAssignment,
  status: string,
  action: "accept" | "submit",
) {
  if (action !== "submit") return { ...assignment, status };
  const submissions = assignment.submissions.map(submission => (
    submission.status === "uploaded" ? { ...submission, status: "in-review" } : submission
  ));
  const byId = new Map(submissions.map(submission => [submission.id, submission]));
  return {
    ...assignment,
    status,
    submissions,
    tracks: assignment.tracks.map(track => ({
      ...track,
      latestSubmission: track.latestSubmission
        ? byId.get(track.latestSubmission.id) || track.latestSubmission
        : null,
    })),
  };
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

export default function NarratorPortalClient({
  initialData,
  previewMode = false,
}: {
  initialData: NarratorPortalData;
  previewMode?: boolean;
}) {
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
  const [previewAudioUrls, setPreviewAudioUrls] = useState<Record<string, string>>({});
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("production");
  const uploadAttemptRef = useRef<UploadAttempt | null>(null);
  const uploadInFlightRef = useRef(false);
  const fileInputRefs = useRef(new Map<string, HTMLInputElement>());
  const recordButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const recordingPanelRef = useRef<HTMLElement | null>(null);
  const uploadButtonRef = useRef<HTMLButtonElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewAudioUrlsRef = useRef(new Map<string, string>());
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
  const focusedSubmission = focusedTrack?.latestSubmission || null;
  const focusedReady = isSubmissionReady(focusedSubmission);
  const focusedMutable = Boolean(selected && canMutate && OPEN_UPLOAD_STATUSES.has(selected.status));
  const focusedListening = Boolean(focusedSubmission && listeningSubmissionId === focusedSubmission.id);
  const focusedNotice = focusedTrack && trackNotice?.trackId === focusedTrack.id ? trackNotice : null;
  const remainingRequired = Math.max(0, selectedProgress.total - selectedProgress.ready);
  const completionPercent = selectedProgress.total > 0
    ? Math.round((selectedProgress.ready / selectedProgress.total) * 100)
    : 0;
  const selectedStage = selected ? assignmentStage(selected.status) : 0;
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const audioUrls = previewAudioUrlsRef.current;
    return () => {
      for (const url of audioUrls.values()) URL.revokeObjectURL(url);
      audioUrls.clear();
    };
  }, []);

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
    setWorkspaceView("production");
    setSelectedId(assignmentId);
  }

  function focusTrack(track: PortalTrack) {
    if (uploadInFlightRef.current || actionBusy) return;
    if (track.id === focusedTrack?.id) return;
    clearSelectedFile(activeTrackId);
    setActiveTrackId(track.id);
    setTrackNotice(null);
    setListeningSubmissionId("");
    if (window.matchMedia("(max-width: 940px)").matches) {
      window.setTimeout(() => recordingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
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
    if (previewMode) {
      const status = action === "accept" ? "accepted" : "submitted";
      setAssignments(current => current.map(item => item.id === assignment.id ? transitionAssignment(item, status, action) : item));
      setSelectedId(assignment.id);
      setMessage(action === "accept"
        ? "Assignment accepted. Start with the first section that needs a recording."
        : "Book submitted to JJ for review. Your recordings are now read-only.");
      return;
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
      setAssignments(current => current.map(item => item.id === assignment.id ? transitionAssignment(item, status, action) : item));
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

    if (previewMode) {
      const selectedFile = file;
      const submissionId = `preview-upload-${crypto.randomUUID()}`;
      const submission: PortalSubmission = {
        id: submissionId,
        audioTrackId: track.id,
        trackPosition: track.position,
        trackTitle: track.title,
        fileName: selectedFile.name,
        fileSizeBytes: selectedFile.size,
        mimeType: normalizedMimeType(selectedFile),
        status: "uploaded",
        uploadedAt: new Date().toISOString(),
        narratorNote: note.trim(),
        narratorFeedback: "",
      };
      const localAudioUrl = URL.createObjectURL(selectedFile);
      previewAudioUrlsRef.current.set(submissionId, localAudioUrl);
      setPreviewAudioUrls(current => ({ ...current, [submissionId]: localAudioUrl }));
      setAssignments(current => current.map(item => item.id === assignment.id ? {
        ...item,
        status: "recording",
        tracks: item.tracks.map(itemTrack => itemTrack.id === track.id
          ? { ...itemTrack, latestSubmission: submission }
          : itemTrack),
        submissions: [submission, ...item.submissions],
      } : item));
      clearSelectedFile(track.id);
      setTrackNotice({ trackId: track.id, phase: "done", text: `${sectionTitle(track)} is uploaded and ready.` });
      setMessage("Upload complete. You can listen back or continue to the next section.");
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
        fileSizeBytes: selectedFile.size,
        mimeType,
        status: "uploaded",
        uploadedAt: new Date().toISOString(),
        narratorNote,
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
    if (previewMode) {
      router.push("/account?next=/narrator");
      return;
    }
    setActionBusy(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/account?next=/narrator");
  }

  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/" onClick={event => { if (uploadBusy) event.preventDefault(); }}>
          <span className={styles.brandMark}>J</span>
          <span><strong>JJU Audio</strong><small>Narrator workspace</small></span>
        </Link>

        <nav className={styles.sideNav} aria-label="Narrator workspace">
          <a href="#narrator-projects" aria-current="page">
            <FolderIcon />
            <span>Projects</span>
            <strong>{assignments.length}</strong>
          </a>
        </nav>

        <div className={styles.accountCard}>
          <span className={styles.avatar}>{narratorInitials(initialData.displayName)}</span>
          <span className={styles.accountCopy}>
            <strong>{initialData.displayName}</strong>
            <small>Narrator</small>
          </span>
          <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <section className={styles.main}>
        <header className={styles.mobileHeader}>
          <Link className={styles.mobileBrand} href="/" onClick={event => { if (uploadBusy) event.preventDefault(); }}>JJU Audio</Link>
          <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
        </header>

        {message ? <div className={styles.notice} role="status" aria-live="polite">{message}</div> : null}
        {!canMutate ? (
          <div className={styles.notice} role="status">
            This account is {humanStatus(initialData.status)}. Projects are view-only until James activates it.
          </div>
        ) : null}

        <header className={styles.pageHeader}>
          <div>
            <h1 id="narrator-projects">Narrator projects</h1>
            <p>{assignments.length ? `${assignments.length} active ${assignments.length === 1 ? "project" : "projects"}` : "No active projects"}</p>
          </div>
          <Link href="/" target="_blank">Open JJ University</Link>
        </header>

        {!assignments.length ? (
          <section className={styles.noProjects}>
            <FolderIcon />
            <h2>No projects yet</h2>
            <p>When James assigns a book, it will appear here with the Reader text, section list, files, and review notes.</p>
          </section>
        ) : (
          <div className={styles.projectLayout}>
            <aside className={styles.projectPanel} aria-labelledby="project-list-heading">
              <div className={styles.sectionTitle}>
                <h2 id="project-list-heading">Projects</h2>
                <span>{assignments.length}</span>
              </div>
              <ol className={styles.projectList}>
                {assignments.map(assignment => {
                  const progress = progressFor(assignment);
                  const percent = progress.total ? Math.round((progress.ready / progress.total) * 100) : 0;
                  const isSelected = assignment.id === selectedId;
                  return (
                    <li key={assignment.id}>
                      <button
                        type="button"
                        disabled={busy}
                        data-selected={isSelected}
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => chooseAssignment(assignment.id)}
                      >
                        <Image src={assignment.coverSrc} alt="" width={46} height={69} sizes="46px" />
                        <span className={styles.projectCardCopy}>
                          <strong>{assignment.bookTitle}</strong>
                          <span>{displayStatus(assignment.status)}</span>
                          <span className={styles.miniProgress} aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
                          <small>{progress.ready} of {progress.total} uploaded</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>

            {selected ? (
              <article className={styles.projectRoom}>
                <header className={styles.projectHeader}>
                  <Image className={styles.projectCover} src={selected.coverSrc} alt={`${selected.bookTitle} cover`} width={86} height={129} sizes="86px" />
                  <div className={styles.projectIdentity}>
                    <div className={styles.projectStatusRow}>
                      <span className={styles.statusPill} data-status={selected.status}>{displayStatus(selected.status)}</span>
                      <span>{formatDeadline(selected.dueAt)}</span>
                    </div>
                    <h2>{selected.bookTitle}</h2>
                    <p>By James Johnson</p>
                    <div className={styles.projectActions}>
                      {canMutate && selected.status === "offered" ? (
                        <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => updateAssignment(selected, "accept")}>Accept project</button>
                      ) : null}
                      <Link href={`/books/${encodeURIComponent(selected.bookSlug || selected.bookId)}`} target="_blank" rel="noreferrer">
                        <BookIcon /> Open current Reader
                      </Link>
                    </div>
                  </div>
                  <div className={styles.projectProgress}>
                    <strong>{completionPercent}%</strong>
                    <span>{selectedProgress.ready} of {selectedProgress.total} required sections uploaded</span>
                    <progress max={Math.max(1, selectedProgress.total)} value={selectedProgress.ready} aria-label={`${selectedProgress.ready} of ${selectedProgress.total} required recordings uploaded`} />
                  </div>
                </header>

                <ol className={styles.stageLine} aria-label="Project stage">
                  {PROJECT_STAGES.map((stage, index) => (
                    <li key={stage} data-state={index < selectedStage ? "done" : index === selectedStage ? "current" : "next"} aria-current={index === selectedStage ? "step" : undefined}>
                      <span>{index < selectedStage ? "✓" : index + 1}</span>
                      <strong>{stage}</strong>
                    </li>
                  ))}
                </ol>

                <nav className={styles.tabs} aria-label="Project sections">
                  <button type="button" data-active={workspaceView === "production"} aria-pressed={workspaceView === "production"} onClick={() => setWorkspaceView("production")}>Production</button>
                  <button type="button" data-active={workspaceView === "brief"} aria-pressed={workspaceView === "brief"} onClick={() => setWorkspaceView("brief")}>Script &amp; brief</button>
                  <button type="button" data-active={workspaceView === "activity"} aria-pressed={workspaceView === "activity"} onClick={() => setWorkspaceView("activity")}>Activity <span>{selected.submissions.length}</span></button>
                </nav>

                {workspaceView === "brief" ? (
                  <div className={styles.resourcesGrid}>
                    <section>
                      <h3>Production brief</h3>
                      <p>{selected.brief || "James hasn’t added any extra direction for this project."}</p>
                    </section>
                    <section>
                      <h3>Script</h3>
                      <p>Open the current JJU Reader alongside the section list while you work.</p>
                      <Link className={styles.textLink} href={`/books/${encodeURIComponent(selected.bookSlug || selected.bookId)}`} target="_blank" rel="noreferrer">Open current Reader</Link>
                    </section>
                    <section>
                      <h3>File delivery</h3>
                      <dl>
                        <div><dt>Accepted files</dt><dd>MP3, M4A, WAV, FLAC</dd></div>
                        <div><dt>Maximum size</dt><dd>50 MB per file</dd></div>
                        <div><dt>Visibility</dt><dd>Private here; publication is separate</dd></div>
                      </dl>
                    </section>
                  </div>
                ) : workspaceView === "activity" ? (
                  <section className={styles.activityPanel}>
                    <div className={styles.contentHeader}>
                      <div><h3>File activity</h3><p>Uploads and review notes for this project.</p></div>
                    </div>
                    {selected.submissions.length ? (
                      <ol className={styles.activityList}>
                        {selected.submissions.map(submission => (
                          <li key={submission.id}>
                          <span className={styles.activityDot} aria-hidden="true" />
                            <div>
                              <strong>{submission.trackTitle || submission.fileName}</strong>
                              <p>{submission.fileName} · {displayStatus(submission.status)}</p>
                              {submission.narratorFeedback ? <blockquote>James: {submission.narratorFeedback}</blockquote> : null}
                            </div>
                            <time dateTime={submission.uploadedAt}>{formatActivityDate(submission.uploadedAt)}</time>
                          </li>
                        ))}
                      </ol>
                    ) : <p className={styles.emptyActivity}>No files have been uploaded for this project yet.</p>}
                  </section>
                ) : selected.status === "offered" ? (
                  <section className={styles.offerPanel}>
                    <div>
                      <h3>Project offer</h3>
                      <p>{selected.brief || "Review the book and accept when you’re ready to begin."}</p>
                    </div>
                    {canMutate ? <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => updateAssignment(selected, "accept")}>Accept project</button> : null}
                  </section>
                ) : !selected.tracks.length ? (
                  <section className={styles.offerPanel}>
                    <div><h3>Chapter list pending</h3><p>James hasn’t prepared the recording checklist for this book yet.</p></div>
                  </section>
                ) : (
                  <>
                    <div className={styles.productionGrid}>
                      <section className={styles.chapterPanel} aria-labelledby="chapter-list-heading">
                        <div className={styles.contentHeader}>
                          <div><h3 id="chapter-list-heading">Sections</h3><p>{remainingRequired ? `${remainingRequired} required sections remaining` : "All required sections are uploaded"}</p></div>
                          <span>{selectedProgress.ready}/{selectedProgress.total}</span>
                        </div>
                        <ol className={styles.chapterList}>
                          {orderedTracks.map(track => {
                            const current = track.id === focusedTrack?.id;
                            const ready = isSubmissionReady(track.latestSubmission);
                            return (
                              <li key={track.id}>
                                <button
                                  type="button"
                                  disabled={busy}
                                  data-active={current}
                                  aria-current={current ? "step" : undefined}
                                  onClick={() => focusTrack(track)}
                                >
                                  <span className={styles.chapterNumber}>{sectionNumber(track.position)}</span>
                                  <span className={styles.chapterCopy}>
                                    <strong>{sectionTitle(track)}</strong>
                                    <small>{track.latestSubmission?.fileName || (track.required ? "Required" : "Optional")}</small>
                                  </span>
                                  <span className={styles.chapterState} data-ready={ready} data-status={track.latestSubmission?.status || "missing"}>{trackStatus(track)}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </section>

                      {focusedTrack ? (
                        <aside ref={recordingPanelRef} className={styles.inspector} aria-labelledby="selected-chapter-heading">
                          <div className={styles.inspectorHeader}>
                            <div>
                              <span>Section {sectionNumber(focusedTrack.position)}</span>
                              <h3 id="selected-chapter-heading">{sectionTitle(focusedTrack)}</h3>
                              <small>{focusedTrack.required ? "Required" : "Optional"}</small>
                            </div>
                            <span className={styles.trackStatus} data-ready={focusedReady}>{trackStatus(focusedTrack)}</span>
                          </div>

                          {focusedTrack.readerHref ? (
                            <Link className={styles.scriptLink} href={focusedTrack.readerHref} target="_blank" rel="noreferrer">
                              <BookIcon />
                              <span>
                                <strong>{focusedTrack.readerLinkKind === "section" ? "Open this section in Reader" : "Open the current Reader"}</strong>
                                <small>{focusedTrack.readerLinkKind === "section" ? "Section text opens in a new tab" : "This section does not have its own Reader page"}</small>
                              </span>
                            </Link>
                          ) : (
                            <div className={styles.scriptLink} aria-disabled="true">
                              <BookIcon />
                              <span><strong>Reader text unavailable</strong><small>James needs to attach a readable edition</small></span>
                            </div>
                          )}

                          {focusedSubmission?.narratorFeedback ? (
                            <div className={styles.feedback}>
                              <strong>Note from James</strong>
                              <p>{focusedSubmission.narratorFeedback}</p>
                            </div>
                          ) : null}

                          {focusedSubmission ? (
                            <section className={styles.currentFile}>
                              <div>
                                <span className={styles.fileIcon}><PlayIcon /></span>
                                <span><strong>{focusedSubmission.fileName}</strong><small>{focusedSubmission.fileSizeBytes ? displayFileSize(focusedSubmission.fileSizeBytes) : "Uploaded file"} · {formatActivityDate(focusedSubmission.uploadedAt)}</small></span>
                              </div>
                              {isSubmissionListenable(focusedSubmission) ? (
                                <button type="button" aria-expanded={focusedListening} aria-controls={`listen-${focusedSubmission.id}`} onClick={() => setListeningSubmissionId(current => current === focusedSubmission.id ? "" : focusedSubmission.id)}>
                                  {focusedListening ? "Close player" : "Listen back"}
                                </button>
                              ) : null}
                              {focusedSubmission.narratorNote ? <p>Your note: {focusedSubmission.narratorNote}</p> : null}
                            </section>
                          ) : null}

                          {focusedListening && focusedSubmission ? (
                            <div className={styles.listenBack} id={`listen-${focusedSubmission.id}`}>
                              <audio
                                controls
                                preload="none"
                                src={previewMode ? previewAudioUrls[focusedSubmission.id] || undefined : `/api/narrator/submissions/${encodeURIComponent(focusedSubmission.id)}/audio`}
                                aria-label={`Private recording for ${sectionTitle(focusedTrack)}`}
                                onError={() => setTrackNotice({ trackId: focusedTrack.id, phase: "error", text: "That recording couldn’t be loaded. Close the player, then try again." })}
                              >
                                Your browser does not support audio playback.
                              </audio>
                            </div>
                          ) : null}

                          {focusedMutable ? (
                            <>
                              <input
                                ref={element => {
                                  if (element) fileInputRefs.current.set(focusedTrack.id, element);
                                  else fileInputRefs.current.delete(focusedTrack.id);
                                }}
                                className={styles.visuallyHidden}
                                id={`narrator-file-${focusedTrack.id}`}
                                type="file"
                                tabIndex={-1}
                                aria-hidden="true"
                                accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/flac,.mp3,.m4a,.wav,.wave,.flac"
                                disabled={busy}
                                onChange={event => fileChanged(focusedTrack, event)}
                              />
                              <button
                                ref={element => {
                                  if (element) recordButtonRefs.current.set(focusedTrack.id, element);
                                  else recordButtonRefs.current.delete(focusedTrack.id);
                                }}
                                className={styles.uploadButton}
                                type="button"
                                disabled={busy}
                                onClick={() => chooseFile(focusedTrack)}
                              >
                                <UploadIcon /> {focusedSubmission ? "Replace audio file" : "Choose audio file"}
                              </button>
                              <p className={styles.uploadHelp}>MP3, M4A, WAV, or FLAC · 50 MB maximum</p>
                            </>
                          ) : <p className={styles.lockedNote}>This project is read-only at its current stage.</p>}

                          {activeTrackId === focusedTrack.id && file ? (
                            <div className={styles.uploadComposer}>
                              <div className={styles.fileSummary}>
                                <div><strong>{file.name}</strong><span>{displayFileSize(file.size)}</span></div>
                                <button type="button" disabled={busy} onClick={() => {
                                  clearSelectedFile(focusedTrack.id);
                                  setTrackNotice(null);
                                  recordButtonRefs.current.get(focusedTrack.id)?.focus();
                                }}>Change</button>
                              </div>
                              {previewUrl ? (
                                <div className={styles.localPreview}>
                                  <span>Check the file before uploading</span>
                                  <audio controls preload="metadata" src={previewUrl} aria-label={`Preview ${file.name}`}>Your browser does not support audio playback.</audio>
                                </div>
                              ) : null}
                              <label className={styles.noteField}>
                                Note for James <span>Optional</span>
                                <textarea value={note} disabled={busy} maxLength={1000} placeholder="Pronunciation, alternate take, or anything else to flag" onChange={event => setNote(event.target.value)} />
                              </label>
                              <button ref={uploadButtonRef} className={styles.primaryButton} type="button" disabled={busy} onClick={() => uploadTrack(selected, focusedTrack)}>
                                {uploadBusy ? "Uploading…" : focusedNotice?.phase === "error" ? "Retry upload" : "Upload section"}
                              </button>
                              <p className={styles.fileHelp}>Keep this page open until the upload finishes. If the connection drops, choose the same file and retry.</p>
                            </div>
                          ) : null}

                          {focusedNotice ? (
                            <div className={styles.trackNotice} data-phase={focusedNotice.phase} role={focusedNotice.phase === "error" ? "alert" : "status"} aria-live="polite">
                              {uploadBusy ? <span className={styles.activitySpinner} aria-hidden="true" /> : null}
                              <span>{focusedNotice.text}</span>
                              {focusedNotice.phase === "uploading" && Number(focusedNotice.total) > 0 ? (
                                <span className={styles.uploadProgress}>
                                  <progress max={focusedNotice.total} value={focusedNotice.loaded || 0} aria-label={`Uploading ${Math.round(((focusedNotice.loaded || 0) / Number(focusedNotice.total)) * 100)} percent`} />
                                  <span>{displayTransferSize(focusedNotice.loaded || 0)} / {displayFileSize(Number(focusedNotice.total))}</span>
                                  <strong>{Math.round(((focusedNotice.loaded || 0) / Number(focusedNotice.total)) * 100)}%</strong>
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </aside>
                      ) : null}
                    </div>

                    <footer className={styles.submitBar}>
                      <div>
                        <strong>{canSubmitSelected ? "All required sections are uploaded" : `${remainingRequired} required ${remainingRequired === 1 ? "section" : "sections"} left`}</strong>
                        <span>Submitting locks the project while James reviews it.</span>
                      </div>
                      {canMutate && OPEN_UPLOAD_STATUSES.has(selected.status) ? (
                        <button ref={submitButtonRef} className={styles.primaryButton} type="button" disabled={busy || !canSubmitSelected} onClick={() => updateAssignment(selected, "submit")}>Submit project for review</button>
                      ) : <span className={styles.readOnlyState}>{displayStatus(selected.status)}</span>}
                    </footer>
                  </>
                )}
              </article>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
