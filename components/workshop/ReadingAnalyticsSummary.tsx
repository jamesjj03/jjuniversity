import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import type { ReadingAnalyticsResult } from "@/lib/readingAnalytics";
import styles from "./ReadingAnalytics.module.css";

type Props = {
  result: ReadingAnalyticsResult;
  heading?: string;
  showDetailLink?: boolean;
};

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

export default function ReadingAnalyticsSummary({
  result,
  heading = "Signed-in reading",
  showDetailLink = true,
}: Props) {
  return (
    <section className={styles.summarySection} aria-labelledby="reading-summary-heading">
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.coverageBadge}>{result.coverage.label}</span>
          <h2 id="reading-summary-heading">{heading}</h2>
          <p>Last 30 days, except the card marked 7 days. Directional Reader activity.</p>
        </div>
        {showDetailLink ? (
          <GuardedAdminLink className={styles.detailLink} href="/admin/reading" prefetch={false}>
            Open reading report
          </GuardedAdminLink>
        ) : null}
      </header>

      {result.status === "unavailable" ? (
        <div className={styles.unavailable} role="status">
          <strong>Reading totals unavailable</strong>
          <span>{result.message}</span>
        </div>
      ) : (
        <div className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>Engaged minutes</span>
            <strong>{formatNumber(result.summary.engagedMinutes7d)}</strong>
            <small>Last 7 days</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Engaged minutes</span>
            <strong>{formatNumber(result.summary.engagedMinutes30d)}</strong>
            <small>Last 30 days</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Qualified reads</span>
            <strong>{formatNumber(result.summary.qualifiedReads30d)}</strong>
            <small>Last 30 days</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Signed-in readers</span>
            <strong>{formatNumber(result.summary.uniqueReaders30d)}</strong>
            <small>Unique · last 30 days</small>
          </article>
          <article className={`${styles.summaryCard} ${styles.topBookCard}`}>
            <span>Top book</span>
            <strong>{result.summary.topBook30d?.title || "No activity yet"}</strong>
            <small>
              {result.summary.topBook30d
                ? `${formatNumber(result.summary.topBook30d.engagedMinutes)} engaged min · ${formatNumber(result.summary.topBook30d.qualifiedReads)} qualified reads`
                : "Last 30 days"}
            </small>
          </article>
        </div>
      )}
    </section>
  );
}
