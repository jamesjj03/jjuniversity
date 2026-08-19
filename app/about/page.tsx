import type { Metadata } from "next";
import SiteV2AboutPage, { metadata as siteV2Metadata } from "@/app/site-v2/about/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = { ...siteV2Metadata, robots: undefined };

export default function AboutPage() {
  return (
    <SiteV2Shell>
      <SiteV2AboutPage />
    </SiteV2Shell>
  );
}
