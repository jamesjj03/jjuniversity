import type { Metadata } from "next";
import SiteV2BooksPage, { metadata as siteV2Metadata } from "@/app/site-v2/books/page";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";

type Props = {
  searchParams: Promise<{ shelf?: string; collection?: string; path?: string; series?: string; reset?: string }>;
};

export const metadata: Metadata = { ...siteV2Metadata, robots: undefined };

export default function BooksPage(props: Props) {
  return (
    <SiteV2Shell>
      <SiteV2BooksPage {...props} />
    </SiteV2Shell>
  );
}
