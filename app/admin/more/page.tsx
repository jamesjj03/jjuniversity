import type { Metadata } from "next";
import WorkshopHubCard from "@/components/workshop/WorkshopHubCard";
import styles from "@/app/admin/WorkshopCore.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "All Tools | JJU Workshop",
  robots: { index: false, follow: false },
};

export default function MoreWorkshopPage() {
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workshop</p>
          <h1>All tools</h1>
          <p className={styles.intro}>Specialized and retained tools live here by name so they do not crowd the five everyday work modes.</p>
        </div>
      </header>

      <section className={styles.hubGrid} aria-label="Additional Workshop tools">
        <WorkshopHubCard
          title="Atlas editorial authority"
          description="Review map explanations and proposed links between JJU content and places. AI suggestions remain separate from human approval."
          status="Human review gate"
          action="Open Atlas review"
          href="/admin/atlas"
        />
        <WorkshopHubCard
          title="Reading activity"
          description="See signed-in reader minutes, qualified reads, trends, and per-book activity. Anonymous reading is not counted."
          status="Signed-in coverage only"
          action="Open reading analytics"
          href="/admin/reading"
        />
        <WorkshopHubCard
          title="Homepage"
          description="Edit featured and newest selections in the retained full workspace. This legacy editor still loads all of its versioned resources before saving."
          status="Legacy versioned tool"
          action="Open homepage editor"
          href="/admin/legacy?view=site"
        />
        <WorkshopHubCard
          title="Fiber"
          description="Edit the private Fiber page configuration in the retained full workspace. It is separate from the public book catalog."
          status="Legacy versioned tool"
          action="Open Fiber editor"
          href="/admin/legacy?view=fiber"
        />
        <WorkshopHubCard
          title="Full legacy workspace"
          description="The previous all-in-one admin remains available for tools not yet moved into focused routes. It loads Books, Series, Homepage, and Fiber together."
          status="Retained for compatibility"
          action="Open legacy workspace"
          href="/admin/legacy"
        />
        <WorkshopHubCard
          title="Public JJ University"
          description="Leave the protected Workshop and inspect the reader-facing site. Public pages do not expose Workshop controls."
          status="Public site"
          action="View JJ University"
          href="/"
        />
      </section>
    </main>
  );
}
