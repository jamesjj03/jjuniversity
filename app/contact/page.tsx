import type { Metadata } from "next";
import SiteV2ContactPage, { metadata as siteV2Metadata } from "@/app/site-v2/contact/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

export const metadata: Metadata = { ...siteV2Metadata, robots: undefined };

export default function ContactPage() {
  return (
    <SiteV2Shell>
      <SiteV2ContactPage />
    </SiteV2Shell>
  );
}
