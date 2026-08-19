"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PREFERENCES_EVENT, readPreferencesV2 } from "@/lib/preferencesV2";

type ReadingHistoryItem = {
  bookId: string;
  title?: string;
  sectionTitle?: string;
};

const HISTORY_KEY = "jju.readingHistory";

export default function ContinueReadingLink() {
  const ref = useRef<HTMLDetailsElement | null>(null);
  const lastTapRef = useRef(0);
  const router = useRouter();
  const [items, setItems] = useState<ReadingHistoryItem[]>([]);

  useEffect(() => {
    const refresh = () => {
      try {
        if (!readPreferencesV2().saveProgress) {
          setItems([]);
          return;
        }
        const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as ReadingHistoryItem[];
        setItems(Array.isArray(history) ? history.filter(item => item.bookId).slice(0, 5) : []);
      } catch {
        setItems([]);
      }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("jju-reading-history", refresh);
    window.addEventListener(PREFERENCES_EVENT, refresh);
    const closeOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", closeOutside);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("jju-reading-history", refresh);
      window.removeEventListener(PREFERENCES_EVENT, refresh);
      document.removeEventListener("click", closeOutside);
    };
  }, []);

  const latest = items[0];
  if (!latest?.bookId) return null;

  function handleSummaryClick() {
    const now = Date.now();
    if (now - lastTapRef.current < 320 && latest?.bookId) {
      router.push(`/reader?book=${encodeURIComponent(latest.bookId)}`);
    }
    lastTapRef.current = now;
  }

  return (
    <details className="continueReadingMenu" ref={ref}>
      <summary title={latest.title ? `Continue ${latest.title}` : "Continue reading"} onClick={handleSummaryClick}>
        <span>Continue</span>
        <strong>{latest.title || "Reading"}</strong>
      </summary>
      <div className="continueReadingPanel">
        <div className="continueReadingHeader">
          <span>Recent</span>
          <strong>Pick up where you left off</strong>
        </div>
        {items.map(item => (
          <Link href={`/reader?book=${encodeURIComponent(item.bookId)}`} key={`${item.bookId}-${item.sectionTitle || ""}`} onClick={() => { if (ref.current) ref.current.open = false; }}>
            <strong>{item.title || "Reading"}</strong>
            {item.sectionTitle && <span>{item.sectionTitle}</span>}
          </Link>
        ))}
      </div>
    </details>
  );
}
