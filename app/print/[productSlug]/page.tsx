import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PrintCheckoutButton from "@/components/PrintCheckoutButton";
import {
  absoluteUrl,
  bookUrl,
  coverUrl,
  getPrintProduct,
  getPrintProductBooksLive,
  getPrintProductComponents,
  getPrintProductPageCountLive,
  metadataDescription,
  printPriceLabel,
  PRINT_PRODUCTS,
} from "@/lib/publishing";
import { breadcrumbJsonLd, jsonLd, pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ productSlug: string }>;
};

export function generateStaticParams() {
  return PRINT_PRODUCTS.map(product => ({ productSlug: product.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productSlug } = await params;
  const product = getPrintProduct(productSlug);
  if (!product) return {};

  return pageMetadata({
    title: `${product.title} - Print Edition`,
    description: metadataDescription(product.description),
    path: `/print/${product.slug}`,
  });
}

export default async function PrintProductPage({ params }: Props) {
  const { productSlug } = await params;
  const product = getPrintProduct(productSlug);
  if (!product) notFound();

  const books = await getPrintProductBooksLive(product);
  const components = getPrintProductComponents(product);
  const pageCount = await getPrintProductPageCountLive(product);
  const componentSummaries = await Promise.all(components.map(async component => ({
    component,
    books: await getPrintProductBooksLive(component),
    pageCount: await getPrintProductPageCountLive(component),
  })));
  const jsonLdItems = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      brand: {
        "@type": "Brand",
        name: "JJ University",
      },
      description: product.description,
      url: absoluteUrl(`/print/${product.slug}`),
      isRelatedTo: books.map(book => ({
        "@type": "Book",
        name: book.title,
        url: absoluteUrl(bookUrl(book)),
      })),
      sku: product.sku,
      offers: {
        "@type": "Offer",
        availability: "https://schema.org/PreOrder",
        priceCurrency: "USD",
        price: product.targetPriceCents ? (product.targetPriceCents / 100).toFixed(2) : undefined,
        url: absoluteUrl(`/print/${product.slug}`),
      },
    },
    breadcrumbJsonLd([
      { name: "Print", path: "/print" },
      { name: product.title, path: `/print/${product.slug}` },
    ]),
  ];

  return (
    <main className="page publishingPage printProductPage">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(jsonLdItems) }}
      />

      <section className="printDetailHero">
        <div className="printDetailCopy">
          <p className="kicker">{product.kicker}</p>
          <h1>{product.title}</h1>
          <p className="pageTagline">{product.subtitle}</p>
          <p>{product.description}</p>
          <p className="printDetailLine">{product.includedLine}</p>
          <div className="publishingActions">
            <PrintCheckoutButton productSlug={product.slug} salesStatus={product.salesStatus} />
            <Link className="btn primary" href="/series/101">Read the Series Free</Link>
            <Link className="btn secondary" href="/print">Back to Print Shelf</Link>
          </div>
        </div>
        <div className="printDetailStack" aria-hidden="true">
          {books.slice(0, 8).map(book => (
            <Image src={coverUrl(book)} alt="" width={150} height={225} sizes="100px" key={book.id} />
          ))}
        </div>
      </section>

      <section className="printDetailMeta" aria-label="Print edition details">
        <div>
          <span>{product.kind === "bundle" ? "Volumes" : "Books"}</span>
          <strong>{product.kind === "bundle" ? components.length : books.length}</strong>
        </div>
        <div>
          <span>{product.kind === "bundle" ? "Combined pages" : pageCount.actual ? "Interior pages" : "Draft page count"}</span>
          <strong>{pageCount.pages}</strong>
        </div>
        <div>
          <span>Target price</span>
          <strong>{printPriceLabel(product)}</strong>
        </div>
        <div>
          <span>Print status</span>
          <strong>{product.printStatus.replace(/-/g, " ")}</strong>
        </div>
      </section>

      {!!components.length && (
        <section className="printIncludedShelf">
          <div className="sectionHeading">
            <h2>Included Volumes</h2>
            <p>This set is sold as separate physical paperbacks, not one oversized brick.</p>
          </div>
          <div className="printVolumeGrid">
            {componentSummaries.map(({ component, books: componentBooks, pageCount: componentPageCount }) => {
              return (
                <Link className="printVolumeCard" href={`/print/${component.slug}`} key={component.slug}>
                  <span>{component.kicker}</span>
                  <strong>{component.title}</strong>
                  <p>{component.subtitle}</p>
                  <em>{componentBooks.length} books / {componentPageCount.pages} {componentPageCount.actual ? "interior pages" : "estimated pages"}</em>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="printIncludedShelf">
        <div className="sectionHeading">
          <h2>Included Books</h2>
          <p>Every title in this physical collection is still readable free in the library.</p>
        </div>
        <div className="printIncludedGrid">
        {books.map(book => (
          <Link className="printIncludedCard" href={bookUrl(book)} key={book.id}>
            <Image src={coverUrl(book)} alt="" width={120} height={180} sizes="120px" />
            <div>
              <strong>{book.title}</strong>
              <p>{book.description}</p>
            </div>
          </Link>
        ))}
        </div>
      </section>
    </main>
  );
}
