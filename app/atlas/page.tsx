import AtlasMapsClient from "@/components/AtlasMapsClient";
import { getAtlasMapsWithFallback } from "@/lib/atlasMapStore";

export const metadata = {
  title: "Atlas Maps | JJ University",
  description: "Branching maps of theories, people, schools, and influence networks across JJ University.",
};

export default async function AtlasPage() {
  return <AtlasMapsClient data={await getAtlasMapsWithFallback()} />;
}
