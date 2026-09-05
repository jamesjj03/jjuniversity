import type { Metadata } from "next";
import AtlasIndex from "@/components/atlas-world/AtlasIndex";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = {
  title: "Atlas Index",
  description: "Plain-language definitions, methods, caveats, and sources for reading JJ University Atlas.",
};

export default function AtlasIndexPage() {
  return (
    <SiteV2Shell>
      <AtlasIndex />
    </SiteV2Shell>
  );
}
