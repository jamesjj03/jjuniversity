import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import { readAdminBookContent, type AdminResolvedBookContent } from "@/lib/adminBookContent";
import { readAdminBookCatalog, type AdminBookCatalogSnapshot } from "@/lib/adminBookCatalog";
import { readWorkshopPublicationStatus, type WorkshopPublicationStatus } from "@/lib/workshopPublicationStatus";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";
import { safeBooksReturnHref, type WorkshopSearchParams } from "../../_routeState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Publication | JJU Workshop",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: WorkshopSearchParams;
};

function sourceLabel(content: AdminResolvedBookContent) {
  if (content.source === "supabase") return "Workshop draft storage";
  if (content.source === "github") return "the checked-in source";
  return "this computer’s checked-in source";
}

export default async function BookPublicationPage({ params, searchParams }: Props) {
  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = rawId.trim().toLowerCase();
  const returnHref = safeBooksReturnHref(query.from);
  let catalog: AdminBookCatalogSnapshot;
  let content: AdminResolvedBookContent;
  let publication: WorkshopPublicationStatus;

  try {
    [catalog, content] = await Promise.all([
      readAdminBookCatalog(),
      readAdminBookContent(id),
    ]);
    publication = await readWorkshopPublicationStatus(id, content.book);
  } catch (error) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel}>
          <p className={styles.eyebrow}>Publication status unavailable</p>
          <h1>This book’s public edition could not be checked safely.</h1>
          <p>{error instanceof Error ? error.message : "The Workshop could not compare the manuscript to the public edition."}</p>
          <p>No draft was changed and nothing was published.</p>
          <GuardedAdminLink className={styles.secondaryButton} href={`/admin/books/${encodeURIComponent(id)}?from=${encodeURIComponent(returnHref)}`}>Back to manuscript</GuardedAdminLink>
        </section>
      </main>
    );
  }

  const book = catalog.books.map(normalizeWorkshopBook).find(item => item.id === id);
  if (!book) notFound();
  const manuscriptHref = `/admin/books/${encodeURIComponent(book.id)}?from=${encodeURIComponent(returnHref)}`;
  const detailsHref = `/admin/books/${encodeURIComponent(book.id)}/details?from=${encodeURIComponent(returnHref)}`;
  const publicHref = `/books/${encodeURIComponent(book.slug || book.id)}`;
  const changedNames = publication.changedSectionTitles.join(", ");

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Publication</p>
          <h1>{book.title}</h1>
          <p className={styles.intro}>This is the honest handoff between the Workshop draft and the reader-facing edition.</p>
        </div>
        <div className={styles.headerActions}>
          <GuardedAdminLink className={styles.secondaryButton} href={manuscriptHref}>Manuscript</GuardedAdminLink>
          <GuardedAdminLink className={styles.secondaryButton} href={detailsHref}>Book details</GuardedAdminLink>
          <GuardedAdminLink className={styles.secondaryButton} href={publicHref}>Open public page</GuardedAdminLink>
        </div>
      </header>

      <section className={styles.statusCallout}>
        <strong>Saving does not publish.</strong>
        <span>
          Save protects the current manuscript in {sourceLabel(content)}. The public reader only changes when a reviewed source snapshot becomes a new deployed edition.
        </span>
      </section>

      <section className={styles.metricGrid} aria-label="Publication facts">
        <div className={styles.metric}><span>Public edition</span><strong>{publication.editionId.replace("edition-", "").slice(0, 10)}</strong></div>
        <div className={styles.metric}><span>Published sections</span><strong>{publication.publishedSectionCount}</strong></div>
        <div className={styles.metric}><span>Current sections</span><strong>{publication.currentSectionCount}</strong></div>
        <div className={styles.metric}><span>Sections awaiting release</span><strong>{publication.changedSectionCount}</strong></div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <p className={styles.eyebrow}>{publication.matchesPublishedEdition ? "In sync" : "Waiting for publication"}</p>
          <h2>{publication.matchesPublishedEdition ? "This manuscript matches the public edition." : "The Workshop copy is newer than what readers see."}</h2>
          <p>
            {publication.matchesPublishedEdition
              ? "There is no manuscript difference to release right now."
              : `${publication.changedSectionCount} section${publication.changedSectionCount === 1 ? " differs" : "s differ"} from the current edition${changedNames ? `: ${changedNames}${publication.changedSectionCount > publication.changedSectionTitles.length ? ", and more" : ""}` : ""}.`}
          </p>
        </div>
        <div className={styles.capabilityList}>
          <div className={styles.capabilityRow}>
            <div><strong>Workshop save</strong></div>
            <div><p>Keeps the exact manuscript revision and its history safe. It does not expose it to Google or readers.</p></div>
            <span className={styles.capabilityState}>Private draft</span>
          </div>
          <div className={styles.capabilityRow}>
            <div><strong>Public edition</strong></div>
            <div><p>Is compiled into small, reviewable section files used by the reader, book pages, and sitemap. It does not ask Supabase for full book JSON.</p></div>
            <span className={styles.capabilityState}>Current release</span>
          </div>
          <div className={styles.capabilityRow}>
            <div><strong>Next real publish</strong></div>
            <div><p>Will create one reviewed source commit and deployment from an exact manuscript revision. That remote action is intentionally not wired to this screen yet.</p></div>
            <span className={styles.capabilityState}>Needs review</span>
          </div>
        </div>
      </section>
    </main>
  );
}
