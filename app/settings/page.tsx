import type { Metadata } from "next";
import SiteV2SettingsPage, { metadata as siteV2Metadata } from "@/app/site-v2/settings/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = siteV2Metadata;

export default function SettingsPage() {
  return (
    <SiteV2Shell>
      <SiteV2SettingsPage />
    </SiteV2Shell>
  );
}
