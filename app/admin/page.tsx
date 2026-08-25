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

export default async function AdminPage() {
  const [data, reading] = await Promise.all([
    loadDashboard(),
    readReadingAnalytics(),
  ]);

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

      {data.error && (
        <section className={styles.errorPanel} role="alert">
          <h2>The catalog is locked</h2>
          <p>{data.error}</p>
          <p>The rest of the Workshop is still available; no partial catalog data was shown.</p>
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
        <Link className={styles.actionCard} href={getAdminHref("/admin/reviews")}>
          <span className={styles.cardKicker}>Your call</span>
          <h2>Needs your eyes</h2>
          <p>Audio listening, print choices, factual review, and editorial calls—gathered into one finite inbox.</p>
          <strong>See what actually needs you →</strong>
        </Link>
        <Link className={styles.actionCard} href={getAdminHref("/admin/organize")}>
          <span className={styles.cardKicker}>Organize</span>
          <h2>Collections blitz</h2>
          <p>Drag, add, remove, and reorder books while your memory is moving. Nothing is classified automatically.</p>
          <strong>Open the speed board →</strong>
        </Link>
        <Link className={styles.actionCard} href={getAdminHref("/admin/topics")}>
          <span className={styles.cardKicker}>Editorial audit</span>
          <h2>Topics and descriptions</h2>
          <p>See the empty, tiny, overbroad, repetitive, and “from this to that” problems before deciding what to rewrite.</p>
          <strong>Open the audit desk →</strong>
        </Link>
        <Link className={styles.actionCard} href={getAdminHref("/admin/print")}>
          <span className={styles.cardKicker}>Proof only</span>
          <h2>Print editor</h2>
          <p>Compare the conflicting proof packages and make the nine decisions required before any paperback order.</p>
          <strong>Open print review →</strong>
        </Link>
        <Link className={styles.actionCard} href={getAdminHref("/admin/narrators")}>
          <span className={styles.cardKicker}>Audiobooks</span>
          <h2>Narrators</h2>
          <p>Activate narrator accounts, build Reader-matched track plans, offer books, and review private recordings.</p>
          <strong>Open narrator control →</strong>
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
