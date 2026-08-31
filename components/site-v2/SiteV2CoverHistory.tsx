"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./SiteV2.module.css";

type CoverHistoryEntry = {
  src: string;
  label: string;
};

const COVER_HISTORY_BY_BOOK_ID: Readonly<Partial<Record<string, CoverHistoryEntry>>> = {
  lr: {
    src: "/covers-webp/LROld.webp",
    label: "Early cover",
  },
  hr: {
    src: "/covers-webp/HROld.webp",
    label: "Early cover",
  },
};

export default function SiteV2CoverHistory({
  bookId,
  bookTitle,
}: {
  bookId: string;
  bookTitle: string;
}) {
  const entry = COVER_HISTORY_BY_BOOK_ID[bookId.trim().toLowerCase()];
  const [failed, setFailed] = useState(false);

  if (!entry || failed) return null;

  return (
    <details className={styles.coverHistory}>
      <summary>Cover history</summary>
      <figure className={styles.coverHistoryFigure}>
        <div className={styles.coverHistoryArt}>
          <Image
            className={styles.coverHistoryImage}
            src={entry.src}
            alt={`Early cover of ${bookTitle}`}
            fill
            sizes="80px"
            onError={() => setFailed(true)}
          />
        </div>
        <figcaption>
          <strong>{entry.label}</strong>
          <span>An earlier design for {bookTitle}.</span>
        </figcaption>
      </figure>
    </details>
  );
}
