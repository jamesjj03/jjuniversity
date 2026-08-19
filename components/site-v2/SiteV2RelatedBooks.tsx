"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { canonicalBookId } from "@/lib/bookAliases";
import type { PublishedBook } from "@/lib/publishing";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import SiteV2BookCard from "./SiteV2BookCard";
import styles from "./SiteV2.module.css";

const READ_KEY = "jju.readBooks";
const DISPLAY_LIMIT = 4;

function readCompletedBooks() {
  try {
    const value = JSON.parse(localStorage.getItem(READ_KEY) || "[]") as unknown;
    return new Set(
      Array.isArray(value)
        ? value.map(id => canonicalBookId(String(id))).filter(Boolean)
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export default function SiteV2RelatedBooks({
  sourceId,
  initialCandidates,
}: {
  sourceId: string;
  initialCandidates: PublishedBook[];
}) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const [allCandidates, setAllCandidates] = useState<PublishedBook[] | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const expansionStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let refreshVersion = 0;
    const supabase = hasSupabaseConfig() ? createSupabaseBrowserClient() : null;

    const refresh = async () => {
      const version = ++refreshVersion;
      const completed = readCompletedBooks();

      if (supabase) {
        const { data: authData } = await supabase.auth.getUser();
        if (authData.user) {
          const { data } = await supabase
            .from("completed_books")
            .select("book_id")
            .eq("user_id", authData.user.id);
          for (const row of data || []) completed.add(canonicalBookId(String(row.book_id)));
        }
      }

      if (cancelled || version !== refreshVersion) return;
      setCompletedIds(completed);
      setStorageReady(true);
    };

    const handleRefresh = () => void refresh();
    handleRefresh();
    window.addEventListener("storage", handleRefresh);
    window.addEventListener("jju-account", handleRefresh);
    window.addEventListener("jju-reading-history", handleRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleRefresh);
      window.removeEventListener("jju-account", handleRefresh);
      window.removeEventListener("jju-reading-history", handleRefresh);
    };
  }, []);

  const candidates = allCandidates || initialCandidates;
  const visibleBooks = useMemo(() => candidates
    .filter(book => !completedIds.has(canonicalBookId(book.id)))
    .slice(0, DISPLAY_LIMIT), [candidates, completedIds]);

  useEffect(() => {
    if (!storageReady || expansionStarted.current || allCandidates || visibleBooks.length >= DISPLAY_LIMIT) return;
    expansionStarted.current = true;
    const controller = new AbortController();

    fetch(`/api/site-v2/related?book=${encodeURIComponent(sourceId)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : { books: [] })
      .then(data => {
        if (Array.isArray(data.books)) setAllCandidates(data.books);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [allCandidates, sourceId, storageReady, visibleBooks.length]);

  if (!storageReady || !visibleBooks.length) return null;

  return (
    <section className={styles.relatedSection}>
      <div className={styles.sectionHeadingCentered}>
        <h2>Keep going</h2>
      </div>
      <div className={styles.bookGrid}>
        {visibleBooks.map(item => <SiteV2BookCard book={item} key={item.id} />)}
      </div>
    </section>
  );
}
