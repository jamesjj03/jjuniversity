import Link from "next/link";
import type { PublishedBook } from "@/lib/publishing";
import { coverFallbackSrc } from "@/lib/cover";
import { formatBookLength, siteV2CoverSrc, siteV2Description, siteV2ShelfLabel, siteV2ShelfShortLabel } from "@/lib/siteV2";
import SiteV2Cover from "./SiteV2Cover";
import SiteV2SaveButton from "./SiteV2SaveButton";
import styles from "./SiteV2.module.css";

export default function SiteV2BookCard({ book, priority = false }: { book: PublishedBook; priority?: boolean }) {
  return (
    <article className={styles.bookCard} data-book-card>
      <Link className={styles.bookCoverLink} href={`/books/${book.slug}`} aria-label={`See details for ${book.title}`}>
        <span className={styles.bookCoverFrame}>
          <SiteV2Cover src={siteV2CoverSrc(book)} fallbackSrc={coverFallbackSrc(book)} alt={`${book.title} cover`} priority={priority} palette />
        </span>
      </Link>

      <div className={styles.bookCardBody}>
        <div className={styles.bookCardTopline}>
          <span>
            <span className={styles.bookShelfLong}>{siteV2ShelfLabel(book)}</span>
            <span className={styles.bookShelfShort}>{siteV2ShelfShortLabel(book)}</span>
          </span>
          <SiteV2SaveButton bookId={book.id} compact />
        </div>
        <h2><Link href={`/books/${book.slug}`}>{book.title}</Link></h2>
        {book.subtitle && <p className={styles.bookSubtitle}>{book.subtitle}</p>}
        {siteV2Description(book) && <p className={styles.bookDescription}>{siteV2Description(book)}</p>}
        <div className={styles.bookCardMeta}>
          <span>{formatBookLength(book)}</span>
          {book.chapterCount > 0 && <span>{book.chapterCount} chapters</span>}
        </div>
      </div>
    </article>
  );
}
