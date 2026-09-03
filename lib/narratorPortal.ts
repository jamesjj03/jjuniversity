import "server-only";

import { getBookById } from "@/lib/publishing";
import { readPublicationBookIndex, type PublicationBookIndex } from "@/lib/publicationEdition";
import { siteV2CoverSrc } from "@/lib/siteV2";
import { createSupabaseRequestClient } from "@/lib/supabaseServer";

export type NarratorSubmissionView = {
  id: string;
  audioTrackId: string;
  trackPosition: number;
  trackTitle: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  status: string;
  uploadedAt: string;
  narratorNote: string;
  narratorFeedback: string;
  previewAudioUrl?: string;
};

export type NarratorTrackView = {
  id: string;
  position: number;
  sectionKey: string;
  title: string;
  required: boolean;
  readerHref: string;
  readerLinkKind: "section" | "book" | "unavailable";
  latestSubmission: NarratorSubmissionView | null;
};

export type NarratorAssignmentView = {
  id: string;
  editionId: string;
  bookId: string;
  bookTitle: string;
  bookSlug: string;
  coverSrc: string;
  status: string;
  dueAt: string;
  brief: string;
  tracks: NarratorTrackView[];
  submissions: NarratorSubmissionView[];
};

export type NarratorPortalData = {
  displayName: string;
  status: string;
  assignments: NarratorAssignmentView[];
};

type Row = Record<string, unknown>;

export function narratorPortalEnabled() {
  return process.env.JJU_NARRATOR_PORTAL_ENABLED === "1";
}

function missingTable(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return String(value.code || "") === "42P01"
    || String(value.code || "") === "PGRST205"
    || /narrator_(profiles|assignments|submissions).*does not exist/i.test(String(value.message || ""));
}

export async function getNarratorPortalData(userId: string): Promise<NarratorPortalData | null> {
  const supabase = await createSupabaseRequestClient();
  const [profileResult, assignmentResult] = await Promise.all([
    supabase
      .from("narrator_profiles")
      .select("display_name,status")
      .eq("user_id", userId)
      .in("status", ["invited", "active", "paused"])
      .maybeSingle(),
    supabase
      .from("narrator_assignments")
      .select("id,edition_id,status,due_at,narrator_brief")
      .eq("narrator_user_id", userId)
      .neq("status", "closed")
      .order("created_at", { ascending: false }),
  ]);

  if (profileResult.error || assignmentResult.error) {
    const error = profileResult.error || assignmentResult.error;
    if (missingTable(error)) return null;
    throw new Error(error?.message || "Could not load narrator work.");
  }

  const profile = profileResult.data as Row | null;
  if (!profile) return null;
  const assignments = (assignmentResult.data || []) as Row[];
  const editionIds = assignments.map(row => String(row.edition_id || "")).filter(Boolean);

  const [editionResult, trackResult, submissionResult] = await Promise.all([
    editionIds.length
      ? supabase
        .from("audio_editions")
        .select("id,book_id")
        .in("id", editionIds)
      : Promise.resolve({ data: [], error: null }),
    editionIds.length
      ? supabase
        .from("audio_tracks")
        .select("id,edition_id,position,section_key,title,required_for_submission")
        .in("edition_id", editionIds)
        .order("position", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    assignments.length
      ? supabase
        .from("narrator_submissions")
        .select("id,assignment_id,audio_track_id,track_position,track_title,original_file_name,file_size_bytes,mime_type,upload_status,uploaded_at,narrator_note,narrator_feedback")
        .in("assignment_id", assignments.map(row => String(row.id)))
        .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (editionResult.error || trackResult.error || submissionResult.error) {
    const error = editionResult.error || trackResult.error || submissionResult.error;
    if (missingTable(error)) return null;
    throw new Error(error?.message || "Could not load narrator assignments.");
  }

  const editions = (editionResult.data || []) as Row[];
  const bookIds = [...new Set(editions.map(row => String(row.book_id || "")).filter(Boolean))];
  const bookResult = bookIds.length
    ? await supabase.from("book_catalog").select("id,title,slug").in("id", bookIds)
    : { data: [], error: null };
  if (bookResult.error) throw new Error(bookResult.error.message);

  const editionById = new Map(editions.map(row => [String(row.id), row]));
  const bookById = new Map(((bookResult.data || []) as Row[]).map(row => [String(row.id), row]));
  const publicationByBookId = new Map<string, PublicationBookIndex>();
  await Promise.all(bookIds.map(async bookId => {
    try {
      publicationByBookId.set(bookId, await readPublicationBookIndex(bookId));
    } catch {
      // Some assigned books are private or have no current Reader edition.
    }
  }));
  const submissionsByAssignment = new Map<string, NarratorSubmissionView[]>();
  const latestSubmissionByAssignmentTrack = new Map<string, NarratorSubmissionView>();
  const latestHistoricalSubmissionByAssignmentTrack = new Map<string, NarratorSubmissionView>();

  for (const row of (submissionResult.data || []) as Row[]) {
    const assignmentId = String(row.assignment_id || "");
    const audioTrackId = String(row.audio_track_id || "");
    const list = submissionsByAssignment.get(assignmentId) || [];
    const submission = {
      id: String(row.id || ""),
      audioTrackId,
      trackPosition: Number(row.track_position || 0),
      trackTitle: String(row.track_title || ""),
      fileName: String(row.original_file_name || ""),
      fileSizeBytes: Number(row.file_size_bytes || 0),
      mimeType: String(row.mime_type || ""),
      status: String(row.upload_status || ""),
      uploadedAt: String(row.uploaded_at || ""),
      narratorNote: String(row.narrator_note || ""),
      narratorFeedback: String(row.narrator_feedback || ""),
    };
    list.push(submission);
    submissionsByAssignment.set(assignmentId, list);
    const assignmentTrackKey = `${assignmentId}:${audioTrackId}`;
    if (audioTrackId) {
      if (!latestHistoricalSubmissionByAssignmentTrack.has(assignmentTrackKey)) {
        latestHistoricalSubmissionByAssignmentTrack.set(assignmentTrackKey, submission);
      }
      if (submission.status !== "superseded" && !latestSubmissionByAssignmentTrack.has(assignmentTrackKey)) {
        latestSubmissionByAssignmentTrack.set(assignmentTrackKey, submission);
      }
    }
  }

  const tracksByEdition = new Map<string, Row[]>();
  for (const row of (trackResult.data || []) as Row[]) {
    const editionId = String(row.edition_id || "");
    const list = tracksByEdition.get(editionId) || [];
    list.push(row);
    tracksByEdition.set(editionId, list);
  }

  return {
    displayName: String(profile.display_name || "Narrator"),
    status: String(profile.status || "invited"),
    assignments: assignments.map(row => {
      const editionId = String(row.edition_id || "");
      const edition = editionById.get(editionId);
      const bookId = String(edition?.book_id || "");
      const book = bookById.get(bookId);
      const id = String(row.id || "");
      const bookSlug = String(book?.slug || bookId);
      const localBook = getBookById(bookId) || getBookById(bookSlug);
      const publication = publicationByBookId.get(bookId);
      return {
        id,
        editionId,
        bookId,
        bookTitle: String(book?.title || bookId || "Assigned book"),
        bookSlug,
        coverSrc: localBook ? siteV2CoverSrc(localBook) : "/branding/jju-logo.png",
        status: String(row.status || "offered"),
        dueAt: String(row.due_at || ""),
        brief: String(row.narrator_brief || ""),
        tracks: (tracksByEdition.get(editionId) || []).map(track => {
          const audioTrackId = String(track.id || "");
          const sectionKey = String(track.section_key || "");
          const title = String(track.title || "");
          const publishedSection = publication?.sections.find(section => section.id === sectionKey && section.crawlable);
          const readerHref = publishedSection?.path
            || (publication ? `/books/${encodeURIComponent(bookSlug)}` : "");
          return {
            id: audioTrackId,
            position: Number(track.position || 0),
            sectionKey,
            title,
            required: track.required_for_submission !== false,
            readerHref,
            readerLinkKind: publishedSection ? "section" : publication ? "book" : "unavailable",
            latestSubmission: latestSubmissionByAssignmentTrack.get(`${id}:${audioTrackId}`)
              || latestHistoricalSubmissionByAssignmentTrack.get(`${id}:${audioTrackId}`)
              || null,
          };
        }),
        submissions: submissionsByAssignment.get(id) || [],
      };
    }),
  };
}
