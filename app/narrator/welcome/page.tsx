import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { activateNarratorInvite } from "@/lib/narratorAdmin";
import { getNarratorPortalData, narratorPortalEnabled } from "@/lib/narratorPortal";
import { createSupabaseRequestClient, hasSupabaseServerConfig } from "@/lib/supabaseServer";
import NarratorWelcomeClient from "./NarratorWelcomeClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your narrator desk",
  description: "Finish setting up a private JJ University narrator account.",
  robots: { index: false, follow: false },
};

export default async function NarratorWelcomePage() {
  if (!narratorPortalEnabled() || !hasSupabaseServerConfig()) notFound();

  const supabase = await createSupabaseRequestClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email_confirmed_at) redirect("/account?next=/narrator/welcome");

  await activateNarratorInvite(data.user.id);
  const portal = await getNarratorPortalData(data.user.id);
  if (!portal) notFound();

  return <NarratorWelcomeClient displayName={portal.displayName} email={data.user.email || ""} />;
}
