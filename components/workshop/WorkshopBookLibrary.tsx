"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import {
  normalizeWorkshopBook,
  workshopBookStatusLabel,
  type WorkshopBook,
} from "@/lib/workshopBooks";
import styles from "./WorkshopBookLibrary.module.css";

type Props = {
  books: WorkshopBook[];
  initialQuery?: string;
  initialStatus?: string;
  initialPlacement?: string;
  source: string;
  compact?: boolean;
};

const RECENT_BOOKS_KEY = "jju.workshop.recent-books.v1";
const RESULT_STEP = 16;
const STATUS_OPTIONS = new Set(["all", "ready", "coming-soon", "hidden", "needs-review", "unavailable"]);
const PLACEMENT_OPTIONS = new Set(["all", "main", "archive"]);

function canonicalListHref(query: string, status: string, placement: string) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (status !== "all") params.set("status", status);
  if (placement !== "all") params.set("placement", placement);
  const search = params.toString();
  return `/admin/books${search ? `?${search}` : ""}`;
}

function bookHref(id: string, returnHref: string) {
  return `/admin/books/${encodeURIComponent(id)}?from=${encodeURIComponent(returnHref)}`;
}

function readRecentIds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_BOOKS_KEY) || "[]") as unknown;
    return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberBook(id: string) {
  try {
    const next = [id, ...readRecentIds().filter(value => value !== id)].slice(0, 8);
    window.localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(next));
  } catch {
    // Opening a book must never depend on recent-history storage.
  }
}

export default function WorkshopBookLibrary({
  books: initialBooks,
  initialQuery = "",
  initialStatus = "all",
  initialPlacement = "all",
  source,
  compact = false,
}: Props) {
  const pathname = usePathname();
  const books = useMemo(() => initialBooks.map(normalizeWorkshopBook), [initialBooks]);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(STATUS_OPTIONS.has(initialStatus) ? initialStatus : "all");
  const [placement, setPlacement] = useState(PLACEMENT_OPTIONS.has(initialPlacement) ? initialPlacement : "all");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [resultLimit, setResultLimit] = useState(RESULT_STEP);

  useEffect(() => {
    const timer = window.setTimeout(() => setRecentIds(readRecentIds()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (compact) return;
    const timer = window.setTimeout(() => {
      const canonical = canonicalListHref(query, status, placement);
      const search = canonical.includes("?") ? canonical.slice(canonical.indexOf("?")) : "";
      window.history.replaceState(null, "", `${pathname}${search}`);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [compact, pathname, placement, query, status]);

  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search && status === "all" && placement === "all") return [];
    return books
      .filter(book => {
        if (status !== "all" && book.status !== status) return false;
        if (placement !== "all" && book.visibility !== placement) return false;
        if (!search) return true;
        const haystack = [
          book.title,
          book.subtitle,
          book.id,
          book.creator,
          book.series,
          book.description,
          ...book.tags,
        ].join(" ").toLowerCase();
        return haystack.includes(search);
      })
      .sort((left, right) => {
        const leftStarts = left.title.toLowerCase().startsWith(search) ? 0 : 1;
        const rightStarts = right.title.toLowerCase().startsWith(search) ? 0 : 1;
        return leftStarts - rightStarts || left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" });
      });
  }, [books, placement, query, status]);

  const recentBooks = useMemo(() => recentIds
    .map(id => books.find(book => book.id === id))
    .filter((book): book is WorkshopBook => Boolean(book)), [books, recentIds]);

  const returnHref = canonicalListHref(query, status, placement);
  const visibleBooks = matches.slice(0, resultLimit);
  const counts = useMemo(() => ({
    review: books.filter(book => book.status === "needs-review").length,
    hidden: books.filter(book => book.status === "hidden").length,
    comingSoon: books.filter(book => book.status === "coming-soon").length,
  }), [books]);

  const resultCards = (items: WorkshopBook[]) => (
    <div className={styles.results}>
      {items.map(book => (
        <GuardedAdminLink
          className={styles.result}
          href={bookHref(book.id, returnHref)}
          prefetch={false}
          key={book.id}
          onClick={() => rememberBook(book.id)}
        >
          <div className={styles.cover}>
            <CoverImage
              alt=""
              fallbackSrc={coverFallbackSrc(book)}
              height={126}
              sizes="84px"
              src={coverWebpSrc(book)}
              width={84}
            />
          </div>
          <div className={styles.resultCopy}>
            <span>{workshopBookStatusLabel(book.status)}</span>
            <h2>{book.title}</h2>
            <p>{book.subtitle || book.series || book.description || book.id}</p>
          </div>
          <strong className={styles.openLabel}>Write →</strong>
        </GuardedAdminLink>
      ))}
    </div>
  );

  return (
    <section className={`${styles.finder} ${compact ? styles.compact : ""}`} aria-label="Open a book">
      <div className={styles.searchArea}>
        <label className={styles.searchField}>
          <span>Which book do you want to work on?</span>
          <input
            autoComplete="off"
            inputMode="search"
            type="search"
            value={query}
            onChange={event => { setQuery(event.target.value); setResultLimit(RESULT_STEP); }}
            placeholder="Start typing a title"
            autoFocus={!compact}
          />
        </label>
        <div className={styles.queueButtons} aria-label="Quick book queues">
          <button type="button" aria-pressed={status === "needs-review"} className={status === "needs-review" ? styles.activeQueue : ""} onClick={() => { setStatus(status === "needs-review" ? "all" : "needs-review"); setResultLimit(RESULT_STEP); }}>Needs review <strong>{counts.review}</strong></button>
          <button type="button" aria-pressed={status === "hidden"} className={status === "hidden" ? styles.activeQueue : ""} onClick={() => { setStatus(status === "hidden" ? "all" : "hidden"); setResultLimit(RESULT_STEP); }}>Hidden drafts <strong>{counts.hidden}</strong></button>
          <button type="button" aria-pressed={status === "coming-soon"} className={status === "coming-soon" ? styles.activeQueue : ""} onClick={() => { setStatus(status === "coming-soon" ? "all" : "coming-soon"); setResultLimit(RESULT_STEP); }}>Coming soon <strong>{counts.comingSoon}</strong></button>
        </div>
        <details className={styles.moreFilters}>
          <summary>More filters</summary>
          <div>
            <label>
              Publishing state
              <select value={status} onChange={event => { setStatus(event.target.value); setResultLimit(RESULT_STEP); }}>
                <option value="all">Every state</option>
                <option value="ready">Published</option>
                <option value="coming-soon">Coming soon</option>
                <option value="hidden">Hidden drafts</option>
                <option value="needs-review">Needs review</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </label>
            <label>
              Placement
              <select value={placement} onChange={event => { setPlacement(event.target.value); setResultLimit(RESULT_STEP); }}>
                <option value="all">Main and Archive</option>
                <option value="main">Main Library</option>
                <option value="archive">Archive</option>
              </select>
            </label>
          </div>
        </details>
      </div>

      {!query.trim() && status === "all" && placement === "all" ? (
        recentBooks.length ? (
          <div className={styles.recentBlock}>
            <div className={styles.resultHeading}>
              <div>
                <span>Continue where you left off</span>
                <strong>Recent books on this device</strong>
              </div>
              <small>{source}</small>
            </div>
            {resultCards(recentBooks)}
          </div>
        ) : (
          <div className={styles.startState}>
            <strong>Type a few letters. Open the manuscript in one tap.</strong>
            <p>The full catalog stays out of the way until you search or choose a queue.</p>
          </div>
        )
      ) : matches.length ? (
        <div className={styles.matchBlock}>
          <div className={styles.resultHeading} aria-live="polite">
            <div>
              <span>Matches</span>
              <strong>{matches.length} book{matches.length === 1 ? "" : "s"}</strong>
            </div>
            <small>{source}</small>
          </div>
          {resultCards(visibleBooks)}
          {visibleBooks.length < matches.length && (
            <button type="button" className={styles.moreButton} onClick={() => setResultLimit(limit => limit + RESULT_STEP)}>
              Show {Math.min(RESULT_STEP, matches.length - visibleBooks.length)} more
            </button>
          )}
        </div>
      ) : (
        <div className={styles.startState}>
          <strong>No books match that search.</strong>
          <button type="button" onClick={() => { setQuery(""); setStatus("all"); setPlacement("all"); setResultLimit(RESULT_STEP); }}>Clear search</button>
        </div>
      )}
    </section>
  );
}
