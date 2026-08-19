import type { Metadata } from "next";
import SiteV2BookPage, {
  generateMetadata as generateSiteV2Metadata,
} from "@/app/site-v2/books/[slug]/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  params: Promise<{ slug: string }>;
};

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
