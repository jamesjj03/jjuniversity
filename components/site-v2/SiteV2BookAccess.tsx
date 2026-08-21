import Link from "next/link";
import type { PublishedAudioEdition } from "@/lib/audioCatalog";
import SiteV2ReadingAction from "./SiteV2ReadingAction";
import SiteV2SaveButton from "./SiteV2SaveButton";
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
    <div className={styles.bookActions} aria-label="Read, listen, print, or save this book">
      <SiteV2ReadingAction bookId={bookId} bookSlug={bookSlug} status={status} />
      {audioEdition && <Link className={styles.secondaryButton} href={`/listen/${bookSlug}`}>Listen</Link>}
      {printSlug && <Link className={styles.textButton} href={`/print/${printSlug}`}>Print edition</Link>}
      <SiteV2SaveButton bookId={bookId} />
    </div>
  );
}
