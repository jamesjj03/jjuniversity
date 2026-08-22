import { NextResponse } from "next/server";
import { narratorPortalEnabled } from "@/lib/narratorPortal";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { createSupabaseRequestClient, hasSupabaseServerConfig } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ submissionId: string }>;
};

const INTAKE_BUCKET = "narrator-audio-intake";
const SIGNED_URL_SECONDS = 5 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LISTENABLE_UPLOAD_STATUSES = ["uploaded", "in-review", "changes-requested", "approved", "superseded"];

function unavailable(status = 404) {
  return NextResponse.json(
    { error: "Recording is not available." },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

function hasExpectedPath(path: string, userId: string, assignmentId: string) {
  const prefix = `${userId}/${assignmentId}/`;
  if (!path.startsWith(prefix)) return false;
  const fileName = path.slice(prefix.length);
  return Boolean(fileName) && !fileName.includes("/") && !fileName.includes("\\");
}

export async function GET(_request: Request, { params }: Context) {
  if (!narratorPortalEnabled() || !hasSupabaseServerConfig() || !hasSupabaseAdminConfig()) {
    return unavailable();
  }

  const { submissionId } = await params;
  if (!UUID_PATTERN.test(submissionId)) return unavailable();

  const supabase = await createSupabaseRequestClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user?.email_confirmed_at) return unavailable(401);

  const submissionResult = await supabase
    .from("narrator_submissions")
    .select("id,assignment_id,narrator_user_id,storage_bucket,storage_path,upload_status")
    .eq("id", submissionId)
    .eq("narrator_user_id", user.id)
    .in("upload_status", LISTENABLE_UPLOAD_STATUSES)
    .maybeSingle();
  if (submissionResult.error || !submissionResult.data) return unavailable();

  const assignmentId = String(submissionResult.data.assignment_id || "");
  const [profileResult, assignmentResult] = await Promise.all([
    supabase
      .from("narrator_profiles")
      .select("user_id,status")
      .eq("user_id", user.id)
      .in("status", ["active", "paused"])
      .maybeSingle(),
    supabase
      .from("narrator_assignments")
      .select("id,narrator_user_id")
      .eq("id", assignmentId)
      .eq("narrator_user_id", user.id)
      .maybeSingle(),
  ]);
  if (profileResult.error || assignmentResult.error || !profileResult.data || !assignmentResult.data) {
    return unavailable(403);
  }

  const storageBucket = String(submissionResult.data.storage_bucket || "");
  const storagePath = String(submissionResult.data.storage_path || "");
  if (storageBucket !== INTAKE_BUCKET || !hasExpectedPath(storagePath, user.id, assignmentId)) {
    return unavailable();
  }

  const signed = await createSupabaseAdminClient().storage
    .from(INTAKE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) return unavailable(503);

  const response = NextResponse.redirect(signed.data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
