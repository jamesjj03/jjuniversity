"use client";

import { useEffect, useState } from "react";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import {
  readWorkshopRecent,
  WORKSHOP_RECENT_EVENT,
  type WorkshopRecentItem,
} from "@/lib/workshopRecent";
import styles from "./WorkshopHome.module.css";

function elapsedLabel(visitedAt: number) {
  const elapsed = Math.max(0, Date.now() - visitedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function kindLabel(kind: WorkshopRecentItem["kind"]) {
  if (kind === "book") return "Book";
  if (kind === "collection") return "Collections";
  if (kind === "print") return "Print";
  if (kind === "audio") return "Audio";
  if (kind === "review") return "Review";
  return "Tool";
}

export default function WorkshopResumePanel() {
  const [recent, setRecent] = useState<WorkshopRecentItem[]>([]);

  useEffect(() => {
    const sync = () => setRecent(readWorkshopRecent());
    const timer = window.setTimeout(sync, 0);
    window.addEventListener(WORKSHOP_RECENT_EVENT, sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(WORKSHOP_RECENT_EVENT, sync);
    };
  }, []);

  if (!recent.length) {
    return (
      <section className={styles.resumeEmpty} aria-labelledby="resume-heading">
        <div><span>Continue</span><h2 id="resume-heading">Your recent work will live here.</h2></div>
        <p>Open a book or Workshop tool and this device will remember the exact place—never the manuscript text itself.</p>
      </section>
    );
  }

  const [latest, ...others] = recent;
  return (
    <section className={styles.resume} aria-labelledby="resume-heading">
      <header><span>Continue where I left off</span><h2 id="resume-heading">Pick up without hunting.</h2></header>
      <GuardedAdminLink className={styles.latestWork} href={latest.href} prefetch={false}>
        <span className={styles.resumeKind}>{kindLabel(latest.kind)}</span>
        <strong>{latest.label}</strong>
        <small>{latest.description} · {elapsedLabel(latest.visitedAt)}</small>
        <b aria-hidden="true">Continue →</b>
      </GuardedAdminLink>
      {others.length > 0 && (
        <div className={styles.recentList} role="group" aria-label="Other recent work">
          {others.slice(0, 3).map(item => (
            <GuardedAdminLink href={item.href} prefetch={false} key={item.href}>
              <span><strong>{item.label}</strong><small>{kindLabel(item.kind)} · {elapsedLabel(item.visitedAt)}</small></span>
              <b aria-hidden="true">→</b>
            </GuardedAdminLink>
          ))}
        </div>
      )}
    </section>
  );
}
