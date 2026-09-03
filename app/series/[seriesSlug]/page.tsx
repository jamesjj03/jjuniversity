import type { Metadata } from "next";
import SiteV2SeriesPage, {
  generateMetadata as generateSiteV2Metadata,
  generateStaticParams as generateSiteV2StaticParams,
} from "@/app/site-v2/series/[seriesSlug]/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  params: Promise<{ seriesSlug: string }>;
};

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return generateSiteV2StaticParams();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { ...(await generateSiteV2Metadata(props)), robots: undefined };
}

export default function SeriesPage(props: Props) {
  return (
    <SiteV2Shell>
      <SiteV2SeriesPage {...props} />
    </SiteV2Shell>
  );
}
