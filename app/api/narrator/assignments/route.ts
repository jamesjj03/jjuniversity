import { NextResponse } from "next/server";
import { narratorPortalEnabled } from "@/lib/narratorPortal";
import { createSupabaseRequestClient, hasSupabaseServerConfig } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function rpcStatus(code: string | undefined) {
  if (code === "42501") return 403;
  if (code === "40001" || code === "55000") return 409;
  return 500;
}

export async function POST(request: Request) {
  if (!narratorPortalEnabled() || !hasSupabaseServerConfig()) {
    return response({ error: "Not found." }, 404);
  }

  const supabase = await createSupabaseRequestClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email_confirmed_at) return response({ error: "Sign in first." }, 401);

  const body = await request.json().catch(() => null) as { assignmentId?: unknown; action?: unknown } | null;
  const assignmentId = String(body?.assignmentId || "");
  const action = String(body?.action || "");
  if (!UUID_PATTERN.test(assignmentId) || !["accept", "submit"].includes(action)) {
    return response({ error: "Invalid assignment action." }, 400);
  }

  const rpcResult = action === "accept"
    ? await supabase.rpc("narrator_accept_assignment", { p_assignment_id: assignmentId })
    : await supabase.rpc("narrator_submit_assignment", { p_assignment_id: assignmentId });
  if (rpcResult.error) {
    return response({ error: rpcResult.error.message || "That assignment could not be updated." }, rpcStatus(rpcResult.error.code));
  }

  const result = rpcResult.data && typeof rpcResult.data === "object"
    ? rpcResult.data as Record<string, unknown>
    : null;
  const expectedStatus = action === "accept" ? "accepted" : "submitted";
  if (String(result?.assignment_id || "") !== assignmentId || String(result?.status || "") !== expectedStatus) {
    return response({ error: "The assignment transition was not confirmed." }, 409);
  }

  return response({ ok: true, status: expectedStatus }, 200);
}
