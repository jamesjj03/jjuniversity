import Link from "next/link";
import type { PublishedAudioEdition } from "@/lib/audioCatalog";
import SiteV2ReadingAction from "./SiteV2ReadingAction";
import styles from "./SiteV2.module.css";

export default function SiteV2BookAccess({
  bookId,
  bookSlug,
  status,
  audioEdition,
  printSlug,
}: {
  bookId: string;
  bookSlug: string;
  status: string;
  audioEdition: PublishedAudioEdition | null;
  printSlug?: string;
}) {
  return (
    <div className={styles.bookActions} aria-label="Read, listen to, or find a print edition of this book">
      <SiteV2ReadingAction bookId={bookId} bookSlug={bookSlug} status={status} />
      {audioEdition && (
        <Link className={`${styles.secondaryButton} ${styles.bookListenButton}`} href={`/listen/${bookSlug}`} aria-label="Listen to the audiobook">
          <span aria-hidden="true">▶</span> Listen
        </Link>
      )}
      {printSlug && <Link className={styles.textButton} href={`/print/${printSlug}`}>Print edition</Link>}
    </div>
  );
}
