import { createHash } from "node:crypto";
import type { Metadata } from "next";
import TopicsDescriptionDesk from "@/components/workshop/TopicsDescriptionDesk";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import { LEGACY_BOOK_ID_ALIASES } from "@/lib/bookAliases";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import { SITE_V2_APPROVED_TOPICS, siteV2TopicsForBook } from "@/lib/siteV2Taxonomy";
import { buildTopicDescriptionAudit } from "@/lib/topicDescriptionAudit";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "./TopicsPage.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Topics & Descriptions | JJU Workshop",
  robots: { index: false, follow: false },
};

async function loadAudit() {
  const catalog = await readAdminBookCatalog();
  const sourceBooks = catalog.books
    .map(normalizeWorkshopBook)
    .filter(book => (
      book.id
      && book.status === "ready"
      && book.visibility === "main"
      && !Object.hasOwn(LEGACY_BOOK_ID_ALIASES, book.id)
    ));
  const books = sourceBooks.map(book => ({
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    description: book.description,
    coverSrc: coverWebpSrc(book, book.id),
    fallbackCoverSrc: coverFallbackSrc(book, book.id),
    topics: siteV2TopicsForBook(book),
  }));
  const catalogFingerprint = createHash("sha256")
    .update(JSON.stringify(books.map(book => ({
      id: book.id,
      title: book.title,
      description: book.description,
      topics: book.topics,
    }))))
    .digest("hex");

  return {
    audit: buildTopicDescriptionAudit(books, SITE_V2_APPROVED_TOPICS),
    catalogFingerprint,
    source: catalog.source,
  };
}

export default async function TopicsPage() {
  const result = await loadAudit()
    .then(data => ({ data, error: "" }))
    .catch(error => ({
      data: null,
      error: error instanceof Error ? error.message : "The authoritative catalog could not be loaded.",
    }));

  if (!result.data) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel} role="alert">
          <p className={styles.eyebrow}>Topics &amp; descriptions</p>
          <h1>The review desk is safely locked.</h1>
          <p>{result.error}</p>
          <p>No bundled or partial catalog was substituted.</p>
        </section>
      </main>
    );
  }

  return <TopicsDescriptionDesk {...result.data} />;
}
