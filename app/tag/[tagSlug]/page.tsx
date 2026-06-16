import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { absoluteUrl, bookUrl, coverUrl, getAllTags, getBooksForTag, metadataDescription, slugify } from "@/lib/publishing";
import { breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ tagSlug: string }>;
};

function resolveTag(tagSlug: string) {
  const clean = slugify(tagSlug);
  return getAllTags().find(tag => slugify(tag) === clean);
}

export function generateStaticParams() {
  return getAllTags().map(tag => ({ tagSlug: slugify(tag) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tagSlug } = await params;
  const tag = resolveTag(tagSlug);
  if (!tag) return {};

  return pageMetadata({
    title: `${tag} Books`,
    description: metadataDescription(`Read free JJ University books about ${tag}.`),
    path: `/tag/${slugify(tag)}`,
  });
}

export default async function TagPage({ params }: Props) {
  const { tagSlug } = await params;
  const tag = resolveTag(tagSlug);
  if (!tag) notFound();
  const books = getBooksForTag(tag);
  const path = `/tag/${slugify(tag)}`;
  const jsonLdItems = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${tag} Books`,
      url: absoluteUrl(path),
      description: metadataDescription(`Read free JJ University books about ${tag}.`),
      mainEntity: books.map(book => ({
        "@type": "Book",
        name: book.title,
        url: absoluteUrl(bookUrl(book)),
      })),
    },
    breadcrumbJsonLd([
      { name: "Library", path: "/library" },
      { name: "Topics", path: "/library" },
      { name: tag, path },
    ]),
  ];

  return (
    <main className="page publishingPage hubPage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }}
      />

      <section className="publishingHero">
        <p className="kicker">Topic</p>
        <h1>{tag}</h1>
        <p className="pageTagline">A focused shelf of free JJ University books connected to {tag}.</p>
      </section>

      <section className="publishingBookGrid">
        {books.map(book => (
          <Link className="publishingBookCard" href={bookUrl(book)} key={book.id}>
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
