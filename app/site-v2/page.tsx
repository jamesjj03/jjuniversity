import Link from "next/link";
import type { Metadata } from "next";
import SiteV2ContinueLink from "@/components/site-v2/SiteV2ContinueLink";
import SiteV2Cover from "@/components/site-v2/SiteV2Cover";
import styles from "@/components/site-v2/SiteV2.module.css";
import { coverFallbackSrc } from "@/lib/cover";
import { getPublicBooksLive } from "@/lib/publishing";
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
  const books = await getPublicBooksLive();
  const available = books.filter(book => book.status === "ready" && book.visibility !== "archive");
  const byId = new Map(available.map(book => [book.id, book]));
  const homeCards = ((siteData as { homeCards?: HomeCard[] }).homeCards || [])
    .map(item => ({ item, book: byId.get(item.id) }))
    .filter((entry): entry is { item: HomeCard; book: NonNullable<typeof entry.book> } => Boolean(entry.book));

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
          <p className={styles.heroLead}>I spent the last year trying to figure out how everything works.</p>
          <p className={styles.heroGold}>This is the result.</p>
          <p className={styles.heroBody}>Hundreds of short books on science, history, religion, psychology, power, money, and everything in between.</p>
          <p className={styles.heroFree}>All free.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href="/books">Browse the books</Link>
            <SiteV2ContinueLink />
            <Link className={styles.textButton} href="/about">What this is</Link>
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
    </>
  );
}
