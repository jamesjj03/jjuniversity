import type { Metadata } from "next";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import NewBookForm from "@/components/workshop/NewBookForm";
import { readAdminBookCatalog, type AdminBookCatalogSnapshot } from "@/lib/adminBookCatalog";
import styles from "@/app/admin/WorkshopCore.module.css";
import { catalogSourceLabel } from "../_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New Book | JJU Workshop",
  robots: { index: false, follow: false },
};

export default async function NewBookPage() {
  let catalog: AdminBookCatalogSnapshot;

  try {
    catalog = await readAdminBookCatalog();
  } catch (error) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel}>
          <p className={styles.eyebrow}>Creation locked</p>
          <h1>The current catalog version is unavailable.</h1>
          <p>{error instanceof Error ? error.message : "The Workshop could not read the catalog."}</p>
          <p>No draft was created. A safe new-book operation requires the exact current catalog version.</p>
          <GuardedAdminLink className={styles.secondaryButton} href="/admin/books">Back to Books</GuardedAdminLink>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Books</p>
          <h1>New book</h1>
          <p className={styles.intro}>Create one hidden draft, then finish its details and manuscript inside its own workspace.</p>
        </div>
        <div className={styles.headerActions}>
          <GuardedAdminLink className={styles.secondaryButton} href="/admin/books">Back to Books</GuardedAdminLink>
        </div>
      </header>
      <NewBookForm
        initialVersion={catalog.version}
        source={catalogSourceLabel(catalog.source)}
        supabaseWriteLocked={catalog.source === "supabase"
          && catalog.version.replace(/^"|"$/g, "").startsWith("supabase-unversioned:")}
      />
    </main>
  );
}
