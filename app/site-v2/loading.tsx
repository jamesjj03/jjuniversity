import styles from "@/components/site-v2/SiteV2.module.css";

export default function SiteV2Loading() {
  return (
    <div className={styles.loadingPage} role="status" aria-live="polite">
      <span className={styles.loadingLine} />
      <span className={styles.loadingLine} />
      <span className={styles.loadingLine} />
      <span className={styles.visuallyHidden}>Loading page</span>
    </div>
  );
}
