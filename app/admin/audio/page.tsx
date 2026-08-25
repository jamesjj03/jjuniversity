import type { Metadata } from "next";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import { readTacosAudioReview } from "@/lib/audioReview";
import styles from "./AudioReview.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Audio Review | JJU Workshop",
  robots: { index: false, follow: false, nocache: true },
};

const LISTEN_HREF = "/listen/everything-i-touch-turns-to-tacos";

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AudioReviewPage() {
  const review = await readTacosAudioReview();

  if (review.status === "unavailable") {
    return (
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Workshop · Audio review</p>
            <h1>Audio review is locked.</h1>
            <p className={styles.intro}>This page only shows a complete, exact QA package. It never fills gaps with partial data.</p>
          </div>
          <GuardedAdminLink className={styles.secondaryLink} href="/admin">Back to Workshop</GuardedAdminLink>
        </header>
        <section className={styles.errorPanel} role="alert">
          <strong>No audio data shown</strong>
          <p>{review.message}</p>
        </section>
      </main>
    );
  }

  const flaggedTracks = review.tracks.filter(track => track.flags.length > 0);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workshop · Audio review</p>
          <h1>{review.title}</h1>
          <p className={styles.intro}>Narrated by {review.narrator}. This is a read-only QA desk: no upload, approval, or publishing action exists here.</p>
        </div>
        <div className={styles.headerActions}>
          {review.previewAvailable ? (
            <GuardedAdminLink className={styles.primaryLink} href={LISTEN_HREF} prefetch={false}>Open listening proof</GuardedAdminLink>
          ) : null}
          <GuardedAdminLink className={styles.secondaryLink} href="/admin">Back to Workshop</GuardedAdminLink>
        </div>
      </header>

      <section className={styles.releaseBanner} aria-labelledby="audio-release-state">
        <span className={styles.releaseBadge}>QA · Not published</span>
        <div>
          <h2 id="audio-release-state">Technical pass is complete. Human listening is not.</h2>
          <p>The files are staged for private review. This page does not grant publication approval or enable production audio.</p>
        </div>
      </section>

      <section className={styles.metricGrid} aria-label="Audio review status">
        <article className={styles.metric}>
          <span>Objective technical pass</span>
          <strong>{review.technicalPassCount}/16</strong>
          <small>Exact positions and private-file byte checks</small>
        </article>
        <article className={styles.metric}>
          <span>Human listening</span>
          <strong>{review.humanCheckCount} pending</strong>
          <small>Across {review.flaggedTrackCount} flagged tracks</small>
        </article>
        <article className={styles.metric}>
          <span>Package</span>
          <strong>{formatDuration(review.totalSeconds)}</strong>
          <small>{formatBytes(review.totalBytes)} · 16 MP3s</small>
        </article>
      </section>

      <section className={styles.panel} aria-labelledby="technical-pass-heading">
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.passBadge}>16/16 pass</span>
            <h2 id="technical-pass-heading">What the technical pass proves</h2>
          </div>
        </header>
        <ul className={styles.checkList}>
          <li>Track positions 1–16 are complete, unique, and tied to the exact Tacos edition.</li>
          <li>Every selected MP3&apos;s catalog row matches the approved title, section, duration, byte count, and recorded SHA-256 metadata.</li>
          <li>All 16 selected objects are present in private Storage at the expected byte counts; Storage bytes have not yet been independently re-hashed.</li>
          <li>The technical pass does not judge pacing, room tone, cutoff quality, or publication readiness.</li>
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="human-flags-heading">
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.pendingBadge}>{review.humanCheckCount} checks pending</span>
            <h2 id="human-flags-heading">Human listen list</h2>
            <p>These are targeted moments, not automatic failures. Listen and decide by ear.</p>
          </div>
          {review.previewAvailable ? (
            <GuardedAdminLink className={styles.compactListenLink} href={LISTEN_HREF} prefetch={false}>Listen now</GuardedAdminLink>
          ) : (
            <span className={styles.previewUnavailable}>Listening link appears only on the verified audio preview.</span>
          )}
        </header>
        <ol className={styles.flagList}>
          {flaggedTracks.map(track => (
            <li key={track.position}>
              <span className={styles.trackNumber}>{String(track.position).padStart(2, "0")}</span>
              <div>
                <strong>{track.title}</strong>
                {track.flags.map(flag => (
                  <p key={flag.label}><b>{flag.label}:</b> {flag.detail}</p>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.panel} aria-labelledby="all-tracks-heading">
        <header className={styles.panelHeader}>
          <div>
            <span className={styles.passBadge}>Objective package</span>
            <h2 id="all-tracks-heading">All 16 tracks</h2>
            <p>“Technical pass” is machine-verifiable. A track without a flag is not automatically human-approved.</p>
          </div>
        </header>
        <ol className={styles.trackGrid}>
          {review.tracks.map(track => (
            <li className={track.flags.length ? styles.flaggedTrack : styles.track} key={track.position}>
              <div className={styles.trackTopline}>
                <span className={styles.trackNumber}>{String(track.position).padStart(2, "0")}</span>
                <span className={styles.technicalBadge}>Technical pass</span>
              </div>
              <strong>{track.title}</strong>
              <span className={styles.trackMeta}>{formatDuration(track.durationSeconds)} · {formatBytes(track.bytes)}</span>
              {track.flags.length ? (
                <div className={styles.flagChips} role="group" aria-label={`Human checks for track ${track.position}`}>
                  {track.flags.map(flag => <span key={flag.label}>{flag.label}</span>)}
                </div>
              ) : (
                <span className={styles.noFlag}>No targeted flag in this pass</span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
