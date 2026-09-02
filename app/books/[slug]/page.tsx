import type { Metadata } from "next";
import SiteV2BookPage, {
  generateStaticParams as generateSiteV2StaticParams,
  generateMetadata as generateSiteV2Metadata,
} from "@/app/site-v2/books/[slug]/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return generateSiteV2StaticParams();
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { ...(await generateSiteV2Metadata(props)), robots: undefined };
}

export default function BookPage(props: Props) {
  return (
    <SiteV2Shell>
      <SiteV2BookPage {...props} />
    </SiteV2Shell>
  );
}
