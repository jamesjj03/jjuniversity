import type { Metadata } from "next";
import SiteV2ListenPage, { generateMetadata as generateSiteV2Metadata } from "@/app/site-v2/listen/[slug]/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { ...(await generateSiteV2Metadata(props)), robots: undefined };
}
export default function ListenPage(props: Props) {
  return (
    <SiteV2Shell>
      <SiteV2ListenPage {...props} />
    </SiteV2Shell>
  );
}
