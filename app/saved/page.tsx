import type { Metadata } from "next";
import SiteV2SavedPage, { metadata as siteV2Metadata } from "@/app/site-v2/saved/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = siteV2Metadata;

export default function SavedPage() {
  return (
    <SiteV2Shell>
      <SiteV2SavedPage />
    </SiteV2Shell>
  );
}
