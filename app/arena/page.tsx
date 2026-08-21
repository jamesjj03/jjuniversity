import RecallArenaClient from "@/components/RecallArenaClient";
import { getAdminHref } from "@/lib/adminPath";
import { getRecallPacks } from "@/lib/recall";

export const metadata = {
  title: "Recall Arena | JJ University",
  description: "A visual recall game loop for JJ University.",
};

export default async function ArenaPage() {
  const packs = await getRecallPacks(["brain-lateral-source-v1"]);
  return <RecallArenaClient packs={packs} factoryHref={getAdminHref("/admin/arena")} />;
}
