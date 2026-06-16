import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  absoluteUrl,
  bookUrl,
  coverUrl,
  getAllSeries,
  getSeriesBooks,
  getSeriesBySlug,
  metadataDescription,
} from "@/lib/publishing";
import { breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ seriesSlug: string }>;
};

export function generateStaticParams() {
  return getAllSeries().map(series => ({ seriesSlug: series.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { seriesSlug } = await params;
  const series = getSeriesBySlug(seriesSlug);
  if (!series) return {};

  return pageMetadata({
    title: `${series.title} - Reading Series`,
    description: metadataDescription(series.description, `Read the ${series.title} series free online at JJ University.`),
    path: `/series/${series.slug}`,
  });
}

export default async function SeriesPage({ params }: Props) {
  const { seriesSlug } = await params;
  const series = getSeriesBySlug(seriesSlug);
  if (!series) notFound();

  const books = getSeriesBooks(series);
  const is101 = series.slug === "101";
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
      { name: "Library", path: "/library" },
      { name: "Series", path: "/library" },
      { name: series.title, path: `/series/${series.slug}` },
    ]),
  ];

  return (
    <main className="page publishingPage seriesPage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }}
      />

      <section className="publishingHero">
        <p className="kicker">Reading Series</p>
        <h1>{series.title}</h1>
        <p className="pageTagline">{series.description}</p>
        {is101 && (
          <div className="publishingActions">
            <Link className="btn primary" href="/print/101-volume-1">Volume I</Link>
            <Link className="btn secondary" href="/print/101-volume-2">Volume II</Link>
            <Link className="btn secondary" href="/print/101-set">The Set</Link>
          </div>
        )}
      </section>

      {is101 && (
        <section className="publishingPanel curriculumSplit">
          <div>
            <p className="kicker">Volume I</p>
            <h2>The Natural World</h2>
            <p>Numbers, science, matter, energy, and life.</p>
          </div>
          <div>
            <p className="kicker">Volume II</p>
            <h2>The Human World</h2>
            <p>Body, mind, meaning, civilization, institutions, and money.</p>
          </div>
        </section>
      )}

      <section className="publishingBookGrid">
        {books.map((book, index) => (
          <Link className="publishingBookCard" href={bookUrl(book)} key={book.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <img src={coverUrl(book)} alt="" loading="lazy" />
            <div>
              <strong>{book.title}</strong>
              <p>{book.description}</p>
            </div>
          </Link>
        ))}
      </section>
    </main>
  );
}
