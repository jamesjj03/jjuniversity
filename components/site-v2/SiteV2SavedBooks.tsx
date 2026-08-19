"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { PublishedBook } from "@/lib/publishing";
import SiteV2BookCard from "./SiteV2BookCard";
import { useSiteV2SavedBookIds } from "./useSiteV2SavedBooks";
import styles from "./SiteV2.module.css";

const subscribeToHydration = () => () => {};

export default function SiteV2SavedBooks({ books }: { books: PublishedBook[] }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const savedIds = useSiteV2SavedBookIds();
  const [visibleCount, setVisibleCount] = useState(30);

  const savedBooks = useMemo(() => books.filter(book => savedIds.has(book.id)), [books, savedIds]);

  if (!hydrated) {
    return (
      <div className={styles.savedEmpty} role="status">
        <p>Loading saved books...</p>
      </div>
    );
  }

  if (!savedBooks.length) {
    return (
      <div className={styles.savedEmpty}>
        <div className={styles.savedEmptyMark} aria-hidden="true">+</div>
        <h2>Nothing saved yet.</h2>
        <p>Use Save for later on any book. It will show up here on this device.</p>
        <Link className={styles.primaryButton} href="/books">Browse the books</Link>
      </div>
    );
  }

  return (
    <>
      <div className={styles.savedSummary} aria-label={`${savedBooks.length} ${savedBooks.length === 1 ? "book" : "books"} saved`}>
        <strong>{savedBooks.length}</strong>
        <span>{savedBooks.length === 1 ? "Book saved" : "Books saved"}</span>
      </div>
      <div className={styles.bookGrid}>
        {savedBooks.slice(0, visibleCount).map((book, index) => <SiteV2BookCard book={book} priority={index < 4} key={book.id} />)}
      </div>
      {visibleCount < savedBooks.length && (
        <div className={styles.loadMoreRow}>
          <button className={styles.secondaryButton} type="button" onClick={() => setVisibleCount(count => count + 30)}>
            Show 30 more
          </button>
          <span>Showing {Math.min(visibleCount, savedBooks.length)} of {savedBooks.length}</span>
        </div>
      )}
    </>
  );
}
