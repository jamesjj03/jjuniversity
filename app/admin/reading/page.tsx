import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import ReadingAnalyticsSummary from "@/components/workshop/ReadingAnalyticsSummary";
import styles from "@/components/workshop/ReadingAnalytics.module.css";
import { readReadingAnalytics, type ReadingAnalyticsTrendPoint } from "@/lib/readingAnalytics";
import workshopStyles from "@/app/admin/WorkshopCore.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Reading | JJU Workshop",
  robots: { index: false, follow: false, nocache: true },
};

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function ReadingTrend({
  title,
  points,
  value,
  qualified = false,
}: {
  title: string;
  points: ReadingAnalyticsTrendPoint[];
  value: (point: ReadingAnalyticsTrendPoint) => number;
  qualified?: boolean;
}) {
  const maximum = Math.max(0, ...points.map(value));
  const first = points[0]?.label || "30 days ago";
  const last = points.at(-1)?.label || "Today";

  return (
    <article className={`${styles.chart} ${qualified ? styles.qualifiedChart : ""}`}>
      <h3>{title}</h3>
      <ol className={styles.chartBars} aria-label={`${title} by day`}>
        {points.map(point => {
          const amount = value(point);
          const height = maximum > 0 ? Math.max(3, amount / maximum * 100) : 0;
          return (
            <li key={point.date} title={`${point.label}: ${formatNumber(amount)}`}>
              <span
                className={styles.chartBar}
                style={{
                  "--bar-height": `${height}%`,
                  "--bar-min-height": amount > 0 ? "3px" : "0",
                } as CSSProperties}
                aria-hidden="true"
              />
              <span className={styles.srOnly}>{point.label}: {formatNumber(amount)}</span>
            </li>
          );
        })}
      </ol>
      <div className={styles.chartAxis} aria-hidden="true"><span>{first}</span><span>{last}</span></div>
    </article>
  );
}

export default async function ReadingAnalyticsPage() {
  const result = await readReadingAnalytics();
  const hasData = result.status === "available" && result.eventRows30d > 0;

  return (
    <main className={workshopStyles.page}>
      <header className={workshopStyles.pageHeader}>
        <div>
          <p className={workshopStyles.eyebrow}>Workshop</p>
          <h1>Reading</h1>
          <p className={workshopStyles.intro}>See which books signed-in readers are spending time with. This report shows directional aggregate activity, not individual reading histories or audited circulation.</p>
        </div>
        <div className={workshopStyles.headerActions}>
          <GuardedAdminLink className={workshopStyles.quietButton} href="/admin">Back to Workshop</GuardedAdminLink>
        </div>
      </header>

      <div className={styles.reportStack}>
        <section className={styles.coverageNote} aria-label="Reading analytics coverage">
          <div>
            <strong>{result.coverage.label}</strong>
            <p>{result.coverage.detail}</p>
          </div>
          <div>
            <strong>What counts as a qualified read</strong>
            <p>{result.coverage.qualifiedReadDefinition}</p>
          </div>
        </section>

        <ReadingAnalyticsSummary result={result} heading="Reading activity" showDetailLink={false} />

        {result.status === "available" && !hasData ? (
          <section className={styles.emptyState}>
            <span className={styles.coverageBadge}>No recorded activity</span>
            <h2>No signed-in reading events yet</h2>
            <p>The Reader has not recorded an engaged minute or qualified read in the last 30 days. That is an honest zero for this signed-in-only report—not evidence that nobody has read the books.</p>
          </section>
        ) : null}

        {result.status === "available" && hasData ? (
          <>
            <section className={styles.panel} aria-labelledby="reading-trends-heading">
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.coverageBadge}>Rolling 30 days</span>
                  <h2 id="reading-trends-heading">Daily activity</h2>
                  <p>Events appear on the day the Reader recorded them.</p>
                </div>
              </header>
              <div className={styles.chartGrid}>
                <ReadingTrend title="Engaged minutes" points={result.trend} value={point => point.engagedMinutes} />
                <ReadingTrend title="Qualified reads" points={result.trend} value={point => point.qualifiedReads} qualified />
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="reading-books-heading">
              <header className={styles.panelHeader}>
                <div>
                  <span className={styles.coverageBadge}>{formatNumber(result.books.length)} active book{result.books.length === 1 ? "" : "s"}</span>
                  <h2 id="reading-books-heading">Activity by book</h2>
                  <p>Sorted by engaged minutes in the last 30 days.</p>
                </div>
              </header>
              <div className={styles.tableWrap}>
                <table className={styles.bookTable}>
                  <thead>
                    <tr>
                      <th scope="col">Book</th>
                      <th scope="col">Minutes · 7d</th>
                      <th scope="col">Minutes · 30d</th>
                      <th scope="col">Qualified reads</th>
                      <th scope="col">Readers</th>
                      <th scope="col">Latest activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.books.map(book => (
                      <tr key={book.bookId}>
                        <td data-label="Book">
                          <span className={styles.bookTitle}>
                            <GuardedAdminLink href={`/admin/books/${encodeURIComponent(book.bookId)}`} prefetch={false}>{book.title}</GuardedAdminLink>
                            <small>{book.titleAvailable ? book.bookId : `${book.bookId} · catalog title unavailable`}</small>
                          </span>
                        </td>
                        <td data-label="Minutes · 7d">{formatNumber(book.engagedMinutes7d)}</td>
                        <td data-label="Minutes · 30d">{formatNumber(book.engagedMinutes30d)}</td>
                        <td data-label="Qualified reads">{formatNumber(book.qualifiedReads30d)}</td>
                        <td data-label="Readers">{formatNumber(book.uniqueReaders30d)}</td>
                        <td className={styles.lastActivity} data-label="Latest activity">{dateTimeFormatter.format(new Date(book.lastActivityAt))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
