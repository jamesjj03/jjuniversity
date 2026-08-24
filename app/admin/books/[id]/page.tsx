import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import BookOverviewWorkspace from "@/components/workshop/BookOverviewWorkspace";
import { readAdminBookCatalog, type AdminBookCatalogSnapshot } from "@/lib/adminBookCatalog";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";
import { safeBooksReturnHref, type WorkshopSearchParams } from "../_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book Overview | JJU Workshop",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: WorkshopSearchParams;
};

export default async function BookOverviewPage({ params, searchParams }: Props) {
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
          <p className={styles.eyebrow}>Book locked</p>
          <h1>This book did not load safely.</h1>
          <p>{error instanceof Error ? error.message : "The Workshop could not read this book."}</p>
          <p>No book controls were opened and nothing was changed.</p>
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
      <BookOverviewWorkspace
        initialBook={book}
        initialVersion={catalog.version}
        returnHref={returnHref}
        supabaseWriteGateUnavailable={supabaseWriteGateUnavailable}
      />
    </main>
  );
}
