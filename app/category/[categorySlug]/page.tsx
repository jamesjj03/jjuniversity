import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { absoluteUrl, bookUrl, coverUrl, getCategories, metadataDescription, slugify } from "@/lib/publishing";
import { breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ categorySlug: string }>;
};

export function generateStaticParams() {
  return getCategories().map(category => ({ categorySlug: category.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { categorySlug } = await params;
  const category = getCategories().find(item => item.slug === slugify(categorySlug));
  if (!category) return {};

  return pageMetadata({
    title: `${category.name} Books`,
    description: metadataDescription(category.description, `Read free ${category.name.toLowerCase()} books at JJ University.`),
    path: `/category/${category.slug}`,
  });
}

export default async function CategoryPage({ params }: Props) {
  const { categorySlug } = await params;
  const category = getCategories().find(item => item.slug === slugify(categorySlug));
  if (!category) notFound();
  const jsonLdItems = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${category.name} Books`,
      url: absoluteUrl(`/category/${category.slug}`),
      description: metadataDescription(category.description),
      mainEntity: category.books.map(book => ({
        "@type": "Book",
        name: book.title,
        url: absoluteUrl(bookUrl(book)),
      })),
    },
    breadcrumbJsonLd([
      { name: "Library", path: "/library" },
      { name: "Categories", path: "/library" },
      { name: category.name, path: `/category/${category.slug}` },
    ]),
  ];

  return (
    <main className="page publishingPage hubPage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }}
      />

      <section className="publishingHero">
        <p className="kicker">Category</p>
        <h1>{category.name}</h1>
        <p className="pageTagline">{category.description}</p>
      </section>

      <section className="publishingBookGrid">
        {category.books.map(book => (
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
