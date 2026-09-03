import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import SiteV2Cover from "@/components/site-v2/SiteV2Cover";
import styles from "@/components/site-v2/SiteV2.module.css";
import { coverFallbackSrc } from "@/lib/cover";
import {
  absoluteUrl,
  bookUrl,
  getAllSeriesLive,
  getSeriesBooksLive,
  getSeriesBySlugLive,
  metadataDescription,
  slugify,
} from "@/lib/publishing";
import { breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";
import { formatBookLength, siteV2CoverSrc, siteV2Description } from "@/lib/siteV2";

type Props = {
  params: Promise<{ seriesSlug: string }>;
};

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const params = new Map<string, { seriesSlug: string }>();
  for (const series of await getAllSeriesLive()) {
    for (const seriesSlug of [series.slug, ...series.slugAliases].map(slugify).filter(Boolean)) {
      params.set(seriesSlug, { seriesSlug });
    }
  }
  return [...params.values()];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { seriesSlug } = await params;
  const series = await getSeriesBySlugLive(seriesSlug);
  if (!series) return {};

  return {
    ...pageMetadata({
      title: series.title,
      description: metadataDescription(series.description, `Read the ${series.title} series free online at JJ University.`),
      path: `/series/${series.slug}`,
    }),
    robots: { index: true, follow: true },
  };
}

export default async function SiteV2SeriesPage({ params }: Props) {
  const { seriesSlug } = await params;
  const series = await getSeriesBySlugLive(seriesSlug);
  if (!series) notFound();
  if (slugify(seriesSlug) !== series.slug) permanentRedirect(`/series/${series.slug}`);

  const books = await getSeriesBooksLive(series);
  const jsonLdItems = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: series.title,
      url: absoluteUrl(`/series/${series.slug}`),
      description: metadataDescription(series.description),
      mainEntity: books.map(book => ({
        "@type": "Book",
        name: book.title,
        url: absoluteUrl(bookUrl(book)),
      })),
    },
    breadcrumbJsonLd([
      { name: "Books", path: "/books" },
      { name: series.visibility === "archive" ? "Archive" : "Library", path: "/books" },
      { name: series.title, path: `/series/${series.slug}` },
    ]),
  ];

  return (
    <article className={styles.seriesPage}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }} />

      <Link className={styles.backLink} href="/books"><span aria-hidden="true">←</span> Back to Library</Link>

      <header className={styles.seriesPageHero}>
        <div className={styles.seriesPageCovers} aria-label={`${series.title} cover selection`}>
          {books.slice(0, 3).map((book, index) => (
            <div className={styles.seriesPageCover} key={book.id}>
              <SiteV2Cover
                src={siteV2CoverSrc(book)}
                fallbackSrc={coverFallbackSrc(book)}
                alt={`${book.title} cover`}
                priority={index === 0}
                sizes="(max-width: 760px) 28vw, 172px"
                palette
              />
            </div>
          ))}
        </div>
        <div className={styles.seriesPageCopy}>
          <span>{series.visibility === "archive" ? "Library Archive" : "Reading Series"}</span>
          <h1>{series.title}</h1>
          <p className={styles.seriesPageTagline}>{series.tagline}</p>
          <p className={styles.seriesPageDescription}>{series.description}</p>
          <p className={styles.seriesPageCount}>
            <span>{books.length} {books.length === 1 ? "book" : "books"}</span>
            <span aria-hidden="true">·</span>
            <span>There’s no required order. Start wherever you want.</span>
          </p>
        </div>
      </header>

      <section className={styles.seriesBookList} aria-labelledby="series-books-heading">
        <div className={styles.seriesBookListHeading}>
          <h2 id="series-books-heading">In this series</h2>
          <Link href="/books">Browse all books <span aria-hidden="true">→</span></Link>
        </div>
        <ol>
          {books.map((book, index) => (
            <li key={book.id}>
              <Link className={styles.seriesBookRow} href={bookUrl(book)}>
                <span className={styles.seriesBookNumber}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.seriesBookCover}>
                  <SiteV2Cover
                    src={siteV2CoverSrc(book)}
                    fallbackSrc={coverFallbackSrc(book)}
                    alt={`${book.title} cover`}
                    sizes="76px"
                    palette
                  />
                </span>
                <span className={styles.seriesBookDetails}>
                  <strong>{book.title}</strong>
                  {book.subtitle && <em>{book.subtitle}</em>}
                  {siteV2Description(book) && <span>{siteV2Description(book)}</span>}
                </span>
                <span className={styles.seriesBookLength}>{formatBookLength(book)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
