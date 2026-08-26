import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import ManuscriptStudio from "@/components/workshop/ManuscriptStudio";
import { readAdminBookContent, type AdminResolvedBookContent } from "@/lib/adminBookContent";
import { readAdminBookCatalog, type AdminBookCatalogSnapshot } from "@/lib/adminBookCatalog";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";
import { firstSearchValue, safeBooksReturnHref, type WorkshopSearchParams } from "../_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Write | JJU Workshop",
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
  const initialSectionId = firstSearchValue(query.section).trim();
  let catalog: AdminBookCatalogSnapshot;
  let content: AdminResolvedBookContent;

  try {
    [catalog, content] = await Promise.all([
      readAdminBookCatalog(),
      readAdminBookContent(id),
    ]);
  } catch (error) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel}>
          <p className={styles.eyebrow}>Book locked</p>
          <h1>This writing space did not load safely.</h1>
          <p>{error instanceof Error ? error.message : "The Workshop could not read this book."}</p>
          <p>No editing controls were opened and nothing was changed.</p>
          <GuardedAdminLink className={styles.secondaryButton} href={returnHref}>Back to Books</GuardedAdminLink>
        </section>
      </main>
    );
  }

  const book = catalog.books.map(normalizeWorkshopBook).find(item => item.id === id);
  if (!book) notFound();

  return (
    <main>
      <ManuscriptStudio
        book={book}
        content={content.book}
        initialVersion={content.version}
        initialSectionId={initialSectionId}
        returnHref={returnHref}
      />
    </main>
  );
}
