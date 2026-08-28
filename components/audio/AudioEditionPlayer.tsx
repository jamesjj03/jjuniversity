"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublishedAudioEdition } from "@/lib/audioCatalog";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import styles from "./AudioEditionPlayer.module.css";

type StoredAudioProgress = {
  trackId: string;
  currentTime: number;
  completedTrackIds: string[];
};

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function readStoredProgress(key: string): StoredAudioProgress | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<StoredAudioProgress> | null;
    if (!value || typeof value.trackId !== "string") return null;
    return {
      trackId: value.trackId,
      currentTime: Number.isFinite(value.currentTime) && Number(value.currentTime) >= 0 ? Number(value.currentTime) : 0,
      completedTrackIds: Array.isArray(value.completedTrackIds)
        ? value.completedTrackIds.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return null;
  }
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
  const progressKey = `jju.audio-progress.${edition.id}`;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resumeRef = useRef<{ trackId: string; seconds: number } | null>(null);
  const lastStoredSecondRef = useRef(-1);
  const [trackIndex, setTrackIndex] = useState(0);
  const [completedTrackIds, setCompletedTrackIds] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(edition.tracks[0]?.durationSeconds || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mobileControlsActivated, setMobileControlsActivated] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [accountReady, setAccountReady] = useState(edition.accessModel === "free");
  const [accountChecked, setAccountChecked] = useState(edition.accessModel !== "account" || !hasSupabaseConfig());
  const [error, setError] = useState("");
  const track = edition.tracks[trackIndex];
  const nextTrack = edition.tracks[trackIndex + 1] || null;
  const previousTrack = edition.tracks[trackIndex - 1] || null;
  const completedSet = useMemo(() => new Set(completedTrackIds), [completedTrackIds]);
  const trackProgress = Math.min(1, currentTime / Math.max(1, duration || track?.durationSeconds || 1));
  const overallProgress = Math.min(
    100,
    ((completedTrackIds.length + (track && !completedSet.has(track.id) ? trackProgress : 0)) / Math.max(1, edition.tracks.length)) * 100,
  );

  useEffect(() => {
    if (edition.accessModel !== "account" || !hasSupabaseConfig()) return;
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

  useEffect(() => {
    const stored = readStoredProgress(progressKey);
    if (!stored) return;
    const timer = window.setTimeout(() => {
      const restoredIndex = edition.tracks.findIndex(item => item.id === stored.trackId);
      if (restoredIndex >= 0 && !stored.completedTrackIds.includes(stored.trackId)) {
        resumeRef.current = { trackId: stored.trackId, seconds: stored.currentTime };
        setTrackIndex(restoredIndex);
        setCurrentTime(stored.currentTime);
        setDuration(edition.tracks[restoredIndex]?.durationSeconds || 0);
      }
      setCompletedTrackIds(stored.completedTrackIds.filter(id => edition.tracks.some(item => item.id === id)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [edition.tracks, progressKey]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: edition.narratorName,
      album: bookSlug.replace(/-/g, " "),
    });
    const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ["play", () => { void audioRef.current?.play(); }],
      ["pause", () => audioRef.current?.pause()],
      ["seekbackward", details => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 15));
      }],
      ["seekforward", details => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 15));
      }],
    ];
    for (const [action, handler] of actions) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Optional browser integration. */ }
    }
    return () => {
      for (const [action] of actions) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Optional browser integration. */ }
      }
    };
  }, [bookSlug, edition.narratorName, track]);

  function storeProgress(seconds: number, completed = completedTrackIds, selectedTrack = track) {
    if (!selectedTrack) return;
    try {
      localStorage.setItem(progressKey, JSON.stringify({
        trackId: selectedTrack.id,
        currentTime: Math.max(0, Number.isFinite(seconds) ? seconds : 0),
        completedTrackIds: completed,
      } satisfies StoredAudioProgress));
    } catch {
      // Playback continues when browser storage is unavailable.
    }
  }

  function chooseTrack(index: number, persistCurrent = true) {
    const bounded = Math.max(0, Math.min(edition.tracks.length - 1, index));
    if (persistCurrent && audioRef.current && track) storeProgress(audioRef.current.currentTime);
    setError("");
    setIsPlaying(false);
    setMobileControlsActivated(true);
    setCurrentTime(0);
    setDuration(edition.tracks[bounded]?.durationSeconds || 0);
    resumeRef.current = null;
    lastStoredSecondRef.current = -1;
    setTrackIndex(bounded);
  }

  function seekBy(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || duration || Infinity, audio.currentTime + delta));
    setCurrentTime(audio.currentTime);
    storeProgress(audio.currentTime);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    setError("");
    setMobileControlsActivated(true);
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch {
      setError("That track could not start. Try it again in a moment.");
    }
  }

  function finishTrack() {
    const completed = completedSet.has(track.id) ? completedTrackIds : [...completedTrackIds, track.id];
    setCompletedTrackIds(completed);
    storeProgress(0, completed, nextTrack || track);
    if (nextTrack) chooseTrack(trackIndex + 1, false);
    else setIsPlaying(false);
  }

  if (!track) return null;

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

      <div className={styles.playerLayout}>
        <div className={styles.playbackPanel}>
          <div className={styles.nowPlaying} aria-live="polite">
            <div>
              <span>{isPlaying ? "Now playing" : currentTime > 0 ? "Ready to resume" : "Selected chapter"} · {track.position} of {edition.tracks.length}</span>
              <strong>{track.title}</strong>
            </div>
            <label className={styles.speedControl}>
              <span>Speed</span>
              <select
                aria-label="Playback speed"
                value={playbackRate}
                onChange={event => {
                  const rate = Number(event.target.value);
                  setPlaybackRate(rate);
                  if (audioRef.current) audioRef.current.playbackRate = rate;
                }}
              >
                {[0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
              </select>
            </label>
          </div>

          <audio
            ref={audioRef}
            key={`${track.id}:${candidatePreviewKey || "published"}`}
            preload="metadata"
            src={`/api/audio/editions/${encodeURIComponent(edition.id)}/tracks/${encodeURIComponent(track.id)}${candidatePreviewKey ? `?candidate=${encodeURIComponent(candidatePreviewKey)}` : ""}`}
            onLoadedMetadata={event => {
              const audio = event.currentTarget;
              audio.playbackRate = playbackRate;
              setDuration(Number.isFinite(audio.duration) ? audio.duration : track.durationSeconds);
              const resume = resumeRef.current;
              if (resume?.trackId === track.id && resume.seconds > 0 && resume.seconds < audio.duration - 2) {
                audio.currentTime = resume.seconds;
                setCurrentTime(resume.seconds);
                resumeRef.current = null;
              }
            }}
            onTimeUpdate={event => {
              const seconds = event.currentTarget.currentTime;
              setCurrentTime(seconds);
              const whole = Math.floor(seconds);
              if (whole > 0 && whole !== lastStoredSecondRef.current && whole % 5 === 0) {
                lastStoredSecondRef.current = whole;
                storeProgress(seconds);
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={event => {
              setIsPlaying(false);
              storeProgress(event.currentTarget.currentTime);
            }}
            onEnded={finishTrack}
            onError={() => setError("That track could not be loaded. Try it again in a moment.")}
          >
            Your browser does not support audio playback.
          </audio>

          <div className={styles.timeline}>
            <input
              aria-label={`Position in ${track.title}`}
              type="range"
              min="0"
              max={Math.max(1, duration || track.durationSeconds)}
              step="0.1"
              value={Math.min(currentTime, Math.max(1, duration || track.durationSeconds))}
              style={{ "--track-progress": `${trackProgress * 100}%` } as CSSProperties}
              onChange={event => {
                const seconds = Number(event.target.value);
                if (audioRef.current) audioRef.current.currentTime = seconds;
                setCurrentTime(seconds);
                storeProgress(seconds);
              }}
            />
            <div><span>{formatDuration(currentTime)}</span><span>−{formatDuration(Math.max(0, (duration || track.durationSeconds) - currentTime))}</span></div>
          </div>

          <div className={styles.transport} data-mobile-docked={mobileControlsActivated || isPlaying || currentTime > 0}>
            <button type="button" onClick={() => seekBy(-15)} aria-label="Go back 15 seconds"><span aria-hidden="true">↶</span><small>15</small></button>
            <button className={styles.playButton} type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause audiobook" : currentTime > 0 ? "Resume audiobook" : "Play audiobook"}>
              <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
              <small>{isPlaying ? "Pause" : currentTime > 0 ? "Resume" : "Play"}</small>
            </button>
            <button type="button" onClick={() => seekBy(15)} aria-label="Go forward 15 seconds"><span aria-hidden="true">↷</span><small>15</small></button>
          </div>

          <div className={styles.chapterNav} aria-label="Chapter navigation">
            <button type="button" disabled={!previousTrack} onClick={() => chooseTrack(trackIndex - 1)}>
              <span>← Previous</span>
              <strong>{previousTrack?.title || "Beginning"}</strong>
            </button>
            <button type="button" disabled={!nextTrack} onClick={() => chooseTrack(trackIndex + 1)}>
              <span>Next →</span>
              <strong>{nextTrack?.title || "End of audiobook"}</strong>
            </button>
          </div>

          {error && <p className={styles.error} role="status">{error}</p>}

          <div className={styles.upNext}>
            <span>Up next</span>
            <strong>{nextTrack ? `${String(nextTrack.position).padStart(2, "0")} · ${nextTrack.title}` : "You’re at the end of the audiobook"}</strong>
          </div>
        </div>

        <div className={styles.tracks}>
          <div className={styles.trackHeading}>
            <div>
              <p>Listening progress</p>
              <h2>Chapters</h2>
            </div>
            <strong>{completedTrackIds.length}<span> / {edition.tracks.length}</span></strong>
          </div>
          <div
            className={styles.overallProgress}
            role="progressbar"
            aria-label="Overall audiobook progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overallProgress)}
          >
            <span style={{ width: `${overallProgress}%` }} />
          </div>
          <ol className={styles.trackList}>
            {edition.tracks.map((item, index) => {
              const complete = completedSet.has(item.id);
              const active = index === trackIndex;
              const status = active ? "active" : complete ? "listened" : index === trackIndex + 1 ? "up-next" : "queued";
              const statusLabel = active
                ? isPlaying ? "Playing" : currentTime > 0 ? "In progress" : "Selected"
                : complete ? "Listened" : status === "up-next" ? "Up next" : "";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-status={status}
                    aria-current={active ? "true" : undefined}
                    aria-label={`Chapter ${item.position}: ${item.title}${statusLabel ? `, ${statusLabel}` : ""}`}
                    onClick={() => chooseTrack(index)}
                  >
                    <span className={styles.trackNumber}>{complete ? "✓" : String(item.position).padStart(2, "0")}</span>
                    <span className={styles.trackTitle}>{item.title}<small>{statusLabel}</small></span>
                    <span className={styles.trackDuration}>{formatDuration(item.durationSeconds)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className={styles.mobileDock} data-active={mobileControlsActivated || isPlaying || currentTime > 0} aria-label="Persistent playback controls">
        <button type="button" onClick={() => seekBy(-15)} aria-label="Go back 15 seconds"><span aria-hidden="true">↶</span><small>15</small></button>
        <button type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause audiobook" : currentTime > 0 ? "Resume audiobook" : "Play audiobook"}>
          <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
          <small>{isPlaying ? "Pause" : currentTime > 0 ? "Resume" : "Play"}</small>
        </button>
        <button type="button" onClick={() => seekBy(15)} aria-label="Go forward 15 seconds"><span aria-hidden="true">↷</span><small>15</small></button>
      </div>
    </section>
  );
}
