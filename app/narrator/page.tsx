import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import NarratorPortalClient from "./NarratorPortalClient";
import { getNarratorPortalData, narratorPortalEnabled } from "@/lib/narratorPortal";
import { getNarratorPortalPreviewData } from "@/lib/narratorPortalPreview";
import { createSupabaseRequestClient, hasSupabaseServerConfig } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Narrator desk",
  description: "Private JJ University narrator workspace.",
  robots: { index: false, follow: false },
};

export default async function NarratorPage() {
  if (process.env.NODE_ENV === "development" && process.env.JJU_NARRATOR_LOCAL_PREVIEW !== "0") {
    return <NarratorPortalClient initialData={getNarratorPortalPreviewData()} previewMode />;
  }

  if (!narratorPortalEnabled() || !hasSupabaseServerConfig()) notFound();

  const supabase = await createSupabaseRequestClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email_confirmed_at) redirect("/account?next=/narrator");

  const portal = await getNarratorPortalData(data.user.id).catch(() => null);
  if (!portal) notFound();

  return <NarratorPortalClient initialData={portal} />;
}
