import Link from "next/link";
import type { Metadata } from "next";
import styles from "@/components/site-v2/SiteV2.module.css";

export const metadata: Metadata = {
  title: "Explore",
  description: "Explore JJ University books, collections, and print editions.",
};

export default function SiteV2ExplorePage() {
  return (
    <article className={`${styles.aboutPage} siteV2ExplorePage`}>
      <header className={styles.pageHeaderCentered}>
        <h1>Explore</h1>
        <p>Find a subject, follow a collection, or see what is becoming a physical edition.</p>
      </header>

      <div className={styles.aboutSections}>
        <section>
          <h2>Collections</h2>
          <p>Browse the catalog by shelf, topic, or the collections that connect books around one idea.</p>
          <div className={styles.aboutAction}>
            <Link className={styles.primaryButton} href="/books">Browse books</Link>
          </div>
        </section>

        <section>
          <h2>Print</h2>
          <p>See the paperback collections being prepared without losing the free online library.</p>
          <div className={styles.aboutAction}>
            <Link className={styles.primaryButton} href="/print">See print editions</Link>
          </div>
        </section>
      </div>
    </article>
  );
}
