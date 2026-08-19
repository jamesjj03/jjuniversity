import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PrintCheckoutButton from "@/components/PrintCheckoutButton";
import styles from "@/components/site-v2/SiteV2.module.css";
import {
  coverUrl,
  getCollectionsLive,
  getPrintProduct,
  getPrintProductBooksLive,
  getPrintProductComponents,
  getPrintProductPageCountLive,
  metadataDescription,
  printPriceLabel,
  PRINT_PRODUCTS,
} from "@/lib/publishing";
import { pageMetadata } from "@/lib/seo";

type Props = {
  params: Promise<{ productSlug: string }>;
  searchParams: Promise<{ checkout?: string | string[] }>;
};

export function generateStaticParams() {
  return PRINT_PRODUCTS.map(product => ({ productSlug: product.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productSlug } = await params;
  const product = getPrintProduct(productSlug);
  return product ? {
    ...pageMetadata({
      title: `${product.title} print edition`,
      description: metadataDescription(product.description),
      path: `/print/${product.slug}`,
    }),
    robots: { index: false, follow: true },
  } : {};
}

export default async function SiteV2PrintProductPage({ params, searchParams }: Props) {
  const [{ productSlug }, query] = await Promise.all([params, searchParams]);
  const product = getPrintProduct(productSlug);
  if (!product) notFound();
  const checkoutState = Array.isArray(query.checkout) ? query.checkout[0] : query.checkout;

  const components = getPrintProductComponents(product);
  const [books, pageCount, componentSummaries, collections] = await Promise.all([
    getPrintProductBooksLive(product),
    getPrintProductPageCountLive(product),
    Promise.all(components.map(async component => {
      const [componentBooks, componentPageCount] = await Promise.all([
        getPrintProductBooksLive(component),
        getPrintProductPageCountLive(component),
      ]);
      return { component, books: componentBooks, pageCount: componentPageCount };
    })),
    getCollectionsLive(),
  ]);
  const productBookIds = new Set(product.bookIds);
  const matchingCollection = collections
    .filter(collection => product.bookIds.every(bookId => collection.bookIds.includes(bookId)))
    .sort((a, b) => {
      const aExtra = a.bookIds.filter(bookId => !productBookIds.has(bookId)).length;
      const bExtra = b.bookIds.filter(bookId => !productBookIds.has(bookId)).length;
      return aExtra - bExtra || a.title.localeCompare(b.title);
    })[0];
  const readFreeParams = new URLSearchParams({ reset: "1" });
  if (matchingCollection) readFreeParams.set("collection", matchingCollection.slug);
  const readFreeHref = `/books?${readFreeParams.toString()}`;

  return (
    <article className={styles.printProductPage}>
      <Link className={styles.backLink} href="/print"><span aria-hidden="true">←</span> Back to print</Link>

      {checkoutState === "success" && (
        <div className={styles.checkoutNotice} data-state="success" role="status">
          <strong>Checkout complete.</strong>
          <span>Your confirmation and shipping details will arrive by email.</span>
        </div>
      )}
      {checkoutState === "cancelled" && (
        <div className={styles.checkoutNotice} data-state="cancelled" role="status">
          <strong>Checkout canceled.</strong>
          <span>Nothing was charged. The books are still here when you want them.</span>
        </div>
      )}

      <section className={styles.printProductHero}>
        <div className={styles.printProductHeroCopy}>
          <span>{product.kind === "bundle" ? "Physical set" : product.kicker}</span>
          <h1>{product.title}</h1>
          <p className={styles.printProductSubtitle}>{product.subtitle}</p>
          <p>{product.description}</p>
          <div className={styles.printActions}>
            <PrintCheckoutButton productSlug={product.slug} salesStatus={product.salesStatus} returnPath={`/print/${product.slug}`} />
            <Link className={styles.secondaryButton} href={readFreeHref}>Read the books free</Link>
          </div>
        </div>

        <div className={styles.printProductStack} aria-hidden="true">
          {books.slice(0, 4).map((book, index) => (
            <Image
              src={coverUrl(book)}
              alt=""
              width={220}
              height={330}
              sizes="(max-width: 760px) 45vw, 220px"
              loading="eager"
              fetchPriority={index === 2 ? "high" : undefined}
              key={book.id}
              style={{ "--print-cover-index": index } as CSSProperties}
            />
          ))}
        </div>
      </section>

      <section className={styles.printMetaGrid} aria-label="Print edition details">
        <div><span>{product.kind === "bundle" ? "Volumes" : "Books"}</span><strong>{product.kind === "bundle" ? components.length : books.length}</strong></div>
        <div><span>{pageCount.actual ? "Interior pages" : "Draft page count"}</span><strong>{pageCount.pages}</strong></div>
        <div><span>Target price</span><strong>{printPriceLabel(product)}</strong></div>
      </section>

      {componentSummaries.length > 0 && (
        <section className={styles.printVolumeSection}>
          <div className={styles.printSectionHeading}>
            <h2>Included volumes</h2>
          </div>
          <div className={styles.printVolumeGrid}>
            {componentSummaries.map(({ component, books: componentBooks, pageCount: componentPageCount }) => (
              <Link className={styles.printVolumeCard} href={`/print/${component.slug}`} key={component.slug}>
                <span>{component.kicker}</span>
                <strong>{component.title}</strong>
                <p>{component.subtitle}</p>
                <small>{componentBooks.length} books · {componentPageCount.pages} {componentPageCount.actual ? "pages" : "draft pages"}</small>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className={styles.printIncludedSection}>
        <div className={styles.printSectionHeading}>
          <h2>Included books</h2>
        </div>
        <div className={styles.printBookGrid}>
          {books.map(book => (
            <Link className={styles.printBookCard} href={`/books/${book.slug}`} key={book.id}>
              <Image src={coverUrl(book)} alt={`${book.title} cover`} width={110} height={165} sizes="110px" />
              <span>{book.title}</span>
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
