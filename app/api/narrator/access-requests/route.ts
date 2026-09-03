import { NextResponse } from "next/server";
import { after } from "next/server";
import {
  narratorAccessRequestsEnabled,
  narratorRequesterFingerprint,
  NarratorRequestInputError,
  NarratorRequestUnavailableError,
  notifyNarratorAccessRequestOwner,
  submitNarratorAccessRequest,
} from "@/lib/narratorAccessRequests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

type RequestBody = {
  displayName?: unknown;
  contactEmail?: unknown;
  note?: unknown;
  website?: unknown;
};

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: RESPONSE_HEADERS });
}

export async function POST(request: Request) {
  if (!narratorAccessRequestsEnabled()) {
    return json({ error: "Narrator requests are not open yet." }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return json({ error: "That request is too large." }, 413);
  }

  try {
    const body = await request.json().catch(() => null) as RequestBody | null;
    if (!body) return json({ error: "Enter your name and email address." }, 400);

    // Quietly accept bot-filled forms so the field cannot be used to probe the
    // protection. Nothing is stored and no notification is sent.
    if (String(body.website || "").trim()) {
      return json({ ok: true, accepted: true }, 202);
    }

    const result = await submitNarratorAccessRequest({
      displayName: body.displayName,
      contactEmail: body.contactEmail,
      note: body.note,
      requesterFingerprint: narratorRequesterFingerprint(request),
    });
    if (result.notificationRequestId) {
      after(() => notifyNarratorAccessRequestOwner(result.notificationRequestId));
    }
    return json({ ok: true, accepted: true }, 202);
  } catch (error) {
    if (error instanceof NarratorRequestInputError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof NarratorRequestUnavailableError) {
      return json({ error: error.message }, 503);
    }
    return json({ error: "The request could not be saved safely." }, 503);
  }
}
