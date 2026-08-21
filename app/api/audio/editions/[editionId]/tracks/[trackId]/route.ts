import { NextResponse } from "next/server";
import { getAudioStreamRecord } from "@/lib/audioCatalog";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { createSupabaseRequestClient, hasSupabaseServerConfig } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ editionId: string; trackId: string }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(status = 404) {
  return NextResponse.json(
    { error: "Audio is not available." },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
export async function GET(_request: Request, { params }: Context) {
  const { editionId, trackId } = await params;
  if (!UUID_PATTERN.test(editionId) || !UUID_PATTERN.test(trackId)) return unavailable();

  const record = await getAudioStreamRecord(editionId, trackId).catch(() => null);
  if (!record || !hasSupabaseAdminConfig()) return unavailable();

  if (record.accessModel === "subscription") {
    // Subscription entitlements do not exist yet. Fail closed until they do.
    return unavailable(403);
  }

  if (record.accessModel === "account") {
    if (!hasSupabaseServerConfig()) return unavailable(503);
    const supabase = await createSupabaseRequestClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email_confirmed_at) return unavailable(401);
  }

  const admin = createSupabaseAdminClient();
  const signed = await admin.storage
    .from(record.storageBucket)
    .createSignedUrl(record.storagePath, 15 * 60);

  if (signed.error || !signed.data?.signedUrl) return unavailable();

  const response = NextResponse.redirect(signed.data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
