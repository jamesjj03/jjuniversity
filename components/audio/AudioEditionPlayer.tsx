"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublishedAudioEdition } from "@/lib/audioCatalog";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import styles from "./AudioEditionPlayer.module.css";

function formatDuration(seconds: number) {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function AudioEditionPlayer({
  edition,
  bookSlug,
  candidatePreviewKey,
}: {
  edition: PublishedAudioEdition;
  bookSlug: string;
  candidatePreviewKey?: string | null;
}) {
  const [trackIndex, setTrackIndex] = useState(0);
  const [accountReady, setAccountReady] = useState(edition.accessModel === "free");
  const [accountChecked, setAccountChecked] = useState(edition.accessModel !== "account" || !hasSupabaseConfig());
  const [error, setError] = useState("");
  const track = edition.tracks[trackIndex];

  useEffect(() => {
    if (edition.accessModel !== "account") return;
    if (!hasSupabaseConfig()) return;
    const supabase = createSupabaseBrowserClient();
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setAccountReady(Boolean(data.user?.email_confirmed_at));
      setAccountChecked(true);
    });
    return () => {
      active = false;
    };
  }, [edition.accessModel]);

  function chooseTrack(index: number) {
    setError("");
    setTrackIndex(index);
  }

  if (!accountChecked) {
    return <div className={styles.accountGate}><p>Checking your account…</p></div>;
  }

  if (!accountReady) {
    return (
      <div className={styles.accountGate}>
        <p>Sign in with a verified JJ University account to listen.</p>
        <Link className={styles.accountLink} href={`/account?next=${encodeURIComponent(`/listen/${bookSlug}`)}`}>Sign in</Link>
      </div>
    );
  }

  return (
    <section className={styles.player} aria-label="Audiobook player">
      {candidatePreviewKey ? (
        <p className={styles.candidateNotice}>Private listening proof · Danny&apos;s recovered email masters</p>
      ) : null}
      <div className={styles.nowPlaying} aria-live="polite">
        <span>Now playing</span>
        <strong>{track.title}</strong>
      </div>

      <audio
        key={`${track.id}:${candidatePreviewKey || "published"}`}
        className={styles.audio}
        controls
        preload="metadata"
        src={`/api/audio/editions/${encodeURIComponent(edition.id)}/tracks/${encodeURIComponent(track.id)}${candidatePreviewKey ? `?candidate=${encodeURIComponent(candidatePreviewKey)}` : ""}`}
        onEnded={() => {
          if (trackIndex < edition.tracks.length - 1) chooseTrack(trackIndex + 1);
        }}
        onError={() => setError("That track could not be loaded. Try it again in a moment.")}
      >
        Your browser does not support audio playback.
      </audio>
      {error && <p className={styles.error} role="status">{error}</p>}

      <div className={styles.transport}>
        <button type="button" disabled={trackIndex === 0} onClick={() => chooseTrack(Math.max(0, trackIndex - 1))}>Previous track</button>
        <button type="button" disabled={trackIndex === edition.tracks.length - 1} onClick={() => chooseTrack(Math.min(edition.tracks.length - 1, trackIndex + 1))}>Next track</button>
      </div>

      <div className={styles.tracks}>
        <h2>Tracks</h2>
        <ol className={styles.trackList}>
          {edition.tracks.map((item, index) => (
            <li key={item.id}>
              <button type="button" data-active={index === trackIndex} aria-current={index === trackIndex ? "true" : undefined} onClick={() => chooseTrack(index)}>
                <span className={styles.trackNumber}>{String(item.position).padStart(2, "0")}</span>
                <span>{item.title}</span>
                <span className={styles.trackDuration}>{formatDuration(item.durationSeconds)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
