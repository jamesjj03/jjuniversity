import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SiteV2Cover from "@/components/site-v2/SiteV2Cover";
import SiteV2ReadingAction from "@/components/site-v2/SiteV2ReadingAction";
import SiteV2RelatedBooks from "@/components/site-v2/SiteV2RelatedBooks";
import SiteV2SaveButton from "@/components/site-v2/SiteV2SaveButton";
import styles from "@/components/site-v2/SiteV2.module.css";
import { coverFallbackSrc } from "@/lib/cover";
import {
  bookUrl,
  coverUrl,
  getBookBySlugLive,
  getBookSample,
  getCollectionsLive,
  getPrintProductsForBook,
  getRelatedBooksLive,
} from "@/lib/publishing";
import { formatBookLength, siteV2CoverSrc, siteV2Description, siteV2ShelfLabel, siteV2TopicsForBook } from "@/lib/siteV2";
import { bookJsonLd, breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) return {};
  return {
    ...pageMetadata({
      title: book.title,
      description: siteV2Description(book),
      path: bookUrl(book),
      image: coverUrl(book),
      imageAlt: `${book.title} cover`,
      type: "book",
    }),
    robots: { index: false, follow: true },
  };
}

export default async function SiteV2BookPage({ params }: Props) {
  const { slug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) notFound();

  const [sample, related, allSeries] = await Promise.all([
    getBookSample(book),
    getRelatedBooksLive(book, 16),
    getCollectionsLive(),
  ]);
  const series = allSeries.filter(item => item.bookIds.includes(book.id));
  const printProduct = getPrintProductsForBook(book.id)[0];
  const topics = siteV2TopicsForBook(book);
  const bookPath = bookUrl(book);

  return (
    <article className={styles.bookPage}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            bookJsonLd(book, bookPath),
            breadcrumbJsonLd([
              { name: "Books", path: "/books" },
              { name: book.title, path: bookPath },
            ]),
          ]),
        }}
      />
      <Link className={styles.backLink} href="/books"><span aria-hidden="true">←</span> Back to books</Link>

      <section className={styles.bookHero}>
        <div className={styles.bookHeroCover}>
          <SiteV2Cover src={siteV2CoverSrc(book)} fallbackSrc={coverFallbackSrc(book)} alt={`${book.title} cover`} priority sizes="(max-width: 700px) 76vw, 390px" />
        </div>

        <div className={styles.bookHeroCopy}>
          <span className={styles.bookShelfLabel}>{siteV2ShelfLabel(book)}</span>
          <h1>{book.title}</h1>
          {book.subtitle && <p className={styles.bookHeroSubtitle}>{book.subtitle}</p>}
          <p className={styles.bookHeroDescription}>{siteV2Description(book) || "A JJ University book by James Johnson."}</p>

          {(topics.length > 0 || series.length > 0) && (
            <div className={styles.bookHeroFacets}>
              {topics.length > 0 && (
                <div>
                  <span>Topics</span>
                  <p>{topics.join(" · ")}</p>
                </div>
              )}
              {series.length > 0 && (
                <div>
                  <span>Collections</span>
                  <p className={styles.collectionLinks}>
                    {series.map(item => <Link href={`/books?collection=${item.slug}&reset=1`} key={item.id}>{item.title}</Link>)}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className={styles.bookMetaGrid} aria-label="Book details">
            <div><strong>{formatBookLength(book)}</strong><span>Reading time</span></div>
            <div><strong>{sample.chapterCount || book.chapterCount || "Open"}</strong><span>Chapters</span></div>
            <div><strong>{book.creator || "James Johnson"}</strong><span>Author</span></div>
          </div>

          <div className={styles.bookActions}>
            <SiteV2ReadingAction bookId={book.id} bookSlug={book.slug} status={book.status} />
            <SiteV2SaveButton bookId={book.id} />
            {printProduct && <Link className={styles.textButton} href={`/print/${printProduct.slug}`}>Print edition</Link>}
          </div>
          <p className={styles.progressNote}>Reading progress can be saved on this device. Account tools are available if you sign in.</p>
        </div>
      </section>

      <section className={styles.bookInfoGrid}>
        <section className={styles.contentsPanel}>
          <div className={styles.contentsHeading}>
            <h2>Chapters</h2>
            {sample.chapterCount > 0 && <span>{sample.chapterCount} total</span>}
          </div>
          {sample.toc.length ? (
            <ol>
              {sample.toc.slice(0, 18).map((item, index) => (
                <li key={`${item}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>
              ))}
            </ol>
          ) : (
            <p>Open the reader to see the full chapter list.</p>
          )}
          {sample.chapterCount > 18 && <p>{sample.chapterCount - 18} more chapters are available in the reader.</p>}
        </section>
      </section>

      <SiteV2RelatedBooks key={book.id} sourceId={book.id} initialCandidates={related} />
    </article>
  );
}
