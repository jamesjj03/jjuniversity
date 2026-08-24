import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import BookManuscriptWorkspace from "@/components/workshop/BookManuscriptWorkspace";
import BookWorkspaceHeader from "@/components/workshop/BookWorkspaceHeader";
import { readAdminBookCatalog, type AdminBookCatalogSnapshot } from "@/lib/adminBookCatalog";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";
import { safeBooksReturnHref, type WorkshopSearchParams } from "../../_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book Manuscript | JJU Workshop",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: WorkshopSearchParams;
};

export default async function BookManuscriptPage({ params, searchParams }: Props) {
  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = rawId.trim().toLowerCase();
  const returnHref = safeBooksReturnHref(query.from);
  let catalog: AdminBookCatalogSnapshot;

  try {
    catalog = await readAdminBookCatalog();
  } catch (error) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel}>
          <p className={styles.eyebrow}>Manuscript locked</p>
          <h1>This manuscript did not load safely.</h1>
          <p>{error instanceof Error ? error.message : "The Workshop could not read this book."}</p>
          <p>No manuscript controls were opened and nothing was changed.</p>
          <GuardedAdminLink className={styles.secondaryButton} href={returnHref}>Back to Books</GuardedAdminLink>
        </section>
      </main>
    );
  }

  const book = catalog.books.map(normalizeWorkshopBook).find(item => item.id === id);
  if (!book) notFound();

  return (
    <main className={styles.page}>
      <BookWorkspaceHeader book={book} active="manuscript" returnHref={returnHref} />
      <div className={styles.notice}>The manuscript loads separately from catalog details. Save the current section before switching sections; unsaved navigation is guarded.</div>
      <BookManuscriptWorkspace book={book} />
    </main>
  );
}
