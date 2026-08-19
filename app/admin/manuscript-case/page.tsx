import type { Metadata } from "next";
import Link from "next/link";
import ManuscriptCaseReviewClient from "@/components/ManuscriptCaseReviewClient";
import styles from "@/components/ManuscriptCaseReview.module.css";
import { getCaseReviewAvailability, type CaseReviewAvailability } from "@/lib/manuscriptCaseReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manuscript Case Review | JJ University Admin",
  robots: { index: false, follow: false },
};

export default async function ManuscriptCaseReviewPage() {
  const availability = await getCaseReviewAvailability();

  if (!availability.available) {
    return <UnavailableReview availability={availability} />;
  }

  return <ManuscriptCaseReviewClient />;
}

function UnavailableReview({ availability }: { availability: CaseReviewAvailability }) {
  const deployed = availability.reason === "deployed";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Protected editorial tool</p>
          <h1>Opening Case Review</h1>
          <p>Review decisions remain separate from manuscripts and the public catalog.</p>
        </div>
        <div className={styles.headerLinks}>
          <Link href="/admin/editorial">Editorial reviews</Link>
          <Link href="/admin/taxonomy-review">Collections &amp; Taxonomy</Link>
        </div>
      </header>

      <section className={styles.unavailable} aria-labelledby="case-review-unavailable-title">
        <p className={styles.availabilityBadge}>{deployed ? "Local workspace only" : "Local audit required"}</p>
        <h2 id="case-review-unavailable-title">
          {deployed ? "This review desk does not run on the deployed site." : "This review desk is not ready in this workspace."}
        </h2>
        <p>{availability.message}</p>
        <p>
          {deployed
            ? "The large audit artifact and writable decision file stay off Vercel by design. Use the local JJ University development workspace for capitalization review."
            : "No manuscript or decision file was changed. Restore or regenerate the local manuscript quality audit, then reload this page."}
        </p>
        <div className={styles.unavailableActions}>
          <Link href="/admin/taxonomy-review">Open Collections &amp; Taxonomy</Link>
          <Link href="/admin">Back to Admin</Link>
        </div>
      </section>
    </main>
  );
}
