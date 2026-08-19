"use client";

import { toggleSiteV2SavedBook, useSiteV2SavedBookIds } from "./useSiteV2SavedBooks";
import styles from "./SiteV2.module.css";

export default function SiteV2SaveButton({ bookId, compact = false }: { bookId: string; compact?: boolean }) {
  const saved = useSiteV2SavedBookIds().has(bookId);

  return (
    <button
      className={compact ? styles.cardSaveButton : styles.secondaryButton}
      type="button"
      onClick={() => toggleSiteV2SavedBook(bookId)}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved books" : "Save for later"}
    >
      {compact ? (
        <>
          <span className={styles.cardSaveLong}>{saved ? "Saved" : "Save for later"}</span>
          <span className={styles.cardSaveShort}>{saved ? "Saved" : "Save"}</span>
        </>
      ) : saved ? "Saved" : "Save for later"}
    </button>
  );
}
