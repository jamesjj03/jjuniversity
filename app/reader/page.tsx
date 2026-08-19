import type { Metadata } from "next";
import SiteV2ReaderPage, { metadata as siteV2Metadata } from "@/app/site-v2/reader/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  searchParams: Promise<{ book?: string | string[]; restart?: string | string[] }>;
};

export const metadata: Metadata = siteV2Metadata;

export default function ReaderPage(props: Props) {
  return (
    <SiteV2Shell>
      <SiteV2ReaderPage {...props} />
    </SiteV2Shell>
  );
}
