import Link from "next/link";
import styles from "@/components/site-v2/SiteV2.module.css";

export default function SiteV2NotFound() {
  return (
    <section className={styles.statusPage}>
      <span>404</span>
      <h1>That page isn&apos;t here.</h1>
      <p>The link may be old, or the book may have moved.</p>
      <Link className={styles.primaryButton} href="/books">Browse the books</Link>
    </section>
  );
}
