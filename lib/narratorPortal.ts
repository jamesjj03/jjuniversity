import "server-only";

import { createSupabaseRequestClient } from "@/lib/supabaseServer";

export type NarratorSubmissionView = {
  id: string;
  trackPosition: number;
  trackTitle: string;
  fileName: string;
  status: string;
  uploadedAt: string;
};

export type NarratorAssignmentView = {
  id: string;
  editionId: string;
  bookId: string;
  bookTitle: string;
  bookSlug: string;
  status: string;
  dueAt: string;
  brief: string;
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

  const [editionResult, submissionResult] = await Promise.all([
    editionIds.length
      ? supabase
        .from("audio_editions")
        .select("id,book_id")
        .in("id", editionIds)
      : Promise.resolve({ data: [], error: null }),
    assignments.length
      ? supabase
        .from("narrator_submissions")
        .select("id,assignment_id,track_position,track_title,original_file_name,upload_status,uploaded_at")
        .in("assignment_id", assignments.map(row => String(row.id)))
        .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (editionResult.error || submissionResult.error) {
    const error = editionResult.error || submissionResult.error;
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
  const submissionsByAssignment = new Map<string, NarratorSubmissionView[]>();

  for (const row of (submissionResult.data || []) as Row[]) {
    const assignmentId = String(row.assignment_id || "");
    const list = submissionsByAssignment.get(assignmentId) || [];
    list.push({
      id: String(row.id || ""),
      trackPosition: Number(row.track_position || 0),
      trackTitle: String(row.track_title || ""),
      fileName: String(row.original_file_name || ""),
      status: String(row.upload_status || ""),
      uploadedAt: String(row.uploaded_at || ""),
    });
    submissionsByAssignment.set(assignmentId, list);
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
      return {
        id,
        editionId,
        bookId,
        bookTitle: String(book?.title || bookId || "Assigned book"),
        bookSlug: String(book?.slug || bookId),
        status: String(row.status || "offered"),
        dueAt: String(row.due_at || ""),
        brief: String(row.narrator_brief || ""),
        submissions: submissionsByAssignment.get(id) || [],
      };
    }),
  };
}
