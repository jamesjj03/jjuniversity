import RecallArenaClient from "@/components/RecallArenaClient";
import { getRecallPack } from "@/lib/recall";

export const metadata = {
  title: "Recall Arena | JJ University",
  description: "A visual recall game loop for JJ University.",
};

export default async function ArenaPage() {
  const pack = await getRecallPack("brain-intro");
  return <RecallArenaClient pack={pack} />;
}
