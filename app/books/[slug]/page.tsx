import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  bookUrl,
  coverUrl,
  getBookBySlugLive,
  getBookSample,
  getPublicBooksLive,
  getPrintProductsForBook,
  getRelatedBooksLive,
  metadataDescription,
  slugify,
} from "@/lib/publishing";
import { getBookSectionRoutes } from "@/lib/bookSectionRoutes";
import { bookJsonLd, breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return (await getPublicBooksLive()).map(book => ({ slug: book.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) return {};
  const description = metadataDescription(book.description, `Read ${book.title} free online at JJ University.`);

  return pageMetadata({
    title: `${book.title} - Free Book`,
    description,
    path: bookUrl(book),
    image: coverUrl(book),
    imageAlt: `${book.title} cover`,
    type: "book",
  });
}

export default async function BookPage({ params }: Props) {
  const { slug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) notFound();

  const sample = await getBookSample(book);
  const sectionRoutes = await getBookSectionRoutes(book);
  const related = await getRelatedBooksLive(book, 6);
  const printProducts = getPrintProductsForBook(book.id);
  const bookPath = bookUrl(book);
  const jsonLdItems = [
    bookJsonLd(book, bookPath),
    breadcrumbJsonLd([
      { name: "Library", path: "/library" },
      { name: book.primaryCategory, path: `/category/${slugify(book.primaryCategory)}` },
      { name: book.title, path: bookPath },
    ]),
  ];

  return (
    <main className="page publishingPage bookDetailPage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }}
      />

      <section className="publishingHero bookHero">
        <div className="bookHeroCover">
          <Image src={coverUrl(book)} alt={`${book.title} cover`} width={480} height={720} sizes="(max-width: 720px) 70vw, 34vw" />
        </div>

        <div className="bookHeroCopy">
          <p className="kicker">{book.primaryCategory}</p>
          <h1>{book.title}</h1>
          {book.subtitle && <p className="pageTagline">{book.subtitle}</p>}
          <p>{book.description || "A free JJ University book by James Johnson."}</p>

          <div className="publishingActions">
            <Link className="btn primary" href={`/reader?book=${encodeURIComponent(book.id)}`}>Read Free</Link>
            {printProducts[0] && <Link className="btn secondary" href={`/print/${printProducts[0].slug}`}>Paperback</Link>}
            <Link className="btn secondary" href={`/category/${slugify(book.primaryCategory)}`}>More {book.primaryCategory}</Link>
          </div>

          <div className="bookMetaChips" aria-label="Book details">
            {book.readingLabel && book.readingLabel !== "Unknown" && <span>{book.readingLabel}</span>}
            {!!book.chapterCount && <span>{book.chapterCount} sections</span>}
            {!!book.wordCount && <span>{book.wordCount.toLocaleString()} words</span>}
            <span>{book.status === "coming-soon" ? "Coming soon" : "Free online"}</span>
          </div>
        </div>
      </section>

      <section className="publishingGrid">
        <article className="publishingPanel">
          <h2>What This Book Covers</h2>
          {sectionRoutes.length ? (
            <ol className="tocList">
              {sectionRoutes.slice(0, 18).map(item => (
                <li key={item.path}>
                  <Link href={item.path}>{item.title}</Link>
                </li>
              ))}
            </ol>
          ) : sample.toc.length ? (
            <ol className="tocList">
              {sample.toc.map(item => <li key={item}>{item}</li>)}
            </ol>
          ) : (
            <p>This page is ready for discovery. The full reader is available from the button above.</p>
          )}
        </article>

        <article className="publishingPanel">
          <h2>Excerpt</h2>
          <p>{sample.excerpt || book.description || "Open the reader to start the book."}</p>
        </article>
      </section>

      {!!book.tags.length && (
        <section className="publishingPanel">
          <h2>Topics</h2>
          <div className="publishingTagRow">
            {book.tags.map(tag => <Link href={`/tag/${slugify(tag)}`} key={tag}>{tag}</Link>)}
          </div>
        </section>
      )}

      {!!related.length && (
        <section className="publishingPanel">
          <div className="sectionHeading">
            <h2>Related Books</h2>
            <span>Internal links are the new hallway signs.</span>
          </div>
          <div className="publishingBookRail">
            {related.map(item => (
              <Link href={bookUrl(item)} key={item.id}>
                <Image src={coverUrl(item)} alt="" width={180} height={270} sizes="(max-width: 720px) 38vw, 180px" />
                <strong>{item.title}</strong>
                <span>{item.primaryCategory}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
