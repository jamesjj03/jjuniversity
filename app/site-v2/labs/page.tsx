import type { Metadata } from "next";
import RecallArenaClient from "@/components/RecallArenaClient";
import { getRecallPacks } from "@/lib/recall";

export const metadata: Metadata = {
  title: "Labs",
  description: "Visual practice for recognition and recall.",
};

export default async function SiteV2LabsPage() {
  const packs = await getRecallPacks(["brain-lateral-source-v1"]);
  return <RecallArenaClient packs={packs} variant="site-v2" factoryHref={null} />;
}
