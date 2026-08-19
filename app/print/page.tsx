import type { Metadata } from "next";
import SiteV2PrintPage, { metadata as siteV2Metadata } from "@/app/site-v2/print/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = { ...siteV2Metadata, robots: undefined };

export default function PrintPage() {
  return (
    <SiteV2Shell>
      <SiteV2PrintPage />
    </SiteV2Shell>
  );
}
