import type { Metadata } from "next";
import SiteV2SavedBooks from "@/components/site-v2/SiteV2SavedBooks";
import styles from "@/components/site-v2/SiteV2.module.css";
import { getPublicBooksLive } from "@/lib/publishing";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Saved books",
  description: "Books saved on this device for later reading.",
  path: "/saved",
  noIndex: true,
});

export default async function SiteV2SavedPage() {
  const books = await getPublicBooksLive();
  return (
    <section className={styles.savedPage}>
      <header className={styles.pageHeaderCentered}>
        <h1>Saved books</h1>
      </header>
      <SiteV2SavedBooks books={books} />
    </section>
  );
}
