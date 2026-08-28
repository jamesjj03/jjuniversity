import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import WorkshopAddressCard from "@/components/workshop/WorkshopAddressCard";
import WorkshopResumePanel from "@/components/workshop/WorkshopResumePanel";
import { WorkshopFinderButton } from "@/components/workshop/WorkshopShell";
import styles from "@/components/workshop/WorkshopHome.module.css";

export default function AdminPage() {
  return (
    <main className={styles.home}>
      <header className={styles.homeHeader}>
        <span className={styles.eyebrow}>JJU Workshop</span>
        <h1>What do you want to work on?</h1>
        <p>This is the permanent front door. Find a book, resume the exact desk you last opened, or enter one of five clear work modes.</p>
      </header>

      <WorkshopAddressCard />

      <section className={styles.startGrid} aria-label="Start or resume work">
        <WorkshopFinderButton className={styles.finderLaunch}>
          <span aria-hidden="true">⌕</span>
          <span><strong>Find any book</strong><small>Title, subtitle, series, or book ID</small></span>
          <b>Open the finder →</b>
        </WorkshopFinderButton>
        <WorkshopResumePanel />
      </section>

      <section className={styles.modeSection} aria-labelledby="work-modes-heading">
        <header>
          <h2 id="work-modes-heading">Five ways to work</h2>
          <p>The same five modes stay put on desktop and phone. Every specialized tool has a named home.</p>
        </header>
        <div className={styles.modeGrid}>
          <article className={styles.modeCard}>
            <span className={styles.modeNumber}>01</span><h3>Books</h3><p>Write manuscripts, edit details, or start a hidden draft.</p>
            <div className={styles.modeActions}><GuardedAdminLink href="/admin/books">Browse <b>→</b></GuardedAdminLink><GuardedAdminLink href="/admin/books/new">New book <b>→</b></GuardedAdminLink></div>
          </article>
          <article className={styles.modeCard}>
            <span className={styles.modeNumber}>02</span><h3>Collections</h3><p>Organize series, audit Topics, and review taxonomy.</p>
            <div className={styles.modeActions}><GuardedAdminLink href="/admin/organize">Organize <b>→</b></GuardedAdminLink><GuardedAdminLink href="/admin/topics">Topics <b>→</b></GuardedAdminLink></div>
          </article>
          <article className={styles.modeCard}>
            <span className={styles.modeNumber}>03</span><h3>Print</h3><p>Design the series system, spines, formats, notices, pricing, and proofs.</p>
            <div className={styles.modeActions}><GuardedAdminLink href="/admin/print">Design lab <b>→</b></GuardedAdminLink><GuardedAdminLink href="/admin/print/proofs">Proofs <b>→</b></GuardedAdminLink></div>
          </article>
          <article className={styles.modeCard}>
            <span className={styles.modeNumber}>04</span><h3>Audio</h3><p>Listen to editions and manage narrator work.</p>
            <div className={styles.modeActions}><GuardedAdminLink href="/admin/audio">Audio QA <b>→</b></GuardedAdminLink><GuardedAdminLink href="/admin/narrators">Narrators <b>→</b></GuardedAdminLink></div>
          </article>
          <article className={styles.modeCard}>
            <span className={styles.modeNumber}>05</span><h3>Review</h3><p>Handle the editorial decisions that require your eyes.</p>
            <div className={styles.modeActions}><GuardedAdminLink href="/admin/reviews">Queue <b>→</b></GuardedAdminLink><GuardedAdminLink href="/admin/reading">Reading <b>→</b></GuardedAdminLink></div>
          </article>
        </div>
      </section>

      <footer className={styles.homeFooter}>
        <span>Homepage, Fiber, Atlas, Arena, and retained tools remain available without crowding everyday work.</span>
        <GuardedAdminLink href="/admin/more">See all tools →</GuardedAdminLink>
      </footer>
    </main>
  );
}
