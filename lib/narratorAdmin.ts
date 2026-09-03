import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import { readAdminBookContent } from "@/lib/adminBookContent";
import { narratorRequestNotificationConfigured } from "@/lib/narratorAccessRequests";
import { SITE_URL } from "@/lib/publishing";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_STATUSES = new Set(["invited", "active", "paused", "closed"]);
const INVITABLE_CONTACT_STATUSES = new Set(["contact", "invite-pending", "repair-needed"]);
const REVIEWABLE_STATUSES = new Set(["in-review"]);
const INTAKE_BUCKET = "narrator-audio-intake";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_RETRY_LEASE_MS = 10 * 60 * 1000;
const INVITE_RECOVERY_WINDOW_MS = 50 * 60 * 1000;

type Row = Record<string, unknown>;

export type NarratorAdminAccount = {
  id: string;
  email: string;
  createdAt: string;
  confirmedAt: string;
};

export type NarratorAdminProfile = {
  userId: string;
  displayName: string;
  contactEmail: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type NarratorAdminContact = {
  id: string;
  displayName: string;
  contactEmail: string;
  source: string;
  notes: string;
  status: string;
  authUserId: string;
  inviteSentAt: string;
  inviteRetryLocked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NarratorAdminAccessRequest = {
  id: string;
  displayName: string;
  contactEmail: string;
  note: string;
  status: string;
  notificationStatus: string;
  linkedContactId: string;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type NarratorAdminTrack = {
  id: string;
  editionId: string;
  position: number;
  sectionKey: string;
  title: string;
  required: boolean;
  status: string;
};

export type NarratorAdminEdition = {
  id: string;
  bookId: string;
  bookTitle: string;
  editionKey: string;
  narratorName: string;
  status: string;
  sourceContentVersion: number;
  sourceContentSha256: string;
  createdAt: string;
  updatedAt: string;
  tracks: NarratorAdminTrack[];
};

export type NarratorAdminAssignment = {
  id: string;
  editionId: string;
  narratorUserId: string;
  narratorName: string;
  bookId: string;
  bookTitle: string;
  status: string;
  dueAt: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
};

export type NarratorAdminSubmission = {
  id: string;
  assignmentId: string;
  narratorUserId: string;
  narratorName: string;
  bookTitle: string;
  audioTrackId: string;
  trackPosition: number;
  trackTitle: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: string;
  narratorNote: string;
  narratorFeedback: string;
  reviewNote: string;
  uploadedAt: string;
  reviewedAt: string;
  updatedAt: string;
};

export type NarratorAdminBook = {
  id: string;
  title: string;
  status: string;
  visibility: string;
};

export type NarratorAdminSnapshot = {
  available: boolean;
  portalEnabled: boolean;
  invitesEnabled: boolean;
  contactsAvailable: boolean;
  accessRequestsAvailable: boolean;
  requestNotificationConfigured: boolean;
  message: string;
  accounts: NarratorAdminAccount[];
  contacts: NarratorAdminContact[];
  accessRequests: NarratorAdminAccessRequest[];
  profiles: NarratorAdminProfile[];
  books: NarratorAdminBook[];
  editions: NarratorAdminEdition[];
  assignments: NarratorAdminAssignment[];
  submissions: NarratorAdminSubmission[];
};

export class NarratorAdminInputError extends Error {}
export class NarratorAdminConflictError extends Error {}
export class NarratorAdminUnavailableError extends Error {}

export function narratorInvitesEnabled() {
  return process.env.JJU_NARRATOR_PORTAL_ENABLED === "1"
    && process.env.JJU_NARRATOR_INVITES_ENABLED === "1";
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = cleanText(value, maxLength);
  if (!text) throw new NarratorAdminInputError(`${label} is required.`);
  return text;
}

function requiredUuid(value: unknown, label: string) {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new NarratorAdminInputError(`${label} is invalid.`);
  return id;
}

function optionalEmail(value: unknown) {
  const email = cleanText(value, 254).toLowerCase();
  if (email && !EMAIL_PATTERN.test(email)) throw new NarratorAdminInputError("Email address is invalid.");
  return email;
}

function isMissingAudioFoundation(error: unknown) {
  const record = error && typeof error === "object" ? error as Row : {};
  const code = String(record.code || "");
  const message = String(record.message || "");
  return code === "42P01"
    || code === "PGRST205"
    || /(?:narrator_profiles|audio_editions|audio_tracks|narrator_assignments|narrator_submissions).*does not exist/i.test(message);
}

function isMissingNarratorContacts(error: unknown) {
  const record = error && typeof error === "object" ? error as Row : {};
  const code = String(record.code || "");
  const message = String(record.message || "");
  return code === "42P01"
    || code === "PGRST205"
    || /narrator_contacts.*does not exist/i.test(message)
    || /could not find.*narrator_contacts/i.test(message);
}

function isMissingNarratorAccessRequests(error: unknown) {
  const record = error && typeof error === "object" ? error as Row : {};
  const code = String(record.code || "");
  const message = String(record.message || "");
  return code === "42P01"
    || code === "PGRST202"
    || code === "PGRST205"
    || /narrator_access_requests.*does not exist/i.test(message)
    || /could not find.*narrator_access_requests/i.test(message);
}

function parseContentVersion(version: string) {
  const match = /^supabase:(\d+)$/.exec(version.trim());
  return match ? Number(match[1]) : 0;
}

function contentSha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeEditionKey(value: unknown) {
  const key = cleanText(value || "standard", 48)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!key || key.length < 2) throw new NarratorAdminInputError("Edition key is invalid.");
  return key;
}

function optionalDate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new NarratorAdminInputError("Due date is invalid.");
  return date.toISOString();
}

async function listConfirmedAccounts(): Promise<NarratorAdminAccount[]> {
  const supabase = createSupabaseAdminClient();
  const accounts: NarratorAdminAccount[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new NarratorAdminUnavailableError(`Could not read existing accounts: ${result.error.message}`);
    const users = result.data.users || [];
    for (const user of users) {
      const confirmedAt = String(user.email_confirmed_at || user.confirmed_at || "");
      if (!user.email || !confirmedAt) continue;
      accounts.push({
        id: user.id,
        email: user.email,
        createdAt: String(user.created_at || ""),
        confirmedAt,
      });
    }
    if (users.length < 100) break;
  }
  return accounts.sort((a, b) => a.email.localeCompare(b.email));
}

function emptySnapshot(message: string): NarratorAdminSnapshot {
  return {
    available: false,
    portalEnabled: process.env.JJU_NARRATOR_PORTAL_ENABLED === "1",
    invitesEnabled: narratorInvitesEnabled(),
    contactsAvailable: false,
    accessRequestsAvailable: false,
    requestNotificationConfigured: narratorRequestNotificationConfigured(),
    message,
    accounts: [],
    contacts: [],
    accessRequests: [],
    profiles: [],
    books: [],
    editions: [],
    assignments: [],
    submissions: [],
  };
}

export async function readNarratorAdminSnapshot(): Promise<NarratorAdminSnapshot> {
  if (!hasSupabaseAdminConfig()) {
    return emptySnapshot("Supabase admin access is not configured. No narrator data is shown.");
  }

  const supabase = createSupabaseAdminClient();
  const [accounts, catalog, contactsResult, accessRequestsResult, profilesResult, editionsResult, tracksResult, assignmentsResult, submissionsResult] = await Promise.all([
    listConfirmedAccounts(),
    readAdminBookCatalog(),
    supabase.from("narrator_contacts").select("id,display_name,contact_email,source,notes,status,auth_user_id,invite_sent_at,invite_attempt_started_at,created_at,updated_at").order("created_at"),
    supabase.from("narrator_access_requests").select("id,display_name,contact_email,note,status,notification_status,linked_contact_id,reviewed_at,created_at,updated_at").order("created_at", { ascending: false }),
    supabase.from("narrator_profiles").select("user_id,display_name,contact_email,status,created_at,updated_at").order("display_name"),
    supabase.from("audio_editions").select("id,book_id,edition_key,narrator_name,status,source_content_version,source_content_sha256,created_at,updated_at").order("created_at", { ascending: false }),
    supabase.from("audio_tracks").select("id,edition_id,position,section_key,title,required_for_submission,status").order("position"),
    supabase.from("narrator_assignments").select("id,edition_id,narrator_user_id,status,due_at,narrator_brief,created_at,updated_at").order("created_at", { ascending: false }),
    supabase.from("narrator_submissions").select("id,assignment_id,narrator_user_id,audio_track_id,track_position,track_title,original_file_name,mime_type,file_size_bytes,upload_status,narrator_note,narrator_feedback,review_note,uploaded_at,reviewed_at,updated_at").order("created_at", { ascending: false }),
  ]);

  const contactsAvailable = !contactsResult.error;
  const accessRequestsAvailable = !accessRequestsResult.error;
  if (contactsResult.error && !isMissingNarratorContacts(contactsResult.error)) {
    throw new NarratorAdminUnavailableError(`Could not read the narrator roster: ${contactsResult.error.message}`);
  }
  if (accessRequestsResult.error && !isMissingNarratorAccessRequests(accessRequestsResult.error)) {
    throw new NarratorAdminUnavailableError(`Could not read narrator access requests: ${accessRequestsResult.error.message}`);
  }
  const firstError = profilesResult.error || editionsResult.error || tracksResult.error || assignmentsResult.error || submissionsResult.error;
  if (firstError) {
    if (isMissingAudioFoundation(firstError)) {
      return emptySnapshot("The audio foundation is not available in this environment. No partial narrator data is shown.");
    }
    throw new NarratorAdminUnavailableError(`Could not read the narrator control room: ${firstError.message}`);
  }

  const books = catalog.books.map(book => ({
    id: String(book.id || ""),
    title: String(book.title || book.id || "Untitled"),
    status: String(book.status || ""),
    visibility: String(book.visibility || ""),
  })).filter(book => book.id).sort((a, b) => a.title.localeCompare(b.title));
  const contacts = (((contactsResult.data || []) as Row[]).map(row => ({
    id: String(row.id || ""),
    displayName: String(row.display_name || "Narrator"),
    contactEmail: String(row.contact_email || ""),
    source: String(row.source || ""),
    notes: String(row.notes || ""),
    status: String(row.status || "contact"),
    authUserId: String(row.auth_user_id || ""),
    inviteSentAt: String(row.invite_sent_at || ""),
    inviteRetryLocked: String(row.status || "") === "invite-pending"
      && Number.isFinite(new Date(String(row.invite_attempt_started_at || "")).getTime())
      && Date.now() - new Date(String(row.invite_attempt_started_at || "")).getTime() < INVITE_RETRY_LEASE_MS,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  })) satisfies NarratorAdminContact[]);
  const accessRequests = (((accessRequestsResult.data || []) as Row[]).map(row => ({
    id: String(row.id || ""),
    displayName: String(row.display_name || "Narrator"),
    contactEmail: String(row.contact_email || ""),
    note: String(row.note || ""),
    status: String(row.status || "pending"),
    notificationStatus: String(row.notification_status || "pending"),
    linkedContactId: String(row.linked_contact_id || ""),
    reviewedAt: String(row.reviewed_at || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  })) satisfies NarratorAdminAccessRequest[]);
  const bookById = new Map(books.map(book => [book.id, book]));
  const profiles = ((profilesResult.data || []) as Row[]).map(row => ({
    userId: String(row.user_id || ""),
    displayName: String(row.display_name || "Narrator"),
    contactEmail: String(row.contact_email || ""),
    status: String(row.status || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  }));
  const profileById = new Map(profiles.map(profile => [profile.userId, profile]));
  const tracks = ((tracksResult.data || []) as Row[]).map(row => ({
    id: String(row.id || ""),
    editionId: String(row.edition_id || ""),
    position: Number(row.position || 0),
    sectionKey: String(row.section_key || ""),
    title: String(row.title || ""),
    required: row.required_for_submission !== false,
    status: String(row.status || ""),
  }));
  const tracksByEdition = new Map<string, NarratorAdminTrack[]>();
  for (const track of tracks) {
    const list = tracksByEdition.get(track.editionId) || [];
    list.push(track);
    tracksByEdition.set(track.editionId, list);
  }
  const editions = ((editionsResult.data || []) as Row[]).map(row => {
    const bookId = String(row.book_id || "");
    return {
      id: String(row.id || ""),
      bookId,
      bookTitle: bookById.get(bookId)?.title || bookId || "Unknown book",
      editionKey: String(row.edition_key || ""),
      narratorName: String(row.narrator_name || ""),
      status: String(row.status || ""),
      sourceContentVersion: Number(row.source_content_version || 0),
      sourceContentSha256: String(row.source_content_sha256 || ""),
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
      tracks: (tracksByEdition.get(String(row.id || "")) || []).sort((a, b) => a.position - b.position),
    };
  });
  const editionById = new Map(editions.map(edition => [edition.id, edition]));
  const assignments = ((assignmentsResult.data || []) as Row[]).map(row => {
    const editionId = String(row.edition_id || "");
    const narratorUserId = String(row.narrator_user_id || "");
    const edition = editionById.get(editionId);
    return {
      id: String(row.id || ""),
      editionId,
      narratorUserId,
      narratorName: profileById.get(narratorUserId)?.displayName || narratorUserId,
      bookId: edition?.bookId || "",
      bookTitle: edition?.bookTitle || "Unknown book",
      status: String(row.status || ""),
      dueAt: String(row.due_at || ""),
      brief: String(row.narrator_brief || ""),
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
    };
  });
  const assignmentById = new Map(assignments.map(assignment => [assignment.id, assignment]));
  const submissions = ((submissionsResult.data || []) as Row[]).map(row => {
    const assignment = assignmentById.get(String(row.assignment_id || ""));
    const narratorUserId = String(row.narrator_user_id || "");
    return {
      id: String(row.id || ""),
      assignmentId: String(row.assignment_id || ""),
      narratorUserId,
      narratorName: profileById.get(narratorUserId)?.displayName || narratorUserId,
      bookTitle: assignment?.bookTitle || "Unknown book",
      audioTrackId: String(row.audio_track_id || ""),
      trackPosition: Number(row.track_position || 0),
      trackTitle: String(row.track_title || ""),
      fileName: String(row.original_file_name || ""),
      mimeType: String(row.mime_type || ""),
      fileSizeBytes: Number(row.file_size_bytes || 0),
      status: String(row.upload_status || ""),
      narratorNote: String(row.narrator_note || ""),
      narratorFeedback: String(row.narrator_feedback || ""),
      reviewNote: String(row.review_note || ""),
      uploadedAt: String(row.uploaded_at || ""),
      reviewedAt: String(row.reviewed_at || ""),
      updatedAt: String(row.updated_at || ""),
    };
  });

  return {
    available: true,
    portalEnabled: process.env.JJU_NARRATOR_PORTAL_ENABLED === "1",
    invitesEnabled: narratorInvitesEnabled(),
    contactsAvailable,
    accessRequestsAvailable,
    requestNotificationConfigured: narratorRequestNotificationConfigured(),
    message: profiles.length || assignments.length || submissions.length
      ? "Current private narrator workflow data."
      : "No narrator profiles, assignments, or submissions exist yet.",
    accounts,
    contacts,
    accessRequests,
    profiles,
    books,
    editions,
    assignments,
    submissions,
  };
}

export async function reviewNarratorAccessRequest(input: {
  requestId: unknown;
  expectedUpdatedAt: unknown;
  decision: unknown;
}) {
  if (!hasSupabaseAdminConfig()) throw new NarratorAdminUnavailableError("Supabase admin access is not configured.");
  const requestId = requiredUuid(input.requestId, "Access request");
  const expectedUpdatedAt = requiredText(input.expectedUpdatedAt, "Current request version", 80);
  const decision = cleanText(input.decision, 16).toLowerCase();
  if (!new Set(["approve", "decline"]).has(decision)) {
    throw new NarratorAdminInputError("Choose approve or decline.");
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase.rpc("review_narrator_access_request", {
    p_request_id: requestId,
    p_expected_updated_at: expectedUpdatedAt,
    p_decision: decision,
  });
  if (result.error) {
    if (isMissingNarratorAccessRequests(result.error)) {
      throw new NarratorAdminUnavailableError("The narrator request queue has not been installed yet.");
    }
    throw new NarratorAdminUnavailableError(result.error.message);
  }

  const outcome = String(result.data || "");
  if (outcome === "approved" || outcome === "declined") return { outcome };
  if (outcome === "request-conflict") {
    throw new NarratorAdminConflictError("That request changed or was already reviewed. Reload before trying again.");
  }
  if (outcome === "contact-conflict") {
    throw new NarratorAdminConflictError("The matching roster contact changed. Nothing was approved; reload before trying again.");
  }
  throw new NarratorAdminInputError("That access-request decision is invalid.");
}

export async function saveNarratorContact(input: {
  contactId?: unknown;
  displayName: unknown;
  contactEmail?: unknown;
  source?: unknown;
  notes?: unknown;
  expectedUpdatedAt?: unknown;
}) {
  if (!hasSupabaseAdminConfig()) throw new NarratorAdminUnavailableError("Supabase admin access is not configured.");
  const contactId = String(input.contactId || "").trim().toLowerCase();
  const displayName = requiredText(input.displayName, "Narrator name", 80);
  const contactEmail = optionalEmail(input.contactEmail);
  const source = cleanText(input.source || "Manual", 120) || "Manual";
  const notes = cleanText(input.notes, 1200);
  const supabase = createSupabaseAdminClient();

  if (contactId) {
    if (!UUID_PATTERN.test(contactId)) throw new NarratorAdminInputError("Narrator contact is invalid.");
    const expectedUpdatedAt = requiredText(input.expectedUpdatedAt, "Current narrator version", 80);
    const current = await supabase
      .from("narrator_contacts")
      .select("id,status,auth_user_id,updated_at")
      .eq("id", contactId)
      .maybeSingle();
    if (current.error) {
      if (isMissingNarratorContacts(current.error)) throw new NarratorAdminUnavailableError("The private narrator roster has not been installed yet.");
      throw new NarratorAdminUnavailableError(current.error.message);
    }
    if (!current.data) throw new NarratorAdminConflictError("That narrator contact no longer exists. Reload before saving.");
    if (String(current.data.updated_at || "") !== expectedUpdatedAt) {
      throw new NarratorAdminConflictError("That narrator contact changed. Reload before saving again.");
    }
    if (String(current.data.auth_user_id || "")) {
      throw new NarratorAdminInputError("This narrator is already linked to an account. Update the account profile instead.");
    }
    if (String(current.data.status || "contact") !== "contact") {
      throw new NarratorAdminConflictError("This narrator contact is already being invited or repaired. Reload before changing the address.");
    }
    const updated = await supabase
      .from("narrator_contacts")
      .update({ display_name: displayName, contact_email: contactEmail || null, source, notes })
      .eq("id", contactId)
      .eq("updated_at", expectedUpdatedAt)
      .select("id,display_name,contact_email,source,notes,status,auth_user_id,invite_sent_at,created_at,updated_at")
      .maybeSingle();
    if (updated.error) {
      if (String(updated.error.code || "") === "23505") throw new NarratorAdminConflictError("That email address is already on the narrator roster.");
      throw new NarratorAdminUnavailableError(updated.error.message);
    }
    if (!updated.data) throw new NarratorAdminConflictError("That narrator contact changed. Reload before saving again.");
    return updated.data;
  }

  const inserted = await supabase
    .from("narrator_contacts")
    .insert({ display_name: displayName, contact_email: contactEmail || null, source, notes, status: "contact" })
    .select("id,display_name,contact_email,source,notes,status,auth_user_id,invite_sent_at,created_at,updated_at")
    .single();
  if (inserted.error) {
    if (isMissingNarratorContacts(inserted.error)) throw new NarratorAdminUnavailableError("The private narrator roster has not been installed yet.");
    if (String(inserted.error.code || "") === "23505") throw new NarratorAdminConflictError("That email address is already on the narrator roster.");
    throw new NarratorAdminUnavailableError(inserted.error.message);
  }
  return inserted.data;
}

async function findAuthAccountByEmail(email: string) {
  const supabase = createSupabaseAdminClient();
  for (let page = 1; page <= 20; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new NarratorAdminUnavailableError(`Could not check existing accounts: ${result.error.message}`);
    const match = (result.data.users || []).find(user => String(user.email || "").trim().toLowerCase() === email);
    if (match) return match;
    if ((result.data.users || []).length < 100) return null;
  }
  throw new NarratorAdminUnavailableError("The account list is too large to verify this invitation safely.");
}

export async function inviteNarratorContact(input: {
  contactId: unknown;
  expectedUpdatedAt: unknown;
  confirmedEmail: unknown;
}) {
  if (!hasSupabaseAdminConfig()) throw new NarratorAdminUnavailableError("Supabase admin access is not configured.");
  if (process.env.JJU_NARRATOR_PORTAL_ENABLED !== "1") {
    throw new NarratorAdminUnavailableError("The narrator portal is turned off. Turn it on before inviting or repairing narrator access.");
  }
  const contactId = requiredUuid(input.contactId, "Narrator contact");
  const expectedUpdatedAt = requiredText(input.expectedUpdatedAt, "Current narrator version", 80);
  const confirmedEmail = optionalEmail(input.confirmedEmail);
  if (!confirmedEmail) throw new NarratorAdminInputError("Confirm the exact email address before sending an invitation.");
  const supabase = createSupabaseAdminClient();
  const current = await supabase
    .from("narrator_contacts")
    .select("id,display_name,contact_email,status,auth_user_id,invite_sent_at,invite_reservation_id,invite_attempt_id,invite_attempt_started_at,updated_at")
    .eq("id", contactId)
    .maybeSingle();
  if (current.error) {
    if (isMissingNarratorContacts(current.error)) throw new NarratorAdminUnavailableError("The private narrator roster has not been installed yet.");
    throw new NarratorAdminUnavailableError(current.error.message);
  }
  if (!current.data) throw new NarratorAdminConflictError("That narrator contact no longer exists. Reload before inviting.");
  if (String(current.data.updated_at || "") !== expectedUpdatedAt) {
    throw new NarratorAdminConflictError("That narrator contact changed. Reload and check the address again.");
  }
  const contactEmail = optionalEmail(current.data.contact_email);
  if (!contactEmail || contactEmail !== confirmedEmail) {
    throw new NarratorAdminInputError("The confirmed email does not match the current narrator contact.");
  }
  const contactStatus = String(current.data.status || "contact");
  if (!INVITABLE_CONTACT_STATUSES.has(contactStatus)) {
    throw new NarratorAdminInputError("This narrator contact is not waiting for an invitation.");
  }

  const linkedUserId = String(current.data.auth_user_id || "");
  const linkedRepair = contactStatus === "repair-needed" && Boolean(linkedUserId);
  if (!linkedRepair && process.env.JJU_NARRATOR_INVITES_ENABLED !== "1") {
    throw new NarratorAdminUnavailableError("Narrator invitations are turned off. Turn on the separate invitation switch before sending one.");
  }
  if (!linkedRepair && contactStatus === "invite-pending") {
    const attemptStartedAt = new Date(String(current.data.invite_attempt_started_at || "")).getTime();
    if (Number.isFinite(attemptStartedAt) && Date.now() - attemptStartedAt < INVITE_RETRY_LEASE_MS) {
      throw new NarratorAdminConflictError("That invitation attempt is still in progress. No second email was started. Wait ten minutes from the first attempt before retrying.");
    }
  }

  let contactVersion = expectedUpdatedAt;
  let invitationReservationId = String(current.data.invite_reservation_id || "");
  let invitationAttemptId = "";
  if (!linkedRepair) {
    invitationReservationId ||= randomUUID();
    invitationAttemptId = randomUUID();
    const inviteAttemptStartedAt = new Date().toISOString();
    const reserved = await supabase
      .from("narrator_contacts")
      .update({
        status: "invite-pending",
        invite_reservation_id: invitationReservationId,
        invite_attempt_id: invitationAttemptId,
        invite_attempt_started_at: inviteAttemptStartedAt,
      })
      .eq("id", contactId)
      .eq("updated_at", expectedUpdatedAt)
      .eq("status", contactStatus)
      .is("auth_user_id", null)
      .select("id,status,invite_reservation_id,invite_attempt_id,invite_attempt_started_at,updated_at")
      .maybeSingle();
    if (reserved.error) throw new NarratorAdminUnavailableError(reserved.error.message);
    if (!reserved.data) {
      throw new NarratorAdminConflictError("That narrator contact changed before the invitation was reserved. No email was sent. Reload and check it again.");
    }
    contactVersion = String(reserved.data.updated_at || "");
  }

  async function releaseReservationForEdit(message: string): Promise<never> {
    if (linkedRepair) throw new NarratorAdminConflictError(message);
    const released = await supabase
      .from("narrator_contacts")
      .update({
        status: "contact",
        invite_reservation_id: null,
        invite_attempt_id: null,
        invite_attempt_started_at: null,
      })
      .eq("id", contactId)
      .eq("updated_at", contactVersion)
      .eq("status", "invite-pending")
      .is("auth_user_id", null)
      .eq("invite_attempt_id", invitationAttemptId)
      .select("id")
      .maybeSingle();
    const releaseNote = released.error || !released.data
      ? " The reserved roster row changed before it could be reopened; reload before doing anything else."
      : " The contact was reopened for editing, and no email was sent.";
    throw new NarratorAdminConflictError(`${message}${releaseNote}`);
  }

  let account: User | null = null;
  if (linkedUserId) {
    const linkedAccount = await supabase.auth.admin.getUserById(linkedUserId);
    const linkedEmail = String(linkedAccount.data.user?.email || "").trim().toLowerCase();
    if (linkedAccount.error || !linkedAccount.data.user || linkedEmail !== contactEmail) {
      throw new NarratorAdminConflictError("This roster contact is linked to a different or unavailable account. No invitation was sent.");
    }
    account = linkedAccount.data.user;
  } else {
    account = await findAuthAccountByEmail(contactEmail);
  }
  let invitationSent = false;
  if (!account) {
    const invited = await supabase.auth.admin.inviteUserByEmail(contactEmail, {
      redirectTo: `${SITE_URL}/narrator/welcome`,
      data: {
        jju_narrator_contact_id: contactId,
        jju_narrator_invite_reservation_id: invitationReservationId,
      },
    });
    if (invited.error || !invited.data.user) {
      throw new NarratorAdminUnavailableError(`${invited.error?.message || "The invitation could not be sent."} The roster kept this address reserved so a retry can recover safely.`);
    }
    account = invited.data.user;
    invitationSent = true;
  }

  const confirmedAt = String(account.email_confirmed_at || account.confirmed_at || "");
  const invitationMetadata = account.user_metadata || {};
  const invitationMatchesReservation = String(invitationMetadata.jju_narrator_contact_id || "") === contactId
    && String(invitationMetadata.jju_narrator_invite_reservation_id || "") === invitationReservationId;
  const invitationIssuedAt = new Date(String(account.confirmation_sent_at || account.invited_at || "")).getTime();
  const invitationAge = Date.now() - invitationIssuedAt;
  const invitationIsFresh = Number.isFinite(invitationIssuedAt)
    && invitationAge >= -(5 * 60 * 1000)
    && invitationAge < INVITE_RECOVERY_WINDOW_MS;
  const sameReservationInvitation = !confirmedAt
    && Boolean(account.invited_at)
    && (linkedRepair || invitationMatchesReservation);
  if (!invitationSent && sameReservationInvitation && !invitationIsFresh) {
    if (!linkedRepair) {
      const heldForRepair = await supabase
        .from("narrator_contacts")
        .update({
          auth_user_id: account.id,
          status: "repair-needed",
          invite_sent_at: String(account.confirmation_sent_at || account.invited_at || ""),
          invite_attempt_id: null,
          invite_attempt_started_at: null,
        })
        .eq("id", contactId)
        .eq("updated_at", contactVersion)
        .eq("status", "invite-pending")
        .is("auth_user_id", null)
        .eq("invite_attempt_id", invitationAttemptId)
        .select("id")
        .maybeSingle();
      if (heldForRepair.error || !heldForRepair.data) {
        throw new NarratorAdminUnavailableError("The matching invitation is too old to trust, and its safe repair state could not be recorded. Reload before doing anything else.");
      }
    }
    throw new NarratorAdminConflictError("The matching setup email is too old to trust. Send this account a fresh recovery email from the private Auth desk, let the narrator confirm it, then finish portal setup here. No email was sent now.");
  }
  const recoverableInvitation = !confirmedAt
    && sameReservationInvitation
    && invitationIsFresh;
  if (!invitationSent && !confirmedAt && !recoverableInvitation) {
    await releaseReservationForEdit("An unconfirmed JJ University account already uses this email. Resolve that account before linking narrator access.");
  }
  const existingProfile = await supabase
    .from("narrator_profiles")
    .select("user_id,status")
    .eq("user_id", account.id)
    .maybeSingle();
  if (existingProfile.error) throw new NarratorAdminUnavailableError(existingProfile.error.message);
  if (existingProfile.data && ["paused", "closed"].includes(String(existingProfile.data.status || ""))) {
    if (invitationSent) {
      throw new NarratorAdminUnavailableError("The invitation may have been sent, but that narrator profile is paused or closed. The reserved roster state was left intact for review.");
    }
    await releaseReservationForEdit("That account is paused or closed. Reopen it from the existing-account controls instead of sending an invitation.");
  }

  const awaitsConfirmation = invitationSent || recoverableInvitation;
  const nextStatus = awaitsConfirmation ? "invite-sent" : "active";
  const requestedProfileStatus = awaitsConfirmation ? "invited" : "active";
  const linkResult = await supabase.rpc("link_narrator_portal_contact", {
    p_contact_id: contactId,
    p_expected_updated_at: contactVersion,
    p_attempt_id: invitationAttemptId || null,
    p_user_id: account.id,
    p_display_name: String(current.data.display_name || "Narrator"),
    p_contact_email: contactEmail,
    p_contact_status: nextStatus,
    p_profile_status: requestedProfileStatus,
    p_invite_sent_at: awaitsConfirmation
      ? String(current.data.invite_sent_at || account.confirmation_sent_at || account.invited_at || new Date().toISOString())
      : null,
    p_invite_reservation_id: invitationReservationId || null,
    p_linked_repair: linkedRepair,
  });
  if (linkResult.error) {
    throw new NarratorAdminUnavailableError(`${invitationSent ? "The invitation may have been sent, but" : "The account was not linked because"} the atomic portal setup failed: ${linkResult.error.message}`);
  }
  const linkOutcome = String(linkResult.data || "contact-conflict");
  if (["profile-paused", "profile-closed"].includes(linkOutcome)) {
    if (!invitationSent && !linkedRepair) {
      await releaseReservationForEdit(`That account became ${linkOutcome.replace("profile-", "")} while portal setup was being linked. Reopen it from the existing-account controls first.`);
    }
    throw new NarratorAdminConflictError(`That narrator profile is ${linkOutcome.replace("profile-", "")}. Its access state was left unchanged.`);
  }
  if (linkOutcome !== "linked") {
    throw new NarratorAdminConflictError(`${invitationSent ? "The invitation may have been sent, but" : "The account was not linked because"} the reviewed roster state changed. Reload before trying anything else.`);
  }

  return {
    contactId,
    status: nextStatus,
    invitationSent,
    invitationRecovered: recoverableInvitation && !invitationSent,
    linkedExistingAccount: !awaitsConfirmation,
  };
}

export async function activateNarratorInvite(userIdValue: unknown) {
  if (!hasSupabaseAdminConfig()) return;
  const userId = requiredUuid(userIdValue, "Narrator account");
  const supabase = createSupabaseAdminClient();
  const activation = await supabase.rpc("activate_narrator_invite_contact", { p_user_id: userId });
  if (activation.error) {
    if (isMissingNarratorContacts(activation.error)) throw new NarratorAdminUnavailableError("The private narrator roster has not been installed yet.");
    throw new NarratorAdminUnavailableError(activation.error.message);
  }
  const outcome = String(activation.data || "not-ready");
  if (["active", "activated"].includes(outcome)) return;
  if (["paused", "closed"].includes(outcome)) {
    throw new NarratorAdminConflictError(`This narrator account is ${outcome}. Its administrative state was left unchanged.`);
  }
  if (outcome === "repair-needed") {
    throw new NarratorAdminUnavailableError("The narrator profile is missing or inconsistent. The roster is marked for repair.");
  }
  throw new NarratorAdminConflictError("This narrator invitation is not ready to activate.");
}

export async function saveNarratorProfile(input: {
  userId: unknown;
  displayName: unknown;
  status: unknown;
  expectedUpdatedAt?: unknown;
}) {
  if (!hasSupabaseAdminConfig()) throw new NarratorAdminUnavailableError("Supabase admin access is not configured.");
  const userId = requiredUuid(input.userId, "Account");
  const displayName = requiredText(input.displayName, "Display name", 80);
  const status = cleanText(input.status || "active", 24).toLowerCase();
  if (!PROFILE_STATUSES.has(status)) throw new NarratorAdminInputError("Narrator status is invalid.");

  const supabase = createSupabaseAdminClient();
  const userResult = await supabase.auth.admin.getUserById(userId);
  const user = userResult.data.user;
  if (userResult.error || !user?.email || !(user.email_confirmed_at || user.confirmed_at)) {
    throw new NarratorAdminInputError("Choose an existing confirmed account.");
  }

  const current = await supabase
    .from("narrator_profiles")
    .select("user_id,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (current.error) {
    if (isMissingAudioFoundation(current.error)) throw new NarratorAdminUnavailableError("The narrator profile table is unavailable.");
    throw new NarratorAdminUnavailableError(current.error.message);
  }

  if (current.data) {
    const expectedUpdatedAt = String(input.expectedUpdatedAt || "");
    if (!expectedUpdatedAt || expectedUpdatedAt !== String(current.data.updated_at || "")) {
      throw new NarratorAdminConflictError("That narrator profile changed. Reload before saving again.");
    }
    const updated = await supabase
      .from("narrator_profiles")
      .update({ display_name: displayName, contact_email: user.email, status })
      .eq("user_id", userId)
      .eq("updated_at", expectedUpdatedAt)
      .select("user_id,display_name,contact_email,status,updated_at")
      .maybeSingle();
    if (updated.error) throw new NarratorAdminUnavailableError(updated.error.message);
    if (!updated.data) throw new NarratorAdminConflictError("That narrator profile changed. Reload before saving again.");
    return updated.data;
  }

  if (String(input.expectedUpdatedAt || "")) {
    throw new NarratorAdminConflictError("That narrator profile no longer exists. Reload before saving again.");
  }
  const inserted = await supabase
    .from("narrator_profiles")
    .insert({ user_id: userId, display_name: displayName, contact_email: user.email, status })
    .select("user_id,display_name,contact_email,status,updated_at")
    .single();
  if (inserted.error) {
    if (String(inserted.error.code || "") === "23505") throw new NarratorAdminConflictError("That narrator was created elsewhere. Reload before editing.");
    throw new NarratorAdminUnavailableError(inserted.error.message);
  }
  return inserted.data;
}

export async function createNarratorAssignmentPlan(input: {
  userId: unknown;
  bookId: unknown;
  editionKey?: unknown;
  dueAt?: unknown;
  brief?: unknown;
}) {
  if (!hasSupabaseAdminConfig()) throw new NarratorAdminUnavailableError("Supabase admin access is not configured.");
  const userId = requiredUuid(input.userId, "Narrator");
  const bookId = requiredText(input.bookId, "Book", 160).toLowerCase();
  const editionKey = safeEditionKey(input.editionKey);
  const dueAt = optionalDate(input.dueAt);
  const brief = cleanText(input.brief, 4000);
  const supabase = createSupabaseAdminClient();

  const profileResult = await supabase
    .from("narrator_profiles")
    .select("user_id,display_name,status")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileResult.error) throw new NarratorAdminUnavailableError(profileResult.error.message);
  if (!profileResult.data || profileResult.data.status !== "active") {
    throw new NarratorAdminInputError("Activate that narrator before offering work.");
  }

  const catalog = await readAdminBookCatalog();
  const book = catalog.books.find(item => String(item.id || "").trim().toLowerCase() === bookId);
  if (!book) throw new NarratorAdminInputError("Choose a book from the current catalog.");
  const contentId = String(book.contentKey || book.id || "").replace(/\.json$/i, "");
  const resolved = await readAdminBookContent(contentId);
  if (!resolved.book.sections.length) throw new NarratorAdminInputError("That Reader manuscript has no sections.");
  if (resolved.book.sections.length > 500) throw new NarratorAdminInputError("That manuscript has too many sections for one assignment.");

  const seenSectionKeys = new Set<string>();
  const trackPlan = resolved.book.sections.map((section, index) => {
    const sectionKey = requiredText(section.id, `Reader section ${index + 1}`, 240);
    if (seenSectionKeys.has(sectionKey)) throw new NarratorAdminInputError(`Reader section key "${sectionKey}" is duplicated.`);
    seenSectionKeys.add(sectionKey);
    return {
      position: index + 1,
      sectionKey,
      title: requiredText(section.title || `Section ${index + 1}`, `Reader section ${index + 1} title`, 160),
    };
  });
  const snapshotSha256 = contentSha256(resolved.book);
  const sourceContentVersion = parseContentVersion(resolved.version);
  let createdEditionId = "";

  try {
    const editionResult = await supabase
      .from("audio_editions")
      .insert({
        book_id: String(book.id),
        source_content_version: sourceContentVersion,
        source_content_sha256: snapshotSha256,
        edition_key: editionKey,
        narrator_name: String(profileResult.data.display_name),
        language_code: String(resolved.book.language || "en").slice(0, 12),
        status: "planning",
        access_model: "free",
        description: `Narrator working edition pinned to Reader manuscript ${snapshotSha256.slice(0, 12)}.`,
      })
      .select("id")
      .single();
    if (editionResult.error || !editionResult.data?.id) {
      if (String(editionResult.error?.code || "") === "23505") {
        throw new NarratorAdminConflictError("That book already has this edition key. Choose another key or review the existing edition.");
      }
      throw new NarratorAdminUnavailableError(editionResult.error?.message || "Could not create the edition.");
    }
    createdEditionId = String(editionResult.data.id);

    const tracksResult = await supabase.from("audio_tracks").insert(trackPlan.map(track => ({
      edition_id: createdEditionId,
      position: track.position,
      title: track.title,
      section_key: track.sectionKey,
      required_for_submission: true,
      storage_bucket: "audiobooks",
      storage_path: "",
      mime_type: "audio/mpeg",
      status: "expected",
    })));
    if (tracksResult.error) throw new NarratorAdminUnavailableError(`Could not create the Reader track plan: ${tracksResult.error.message}`);

    const assignmentResult = await supabase
      .from("narrator_assignments")
      .insert({
        edition_id: createdEditionId,
        narrator_user_id: userId,
        status: "offered",
        due_at: dueAt,
        narrator_brief: brief,
      })
      .select("id")
      .single();
    if (assignmentResult.error || !assignmentResult.data?.id) {
      throw new NarratorAdminUnavailableError(assignmentResult.error?.message || "Could not offer the assignment.");
    }

    return {
      editionId: createdEditionId,
      assignmentId: String(assignmentResult.data.id),
      trackCount: trackPlan.length,
      sourceContentVersion,
      sourceContentSha256: snapshotSha256,
    };
  } catch (error) {
    if (createdEditionId) {
      const rollback = await supabase
        .from("audio_editions")
        .delete()
        .eq("id", createdEditionId)
        .eq("status", "planning")
        .select("id");
      if (rollback.error || rollback.data?.length !== 1) {
        throw new NarratorAdminUnavailableError(`Assignment setup stopped, and automatic cleanup could not be verified for edition ${createdEditionId}. No retry was attempted. Inspect that edition before doing anything else.`);
      }
    }
    throw error;
  }
}

export async function reviewNarratorSubmission(input: {
  submissionId: unknown;
  expectedUpdatedAt: unknown;
  decision: unknown;
  narratorFeedback?: unknown;
  reviewNote?: unknown;
}) {
  if (!hasSupabaseAdminConfig()) throw new NarratorAdminUnavailableError("Supabase admin access is not configured.");
  const submissionId = requiredUuid(input.submissionId, "Submission");
  const expectedUpdatedAt = requiredText(input.expectedUpdatedAt, "Submission version", 80);
  const decision = cleanText(input.decision, 32).toLowerCase();
  if (!['approve', 'request-changes'].includes(decision)) throw new NarratorAdminInputError("Review decision is invalid.");
  const narratorFeedback = cleanText(input.narratorFeedback, 2000);
  const reviewNote = cleanText(input.reviewNote, 2000);
  if (decision === "request-changes" && !narratorFeedback) {
    throw new NarratorAdminInputError("Tell the narrator what needs to change.");
  }
  const supabase = createSupabaseAdminClient();
  const current = await supabase
    .from("narrator_submissions")
    .select("id,assignment_id,upload_status,updated_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (current.error) throw new NarratorAdminUnavailableError(current.error.message);
  if (!current.data) throw new NarratorAdminInputError("Submission not found.");
  if (String(current.data.updated_at || "") !== expectedUpdatedAt) {
    throw new NarratorAdminConflictError("That recording changed. Reload and listen to the current version before reviewing it.");
  }
  const currentStatus = String(current.data.upload_status || "");
  if (!REVIEWABLE_STATUSES.has(currentStatus)) {
    throw new NarratorAdminConflictError("That recording is not in a reviewable state.");
  }

  let assignmentRollback: { status: string; updatedAt: string } | null = null;
  const assignmentId = requiredUuid(current.data.assignment_id, "Assignment");
  if (decision === "request-changes") {
    const assignment = await supabase
      .from("narrator_assignments")
      .select("id,status,updated_at")
      .eq("id", assignmentId)
      .maybeSingle();
    if (assignment.error) throw new NarratorAdminUnavailableError(assignment.error.message);
    if (!assignment.data || !["submitted", "recording", "changes-requested"].includes(String(assignment.data.status || ""))) {
      throw new NarratorAdminConflictError("The assignment is no longer open for requested changes.");
    }
    const previousStatus = String(assignment.data.status || "");
    if (previousStatus !== "changes-requested") {
      const moved = await supabase
        .from("narrator_assignments")
        .update({ status: "changes-requested" })
        .eq("id", assignmentId)
        .eq("updated_at", String(assignment.data.updated_at || ""))
        .select("updated_at")
        .maybeSingle();
      if (moved.error) throw new NarratorAdminUnavailableError(moved.error.message);
      if (!moved.data) throw new NarratorAdminConflictError("The assignment changed. Reload before requesting changes.");
      assignmentRollback = { status: previousStatus, updatedAt: String(moved.data.updated_at || "") };
    }
  }

  const nextStatus = decision === "approve" ? "approved" : "changes-requested";
  const reviewed = await supabase
    .from("narrator_submissions")
    .update({
      upload_status: nextStatus,
      narrator_feedback: narratorFeedback,
      review_note: reviewNote,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", submissionId)
    .eq("updated_at", expectedUpdatedAt)
    .in("upload_status", [...REVIEWABLE_STATUSES])
    .select("id,upload_status,updated_at")
    .maybeSingle();

  if (reviewed.error || !reviewed.data) {
    if (assignmentRollback) {
      const rollback = await supabase
        .from("narrator_assignments")
        .update({ status: assignmentRollback.status })
        .eq("id", assignmentId)
        .eq("updated_at", assignmentRollback.updatedAt)
        .eq("status", "changes-requested")
        .select("id");
      if (rollback.error || rollback.data?.length !== 1) {
        throw new NarratorAdminUnavailableError(`The recording review stopped, and assignment ${assignmentId} could not be restored automatically. Reload before taking another action.`);
      }
    }
    if (reviewed.error) throw new NarratorAdminUnavailableError(reviewed.error.message);
    throw new NarratorAdminConflictError("That recording changed. Reload and review the current version.");
  }
  return reviewed.data;
}

export async function createNarratorSubmissionListenUrl(submissionIdValue: unknown) {
  if (!hasSupabaseAdminConfig()) throw new NarratorAdminUnavailableError("Supabase admin access is not configured.");
  const submissionId = requiredUuid(submissionIdValue, "Submission");
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("narrator_submissions")
    .select("id,assignment_id,narrator_user_id,audio_track_id,storage_bucket,storage_path,upload_status")
    .eq("id", submissionId)
    .in("upload_status", ["uploaded", "in-review", "changes-requested", "approved", "superseded"])
    .maybeSingle();
  if (result.error) throw new NarratorAdminUnavailableError(result.error.message);
  if (!result.data) throw new NarratorAdminInputError("Recording is not available.");

  const assignmentId = requiredUuid(result.data.assignment_id, "Assignment");
  const narratorUserId = requiredUuid(result.data.narrator_user_id, "Narrator");
  const audioTrackId = requiredUuid(result.data.audio_track_id, "Audio track");
  const [assignment, track] = await Promise.all([
    supabase
      .from("narrator_assignments")
      .select("id,edition_id,narrator_user_id")
      .eq("id", assignmentId)
      .eq("narrator_user_id", narratorUserId)
      .maybeSingle(),
    supabase
      .from("audio_tracks")
      .select("id,edition_id")
      .eq("id", audioTrackId)
      .maybeSingle(),
  ]);
  if (assignment.error || track.error) throw new NarratorAdminUnavailableError("The recording links could not be verified.");
  if (!assignment.data || !track.data || String(assignment.data.edition_id || "") !== String(track.data.edition_id || "")) {
    throw new NarratorAdminInputError("Recording assignment links are invalid.");
  }
  const bucket = String(result.data.storage_bucket || "");
  const storagePath = String(result.data.storage_path || "");
  const prefix = `${narratorUserId}/${assignmentId}/`;
  const fileName = storagePath.startsWith(prefix) ? storagePath.slice(prefix.length) : "";
  if (bucket !== INTAKE_BUCKET || !fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new NarratorAdminInputError("Recording storage target is invalid.");
  }

  const signed = await supabase.storage.from(INTAKE_BUCKET).createSignedUrl(storagePath, 5 * 60);
  if (signed.error || !signed.data?.signedUrl) throw new NarratorAdminUnavailableError("The private recording could not be opened.");
  return signed.data.signedUrl;
}
