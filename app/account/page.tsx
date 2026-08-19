import type { Metadata } from "next";
import SiteV2AccountPage, { metadata as siteV2Metadata } from "@/app/site-v2/account/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = siteV2Metadata;

export default function AccountPage(props: Props) {
  return (
    <SiteV2Shell>
      <SiteV2AccountPage {...props} />
    </SiteV2Shell>
  );
}
