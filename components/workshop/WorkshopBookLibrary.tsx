"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { GuardedAdminLink } from "@/components/AdminUnsavedChanges";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import {
  normalizeWorkshopBook,
  workshopBookPublicState,
  workshopBookStatusLabel,
  type WorkshopBook,
} from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";

type Props = {
  books: WorkshopBook[];
  initialQuery: string;
  initialStatus: string;
  initialPlacement: string;
  source: string;
};

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

export default function WorkshopBookLibrary({
  books: initialBooks,
  initialQuery,
  initialStatus,
  initialPlacement,
  source,
}: Props) {
  const pathname = usePathname();
  const books = useMemo(() => initialBooks.map(normalizeWorkshopBook), [initialBooks]);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(STATUS_OPTIONS.has(initialStatus) ? initialStatus : "all");
  const [placement, setPlacement] = useState(PLACEMENT_OPTIONS.has(initialPlacement) ? initialPlacement : "all");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const canonical = canonicalListHref(query, status, placement);
      const search = canonical.includes("?") ? canonical.slice(canonical.indexOf("?")) : "";
      window.history.replaceState(null, "", `${pathname}${search}`);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [pathname, placement, query, status]);

  const visibleBooks = useMemo(() => {
    const search = query.trim().toLowerCase();
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
      .sort((left, right) => left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" }));
  }, [books, placement, query, status]);

  const returnHref = canonicalListHref(query, status, placement);

  return (
    <>
      <section className={styles.toolbar} aria-label="Find books">
        <label className={styles.searchField}>
          Search the library
          <input
            autoComplete="off"
            inputMode="search"
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Title, series, tag, or book ID"
          />
        </label>
        <label className={styles.searchField}>
          Publishing state
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">Every state</option>
            <option value="ready">Published</option>
            <option value="coming-soon">Coming soon</option>
            <option value="hidden">Hidden drafts</option>
            <option value="needs-review">Needs review</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label className={styles.searchField}>
          Placement
          <select value={placement} onChange={event => setPlacement(event.target.value)}>
            <option value="all">Main and Archive</option>
            <option value="main">Main Library</option>
            <option value="archive">Archive</option>
          </select>
        </label>
      </section>

      <div className={styles.resultHeader} aria-live="polite">
        <span><strong>{visibleBooks.length}</strong> of {books.length} books</span>
        <span>Reading from {source}</span>
      </div>

      {visibleBooks.length ? (
        <section className={styles.bookGrid} aria-label="Book results">
          {visibleBooks.map(book => (
            <GuardedAdminLink
              className={styles.bookCard}
              href={bookHref(book.id, returnHref)}
              prefetch={false}
              key={book.id}
            >
              <div className={styles.bookCover}>
                <CoverImage
                  alt=""
                  fallbackSrc={coverFallbackSrc(book)}
                  height={111}
                  sizes="74px"
                  src={coverWebpSrc(book)}
                  width={74}
                />
              </div>
              <div className={styles.bookCardCopy}>
                <h2>{book.title}</h2>
                <p>{book.subtitle || book.description || book.id}</p>
                <span className={styles.statusBadge} title={workshopBookPublicState(book)}>
                  {workshopBookStatusLabel(book.status)} · {book.visibility === "archive" ? "Archive" : "Main"}
                </span>
              </div>
            </GuardedAdminLink>
          ))}
        </section>
      ) : (
        <section className={styles.emptyState}>
          <h2>No books match</h2>
          <p>Change the search or filters. Nothing in the catalog was changed.</p>
          <button className={styles.secondaryButton} type="button" onClick={() => {
            setQuery("");
            setStatus("all");
            setPlacement("all");
          }}>
            Clear filters
          </button>
        </section>
      )}
    </>
  );
}
