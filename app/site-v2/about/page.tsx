import Link from "next/link";
import type { Metadata } from "next";
import styles from "@/components/site-v2/SiteV2.module.css";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "About",
    description: "What JJ University is, how the books work, and how the project started.",
    path: "/about",
  }),
  robots: { index: false, follow: true },
};

export default function SiteV2AboutPage() {
  return (
    <article className={styles.aboutPage}>
      <header className={`${styles.pageHeaderCentered} ${styles.aboutHeader}`}>
        <h1>About JJ University</h1>
      </header>

      <div className={`${styles.aboutSections} ${styles.aboutEditorial}`}>
        <section className={styles.aboutRow}>
          <div className={styles.aboutRowHeading}>
            <h2>The basic idea</h2>
          </div>
          <div className={styles.aboutRowBody}>
            <p>JJ University is a collection of books written over the past year with one goal: to figure out how things actually work.</p>
            <p>I&apos;m not just talking one subject here. I&apos;m talking everything. Science, history, religion, psychology, culture, systems, people, ideas, and anything that helps explain reality in a clear, structured way.</p>
          </div>
        </section>

        <section className={styles.aboutRow}>
          <div className={styles.aboutRowHeading}>
            <h2>How the books work</h2>
          </div>
          <div className={styles.aboutRowBody}>
            <p>Each book takes one topic and breaks it into something you can actually understand without dragging it out forever.</p>
            <p>You can open any book and start there. There&apos;s no required order. Read enough of them and the connections start showing up.</p>
            <p>These books aren&apos;t meant to replace original sources, expert work, or your own judgment. They&apos;re meant to give you a useful way into a subject and enough context to keep going.</p>
          </div>
        </section>

        <section className={styles.aboutRow}>
          <div className={styles.aboutRowHeading}>
            <h2>How they&apos;re made</h2>
          </div>
          <div className={styles.aboutRowBody}>
            <p>This started less like a traditional author project and more like a personal knowledge system that turned into a library.</p>
            <p>I use AI during research and drafting. I choose the topics and decide how deep each one needs to go. It helps me gather material and get a first version moving. Then I rewrite, rearrange, cut, and keep messing with it until it sounds like me.</p>
            <p>Some books are further along than others. I&apos;m going back through the catalog now to fix weak sections, check facts, and improve the structure. That work isn&apos;t finished.</p>
          </div>
        </section>

        <section className={styles.aboutRow}>
          <div className={styles.aboutRowHeading}>
            <h2>How it started</h2>
          </div>
          <div className={styles.aboutRowBody}>
            <p>My name is James Johnson, but I usually go by JJ. I&apos;m 22 and from Dayton, Ohio. I never planned to become an author. For a while, I was mostly trying to figure out what I was supposed to do.</p>
            <p>Writing started with random ideas, then spread into bigger subjects. For a stretch, I was making books constantly, sometimes more than one in a day. I&apos;d be delivering pizzas while thinking about chapters, then go home and build them.</p>
            <p>A lot got thrown away or restarted. I spent ridiculous amounts of time on the covers too, sometimes losing my mind over a color palette. Later, I worked with a lot of narrators to turn many of the books into audiobooks.</p>
          </div>
        </section>

        <section className={styles.aboutRow}>
          <div className={styles.aboutRowHeading}>
            <h2>Where it stands</h2>
          </div>
          <div className={styles.aboutRowBody}>
            <p>I&apos;ve slowed down on writing new books so I can improve what&apos;s already here. Right now I&apos;m focused on editing, fact checking, organization, and figuring out how far the project can go without losing what made it useful in the first place.</p>
          </div>
        </section>

        <aside className={`${styles.aboutDisclaimer} ${styles.aboutRow}`}>
          <div className={styles.aboutRowHeading}>
            <strong>Independent educational project</strong>
          </div>
          <div className={styles.aboutRowBody}>
            <p>JJ University isn&apos;t accredited, it isn&apos;t a literal university, and it doesn&apos;t award degrees. Use it to learn, think, and explore, not as the final word on anything.</p>
          </div>
        </aside>
      </div>

      <div className={styles.aboutAction}>
        <Link className={styles.primaryButton} href="/books">Browse the books</Link>
      </div>
    </article>
  );
}
