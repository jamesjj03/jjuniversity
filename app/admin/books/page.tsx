import type { Metadata } from "next";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import WorkshopBookLibrary from "@/components/workshop/WorkshopBookLibrary";
import { readAdminBookCatalog, type AdminBookCatalogSnapshot } from "@/lib/adminBookCatalog";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";
import { catalogSourceLabel, firstSearchValue, type WorkshopSearchParams } from "./_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Books | JJU Workshop",
  robots: { index: false, follow: false },
};

export default async function WorkshopBooksPage({ searchParams }: { searchParams: WorkshopSearchParams }) {
  const query = await searchParams;
  let catalog: AdminBookCatalogSnapshot;

  try {
    catalog = await readAdminBookCatalog();
  } catch (error) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel}>
          <p className={styles.eyebrow}>Books locked</p>
          <h1>The catalog did not load safely.</h1>
          <p>{error instanceof Error ? error.message : "The Workshop could not read the book catalog."}</p>
          <p>No editing controls were opened and nothing was changed.</p>
          <GuardedAdminLink className={styles.secondaryButton} href="/admin/books">Try again</GuardedAdminLink>
        </section>
      </main>
    );
  }

  const books = catalog.books.map(normalizeWorkshopBook);
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workshop library</p>
          <h1>Find a book</h1>
          <p className={styles.intro}>Search, filter, sort, or browse the whole catalog. Every result goes straight into the full manuscript.</p>
        </div>
        <div className={styles.headerActions}>
          <GuardedAdminLink className={styles.primaryButton} href="/admin/books/new">New book</GuardedAdminLink>
          <GuardedAdminLink className={styles.secondaryButton} href="/books">View public library</GuardedAdminLink>
        </div>
      </header>

      <WorkshopBookLibrary
        books={books}
        initialBrowseAll={firstSearchValue(query.browse) === "all"}
        initialPlacement={firstSearchValue(query.placement)}
        initialQuery={firstSearchValue(query.q)}
        initialSort={firstSearchValue(query.sort)}
        initialStatus={firstSearchValue(query.status)}
        source={catalogSourceLabel(catalog.source)}
      />
    </main>
  );
}
