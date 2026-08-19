import type { Metadata } from "next";
import SiteV2PrintProductPage, {
  generateMetadata as generateSiteV2Metadata,
  generateStaticParams as generateSiteV2StaticParams,
} from "@/app/site-v2/print/[productSlug]/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  params: Promise<{ productSlug: string }>;
  searchParams: Promise<{ checkout?: string | string[] }>;
};

export function generateStaticParams() {
  return generateSiteV2StaticParams();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { ...(await generateSiteV2Metadata(props)), robots: undefined };
}

export default function PrintProductPage(props: Props) {
  return (
    <SiteV2Shell>
      <SiteV2PrintProductPage {...props} />
    </SiteV2Shell>
  );
}
