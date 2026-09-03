import "server-only";

import { createHmac } from "node:crypto";
import { SITE_URL } from "@/lib/publishing";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

type Row = Record<string, unknown>;

export class NarratorRequestInputError extends Error {}
export class NarratorRequestUnavailableError extends Error {}

export function narratorAccessRequestsEnabled() {
  return process.env.JJU_NARRATOR_ACCESS_REQUESTS_ENABLED === "1"
    && Boolean(process.env.JJU_NARRATOR_REQUEST_HASH_SECRET?.trim())
    && hasSupabaseAdminConfig();
}

function narratorRequestResendKey() {
  const explicit = process.env.RESEND_API_KEY?.trim() || "";
  if (explicit) return explicit;
  const usesResendSmtp = process.env.SUPABASE_SMTP_HOST?.trim().toLowerCase() === "smtp.resend.com"
    && process.env.SUPABASE_SMTP_USER?.trim().toLowerCase() === "resend";
  return usesResendSmtp ? process.env.SUPABASE_SMTP_PASS?.trim() || "" : "";
}

function narratorRequestFromEmail() {
  const explicit = process.env.JJU_NARRATOR_REQUEST_FROM_EMAIL?.trim() || "";
  if (explicit) return explicit;
  const email = process.env.SUPABASE_SMTP_ADMIN_EMAIL?.trim() || "";
  const senderName = (process.env.SUPABASE_SMTP_SENDER_NAME?.trim() || "JJ University")
    .replace(/[<>\r\n]/g, "")
    .slice(0, 80);
  return email ? `${senderName} <${email}>` : "";
}

export function narratorRequestNotificationConfigured() {
  return Boolean(
    narratorRequestResendKey()
    && process.env.JJU_NARRATOR_REQUEST_NOTIFY_EMAIL?.trim()
    && narratorRequestFromEmail(),
  );
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validatedEmail(value: unknown) {
  const email = cleanText(value, 254).toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    throw new NarratorRequestInputError("Enter a valid email address.");
  }
  return email;
}

export function narratorRequesterFingerprint(request: Request) {
  const secret = process.env.JJU_NARRATOR_REQUEST_HASH_SECRET?.trim() || "";
  if (!secret) throw new NarratorRequestUnavailableError("Narrator requests are not configured.");
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")
    || "unknown";
  const address = forwarded.split(",", 1)[0]?.trim().slice(0, 180) || "unknown";
  return createHmac("sha256", secret).update(address).digest("hex");
}

function isMissingRequestFoundation(error: unknown) {
  const row = error && typeof error === "object" ? error as Row : {};
  const code = String(row.code || "");
  const message = String(row.message || "");
  return code === "42P01"
    || code === "PGRST202"
    || code === "PGRST205"
    || /narrator_access_request/i.test(message)
    || /submit_narrator_access_request/i.test(message);
}

async function markNotificationResult(requestId: string, input: { sent: boolean; error?: string }) {
  const supabase = createSupabaseAdminClient();
  const result = await supabase
    .from("narrator_access_requests")
    .update(input.sent
      ? {
        notification_status: "sent",
        notification_sent_at: new Date().toISOString(),
        notification_last_error: "",
      }
      : {
        notification_status: "failed",
        notification_last_error: cleanText(input.error || "Notification delivery failed.", 500),
      })
    .eq("id", requestId)
    .eq("notification_status", "sending");
  if (result.error && !isMissingRequestFoundation(result.error)) {
    console.error("Could not record narrator request notification state:", result.error.message);
  }
}

export async function notifyNarratorAccessRequestOwner(requestId: string) {
  if (!narratorRequestNotificationConfigured()) return;

  const supabase = createSupabaseAdminClient();
  const claim = await supabase.rpc("claim_narrator_access_notification", {
    p_request_id: requestId,
  });
  if (claim.error) {
    if (!isMissingRequestFoundation(claim.error)) {
      console.error("Could not claim narrator request notification:", claim.error.message);
    }
    return;
  }
  if (claim.data !== true) return;

  const savedRequest = await supabase
    .from("narrator_access_requests")
    .select("display_name,contact_email,note")
    .eq("id", requestId)
    .maybeSingle();
  if (savedRequest.error || !savedRequest.data) {
    await markNotificationResult(requestId, {
      sent: false,
      error: savedRequest.error?.message || "The saved request could not be loaded for notification.",
    });
    return;
  }

  const displayName = String(savedRequest.data.display_name || "Narrator");
  const contactEmail = String(savedRequest.data.contact_email || "");
  const note = String(savedRequest.data.note || "") || "No note included.";

  const destination = process.env.JJU_NARRATOR_REQUEST_NOTIFY_EMAIL?.trim() || "";
  const from = narratorRequestFromEmail();
  const text = [
    "A narrator asked for access to the JJ University workroom.",
    "",
    `Name: ${displayName}`,
    `Email: ${contactEmail}`,
    `Note: ${note}`,
    "",
    `Review the request: ${SITE_URL}/admin/narrators`,
    "",
    "No portal invitation has been sent.",
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${narratorRequestResendKey()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `jju-narrator-request/${requestId}`,
      },
      body: JSON.stringify({
        from,
        to: [destination],
        subject: `Narrator access request from ${displayName}`,
        text,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const detail = cleanText(await response.text().catch(() => ""), 300);
      throw new Error(detail || `Email provider returned ${response.status}.`);
    }
    await markNotificationResult(requestId, { sent: true });
  } catch (error) {
    await markNotificationResult(requestId, {
      sent: false,
      error: error instanceof Error ? error.message : "Notification delivery failed.",
    });
  }
}

export async function submitNarratorAccessRequest(input: {
  displayName: unknown;
  contactEmail: unknown;
  note?: unknown;
  requesterFingerprint: string;
}) {
  if (!narratorAccessRequestsEnabled()) {
    throw new NarratorRequestUnavailableError("Narrator requests are not open yet.");
  }

  const displayName = cleanText(input.displayName, 80);
  const contactEmail = validatedEmail(input.contactEmail);
  const note = cleanText(input.note, 600);
  if (!displayName) throw new NarratorRequestInputError("Enter your name.");
  if (!FINGERPRINT_PATTERN.test(input.requesterFingerprint)) {
    throw new NarratorRequestUnavailableError("Narrator requests are not configured.");
  }

  const supabase = createSupabaseAdminClient();
  const result = await supabase.rpc("submit_narrator_access_request", {
    p_display_name: displayName,
    p_contact_email: contactEmail,
    p_note: note,
    p_requester_fingerprint: input.requesterFingerprint,
  });
  if (result.error) {
    if (isMissingRequestFoundation(result.error)) {
      throw new NarratorRequestUnavailableError("Narrator requests are not open yet.");
    }
    throw new NarratorRequestUnavailableError("The request could not be saved safely.");
  }

  const requestId = String(result.data || "");
  if (!requestId) {
    // Invalid and throttled requests receive the same public response. That
    // avoids exposing the rate-limit state or whether an email is known.
    return { accepted: true, notificationRequestId: "" };
  }

  return {
    accepted: true,
    notificationRequestId: requestId,
  };
}
