"use client";

import Link from "next/link";
import styles from "@/components/site-v2/SiteV2.module.css";

export default function SiteV2Error({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <section className={styles.statusPage}>
      <span>Something broke</span>
      <h1>This page didn&apos;t load.</h1>
      <p>Try it again. If it keeps happening, the contact page is the best place to report it.</p>
      <div className={styles.statusActions}>
        <button className={styles.primaryButton} type="button" onClick={unstable_retry}>Try again</button>
        <Link className={styles.secondaryButton} href="/contact">Contact</Link>
      </div>
    </section>
  );
}
