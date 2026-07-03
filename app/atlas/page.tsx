import AtlasMapsClient from "@/components/AtlasMapsClient";
import { getAtlasMaps } from "@/lib/atlasMaps";

export const metadata = {
  title: "Atlas Maps | JJ University",
  description: "Branching maps of theories, people, schools, and influence networks across JJ University.",
};

export default function AtlasPage() {
  return <AtlasMapsClient data={getAtlasMaps()} />;
}
