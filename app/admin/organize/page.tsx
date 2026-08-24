import type { Metadata } from "next";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import WorkshopHubCard from "@/components/workshop/WorkshopHubCard";
import styles from "@/app/admin/WorkshopCore.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Organize | JJU Workshop",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrganizePage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const selectedBook = Array.isArray(query.book) ? query.book[0] || "" : query.book || "";
  const deployed = process.env.VERCEL === "1";

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workshop</p>
          <h1>Organize</h1>
          <p className={styles.intro}>Collections, shelves, topics, and series shape how readers move through the library. These remain editorial decisions, not silent automatic classification.</p>
        </div>
        {selectedBook && (
          <div className={styles.headerActions}>
            <GuardedAdminLink className={styles.secondaryButton} href={`/admin/books/${encodeURIComponent(selectedBook)}`}>Back to selected book</GuardedAdminLink>
          </div>
        )}
      </header>

      {selectedBook && (
        <div className={styles.notice}>
          Book context: <strong>{selectedBook}</strong>. The current organization desk works across the catalog; it does not silently change this book just because you arrived from its workspace.
        </div>
      )}

      <section className={styles.hubGrid} aria-label="Organization tools">
        <WorkshopHubCard
          title="Collections, shelves, and topics"
          description={deployed
            ? "Review cover-led collections and taxonomy health. On the deployed Workshop, edits stay in the browser and can be exported; server-file saving is unavailable."
            : "Review cover-led collections, shelf lenses, topic health, and unassigned books. Local draft saving and export remain separate from publication."}
          status={deployed ? "Browser draft and export" : "Local draft workspace"}
          action="Open organization desk"
          href="/admin/taxonomy-review"
        />
        <WorkshopHubCard
          title="Series and reading paths"
          description="Use the retained series/path builder for ordered book lists. This is a legacy workspace and still loads its full versioned resource set before saving."
          status="Legacy versioned tool"
          action="Open series builder"
          href="/admin/legacy?view=paths"
        />
      </section>

      <div className={styles.capabilityNote}>Organization drafts do not publish books, rewrite topics, or alter manuscripts automatically.</div>
    </main>
  );
}
