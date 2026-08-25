import "server-only";

import { cache } from "react";
import { LEGACY_BOOK_ID_ALIASES } from "@/lib/bookAliases";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";

export type AudioAccessModel = "free" | "account" | "subscription";

export type PublishedAudioTrack = {
  id: string;
  position: number;
  title: string;
  durationSeconds: number;
};

export type PublishedAudioEdition = {
  id: string;
  bookId: string;
  narratorName: string;
  languageCode: string;
  description: string;
  accessModel: AudioAccessModel;
  totalSeconds: number;
  tracks: PublishedAudioTrack[];
};

export type AudioStreamRecord = {
  editionId: string;
  trackId: string;
  bookId: string;
  trackPosition: number;
  accessModel: AudioAccessModel;
  storageBucket: string;
  storagePath: string;
};

export type AudioStorageTarget = {
  storageBucket: string;
  storagePath: string;
};

type AudioEditionRow = {
  id?: string | null;
  book_id?: string | null;
  narrator_name?: string | null;
  language_code?: string | null;
  description?: string | null;
  access_model?: string | null;
  total_seconds?: number | null;
  status?: string | null;
};

type AudioTrackRow = {
  id?: string | null;
  edition_id?: string | null;
  position?: number | null;
  title?: string | null;
  duration_seconds?: number | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  status?: string | null;
};

type StreamBookRow = {
  id?: string | null;
  status?: string | null;
  visibility?: string | null;
};

const AUDIO_EDITION_SELECT = "id,book_id,narrator_name,language_code,description,access_model,total_seconds,status";
const AUDIO_TRACK_PUBLIC_SELECT = "id,edition_id,position,title,duration_seconds,status";
const AUDIO_TRACK_STREAM_SELECT = "id,edition_id,position,storage_bucket,storage_path,status";
const TACOS_BOOK_ID = "tacos";
const TACOS_AUDIO_EDITION_ID = "4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46";
export const TACOS_AUDIO_CANDIDATE_PREVIEW_KEY = "danny-email-2025-08-15";
const TACOS_AUDIO_CANDIDATE_TOTAL_SECONDS = 1249;
const TACOS_AUDIO_CANDIDATES = new Map<number, { durationSeconds: number; storagePath: string }>([
  [10, {
    durationSeconds: 138,
    storagePath: "everything-i-touch-turns-to-tacos/standard/10-0a69afb8a56a0b6e.mp3",
  }],
  [13, {
    durationSeconds: 23,
    storagePath: "everything-i-touch-turns-to-tacos/standard/13-b0646c8581ffc3e4.mp3",
  }],
  [16, {
    durationSeconds: 45,
    storagePath: "everything-i-touch-turns-to-tacos/standard/16-5981f85def7c4f7c.mp3",
  }],
]);

export function audioCatalogEnabled() {
  return process.env.JJU_AUDIO_CATALOG_ENABLED === "1";
}

function tacosQaPreviewBookEnabled(bookId: string) {
  return audioCatalogEnabled()
    && process.env.VERCEL_ENV === "preview"
    && bookId.trim().toLowerCase() === TACOS_BOOK_ID;
}

function tacosQaPreviewEditionEnabled(editionId: string) {
  return audioCatalogEnabled()
    && process.env.VERCEL_ENV === "preview"
    && editionId.trim().toLowerCase() === TACOS_AUDIO_EDITION_ID;
}

export function getAudioCandidatePreviewKey(bookId: string, editionId: string) {
  if (
    !audioCatalogEnabled()
    || process.env.VERCEL_ENV !== "preview"
    || bookId.trim().toLowerCase() !== TACOS_BOOK_ID
    || editionId.trim().toLowerCase() !== TACOS_AUDIO_EDITION_ID
  ) return null;
  return TACOS_AUDIO_CANDIDATE_PREVIEW_KEY;
}

export function applyAudioCandidatePreview(
  edition: PublishedAudioEdition,
  candidateKey: string | null,
): PublishedAudioEdition {
  if (
    candidateKey !== TACOS_AUDIO_CANDIDATE_PREVIEW_KEY
    || edition.bookId.trim().toLowerCase() !== TACOS_BOOK_ID
    || edition.id.trim().toLowerCase() !== TACOS_AUDIO_EDITION_ID
  ) {
    return edition;
  }
  return {
    ...edition,
    totalSeconds: TACOS_AUDIO_CANDIDATE_TOTAL_SECONDS,
    tracks: edition.tracks.map(track => {
      const candidate = TACOS_AUDIO_CANDIDATES.get(track.position);
      return candidate ? { ...track, durationSeconds: candidate.durationSeconds } : track;
    }),
  };
}

export function resolveAudioStorageTarget(
  record: AudioStreamRecord,
  candidateKey: string | null,
): AudioStorageTarget | null {
  if (!candidateKey) {
    return { storageBucket: record.storageBucket, storagePath: record.storagePath };
  }
  if (
    candidateKey !== getAudioCandidatePreviewKey(record.bookId, record.editionId)
    || record.storageBucket !== "audiobooks"
  ) return null;
  const candidate = TACOS_AUDIO_CANDIDATES.get(record.trackPosition);
  return {
    storageBucket: record.storageBucket,
    storagePath: candidate?.storagePath || record.storagePath,
  };
}

function isMissingAudioTable(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = String(value.code || "");
  const message = String(value.message || "");
  return code === "42P01"
    || code === "PGRST205"
    || /audio_(editions|tracks).*does not exist/i.test(message)
    || /could not find.*audio_(editions|tracks)/i.test(message);
}

function accessModel(value: unknown): AudioAccessModel {
  if (value === "account" || value === "subscription") return value;
  return "free";
}

function normalizeTrack(row: AudioTrackRow, requiredStatus: "published" | "qa"): PublishedAudioTrack | null {
  const id = String(row.id || "").trim();
  const position = Number(row.position || 0);
  if (!id || position <= 0 || String(row.status || "") !== requiredStatus) return null;
  return {
    id,
    position,
    title: String(row.title || `Track ${position}`).trim() || `Track ${position}`,
    durationSeconds: Math.max(0, Number(row.duration_seconds || 0)),
  };
}

async function readPublishedAudioEditionForBook(bookId: string): Promise<PublishedAudioEdition | null> {
  if (!audioCatalogEnabled() || !hasSupabaseAdminConfig()) return null;

  const supabase = createSupabaseAdminClient();
  const allowTacosQaPreview = tacosQaPreviewBookEnabled(bookId);
  let editionResult = await supabase
    .from("audio_editions")
    .select(AUDIO_EDITION_SELECT)
    .eq("book_id", bookId)
    .eq("status", "published")
    .in("access_model", ["free", "account"])
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (editionResult.error) {
    if (isMissingAudioTable(editionResult.error)) return null;
    throw new Error(editionResult.error.message);
  }

  if (!editionResult.data && allowTacosQaPreview) {
    editionResult = await supabase
      .from("audio_editions")
      .select(AUDIO_EDITION_SELECT)
      .eq("id", TACOS_AUDIO_EDITION_ID)
      .eq("book_id", TACOS_BOOK_ID)
      .eq("status", "qa")
      .in("access_model", ["free", "account"])
      .maybeSingle();
    if (editionResult.error) {
      if (isMissingAudioTable(editionResult.error)) return null;
      throw new Error(editionResult.error.message);
    }
  }

  const edition = editionResult.data as AudioEditionRow | null;
  if (!edition?.id || !edition.book_id) return null;
  const editionStatus = String(edition.status || "");
  const isTacosQaPreview = editionStatus === "qa"
    && tacosQaPreviewBookEnabled(edition.book_id)
    && tacosQaPreviewEditionEnabled(edition.id);
  if (editionStatus !== "published" && !isTacosQaPreview) return null;
  const requiredTrackStatus = isTacosQaPreview ? "qa" : "published";

  const trackResult = await supabase
    .from("audio_tracks")
    .select(AUDIO_TRACK_PUBLIC_SELECT)
    .eq("edition_id", edition.id)
    .eq("status", requiredTrackStatus)
    .order("position", { ascending: true });

  if (trackResult.error) {
    if (isMissingAudioTable(trackResult.error)) return null;
    throw new Error(trackResult.error.message);
  }

  const tracks = (trackResult.data || [])
    .map(row => normalizeTrack(row as AudioTrackRow, requiredTrackStatus))
    .filter((track): track is PublishedAudioTrack => Boolean(track));

  // No tracks means no public audiobook. This keeps incomplete database rows
  // from creating a dead Listen button on a book page.
  if (!tracks.length) return null;

  return {
    id: edition.id,
    bookId: edition.book_id,
    narratorName: String(edition.narrator_name || "").trim(),
    languageCode: String(edition.language_code || "en").trim() || "en",
    description: String(edition.description || "").trim(),
    accessModel: accessModel(edition.access_model),
    totalSeconds: Math.max(0, Number(edition.total_seconds || 0)),
    tracks,
  };
}

export const getPublishedAudioEditionForBook = cache(readPublishedAudioEditionForBook);

export async function getAudioStreamRecord(editionId: string, trackId: string): Promise<AudioStreamRecord | null> {
  if (!audioCatalogEnabled() || !hasSupabaseAdminConfig()) return null;

  const supabase = createSupabaseAdminClient();
  const allowTacosQaPreview = tacosQaPreviewEditionEnabled(editionId);
  const editionResult = await supabase
    .from("audio_editions")
    .select("id,book_id,access_model,status")
    .eq("id", editionId)
    .in("status", allowTacosQaPreview ? ["published", "qa"] : ["published"])
    .maybeSingle();
  if (editionResult.error) {
    if (isMissingAudioTable(editionResult.error)) return null;
    throw new Error(editionResult.error.message);
  }

  const edition = editionResult.data as AudioEditionRow | null;
  if (!edition?.id || !edition.book_id) return null;
  const editionStatus = String(edition.status || "");
  const isTacosQaPreview = editionStatus === "qa"
    && tacosQaPreviewBookEnabled(edition.book_id)
    && tacosQaPreviewEditionEnabled(edition.id);
  if (editionStatus !== "published" && !isTacosQaPreview) return null;
  const requiredTrackStatus = isTacosQaPreview ? "qa" : "published";

  const [trackResult, bookResult] = await Promise.all([
    supabase
      .from("audio_tracks")
      .select(AUDIO_TRACK_STREAM_SELECT)
      .eq("id", trackId)
      .eq("edition_id", editionId)
      .eq("status", requiredTrackStatus)
      .maybeSingle(),
    supabase
      .from("book_catalog")
      .select("id,status,visibility")
      .eq("id", edition.book_id)
      .eq("status", "ready")
      .in("visibility", ["main", "archive"])
      .maybeSingle(),
  ]);

  if (trackResult.error || bookResult.error) {
    const error = trackResult.error || bookResult.error;
    if (isMissingAudioTable(error)) return null;
    throw new Error(error?.message || "Could not load the audio track.");
  }

  const track = trackResult.data as AudioTrackRow | null;
  const book = bookResult.data as StreamBookRow | null;
  const canonicalBookId = String(book?.id || "").trim().toLowerCase();
  if (
    !track?.id
    || Number(track.position || 0) <= 0
    || !track.storage_bucket
    || !track.storage_path
    || !canonicalBookId
    || canonicalBookId !== edition.book_id.trim().toLowerCase()
    || String(book?.status || "").toLowerCase() !== "ready"
    || !["main", "archive"].includes(String(book?.visibility || "").toLowerCase())
    || Boolean(LEGACY_BOOK_ID_ALIASES[canonicalBookId])
  ) return null;

  return {
    editionId: edition.id,
    trackId: track.id,
    bookId: edition.book_id,
    trackPosition: Number(track.position || 0),
    accessModel: accessModel(edition.access_model),
    storageBucket: track.storage_bucket,
    storagePath: track.storage_path,
  };
}
