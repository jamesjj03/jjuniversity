import Link from "next/link";
import WorkshopBookLibrary from "@/components/workshop/WorkshopBookLibrary";
import ReadingAnalyticsSummary from "@/components/workshop/ReadingAnalyticsSummary";
import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import { getAdminHref } from "@/lib/adminPath";
import { readReadingAnalytics } from "@/lib/readingAnalytics";
import { normalizeWorkshopBook, type WorkshopBook } from "@/lib/workshopBooks";
import styles from "./WorkshopCore.module.css";
import { catalogSourceLabel } from "./books/_routeState";

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
      source: catalogSourceLabel(catalog.source),
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
  const [data, reading] = await Promise.all([
    loadDashboard(),
    readReadingAnalytics(),
  ]);
  const hidden = count(data.books, "hidden");
  const review = count(data.books, "needs-review");
  const comingSoon = count(data.books, "coming-soon");

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>JJU Workshop</p>
          <h1>Open a book and start working.</h1>
          <p className={styles.intro}>Search here, tap once, and the whole manuscript opens. No catalog wall and no separate manuscript step.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.primaryButton} href={getAdminHref("/admin/books/new")}>New book</Link>
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

      <ReadingAnalyticsSummary result={reading} />

      {!data.error && (
        <WorkshopBookLibrary
          books={data.books}
          compact
          source={data.source}
        />
      )}

      <section className={styles.actionGrid} aria-label="Workshop actions">
        <Link className={styles.actionCard} href={getAdminHref("/admin/books/new")}>
          <span className={styles.cardKicker}>New draft</span>
          <h2>Start a book</h2>
          <p>Create a hidden catalog entry and its manuscript together.</p>
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
        <Link className={styles.actionCard} href={getAdminHref("/admin/more")}>
          <span className={styles.cardKicker}>Site</span>
          <h2>Homepage and other tools</h2>
          <p>Open publishing, Fiber, Atlas, and the temporary legacy fallback.</p>
          <strong>Open site tools →</strong>
        </Link>
      </section>
    </main>
  );
}
