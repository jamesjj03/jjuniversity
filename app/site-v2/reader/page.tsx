import type { Metadata } from "next";
import ReaderClient from "@/components/ReaderClient";
import styles from "@/components/site-v2/SiteV2.module.css";
import readerRoomStyles from "@/components/site-v2/ReaderRoom.module.css";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Reader",
  description: "Read JJ University books in the web reader.",
  path: "/reader",
  noIndex: true,
});

export default async function SiteV2ReaderPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string | string[]; restart?: string | string[] }>;
}) {
  const query = await searchParams;
  const bookQuery = Array.isArray(query.book) ? query.book[0] || "" : query.book || "";
  const restartQuery = Array.isArray(query.restart) ? query.restart[0] || "" : query.restart || "";

  return (
    <div className={`${styles.readerRoute} ${readerRoomStyles.readerRoomRoute}`}>
      <ReaderClient
        key={`${bookQuery}:${restartQuery}`}
        bookQuery={bookQuery}
        libraryHref="/books"
        libraryLabel="Books"
        autoOpenDesktopPanels={false}
        contentSource="live"
        embedded
        variant="site-v2"
      />
    </div>
  );
}
