import Link from "next/link";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import { getAdminHref } from "@/lib/adminPath";
import { normalizeWorkshopBook, type WorkshopBook } from "@/lib/workshopBooks";
import styles from "./WorkshopCore.module.css";

export const dynamic = "force-dynamic";

type DashboardData = {
  books: WorkshopBook[];
  source: string;
  error: string;
};

async function loadDashboard(): Promise<DashboardData> {
  try {
    const catalog = await readAdminBookCatalog();
    return {
      books: catalog.books.map(normalizeWorkshopBook),
      source: catalog.source,
      error: "",
    };
  } catch (error) {
    return {
      books: [],
      source: "unavailable",
      error: error instanceof Error ? error.message : "The book catalog could not be loaded.",
    };
  }
}

function count(books: WorkshopBook[], status: string) {
  return books.filter(book => book.status === status).length;
}

export default async function AdminPage() {
  const data = await loadDashboard();
  const hidden = count(data.books, "hidden");
  const review = count(data.books, "needs-review");
  const comingSoon = count(data.books, "coming-soon");

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>JJU Workshop</p>
          <h1>What do you want to work on?</h1>
          <p className={styles.intro}>Start with a job, not a control panel. Books open into their own saved, deep-linked workspace.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href={getAdminHref("/admin/books")}>Find a book</Link>
          <Link className={styles.quietButton} href="/">View site</Link>
        </div>
      </header>

      {data.error ? (
        <section className={styles.errorPanel} role="alert">
          <h2>The catalog is locked</h2>
          <p>{data.error}</p>
          <p>The rest of the Workshop is still available; no partial catalog data was shown.</p>
        </section>
      ) : (
        <section className={styles.metricGrid} aria-label="Library status">
          <div className={styles.metric}><span>Total books</span><strong>{data.books.length}</strong></div>
          <div className={styles.metric}><span>Hidden drafts</span><strong>{hidden}</strong></div>
          <div className={styles.metric}><span>Needs review</span><strong>{review}</strong></div>
          <div className={styles.metric}><span>Coming soon</span><strong>{comingSoon}</strong></div>
        </section>
      )}

      <section className={styles.actionGrid} aria-label="Workshop actions">
        <Link className={styles.actionCard} href={getAdminHref("/admin/books")}>
          <span className={styles.cardKicker}>Books</span>
          <h2>Find and edit a book</h2>
          <p>Search by title, series, tag, or ID. Open one book directly into Overview or Manuscript.</p>
          <strong>Open the library →</strong>
        </Link>
        <Link className={styles.actionCard} href={getAdminHref("/admin/books/new")}>
          <span className={styles.cardKicker}>New draft</span>
          <h2>Start a book</h2>
          <p>Create a hidden catalog entry and its manuscript together, then continue in that book’s workspace.</p>
          <strong>Create a hidden draft →</strong>
        </Link>
        <Link className={styles.actionCard} href={getAdminHref("/admin/books?status=needs-review")}>
          <span className={styles.cardKicker}>Editorial</span>
          <h2>Books needing review</h2>
          <p>{data.error ? "Open the filtered library when the catalog is available." : `${review} book${review === 1 ? "" : "s"} currently marked for review.`}</p>
          <strong>See the queue →</strong>
        </Link>
        <Link className={styles.actionCard} href={getAdminHref("/admin/organize")}>
          <span className={styles.cardKicker}>Organize</span>
          <h2>Collections and shelves</h2>
          <p>Work on how books are grouped without mixing that job into title, manuscript, or publishing edits.</p>
          <strong>Open organizing tools →</strong>
        </Link>
      </section>

      {!data.error && <p className={styles.intro}>Catalog source: {data.source}. Saves still use the source’s exact loaded version.</p>}
    </main>
  );
}
