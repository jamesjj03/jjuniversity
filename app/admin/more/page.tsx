import type { Metadata } from "next";
import WorkshopHubCard from "@/components/workshop/WorkshopHubCard";
import styles from "@/app/admin/WorkshopCore.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "More | JJU Workshop",
  robots: { index: false, follow: false },
};

export default function MoreWorkshopPage() {
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workshop</p>
          <h1>More</h1>
          <p className={styles.intro}>Specialized and retained tools live here so they do not crowd the everyday book workflow. Legacy labels are intentional.</p>
        </div>
      </header>

      <section className={styles.hubGrid} aria-label="Additional Workshop tools">
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
          title="Atlas quick controls"
          description="Open the retained Atlas visibility and inventory controls inside the old full workspace. Use Reviews for the dedicated Atlas desk."
          status="Legacy full-load tool"
          action="Open Atlas quick controls"
          href="/admin/legacy?view=atlas"
        />
        <WorkshopHubCard
          title="Full legacy workspace"
          description="The previous all-in-one admin remains available for tools not yet moved into focused routes. It loads Books, Series, Homepage, Atlas quick controls, and Fiber together."
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
