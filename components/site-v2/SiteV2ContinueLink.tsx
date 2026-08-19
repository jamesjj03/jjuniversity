"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PREFERENCES_EVENT, readPreferencesV2 } from "@/lib/preferencesV2";
import styles from "./SiteV2.module.css";

type HistoryItem = {
  bookId?: string;
  requestedId?: string;
  title?: string;
  updatedAt?: string;
};

function latestBook() {
  try {
    if (!readPreferencesV2().saveProgress) return null;
    const history = JSON.parse(localStorage.getItem("jju.readingHistory") || "[]") as HistoryItem[];
    if (!Array.isArray(history)) return null;
    return [...history]
      .filter(item => item.bookId)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
  } catch {
    return null;
  }
}

export default function SiteV2ContinueLink({ compact = false }: { compact?: boolean }) {
  const [item, setItem] = useState<HistoryItem | null>(null);

  useEffect(() => {
    const refresh = () => setItem(latestBook());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("jju-reading-history", refresh);
    window.addEventListener(PREFERENCES_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("jju-reading-history", refresh);
      window.removeEventListener(PREFERENCES_EVENT, refresh);
    };
  }, []);

  if (!item?.bookId) return null;

  return (
    <Link
      className={compact ? styles.headerContinue : styles.primaryButton}
      href={`/reader?book=${encodeURIComponent(item.requestedId || item.bookId)}`}
      title={item.title ? `Continue ${item.title}` : "Continue reading"}
    >
      Continue reading
    </Link>
  );
}
