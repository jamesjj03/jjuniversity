import type { Metadata } from "next";
import Link from "next/link";
import { getCaseReviewAvailability } from "@/lib/manuscriptCaseReview";
import styles from "./EditorialIndex.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Editorial Reviews | JJ University Admin",
  robots: { index: false, follow: false },
};

export default async function EditorialIndexPage() {
  const caseReview = await getCaseReviewAvailability();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Protected editorial tools</p>
          <h1>Editorial Reviews</h1>
          <span>Human decisions stay separate from the public library until they are deliberately applied.</span>
        </div>
        <Link href="/admin">Back to Admin</Link>
      </header>

      <section className={styles.tools} aria-label="Editorial review tools">
        <article>
          <div className={`${styles.status} ${caseReview.available ? "" : styles.localStatus}`}>
            <span aria-hidden="true" />{caseReview.available ? "Ready locally" : "Local only"}
          </div>
          <h2>Opening Case Review</h2>
          <p>
            {caseReview.available
              ? "Review the all-cap openings identified across manuscript sections. Accepting wording records a decision without editing a book."
              : "The large audit and writable decisions stay in the local workspace. The deployed route explains that boundary without loading or changing review data."}
          </p>
          <Link href="/admin/manuscript-case">{caseReview.available ? "Open capitalization review" : "View local-only details"}</Link>
        </article>

        <article>
          <div className={styles.status}><span aria-hidden="true" />Ready</div>
          <h2>Collections &amp; Taxonomy</h2>
          <p>Sort print-ready Collections by cover, audit overlap, and review the separate Shelf and Topic layers without changing the live catalog.</p>
          <Link href="/admin/taxonomy-review">Open sorting desk</Link>
        </article>
      </section>
    </main>
  );
}
