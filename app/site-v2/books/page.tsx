import type { Metadata } from "next";
import Link from "next/link";
import SiteV2BooksBrowser from "@/components/site-v2/SiteV2BooksBrowser";
import styles from "@/components/site-v2/SiteV2.module.css";
import { getCollectionsLive, getPublicBooksLive } from "@/lib/publishing";
import { isSiteV2ShelfId } from "@/lib/siteV2";
import { pageMetadata } from "@/lib/seo";
import featuredIds from "@/public/featured.json";
import fallbackNewestIds from "@/public/newest.json";
import siteConfig from "@/public/site.json";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Books",
    description: "Browse the complete JJ University collection of free short books.",
    path: "/books",
  }),
  robots: { index: false, follow: true },
};

export default async function SiteV2BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ shelf?: string; collection?: string; path?: string; series?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const [books, collections] = await Promise.all([getPublicBooksLive(), getCollectionsLive()]);
  const configuredNewestIds = (siteConfig as { library?: { newestIds?: string[] } }).library?.newestIds || [];
  const newestIds = configuredNewestIds.length ? configuredNewestIds : fallbackNewestIds;
  const initialShelf = params.shelf && isSiteV2ShelfId(params.shelf) ? params.shelf : "all";
  const requestedCollection = params.collection || params.series || params.path;
  const matchedCollection = requestedCollection
    ? collections.find(item => item.id === requestedCollection || item.slug === requestedCollection || item.slugAliases.includes(requestedCollection))
    : undefined;
  const initialCollection = matchedCollection?.id || "all";

  return (
    <>
      <header className={styles.pageHeaderCentered}>
        <h1>Books</h1>
        <div className={styles.pageHeaderActions}>
          <Link className={styles.secondaryButton} href="/books/index">Complete A-Z index</Link>
        </div>
      </header>
      <SiteV2BooksBrowser
        books={books}
        collections={collections}
        featuredIds={featuredIds as string[]}
        newestIds={newestIds as string[]}
        initialShelf={initialShelf}
        initialCollection={initialCollection}
        resetSession={params.reset === "1"}
      />
    </>
  );
}
