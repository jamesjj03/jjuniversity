import type { Metadata } from "next";
import WorkshopHubCard from "@/components/workshop/WorkshopHubCard";
import styles from "@/app/admin/WorkshopCore.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reviews | JJU Workshop",
  robots: { index: false, follow: false },
};

export default function ReviewsPage() {
  const deployed = process.env.VERCEL === "1";

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workshop</p>
          <h1>Reviews</h1>
          <p className={styles.intro}>Editorial decisions stay separate from manuscript text and publication. A review being complete is not the same thing as a book being factually verified.</p>
        </div>
      </header>

      <section className={styles.hubGrid} aria-label="Review tools">
        <WorkshopHubCard
          title="Editorial reviews"
          description="Open the editorial case index and review records without treating audit coverage as truth or automatic approval."
          status="Protected review index"
          action="Open editorial reviews"
          href="/admin/editorial"
        />
        <WorkshopHubCard
          title="Capitalization cases"
          description={deployed
            ? "The large audit artifact and writable decision file remain off the deployed site by design. The availability page explains the local workflow."
            : "Review capitalization candidates in the local workspace. Decisions remain separate from manuscript application."}
          status={deployed ? "Deployed unavailable · local only" : "Local review workspace"}
          action={deployed ? "See why it is unavailable" : "Open case review"}
          href="/admin/manuscript-case"
        />
        <WorkshopHubCard
          title="Atlas review"
          description="Inspect Atlas inventory and editorial layers. The protected Atlas backend must be configured; this hub does not imply that every Atlas record is publication-ready."
          status="Configured backend required"
          action="Open Atlas"
          href="/admin/atlas"
        />
        <WorkshopHubCard
          title="Arena source review"
          description={deployed
            ? "Arena decisions write local review files, so this tool is intentionally unavailable on the deployed Workshop."
            : "Review local Arena source candidates and draft packs. Writes remain in the local workspace."}
          status={deployed ? "Deployed unavailable · local only" : "Local file workspace"}
          action={deployed ? "Use the local Workshop" : "Open Arena review"}
          href={deployed ? undefined : "/admin/arena"}
        />
      </section>
    </main>
  );
}
