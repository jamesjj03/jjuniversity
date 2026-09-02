import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import SiteV2Cover from "@/components/site-v2/SiteV2Cover";
import SiteV2CoverHistory from "@/components/site-v2/SiteV2CoverHistory";
import SiteV2BookAccess from "@/components/site-v2/SiteV2BookAccess";
import SiteV2RelatedBooks from "@/components/site-v2/SiteV2RelatedBooks";
import styles from "@/components/site-v2/SiteV2.module.css";
import { getPublishedAudioEditionForBook } from "@/lib/audioCatalog";
import { coverFallbackSrc } from "@/lib/cover";
import {
  absoluteUrl,
  bookUrl,
  coverUrl,
  getBookBySlugLive,
  getCollectionsLive,
  getPublicBooksLive,
  getPrintProductsForBook,
  getRelatedBooksLive,
  slugify,
} from "@/lib/publishing";
import {
  getBookSectionIndex,
  sanitizePublicSectionHtml,
  sectionHtmlHasMatchingHeading,
} from "@/lib/bookSectionRoutes";
import { formatBookLength, siteV2CoverSrc, siteV2Description, siteV2ShelfLabel, siteV2TopicsForBook } from "@/lib/siteV2";
import { bookJsonLd, breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const books = await getPublicBooksLive();
  const params = new Map<string, { slug: string }>();
  for (const book of books) {
    for (const slug of [book.slug, ...book.slugAliases].map(slugify).filter(Boolean)) {
      params.set(slug, { slug });
    }
  }
  return [...params.values()];
}

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
  if (slugify(slug) !== book.slug) permanentRedirect(bookUrl(book));

  const [sectionIndex, related, allSeries, audioEdition] = await Promise.all([
    getBookSectionIndex(book),
    getRelatedBooksLive(book, 16),
    getCollectionsLive(),
    getPublishedAudioEditionForBook(book.id),
  ]);
  const series = allSeries.filter(item => item.bookIds.includes(book.id));
  const printProduct = getPrintProductsForBook(book.id)[0];
  const topics = siteV2TopicsForBook(book);
  const bookPath = bookUrl(book);
  const firstRoutes = sectionIndex.routes.slice(0, 18);
  const remainingRoutes = sectionIndex.routes.slice(18);
  const bookSchema = {
    ...bookJsonLd(book, bookPath),
    ...(sectionIndex.routes.length ? {
      hasPart: sectionIndex.routes.map(route => ({
        "@type": "CreativeWork",
        name: route.title,
        url: absoluteUrl(route.path),
        position: route.index + 1,
      })),
    } : {}),
  };

  return (
    <article className={styles.bookPage}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            bookSchema,
            breadcrumbJsonLd([
              { name: "Books", path: "/books" },
              { name: book.title, path: bookPath },
            ]),
          ]),
        }}
      />
      <Link className={styles.backLink} href="/books"><span aria-hidden="true">←</span> Back to books</Link>

      <section className={styles.bookHero}>
        <div className={styles.bookHeroCoverColumn}>
          <div className={styles.bookHeroCover}>
            <SiteV2Cover src={siteV2CoverSrc(book)} fallbackSrc={coverFallbackSrc(book)} alt={`${book.title} cover`} priority sizes="(max-width: 700px) 76vw, 390px" />
          </div>
          <SiteV2CoverHistory key={book.id} bookId={book.id} bookTitle={book.title} />
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
                  <p className={styles.collectionLinks}>
                    {topics.map(topic => <Link href={`/tag/${slugify(topic)}`} key={topic}>{topic}</Link>)}
                  </p>
                </div>
              )}
              {series.length > 0 && (
                <div>
                  <span>Series</span>
                  <p className={styles.collectionLinks}>
                    {series.map(item => <Link href={`/series/${item.slug}`} key={item.id}>{item.title}</Link>)}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className={styles.bookMetaGrid} aria-label="Book details">
            <div><strong>{formatBookLength(book)}</strong><span>Reading time</span></div>
            <div><strong>{sectionIndex.routes.length || book.chapterCount || "Open"}</strong><span>Sections</span></div>
          </div>

          <SiteV2BookAccess
            bookId={book.id}
            bookSlug={book.slug}
            status={book.status}
            audioEdition={audioEdition}
            printSlug={printProduct?.slug}
          />
          <p className={styles.progressNote}>Reading progress can be saved on this device. Account tools are available if you sign in.</p>
        </div>
      </section>

      <section className={styles.bookInfoGrid}>
        <section className={styles.contentsPanel}>
          <div className={styles.contentsHeading}>
            <h2>Chapters</h2>
            {sectionIndex.routes.length > 0 && <span>{sectionIndex.routes.length} total</span>}
          </div>
          {firstRoutes.length ? (
            <ol>
              {firstRoutes.map(route => (
                <li key={route.path}>
                  <span>{String(route.index + 1).padStart(2, "0")}</span>
                  <Link href={route.path}>{route.title}</Link>
                </li>
              ))}
            </ol>
          ) : (
            <p>{book.status === "ready" ? "Open the reader to see the available text." : "This book is coming soon."}</p>
          )}
          {remainingRoutes.length > 0 && (
            <details className={styles.moreContents}>
              <summary>Show {remainingRoutes.length} more sections</summary>
              <ol>
                {remainingRoutes.map(route => (
                  <li key={route.path}>
                    <span>{String(route.index + 1).padStart(2, "0")}</span>
                    <Link href={route.path}>{route.title}</Link>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      </section>

      {sectionIndex.extras.length > 0 && (
        <details className={styles.editionNotes}>
          <summary>Edition notes and short pages</summary>
          <div className={styles.editionNotesIntro}>
            Dedications, notices, acknowledgments, author notes, and short passages from this book.
          </div>
          <div className={styles.editionNotesBody}>
            {sectionIndex.extras.map((section, index) => {
              const html = sanitizePublicSectionHtml(section.html);
              const repeatsTitle = sectionHtmlHasMatchingHeading(html, section.title);
              return (
                <section className={styles.editionNote} key={section.id || `${section.title}-${index}`}>
                  {section.title && !repeatsTitle && <h3>{section.title}</h3>}
                  <div className="bookSectionContent" dangerouslySetInnerHTML={{ __html: html }} />
                </section>
              );
            })}
          </div>
        </details>
      )}

      <SiteV2RelatedBooks key={book.id} sourceId={book.id} initialCandidates={related} />
    </article>
  );
}
