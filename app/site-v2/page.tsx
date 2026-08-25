import Link from "next/link";
import type { Metadata } from "next";
import SiteV2ContinueLink from "@/components/site-v2/SiteV2ContinueLink";
import SiteV2Cover from "@/components/site-v2/SiteV2Cover";
import styles from "@/components/site-v2/SiteV2.module.css";
import { coverFallbackSrc } from "@/lib/cover";
import { getCollectionsLive, getPublicBooksLive } from "@/lib/publishing";
import { siteV2CoverSrc } from "@/lib/siteV2";
import { jsonLd, organizationJsonLd, pageMetadata, websiteJsonLd } from "@/lib/seo";
import siteData from "@/public/site.json";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "JJ University",
    description: "Hundreds of free short books on science, history, religion, psychology, power, money, and everything in between.",
    path: "/",
  }),
  title: { absolute: "JJ University" },
  robots: { index: false, follow: true },
};

type HomeCard = {
  id: string;
  displayTitle?: string;
  why?: string;
};

export default async function SiteV2HomePage() {
  const [books, collections] = await Promise.all([getPublicBooksLive(), getCollectionsLive()]);
  const available = books.filter(book => book.status === "ready" && book.visibility !== "archive");
  const availableBookIds = new Set(available.map(book => book.id));
  const byId = new Map(available.map(book => [book.id, book]));
  const homeCards = ((siteData as { homeCards?: HomeCard[] }).homeCards || [])
    .map(item => ({ item, book: byId.get(item.id) }))
    .filter((entry): entry is { item: HomeCard; book: NonNullable<typeof entry.book> } => Boolean(entry.book));
  const featuredCollectionIds = [
    "101-the-core-courses",
    "world-religions",
    "eyes-everywhere",
    "the-mapmakers",
    "the-big-picture",
    "red-white-and-bruised",
  ];
  const collectionById = new Map(collections.map(collection => [collection.id, collection]));
  const featuredCollections = featuredCollectionIds
    .map(id => collectionById.get(id))
    .filter((collection): collection is NonNullable<typeof collection> => Boolean(collection));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd([organizationJsonLd(), websiteJsonLd()]) }}
      />
      <section className={styles.homeHero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.homeHeroCopy}>
          <h1>JJ University</h1>
          <p className={styles.heroLead}>A free library for figuring things out.</p>
          <p className={styles.heroBody}>Hundreds of short books on science, history, religion, psychology, power, money, and the systems underneath everyday life.</p>
          <p className={styles.heroGold}>Start anywhere. All free.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/books">Browse the books</Link>
            <SiteV2ContinueLink />
          </div>
        </div>
      </section>

      {!!homeCards.length && (
        <section className={styles.fiveSection}>
          <div className={styles.sectionHeadingCentered}>
            <h2>Five places to start</h2>
          </div>
          <div className={styles.fiveGrid}>
            {homeCards.slice(0, 5).map(({ item, book }) => (
              <Link className={styles.fiveCard} href={`/books/${book.slug}`} key={book.id}>
                <span className={styles.fiveCover}>
                  <SiteV2Cover src={siteV2CoverSrc(book)} fallbackSrc={coverFallbackSrc(book)} alt={`${book.title} cover`} sizes="(max-width: 700px) 58vw, 190px" />
                </span>
                <strong>{item.displayTitle || book.title}</strong>
                {item.why && <p>{item.why}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {!!featuredCollections.length && (
        <section className={styles.shelvesSection}>
          <div className={styles.sectionHeadingCentered}>
            <h2>Books that belong together</h2>
            <p>Collections turn the library into connected reading paths. Start with one idea and keep following it.</p>
          </div>
          <div className={styles.shelfGrid}>
            {featuredCollections.map(collection => (
              <Link href={`/books?collection=${encodeURIComponent(collection.slug)}&reset=1`} key={collection.id}>
                <span>{collection.bookIds.filter(id => availableBookIds.has(id)).length} books</span>
                <strong>{collection.title}</strong>
                <p>{collection.description}</p>
              </Link>
            ))}
          </div>
          <Link className={styles.centerTextLink} href="/books">Browse every Collection →</Link>
        </section>
      )}
    </>
  );
}
