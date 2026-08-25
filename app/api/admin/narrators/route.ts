import { NextResponse } from "next/server";
import {
  createNarratorAssignmentPlan,
  NarratorAdminConflictError,
  NarratorAdminInputError,
  NarratorAdminUnavailableError,
  reviewNarratorSubmission,
  saveNarratorProfile,
} from "@/lib/narratorAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

type RequestBody = {
  action?: unknown;
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
