import "server-only";

import {
  getAudioCandidatePreviewKey,
  resolveAudioStorageTarget,
  type AudioStreamRecord,
} from "@/lib/audioCatalog";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import humanApproval from "@/private/audio-review/tacos-human-listen-approval.json";

const TACOS_BOOK_ID = "tacos";
const TACOS_BOOK_SLUG = "everything-i-touch-turns-to-tacos";
const TACOS_EDITION_ID = "4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46";
const TACOS_SOURCE_VERSION = 1;
const TACOS_SOURCE_SHA256 = "6603471a78d74ff63cae6b527b4bd10365724d67bf40c597a28614f67ea6923c";
const EXPECTED_TRACKS = 16;
const EXPECTED_TOTAL_BYTES = 49_916_732;
const EXPECTED_TRACK_SECONDS_SUM = 1_248;
const EXPECTED_TOTAL_SECONDS = 1_249;
const AUDIO_BUCKET = "audiobooks";
const AUDIO_PREFIX = `${TACOS_BOOK_SLUG}/standard/`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EditionRow = {
  id?: string | null;
  book_id?: string | null;
  source_content_version?: number | null;
  source_content_sha256?: string | null;
  edition_key?: string | null;
  narrator_name?: string | null;
  language_code?: string | null;
  status?: string | null;
  access_model?: string | null;
  total_seconds?: number | null;
  published_at?: string | null;
};

type TrackRow = {
  id?: string | null;
  edition_id?: string | null;
  position?: number | null;
  title?: string | null;
  section_key?: string | null;
  required_for_submission?: boolean | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | string | null;
  duration_seconds?: number | null;
  sha256?: string | null;
  status?: string | null;
  published_at?: string | null;
};

type BookRow = {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  status?: string | null;
  visibility?: string | null;
};

type SealedTrack = {
  bytes: number;
  durationSeconds: number;
  sha256: string;
  storagePath?: string;
};

const SEALED_TRACKS = new Map<number, SealedTrack>([
  [1, { bytes: 288_272, durationSeconds: 7, sha256: "1539b1508ac5acdaeca015c552d9bdedef2e8dcc497e0db0932b0b71950ebb4d" }],
  [2, { bytes: 565_976, durationSeconds: 14, sha256: "f3f5a732f5331f6b52cce3f8780ef69b71ed5a5984a1cba023131c4a9482cf1b" }],
  [3, { bytes: 2_052_632, durationSeconds: 51, sha256: "d6bb3d451ec1e8b828852161da83e6a4f9ca4a2071ef078165fc29f02889b449" }],
  [4, { bytes: 3_550_772, durationSeconds: 89, sha256: "0a099041e6993bc408df6a706174db82bdf3aefda02980db4b6eb2bb2b1a1e8c" }],
  [5, { bytes: 4_818_188, durationSeconds: 121, sha256: "42ba7159df2b04bd94edc0dc0f7bfd728a40d49e595bad6e9b31cffe86ee1505" }],
  [6, { bytes: 4_483_064, durationSeconds: 112, sha256: "443c842e1c9da080a7edf49353ca58e15e51031729a310f1b4bdc97d7aba45f9" }],
  [7, { bytes: 4_166_732, durationSeconds: 104, sha256: "a669933ec0a070d5237debd1ad50bd5ea27a8b5c37b8cfdc051463d1d0560e0a" }],
  [8, { bytes: 4_383_884, durationSeconds: 110, sha256: "d71d4bad9a4da0ea0c251afced4df381193d0d5d8785135f31ec0110fdd568db" }],
  [9, { bytes: 5_092_760, durationSeconds: 127, sha256: "4aebc14a7c697141096bffb043fed66345460828e68da396121b11dd85e4be66" }],
  [10, {
    bytes: 5_529_152,
    durationSeconds: 138,
    sha256: "0a69afb8a56a0b6e5f842306720778a275bc10d73b127b937b89daee6bfb808c",
    storagePath: `${AUDIO_PREFIX}10-0a69afb8a56a0b6e.mp3`,
  }],
  [11, { bytes: 5_161_664, durationSeconds: 129, sha256: "9d19b451c7e5ed84574faef59de620f7de8e32783a4ad60c67e36c13872d295c" }],
  [12, { bytes: 5_115_728, durationSeconds: 128, sha256: "d8ec5707d3e3f8214d96c56bb7630ca27e52b5c89e1ebc953c642d646beb781e" }],
  [13, {
    bytes: 919_892,
    durationSeconds: 23,
    sha256: "b0646c8581ffc3e40a02ac851f592181e95f49b551c269282835d757a2c93ace",
    storagePath: `${AUDIO_PREFIX}13-b0646c8581ffc3e4.mp3`,
  }],
  [14, { bytes: 913_628, durationSeconds: 23, sha256: "7901a1061488af6ef74321bc0806ece9ea62de0aa5073522d8e3cd846394fd6f" }],
  [15, { bytes: 1_068_140, durationSeconds: 27, sha256: "5da4628032f08ac964fe9f774968fc190be74f22de5697b6b93173cd06e7966e" }],
  [16, {
    bytes: 1_806_248,
    durationSeconds: 45,
    sha256: "5981f85def7c4f7cb278cdd5611a3f5ab583d2818f3e7b96ca1f853f2b61f6a9",
    storagePath: `${AUDIO_PREFIX}16-5981f85def7c4f7c.mp3`,
  }],
]);

const PREVIOUS_DATABASE_TRACKS = new Map<number, SealedTrack>([
  [10, { bytes: 5_489_480, durationSeconds: 137, sha256: "992cecfdefaa74d2f7872bd40cf9428482b968e7411fa1bcd9ece905bd933cc9" }],
  [13, { bytes: 907_364, durationSeconds: 23, sha256: "ebbf68878706555c1abd3588213face53811d0bac6c8e51713d02ffaf1595b7d" }],
  [16, { bytes: 1_775_972, durationSeconds: 44, sha256: "743ea9ec251007bb989f6374513716e25a9120bf64b1cafd732bc964596af927" }],
]);

export type AudioHumanFlag = {
  label: string;
  detail: string;
};

const HUMAN_FLAGS = new Map<number, AudioHumanFlag[]>([
  [5, [{ label: "Room tone", detail: "Listen through the quiet room tone for continuity and unexpected noise." }]],
  [7, [{ label: "Tail", detail: "Listen through the end of the file for a cutoff, click, or leftover sound." }]],
  [10, [{ label: "Room tone", detail: "Listen through the quiet room tone in Danny's recovered email master." }]],
  [13, [{ label: "Short tail", detail: "Confirm the short ending space feels intentional and nothing is clipped." }]],
  [16, [
    { label: "Opening", detail: "Confirm the opening word and lead-in start cleanly." },
    { label: "Room tone", detail: "Listen through the quiet room tone for continuity and unexpected noise." },
  ]],
]);

export type AudioReviewTrack = {
  position: number;
  title: string;
  durationSeconds: number;
  bytes: number;
  flags: AudioHumanFlag[];
};

export type TacosAudioReview = {
  status: "available";
  title: string;
  narrator: string;
  tracks: AudioReviewTrack[];
  totalBytes: number;
  totalSeconds: number;
  technicalPassCount: number;
  humanCheckCount: number;
  humanReviewedCheckCount: number;
  humanListenApproved: boolean;
  humanListenApprovedAt: string;
  humanListenApprovedBy: string;
  flaggedTrackCount: number;
  previewAvailable: boolean;
};

export type TacosAudioReviewUnavailable = {
  status: "unavailable";
  message: string;
};

export type TacosAudioReviewResult = TacosAudioReview | TacosAudioReviewUnavailable;

type StorageTarget = {
  bucket: string;
  path: string;
  bytes: number;
};

function unavailable(message: string): TacosAudioReviewUnavailable {
  return { status: "unavailable", message };
}

function normalized(value: unknown) {
  return String(value || "").trim();
}

function normalizedHash(value: unknown) {
  return normalized(value).toLowerCase();
}

function isCanonicalBook(book: BookRow | null) {
  return book?.id === TACOS_BOOK_ID
    && book.slug === TACOS_BOOK_SLUG
    && book.status === "ready"
    && ["main", "archive"].includes(normalized(book.visibility));
}

function isCanonicalEdition(edition: EditionRow | null) {
  return edition?.id === TACOS_EDITION_ID
    && edition.book_id === TACOS_BOOK_ID
    && Number(edition.source_content_version) === TACOS_SOURCE_VERSION
    && normalizedHash(edition.source_content_sha256) === TACOS_SOURCE_SHA256
    && edition.edition_key === "standard"
    && normalized(edition.narrator_name) === "James Johnson"
    && normalized(edition.language_code).toLowerCase() === "en"
    && edition.status === "qa"
    && edition.access_model === "free"
    && Number(edition.total_seconds) === 1_247
    && !edition.published_at;
}

function effectiveTrack(row: TrackRow, position: number) {
  const sealed = SEALED_TRACKS.get(position);
  if (!sealed) return null;
  return {
    bytes: sealed.bytes,
    durationSeconds: sealed.durationSeconds,
    sha256: sealed.sha256,
    storagePath: sealed.storagePath ?? normalized(row.storage_path),
  };
}

function rowMatchesSeal(row: TrackRow, seal: SealedTrack) {
  const storagePath = normalized(row.storage_path);
  return Number(row.file_size_bytes || 0) === seal.bytes
    && Number(row.duration_seconds || 0) === seal.durationSeconds
    && normalizedHash(row.sha256) === seal.sha256
    && storagePath.endsWith(`-${seal.sha256.slice(0, 16)}.mp3`);
}

function normalizeTracks(rows: TrackRow[]): {
  publicTracks: AudioReviewTrack[];
  storageTargets: StorageTarget[];
  streamRecords: AudioStreamRecord[];
} | null {
  if (rows.length !== EXPECTED_TRACKS) return null;
  const sorted = [...rows].sort((a, b) => Number(a.position) - Number(b.position));
  const positions = new Set<number>();
  const trackIds = new Set<string>();
  const effectiveHashes = new Set<string>();
  const publicTracks: AudioReviewTrack[] = [];
  const storageTargets: StorageTarget[] = [];
  const streamRecords: AudioStreamRecord[] = [];

  for (const [index, row] of sorted.entries()) {
    const position = Number(row.position);
    const trackId = normalized(row.id);
    const title = normalized(row.title);
    const sectionKey = normalized(row.section_key);
    const rowHash = normalizedHash(row.sha256);
    if (
      position !== index + 1
      || positions.has(position)
      || !UUID_PATTERN.test(trackId)
      || trackIds.has(trackId)
      || row.edition_id !== TACOS_EDITION_ID
      || !title
      || !sectionKey
      || row.required_for_submission !== true
      || row.storage_bucket !== AUDIO_BUCKET
      || !normalized(row.storage_path).startsWith(AUDIO_PREFIX)
      || row.mime_type !== "audio/mpeg"
      || Number(row.file_size_bytes || 0) <= 0
      || Number(row.duration_seconds || 0) <= 0
      || !/^[a-f0-9]{64}$/.test(rowHash)
      || row.status !== "qa"
      || Boolean(row.published_at)
    ) return null;
    positions.add(position);
    trackIds.add(trackId);

    const sealed = SEALED_TRACKS.get(position);
    if (!sealed) return null;
    const previous = PREVIOUS_DATABASE_TRACKS.get(position);
    if (!rowMatchesSeal(row, sealed) && !(previous && rowMatchesSeal(row, previous))) return null;

    const effective = effectiveTrack(row, position);
    if (!effective) return null;
    if (
      effective.bytes <= 0
      || effective.durationSeconds <= 0
      || !/^[a-f0-9]{64}$/.test(effective.sha256)
      || !effective.storagePath.startsWith(AUDIO_PREFIX)
      || !effective.storagePath.endsWith(`-${effective.sha256.slice(0, 16)}.mp3`)
      || effectiveHashes.has(effective.sha256)
    ) return null;
    effectiveHashes.add(effective.sha256);

    publicTracks.push({
      position,
      title,
      durationSeconds: effective.durationSeconds,
      bytes: effective.bytes,
      flags: HUMAN_FLAGS.get(position) || [],
    });
    storageTargets.push({ bucket: AUDIO_BUCKET, path: effective.storagePath, bytes: effective.bytes });
    streamRecords.push({
      editionId: TACOS_EDITION_ID,
      trackId,
      bookId: TACOS_BOOK_ID,
      trackPosition: position,
      accessModel: "free",
      storageBucket: AUDIO_BUCKET,
      storagePath: normalized(row.storage_path),
    });
  }

  if (new Set(storageTargets.map(target => target.path)).size !== EXPECTED_TRACKS) return null;
  if (new Set(publicTracks.map(track => track.position)).size !== EXPECTED_TRACKS) return null;
  if (publicTracks.reduce((sum, track) => sum + track.bytes, 0) !== EXPECTED_TOTAL_BYTES) return null;
  // Each track duration is stored as a rounded integer. Their sum is one second
  // shorter than the independently rounded 20:48.94 full-program runtime.
  if (publicTracks.reduce((sum, track) => sum + track.durationSeconds, 0) !== EXPECTED_TRACK_SECONDS_SUM) return null;

  return { publicTracks, storageTargets, streamRecords };
}

async function storageTargetsPresent(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  targets: StorageTarget[],
) {
  const groups = new Map<string, { bucket: string; folder: string; targets: StorageTarget[] }>();
  for (const target of targets) {
    if (target.bucket !== AUDIO_BUCKET || !target.path.startsWith(AUDIO_PREFIX)) return false;
    const slashIndex = target.path.lastIndexOf("/");
    if (slashIndex <= 0 || slashIndex === target.path.length - 1) return false;
    const folder = target.path.slice(0, slashIndex);
    const key = `${target.bucket}:${folder}`;
    const group = groups.get(key) || { bucket: target.bucket, folder, targets: [] };
    group.targets.push(target);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const result = await supabase.storage.from(group.bucket).list(group.folder, { limit: 100, offset: 0 });
    if (result.error) return false;
    const objects = new Map((result.data || []).map(item => [item.name, item]));
    for (const target of group.targets) {
      const name = target.path.slice(target.path.lastIndexOf("/") + 1);
      const item = objects.get(name);
      const metadataSize = Number(item?.metadata?.size ?? item?.metadata?.contentLength ?? 0);
      if (!item || metadataSize !== target.bytes) return false;
    }
  }
  return true;
}

export async function readTacosAudioReview(): Promise<TacosAudioReviewResult> {
  if (!hasSupabaseAdminConfig()) {
    return unavailable("The private audio connection is not configured. No review data was shown.");
  }

  try {
    const supabase = createSupabaseAdminClient();
    const [bookResult, editionResult, tracksResult] = await Promise.all([
      supabase
        .from("book_catalog")
        .select("id,slug,title,status,visibility")
        .eq("id", TACOS_BOOK_ID)
        .maybeSingle(),
      supabase
        .from("audio_editions")
        .select("id,book_id,source_content_version,source_content_sha256,edition_key,narrator_name,language_code,status,access_model,total_seconds,published_at")
        .eq("id", TACOS_EDITION_ID)
        .maybeSingle(),
      supabase
        .from("audio_tracks")
        .select("id,edition_id,position,title,section_key,required_for_submission,storage_bucket,storage_path,mime_type,file_size_bytes,duration_seconds,sha256,status,published_at")
        .eq("edition_id", TACOS_EDITION_ID)
        .order("position", { ascending: true }),
    ]);

    if (bookResult.error || editionResult.error || tracksResult.error) {
      return unavailable("The exact audio review package could not be read. No partial track data was shown.");
    }

    const book = bookResult.data as BookRow | null;
    const edition = editionResult.data as EditionRow | null;
    if (!isCanonicalBook(book) || !isCanonicalEdition(edition)) {
      return unavailable("The Tacos edition no longer matches the sealed QA package. Review is locked.");
    }

    const normalizedTracks = normalizeTracks((tracksResult.data || []) as TrackRow[]);
    if (!normalizedTracks) {
      return unavailable("The Tacos edition is not an exact 16-track technical package. No partial track data was shown.");
    }

    if (!await storageTargetsPresent(supabase, normalizedTracks.storageTargets)) {
      return unavailable("One or more selected private audio files could not be verified at the sealed byte count. Technical pass was not claimed.");
    }

    const candidateKey = getAudioCandidatePreviewKey(TACOS_BOOK_ID, TACOS_EDITION_ID);
    const previewTargetsMatch = Boolean(candidateKey) && normalizedTracks.streamRecords.every((record, index) => {
      const target = resolveAudioStorageTarget(record, candidateKey);
      const expected = normalizedTracks.storageTargets[index];
      return target?.storageBucket === expected.bucket && target.storagePath === expected.path;
    });
    const humanCheckCount = normalizedTracks.publicTracks.reduce((sum, track) => sum + track.flags.length, 0);
    const approvalMatchesPackage = humanApproval.editionId === TACOS_EDITION_ID
      && humanApproval.bookId === TACOS_BOOK_ID
      && humanApproval.trackCount === EXPECTED_TRACKS
      && humanApproval.totalBytes === EXPECTED_TOTAL_BYTES
      && humanApproval.humanListenApproval.status === "approved"
      && humanApproval.publicationApproval === "not-granted";

    return {
      status: "available",
      title: normalized(book?.title) || "Everything I Touch Turns to Tacos",
      narrator: normalized(edition?.narrator_name),
      tracks: normalizedTracks.publicTracks,
      totalBytes: EXPECTED_TOTAL_BYTES,
      totalSeconds: EXPECTED_TOTAL_SECONDS,
      technicalPassCount: EXPECTED_TRACKS,
      humanCheckCount: approvalMatchesPackage ? 0 : humanCheckCount,
      humanReviewedCheckCount: approvalMatchesPackage ? humanCheckCount : 0,
      humanListenApproved: approvalMatchesPackage,
      humanListenApprovedAt: approvalMatchesPackage ? humanApproval.humanListenApproval.approvedAt : "",
      humanListenApprovedBy: approvalMatchesPackage ? humanApproval.humanListenApproval.approvedBy : "",
      flaggedTrackCount: normalizedTracks.publicTracks.filter(track => track.flags.length > 0).length,
      previewAvailable: previewTargetsMatch,
    };
  } catch {
    return unavailable("The private audio review failed closed. No track data was shown.");
  }
}
