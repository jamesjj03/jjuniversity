import { NextResponse } from "next/server";
import {
  createNarratorAssignmentPlan,
  inviteNarratorContact,
  NarratorAdminConflictError,
  NarratorAdminInputError,
  NarratorAdminUnavailableError,
  reviewNarratorAccessRequest,
  reviewNarratorSubmission,
  saveNarratorContact,
  saveNarratorProfile,
} from "@/lib/narratorAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

type RequestBody = {
  action?: unknown;
  contactId?: unknown;
  contactEmail?: unknown;
  source?: unknown;
  notes?: unknown;
  confirmedEmail?: unknown;
  userId?: unknown;
  displayName?: unknown;
  status?: unknown;
  expectedUpdatedAt?: unknown;
  bookId?: unknown;
  editionKey?: unknown;
  dueAt?: unknown;
  brief?: unknown;
  submissionId?: unknown;
  decision?: unknown;
  narratorFeedback?: unknown;
  reviewNote?: unknown;
  requestId?: unknown;
};

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: PRIVATE_HEADERS });
}

function errorResponse(error: unknown) {
  if (error instanceof NarratorAdminInputError) return json({ error: error.message }, 400);
  if (error instanceof NarratorAdminConflictError) return json({ error: error.message }, 409);
  if (error instanceof NarratorAdminUnavailableError) return json({ error: error.message }, 503);
  return json({ error: error instanceof Error ? error.message : "Narrator action failed safely." }, 500);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as RequestBody | null;
    if (!body) return json({ error: "Invalid request." }, 400);
    const action = String(body.action || "");

    if (action === "save-contact") {
      const contact = await saveNarratorContact({
        contactId: body.contactId,
        displayName: body.displayName,
        contactEmail: body.contactEmail,
        source: body.source,
        notes: body.notes,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
      return json({ ok: true, contact }, body.contactId ? 200 : 201);
    }

    if (action === "review-access-request") {
      const review = await reviewNarratorAccessRequest({
        requestId: body.requestId,
        expectedUpdatedAt: body.expectedUpdatedAt,
        decision: body.decision,
      });
      return json({ ok: true, review });
    }

    if (action === "invite-contact") {
      const invitation = await inviteNarratorContact({
        contactId: body.contactId,
        expectedUpdatedAt: body.expectedUpdatedAt,
        confirmedEmail: body.confirmedEmail,
      });
      return json({ ok: true, invitation }, invitation.invitationSent ? 201 : 200);
    }

    if (action === "save-profile") {
      const profile = await saveNarratorProfile({
        userId: body.userId,
        displayName: body.displayName,
        status: body.status,
        expectedUpdatedAt: body.expectedUpdatedAt,
      });
      return json({ ok: true, profile });
    }

    if (action === "create-assignment-plan") {
      const plan = await createNarratorAssignmentPlan({
        userId: body.userId,
        bookId: body.bookId,
        editionKey: body.editionKey,
        dueAt: body.dueAt,
        brief: body.brief,
      });
      return json({ ok: true, plan }, 201);
    }

    if (action === "review-submission") {
      const submission = await reviewNarratorSubmission({
        submissionId: body.submissionId,
        expectedUpdatedAt: body.expectedUpdatedAt,
        decision: body.decision,
        narratorFeedback: body.narratorFeedback,
        reviewNote: body.reviewNote,
      });
      return json({ ok: true, submission });
    }

    return json({ error: "Unknown narrator action." }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}
