import type { Metadata } from "next";
import AtlasMapsClient from "@/components/AtlasMapsClient";
import { getAtlasMapsWithFallback } from "@/lib/atlasMapStore";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Maps of the connections between fields, theories, people, and schools.",
};

export default async function SiteV2AtlasPage() {
  return <AtlasMapsClient data={await getAtlasMapsWithFallback()} variant="site-v2" />;
}
