import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import {
  coverUrl,
  getPrintProductPageCountLive,
  getPrintProductBooksLive,
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

export default async function PrintIndexPage() {
  const printShelves = await Promise.all(PRINT_PRODUCTS.map(async product => {
    const books = await getPrintProductBooksLive(product);
    const components = getPrintProductComponents(product);
    const pageCount = await getPrintProductPageCountLive(product);
    return {
      product,
      books,
      components,
      pageCount,
    };
  }));
  const totalBooks = printShelves.reduce((sum, shelf) => sum + shelf.books.length, 0);
  const totalPages = printShelves.reduce((sum, shelf) => sum + shelf.pageCount.pages, 0);

  return (
    <main className="page publishingPage printShelfPage">
      <section className="publishingHero printShelfHero">
        <div>
          <p className="kicker">Print Bench</p>
          <h1>Print</h1>
          <p className="pageTagline">Physical editions, proof stacks, page counts, and the shelf before checkout goes live.</p>
        </div>
        <div className="printBenchStats" aria-label="Print bench status">
          <span><strong>{printShelves.length}</strong> editions</span>
          <span><strong>{totalBooks}</strong> books</span>
          <span><strong>{totalPages.toLocaleString()}</strong> pages</span>
        </div>
      </section>

      <section className="printCatalogGrid" aria-label="Print collections">
        {printShelves.map(({ product, books, components, pageCount }) => (
          <Link className="printCatalogCard" href={`/print/${product.slug}`} key={product.slug}>
            <span className="printProofStamp" aria-hidden="true">Proof</span>
            <div className="printShelfCovers" aria-hidden="true">
              {books.slice(0, 6).map(book => (
                <Image src={coverUrl(book)} alt="" width={150} height={225} sizes="90px" key={book.id} />
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
