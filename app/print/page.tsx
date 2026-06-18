import Link from "next/link";
import type { Metadata } from "next";
import {
  coverUrl,
  getPrintProductPageCount,
  getPrintProductBooks,
  getPrintProductComponents,
  printPriceLabel,
  PRINT_PRODUCTS,
} from "@/lib/publishing";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Print Editions",
  description: "Physical JJ University curriculum products, collections, and future custom anthologies.",
  path: "/print",
});

export default function PrintIndexPage() {
  const printShelves = PRINT_PRODUCTS.map(product => {
    const books = getPrintProductBooks(product);
    const components = getPrintProductComponents(product);
    const pageCount = getPrintProductPageCount(product);
    return {
      product,
      books,
      components,
      pageCount,
    };
  });

  return (
    <main className="page publishingPage printShelfPage">
      <section className="publishingHero printShelfHero">
        <h1>Print</h1>
      </section>

      <section className="printCatalogGrid" aria-label="Print collections">
        {printShelves.map(({ product, books, components, pageCount }) => (
          <Link className="printCatalogCard" href={`/print/${product.slug}`} key={product.slug}>
            <div className="printShelfCovers" aria-hidden="true">
              {books.slice(0, 6).map(book => (
                <img src={coverUrl(book)} alt="" loading="lazy" key={book.id} />
              ))}
            </div>
            <div className="printShelfInfo">
              <span>{product.kicker}</span>
              <h2>{product.title}</h2>
              <p>{product.subtitle}</p>
              <div className="printShelfMeta">
                <strong>{product.kind === "bundle" ? `${components.length} volumes` : `${books.length} books`}</strong>
                <strong>{pageCount.pages} {pageCount.actual ? "interior pages" : "estimated pages"}</strong>
                <strong>{printPriceLabel(product)}</strong>
                <strong>Not for sale yet</strong>
              </div>
            </div>
          </Link>
        ))}
      </section>

      <section className="printShelfNote">
        <p>Digital reading pages remain canonical. Print pages are catalog pages for the physical editions before checkout goes live.</p>
        <Link href="/library">Start with a book</Link>
      </section>
    </main>
  );
}
