import { NextResponse } from "next/server";
import { narratorPortalEnabled } from "@/lib/narratorPortal";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { createSupabaseRequestClient, hasSupabaseServerConfig } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const INTAKE_BUCKET = "narrator-audio-intake";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_ASSIGNMENT_STATUSES = ["accepted", "recording", "changes-requested"];
const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
]);

type UploadRequest = {
  action?: unknown;
  assignmentId?: unknown;
  idempotencyKey?: unknown;
  trackPosition?: unknown;
  trackTitle?: unknown;
  fileName?: unknown;
  fileSize?: unknown;
  mimeType?: unknown;
  narratorNote?: unknown;
  submissionId?: unknown;
};

type JsonRecord = Record<string, unknown>;

type StoredObject = {
  name?: string;
  metadata?: Record<string, unknown> | null;
};

function response(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function rpcStatus(error: unknown) {
  const value = error && typeof error === "object" ? error as JsonRecord : {};
  const code = String(value.code || "");
  if (code === "42501") return 403;
  if (["22000", "22023", "23505", "40001", "55000"].includes(code)) return 409;
  return 500;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeFileName(value: unknown) {
  const original = String(value || "audio.mp3").split(/[\\/]/).pop() || "audio.mp3";
  const cleaned = original
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return cleaned || "audio.mp3";
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function objectSize(item: StoredObject) {
  const metadata = item.metadata || {};
  const candidate = metadata.size ?? metadata.contentLength ?? metadata.content_length;
  const size = Number(candidate);
  return Number.isFinite(size) ? size : null;
}

function splitStoragePath(path: string, expectedPrefix: string) {
  if (!path.startsWith(expectedPrefix)) return null;
  const fileName = path.slice(expectedPrefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) return null;
  return {
    folder: expectedPrefix.slice(0, -1),
    fileName,
  };
}

async function signedInContext() {
  if (!hasSupabaseServerConfig()) return null;
  const supabase = await createSupabaseRequestClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email_confirmed_at) return null;
  return { supabase, user: data.user };
}

async function findStoredObject(folder: string, fileName: string) {
  const admin = createSupabaseAdminClient();
  const result = await admin.storage
    .from(INTAKE_BUCKET)
    .list(folder, { search: fileName, limit: 100 });
  if (result.error) return { error: result.error.message, item: null };
  const item = ((result.data || []) as StoredObject[]).find(candidate => candidate.name === fileName) || null;
  return { error: "", item };
}

export async function POST(request: Request) {
  if (!narratorPortalEnabled() || !hasSupabaseAdminConfig() || !hasSupabaseServerConfig()) {
    return response({ error: "Not found." }, 404);
  }

  const context = await signedInContext();
  if (!context) return response({ error: "Sign in before uploading." }, 401);
  const { supabase, user } = context;

  const body = await request.json().catch(() => null) as UploadRequest | null;
  if (!body) return response({ error: "Invalid request." }, 400);
  const action = String(body.action || "create");

  if (action === "complete") {
    const submissionId = String(body.submissionId || "");
    if (!UUID_PATTERN.test(submissionId)) return response({ error: "Invalid submission." }, 400);

    const submissionResult = await supabase
      .from("narrator_submissions")
      .select("id,assignment_id,narrator_user_id,storage_bucket,storage_path,file_size_bytes,upload_status")
      .eq("id", submissionId)
      .eq("narrator_user_id", user.id)
      .in("upload_status", ["awaiting-upload", "uploaded"])
      .maybeSingle();
    if (submissionResult.error || !submissionResult.data) {
      return response({ error: "Submission not found." }, 404);
    }

    const assignmentId = String(submissionResult.data.assignment_id || "");
    const [profileResult, assignmentResult] = await Promise.all([
      supabase
        .from("narrator_profiles")
        .select("status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("narrator_assignments")
        .select("id,status")
        .eq("id", assignmentId)
        .eq("narrator_user_id", user.id)
        .in("status", OPEN_ASSIGNMENT_STATUSES)
        .maybeSingle(),
    ]);
    if (profileResult.error || !profileResult.data || assignmentResult.error || !assignmentResult.data) {
      return response({ error: "That assignment is read-only right now." }, 403);
    }

    const storageBucket = String(submissionResult.data.storage_bucket || "");
    const storagePath = String(submissionResult.data.storage_path || "");
    const expectedPrefix = `${user.id}/${assignmentId}/`;
    const pathParts = splitStoragePath(storagePath, expectedPrefix);
    if (storageBucket !== INTAKE_BUCKET || !pathParts) {
      return response({ error: "Submission storage target is invalid." }, 403);
    }

    const stored = await findStoredObject(pathParts.folder, pathParts.fileName);
    if (stored.error) return response({ error: "The private upload could not be verified." }, 503);
    if (!stored.item) return response({ error: "The file has not finished uploading." }, 409);

    const observedSize = objectSize(stored.item);
    const expectedSize = Number(submissionResult.data.file_size_bytes || 0);
    if (observedSize === null || observedSize < 1 || expectedSize < 1 || observedSize !== expectedSize) {
      return response({ error: "The uploaded file size does not match the prepared track." }, 409);
    }

    const completedResult = await createSupabaseAdminClient().rpc("narrator_complete_submission", {
      p_expected_user_id: user.id,
      p_submission_id: submissionId,
      p_observed_size_bytes: observedSize,
    });
    const completed = asRecord(completedResult.data);
    if (completedResult.error || !completed) {
      return response({ error: completedResult.error?.message || "The upload could not be finalized." }, rpcStatus(completedResult.error));
    }
    if (String(completed.submission_id || "") !== submissionId
      || String(completed.assignment_id || "") !== assignmentId
      || String(completed.status || "") !== "uploaded") {
      return response({ error: "The upload returned an unexpected state." }, 409);
    }

    return response({
      ok: true,
      submissionId,
      replayed: completed.replayed === true,
    }, 200);
  }

  if (action !== "create") return response({ error: "Invalid upload action." }, 400);

  const assignmentId = String(body.assignmentId || "");
  const idempotencyKey = String(body.idempotencyKey || "");
  const trackPosition = Number(body.trackPosition || 0);
  const trackTitle = cleanText(body.trackTitle, 160);
  const originalFileName = safeFileName(body.fileName);
  const fileSize = Number(body.fileSize || 0);
  const mimeType = String(body.mimeType || "").toLowerCase();
  const narratorNote = cleanText(body.narratorNote, 1000);

  if (!UUID_PATTERN.test(assignmentId)) return response({ error: "Choose an assignment." }, 400);
  if (!UUID_PATTERN.test(idempotencyKey)) return response({ error: "Could not identify this upload attempt." }, 400);
  if (!Number.isInteger(trackPosition) || trackPosition < 1 || trackPosition > 999) return response({ error: "Use a valid track number." }, 400);
  if (!trackTitle) return response({ error: "Add a track title." }, 400);
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_FILE_SIZE) return response({ error: "Each track must be 50 MB or smaller." }, 400);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return response({ error: "Use an MP3, M4A, WAV, or FLAC audio file." }, 400);

  const preparedResult = await supabase.rpc("narrator_prepare_submission", {
    p_assignment_id: assignmentId,
    p_idempotency_key: idempotencyKey,
    p_track_position: trackPosition,
    p_track_title: trackTitle,
    p_original_file_name: originalFileName,
    p_mime_type: mimeType,
    p_file_size_bytes: fileSize,
    p_narrator_note: narratorNote,
  });
  const prepared = asRecord(preparedResult.data);
  if (preparedResult.error || !prepared) {
    return response({ error: preparedResult.error?.message || "Could not start that upload." }, rpcStatus(preparedResult.error));
  }

  const submissionId = String(prepared.submission_id || "");
  const returnedAssignmentId = String(prepared.assignment_id || "");
  const storageBucket = String(prepared.storage_bucket || "");
  const storagePath = String(prepared.storage_path || "");
  const uploadStatus = String(prepared.upload_status || "");
  const expectedPrefix = `${user.id}/${assignmentId}/`;
  const pathParts = splitStoragePath(storagePath, expectedPrefix);
  if (!UUID_PATTERN.test(submissionId)
    || returnedAssignmentId !== assignmentId
    || storageBucket !== INTAKE_BUCKET
    || !pathParts
    || !["awaiting-upload", "uploaded"].includes(uploadStatus)) {
    return response({ error: "The upload returned an unexpected storage target." }, 409);
  }

  if (uploadStatus === "uploaded") {
    return response({
      submissionId,
      bucket: INTAKE_BUCKET,
      path: storagePath,
      alreadyComplete: true,
    }, 200);
  }

  const stored = await findStoredObject(pathParts.folder, pathParts.fileName);
  if (stored.error) return response({ error: "The private upload could not be checked." }, 503);
  if (stored.item) {
    const observedSize = objectSize(stored.item);
    if (observedSize === null || observedSize < 1 || observedSize !== fileSize) {
      return response({ error: "An existing upload does not match this track." }, 409);
    }
    return response({
      submissionId,
      bucket: INTAKE_BUCKET,
      path: storagePath,
      objectPresent: true,
    }, 200);
  }

  const signedResult = await createSupabaseAdminClient().storage
    .from(INTAKE_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signedResult.error || !signedResult.data?.token) {
    return response({ error: "Could not prepare the private upload. Retry this same track." }, 503);
  }

  return response({
    submissionId,
    bucket: INTAKE_BUCKET,
    path: storagePath,
    token: signedResult.data.token,
  }, 201);
}
