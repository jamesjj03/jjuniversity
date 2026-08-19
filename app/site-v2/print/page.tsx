import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import SiteV2Logo from "@/components/site-v2/SiteV2Logo";
import styles from "@/components/site-v2/SiteV2.module.css";
import {
  coverUrl,
  getPrintProductBooksLive,
  getPrintProductComponents,
  getPrintProductPageCountLive,
  printPriceLabel,
  PRINT_PRODUCTS,
} from "@/lib/publishing";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Print",
    description: "Physical editions of JJ University books and collections.",
    path: "/print",
  }),
  robots: { index: false, follow: true },
};

export default async function SiteV2PrintPage() {
  const printShelves = await Promise.all(PRINT_PRODUCTS.map(async product => {
    const [books, pageCount] = await Promise.all([
      getPrintProductBooksLive(product),
      getPrintProductPageCountLive(product),
    ]);
    return { product, books, components: getPrintProductComponents(product), pageCount };
  }));

  return (
    <div className={styles.printPage}>
      <header className={styles.pageHeaderCentered}>
        <SiteV2Logo className={styles.printHeaderLogo} />
        <h1>Print</h1>
      </header>

      <section className={`${styles.printCatalog} ${styles.printCatalogDirect}`} aria-label="Print editions">
        <div className={styles.printProductGrid}>
          {printShelves.map(({ product, books, components, pageCount }, productIndex) => (
            <Link className={styles.printProductCard} href={`/print/${product.slug}`} key={product.slug}>
              <div className={styles.printCoverStack} aria-hidden="true">
                {books.slice(0, 3).map((book, index) => (
                  <Image
                    src={coverUrl(book)}
                    alt=""
                    width={180}
                    height={270}
                    sizes="(max-width: 760px) 42vw, 180px"
                    loading={productIndex === 0 || index === 0 ? "eager" : "lazy"}
                    fetchPriority={productIndex === 0 && index === 1 ? "high" : undefined}
                    key={book.id}
                    style={{ "--print-cover-index": index } as CSSProperties}
                  />
                ))}
              </div>
              <div className={styles.printProductCopy}>
                <span>{product.kind === "bundle" ? "Physical set" : product.kicker}</span>
                <h2>{product.title}</h2>
                <p>{product.subtitle}</p>
                <dl>
                  <div><dt>{product.kind === "bundle" ? "Volumes" : "Books"}</dt><dd>{product.kind === "bundle" ? components.length : books.length}</dd></div>
                  <div><dt>{pageCount.actual ? "Pages" : "Draft pages"}</dt><dd>{pageCount.pages}</dd></div>
                  <div><dt>Price</dt><dd>{printPriceLabel(product)}</dd></div>
                </dl>
                <span className={styles.printStatus}>Not for sale yet</span>
                <strong className={styles.printDetailLink}>See this edition <span aria-hidden="true">→</span></strong>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
