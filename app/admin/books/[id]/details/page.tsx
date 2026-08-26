import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import BookOverviewEditor from "@/components/workshop/BookOverviewEditor";
import { readAdminBookCatalog, type AdminBookCatalogSnapshot } from "@/lib/adminBookCatalog";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";
import { safeBooksReturnHref, type WorkshopSearchParams } from "../../_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book details | JJU Workshop",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: WorkshopSearchParams;
};

export default async function BookDetailsPage({ params, searchParams }: Props) {
  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = rawId.trim().toLowerCase();
  const returnHref = safeBooksReturnHref(query.from);
  const manuscriptHref = `/admin/books/${encodeURIComponent(id)}?from=${encodeURIComponent(returnHref)}`;
  let catalog: AdminBookCatalogSnapshot;

  try {
    catalog = await readAdminBookCatalog();
  } catch (error) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel}>
          <p className={styles.eyebrow}>Book details locked</p>
          <h1>The current library details did not load safely.</h1>
          <p>{error instanceof Error ? error.message : "The Workshop could not read the catalog."}</p>
          <p>No editing controls were opened and nothing was changed.</p>
          <GuardedAdminLink className={styles.secondaryButton} href={returnHref}>Back to Books</GuardedAdminLink>
        </section>
      </main>
    );
  }

  const book = catalog.books.map(normalizeWorkshopBook).find(item => item.id === id);
  if (!book) notFound();

  const supabaseWriteGateUnavailable = catalog.source === "supabase"
    && catalog.version.replace(/^"|"$/g, "").startsWith("supabase-unversioned:");

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Book details</p>
          <h1>{book.title}</h1>
          <p className={styles.intro}>Edit the title, description, publishing state, placement, cover, and other information readers see.</p>
        </div>
        <div className={styles.headerActions}>
          <GuardedAdminLink className={styles.secondaryButton} href={manuscriptHref}>Back to manuscript</GuardedAdminLink>
          <GuardedAdminLink className={styles.quietButton} href={returnHref}>Back to where I was</GuardedAdminLink>
        </div>
      </header>

      <BookOverviewEditor
        initialBook={book}
        initialVersion={catalog.version}
        supabaseWriteGateUnavailable={supabaseWriteGateUnavailable}
      />
    </main>
  );
}
