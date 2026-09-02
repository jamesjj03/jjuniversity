"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canonicalBookId } from "@/lib/bookAliases";
import { PREFERENCES_EVENT, readPreferencesV2 } from "@/lib/preferencesV2";
import styles from "./SiteV2.module.css";

type ReadingState = "start" | "continue" | "again";

function stateFor(bookId: string): ReadingState {
  try {
    const canonicalId = canonicalBookId(bookId);
    const storedRead = JSON.parse(localStorage.getItem("jju.readBooks") || "[]") as unknown;
    const read = new Set(Array.isArray(storedRead) ? storedRead.map(id => canonicalBookId(String(id))) : []);
    if (read.has(canonicalId)) return "again";
    if (!readPreferencesV2().saveProgress) return "start";
    const progress = JSON.parse(localStorage.getItem("jju.readerProgress") || "{}") as Record<string, unknown>;
    const history = JSON.parse(localStorage.getItem("jju.readingHistory") || "[]") as Array<{ bookId?: string }>;
    const hasProgress = Object.keys(progress).some(id => canonicalBookId(id) === canonicalId);
    const hasHistory = Array.isArray(history) && history.some(item => canonicalBookId(String(item.bookId || "")) === canonicalId);
    if (hasProgress || hasHistory) return "continue";
  } catch {
    return "start";
  }
  return "start";
}

const LABELS: Record<ReadingState, string> = {
  start: "Start reading",
  continue: "Continue reading",
  again: "Read again",
};

export default function SiteV2ReadingAction({
  bookId,
  status = "ready",
}: {
  bookId: string;
  bookSlug?: string;
  status?: string;
}) {
  const [readingState, setReadingState] = useState<ReadingState>("start");

  useEffect(() => {
    const refresh = () => setReadingState(stateFor(bookId));
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("jju-account", refresh);
    window.addEventListener("jju-reading-history", refresh);
    window.addEventListener(PREFERENCES_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("jju-account", refresh);
      window.removeEventListener("jju-reading-history", refresh);
      window.removeEventListener(PREFERENCES_EVENT, refresh);
    };
  }, [bookId]);

  if (status !== "ready") {
    return <span className={styles.disabledButton}>Coming soon</span>;
  }

  return (
    <Link className={styles.primaryButton} href={`/reader?book=${encodeURIComponent(bookId)}${readingState === "again" ? "&restart=1" : ""}`}>
      {LABELS[readingState]}
    </Link>
  );
}
