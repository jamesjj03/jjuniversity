import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import {
  absoluteUrl,
  bookUrl,
  coverUrl,
  getBookBySlugLive,
  metadataDescription,
} from "@/lib/publishing";
import {
  getBookSectionRoute,
  getBookSectionRoutes,
  normalizeBookSectionSlug,
  sanitizePublicSectionHtml,
  sectionExcerpt,
} from "@/lib/bookSectionRoutes";
import { breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ slug: string; sectionSlug: string }>;
};

export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, sectionSlug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) return {};

  const route = await getBookSectionRoute(book, sectionSlug);
  if (!route) return {};

  return pageMetadata({
    title: `${route.title} - ${book.title}`,
    description: metadataDescription(sectionExcerpt(route.section), `Read ${route.title} from ${book.title} free online at JJ University.`),
    path: route.path,
    image: coverUrl(book),
    imageAlt: `${book.title} cover`,
    type: "article",
  });
}

export default async function BookSectionPage({ params }: Props) {
  const { slug, sectionSlug } = await params;
  const book = await getBookBySlugLive(slug);
  if (!book) notFound();

  const route = await getBookSectionRoute(book, sectionSlug);
  if (!route) notFound();
  if (normalizeBookSectionSlug(sectionSlug) !== route.sectionSlug) permanentRedirect(route.path);

  const routes = await getBookSectionRoutes(book);
  const previous = routes[route.index - 1];
  const next = routes[route.index + 1];
  const bookPath = bookUrl(book);
  const jsonLdItems = [
    {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: route.title,
      headline: `${route.title} - ${book.title}`,
      url: absoluteUrl(route.path),
      isAccessibleForFree: true,
      position: route.index + 1,
      isPartOf: {
        "@type": "Book",
        name: book.title,
        url: absoluteUrl(bookPath),
        author: {
          "@type": "Person",
          name: book.creator || "James Johnson",
        },
      },
      author: {
        "@type": "Person",
        name: book.creator || "James Johnson",
      },
      description: sectionExcerpt(route.section),
    },
    breadcrumbJsonLd([
      { name: "Books", path: "/books" },
      { name: book.title, path: bookPath },
      { name: route.title, path: route.path },
    ]),
  ];

  return (
    <main className="page publishingPage bookSectionPage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }}
      />

      <article className="bookSectionShell">
        <header className="bookSectionHeader">
          <p className="kicker">{book.title}</p>
          <h1>{route.title}</h1>
          <p className="pageTagline">Section {route.index + 1} of {route.total}</p>
          <div className="publishingActions">
            <Link className="btn primary" href={bookPath}>Book Overview</Link>
            <Link className="btn secondary" href={`/reader?book=${encodeURIComponent(book.id)}`}>Open Reader</Link>
          </div>
        </header>

        <div
          className="bookSectionContent"
          dangerouslySetInnerHTML={{ __html: sanitizePublicSectionHtml(route.section.html) }}
        />

        <nav className="bookSectionNav" aria-label="Book section navigation">
          {previous ? <Link href={previous.path}>Previous: {previous.title}</Link> : <Link href={bookPath}>Back to {book.title}</Link>}
          {next ? <Link href={next.path}>Next: {next.title}</Link> : <Link href={bookPath}>Finish: {book.title}</Link>}
        </nav>
      </article>
    </main>
  );
}
