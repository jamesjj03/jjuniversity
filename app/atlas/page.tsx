import AtlasMapsClient from "@/components/AtlasMapsClient";
import { getAtlasMapsWithFallback } from "@/lib/atlasMapStore";

export const metadata = {
  title: "Atlas Maps | JJ University",
  description: "Branching maps of theories, people, schools, and influence networks across JJ University.",
};

// Atlas reads mutable published maps from Supabase. Render per request so the
// HTML and hydration payload always share one data snapshot.
export const dynamic = "force-dynamic";

export default async function AtlasPage() {
  return <AtlasMapsClient data={await getAtlasMapsWithFallback()} />;
}
