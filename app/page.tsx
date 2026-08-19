import type { Metadata } from "next";
import SiteV2HomePage, { metadata as siteV2Metadata } from "@/app/site-v2/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = { ...siteV2Metadata, robots: undefined };

export default function HomePage() {
  return (
    <SiteV2Shell>
      <SiteV2HomePage />
    </SiteV2Shell>
  );
}
