"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canonicalBookId } from "@/lib/bookAliases";
import { PREFERENCES_EVENT, readPreferencesV2 } from "@/lib/preferencesV2";
import type { PublishedBook, PublishedSeries } from "@/lib/publishing";
import { SITE_V2_SHELVES, siteV2ShelvesForBook, siteV2TopicsForBook } from "@/lib/siteV2";
import SiteV2BookCard from "./SiteV2BookCard";
import styles from "./SiteV2.module.css";

type ReadingFilter = "all" | "unread" | "opened" | "read";
type CatalogMode = "main" | "archive";
type AvailabilityFilter = "all" | "ready" | "coming-soon";
type SortFilter = "featured" | "newest" | "title" | "shortest" | "longest";

type CatalogSession = {
  query?: string;
  shelf?: string;
  topic?: string;
  collectionId?: string;
  availability?: AvailabilityFilter;
  reading?: ReadingFilter;
  sort?: SortFilter;
  catalogMode?: CatalogMode;
  visibleCount?: number;
  scrollY?: number;
};

const CATALOG_SESSION_KEY = "jju.siteV2.catalogSession";
const AVAILABILITY_FILTERS = new Set<AvailabilityFilter>(["all", "ready", "coming-soon"]);
const READING_FILTERS = new Set<ReadingFilter>(["all", "unread", "opened", "read"]);
const SORT_FILTERS = new Set<SortFilter>(["featured", "newest", "title", "shortest", "longest"]);
const CATALOG_MODES = new Set<CatalogMode>(["main", "archive"]);
const MIN_TOPIC_FILTER_BOOKS = 2;

function topicFilterOptions(books: PublishedBook[]) {
  const counts = new Map<string, number>();
  for (const book of books) {
    for (const topic of new Set(siteV2TopicsForBook(book))) counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= MIN_TOPIC_FILTER_BOOKS)
    .map(([tag]) => tag)
    .sort();
}

function readCatalogSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(CATALOG_SESSION_KEY) || "null") as CatalogSession | null;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeCatalogSession(value: CatalogSession) {
  try {
    sessionStorage.setItem(CATALOG_SESSION_KEY, JSON.stringify(value));
  } catch {
    // Browsing still works when session storage is disabled or full.
  }
}

function readStringSet(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return new Set(Array.isArray(value) ? value.map(id => canonicalBookId(String(id))) : []);
  } catch {
    return new Set<string>();
  }
}

function readOpenedIds() {
  try {
    const value = JSON.parse(localStorage.getItem("jju.readingHistory") || "[]") as Array<{ bookId?: string }>;
    return new Set(Array.isArray(value) ? value.map(item => canonicalBookId(String(item.bookId || ""))).filter(Boolean) : []);
  } catch {
    return new Set<string>();
  }
}

export default function SiteV2BooksBrowser({
  books,
  collections,
  featuredIds,
  newestIds,
  initialShelf = "all",
  initialCollection = "all",
  resetSession = false,
}: {
  books: PublishedBook[];
  collections: PublishedSeries[];
  featuredIds: string[];
  newestIds: string[];
  initialShelf?: string;
  initialCollection?: string;
  resetSession?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [shelf, setShelf] = useState(initialShelf);
  const [topic, setTopic] = useState("all");
  const [collectionId, setCollectionId] = useState(initialCollection);
  const [availability, setAvailability] = useState<AvailabilityFilter>("ready");
  const [reading, setReading] = useState<ReadingFilter>("all");
  const [sort, setSort] = useState<SortFilter>("featured");
  const [catalogMode, setCatalogMode] = useState<CatalogMode>("main");
  const [visibleCount, setVisibleCount] = useState(30);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => new Set());
  const [sessionRestored, setSessionRestored] = useState(false);
  const restoreScrollY = useRef<number | null>(null);
  const lastScrollY = useRef(0);
  const leavingCatalog = useRef(false);

  useEffect(() => {
    const saved = resetSession ? null : readCatalogSession();
    const timer = window.setTimeout(() => {
      if (saved) {
        const knownShelves = new Set<string>(SITE_V2_SHELVES.map(item => item.id));
        const knownTopics = new Set(topicFilterOptions(books));
        const knownCollections = new Set(collections.map(item => item.id));

        if (typeof saved.query === "string") setQuery(saved.query.slice(0, 240));
        if (initialShelf === "all" && saved.shelf && (saved.shelf === "all" || knownShelves.has(saved.shelf))) setShelf(saved.shelf);
        if (saved.topic && (saved.topic === "all" || knownTopics.has(saved.topic))) setTopic(saved.topic);
        if (initialCollection === "all" && saved.collectionId && (saved.collectionId === "all" || knownCollections.has(saved.collectionId))) {
          setCollectionId(saved.collectionId);
        }
        if (saved.availability && AVAILABILITY_FILTERS.has(saved.availability)) setAvailability(saved.availability);
        if (saved.reading && READING_FILTERS.has(saved.reading)) setReading(saved.reading);
        if (saved.sort && SORT_FILTERS.has(saved.sort)) setSort(saved.sort);
        if (saved.catalogMode && CATALOG_MODES.has(saved.catalogMode)) setCatalogMode(saved.catalogMode);
        if (Number.isFinite(saved.visibleCount)) setVisibleCount(Math.min(330, Math.max(30, Number(saved.visibleCount))));
        if (Number.isFinite(saved.scrollY)) {
          restoreScrollY.current = Math.max(0, Number(saved.scrollY));
          lastScrollY.current = restoreScrollY.current;
        }
      }
      setSessionRestored(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [books, collections, initialCollection, initialShelf, resetSession]);

  useEffect(() => {
    if (!sessionRestored || restoreScrollY.current === null) return;
    const scrollY = restoreScrollY.current;
    restoreScrollY.current = null;
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [sessionRestored]);

  useEffect(() => {
    if (!sessionRestored) return;

    const save = () => writeCatalogSession({
      query,
      shelf,
      topic,
      collectionId,
      availability,
      reading,
      sort,
      catalogMode,
      visibleCount,
      scrollY: lastScrollY.current,
    });
    let scrollFrame = 0;
    const saveScroll = () => {
      if (leavingCatalog.current) return;
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        lastScrollY.current = window.scrollY;
        save();
      });
    };
    save();
    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", save);
      window.cancelAnimationFrame(scrollFrame);
      save();
    };
  }, [availability, catalogMode, collectionId, query, reading, sessionRestored, shelf, sort, topic, visibleCount]);

  useEffect(() => {
    const refresh = () => {
      setCompletedIds(readStringSet("jju.readBooks"));
      setOpenedIds(readPreferencesV2().saveProgress ? readOpenedIds() : new Set());
    };
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
  }, []);

  const modeBooks = useMemo(() => books.filter(book => (
    catalogMode === "archive" ? book.visibility === "archive" : book.visibility !== "archive"
  )), [books, catalogMode]);

  const availabilityBooks = useMemo(() => modeBooks.filter(book => (
    availability === "all" || book.status === availability
  )), [availability, modeBooks]);
  const optionBookIds = useMemo(() => new Set(availabilityBooks.map(book => book.id)), [availabilityBooks]);
  const visibleShelves = useMemo(() => SITE_V2_SHELVES.filter(item => (
    availabilityBooks.some(book => siteV2ShelvesForBook(book).some(bookShelf => bookShelf.id === item.id))
  )), [availabilityBooks]);
  const topics = useMemo(() => topicFilterOptions(availabilityBooks), [availabilityBooks]);
  const visibleCollections = useMemo(() => collections
    .map(item => ({ item, count: item.bookIds.filter(id => optionBookIds.has(id)).length }))
    .filter(option => option.count > 0), [collections, optionBookIds]);
  const selectedCollection = useMemo(() => collections.find(item => item.id === collectionId), [collectionId, collections]);
  const collectionTitlesByBook = useMemo(() => {
    const titles = new Map<string, string[]>();
    for (const collection of collections) {
      for (const bookId of collection.bookIds) {
        titles.set(bookId, [...(titles.get(bookId) || []), collection.title]);
      }
    }
    return titles;
  }, [collections]);
  const featuredRank = useMemo(() => new Map(featuredIds.map((id, index) => [id, index])), [featuredIds]);
  const newestRank = useMemo(() => new Map(newestIds.map((id, index) => [id, index])), [newestIds]);

  const filtered = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    const selectedCollectionBooks = new Set(selectedCollection?.bookIds || []);
    const list = availabilityBooks.filter(book => {
      if (shelf !== "all" && !siteV2ShelvesForBook(book).some(item => item.id === shelf)) return false;
      const bookTopics = siteV2TopicsForBook(book);
      if (topic !== "all" && !bookTopics.includes(topic)) return false;
      if (collectionId !== "all" && !selectedCollectionBooks.has(book.id)) return false;
      if (reading === "read" && !completedIds.has(book.id)) return false;
      if (reading === "opened" && (!openedIds.has(book.id) || completedIds.has(book.id))) return false;
      if (reading === "unread" && (openedIds.has(book.id) || completedIds.has(book.id))) return false;

      if (cleanQuery) {
        const haystack = [book.title, book.subtitle, book.description, book.creator, ...(collectionTitlesByBook.get(book.id) || []), ...bookTopics]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(cleanQuery)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "shortest") return (a.readingMinutes || Infinity) - (b.readingMinutes || Infinity) || a.title.localeCompare(b.title);
      if (sort === "longest") return (b.readingMinutes || 0) - (a.readingMinutes || 0) || a.title.localeCompare(b.title);
      const rank = sort === "newest" ? newestRank : featuredRank;
      const aRank = rank.get(a.id) ?? Infinity;
      const bRank = rank.get(b.id) ?? Infinity;
      return aRank - bRank || a.title.localeCompare(b.title);
    });
  }, [availabilityBooks, collectionId, collectionTitlesByBook, completedIds, featuredRank, newestRank, openedIds, query, reading, selectedCollection, shelf, sort, topic]);

  const isBaselineCatalog = catalogMode === "main"
    && availability === "ready"
    && query.trim() === ""
    && shelf === "all"
    && topic === "all"
    && collectionId === "all"
    && reading === "all";

  function clearFilters() {
    setQuery("");
    setShelf("all");
    setTopic("all");
    setCollectionId("all");
    setAvailability("ready");
    setReading("all");
    setSort("featured");

    writeCatalogSession({
      query: "",
      shelf: "all",
      topic: "all",
      collectionId: "all",
      availability: "ready",
      reading: "all",
      sort: "featured",
      catalogMode,
      visibleCount,
      scrollY: lastScrollY.current,
    });

    const params = new URLSearchParams(window.location.search);
    ["shelf", "collection", "path", "series", "reset"].forEach(key => params.delete(key));
    const search = params.toString();
    const nextHref = `${pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextHref !== currentHref) router.replace(nextHref, { scroll: false });
  }

  function resetInvalidSelections(nextMode: CatalogMode, nextAvailability: AvailabilityFilter) {
    const nextBooks = books.filter(book => (
      (nextMode === "archive" ? book.visibility === "archive" : book.visibility !== "archive")
      && (nextAvailability === "all" || book.status === nextAvailability)
    ));
    const nextBookIds = new Set(nextBooks.map(book => book.id));

    if (shelf !== "all" && !nextBooks.some(book => siteV2ShelvesForBook(book).some(item => item.id === shelf))) setShelf("all");
    if (topic !== "all" && !nextBooks.some(book => siteV2TopicsForBook(book).includes(topic))) setTopic("all");
    if (collectionId !== "all" && !selectedCollection?.bookIds.some(id => nextBookIds.has(id))) setCollectionId("all");
  }

  function chooseCatalogMode(nextMode: CatalogMode) {
    resetInvalidSelections(nextMode, availability);
    setCatalogMode(nextMode);
  }

  function chooseAvailability(nextAvailability: AvailabilityFilter) {
    resetInvalidSelections(catalogMode, nextAvailability);
    setAvailability(nextAvailability);
  }

  function preserveCatalogPosition(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    if (!target?.getAttribute("href")?.startsWith("/books/")) return;

    leavingCatalog.current = true;
    lastScrollY.current = window.scrollY;
    writeCatalogSession({
      query,
      shelf,
      topic,
      collectionId,
      availability,
      reading,
      sort,
      catalogMode,
      visibleCount,
      scrollY: lastScrollY.current,
    });
  }

  return (
    <section className={styles.booksBrowser} aria-label="Book catalog" onClickCapture={preserveCatalogPosition}>
      <div className={styles.catalogMode} aria-label="Catalog section">
        <button aria-pressed={catalogMode === "main"} className={catalogMode === "main" ? styles.activeMode : ""} type="button" onClick={() => chooseCatalogMode("main")}>Books</button>
        <button aria-pressed={catalogMode === "archive"} className={catalogMode === "archive" ? styles.activeMode : ""} type="button" onClick={() => chooseCatalogMode("archive")}>Archive</button>
      </div>

      <div className={styles.searchRow}>
        <label>
          <span className={styles.visuallyHidden}>Search books</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search books, subjects, or questions"
          />
        </label>
        <details className={styles.filterDisclosure}>
          <summary>Filters</summary>
          <div className={styles.filterGrid}>
            {visibleCollections.length > 0 && (
              <label className={styles.collectionFilter}>
                <span>Collection</span>
                <select value={collectionId} onChange={event => setCollectionId(event.target.value)}>
                  <option value="all">All collections</option>
                  {visibleCollections.map(({ item, count }) => <option key={item.id} value={item.id}>{item.title} ({count})</option>)}
                </select>
              </label>
            )}
            <label>
              <span>Topic</span>
              <select value={topic} onChange={event => setTopic(event.target.value)}>
                <option value="all">All topics</option>
                {topics.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              <span>Availability</span>
              <select value={availability} onChange={event => chooseAvailability(event.target.value as AvailabilityFilter)}>
                <option value="ready">Available now</option>
                <option value="coming-soon">Coming soon</option>
                <option value="all">Any status</option>
              </select>
            </label>
            <label>
              <span>Reading status</span>
              <select value={reading} onChange={event => setReading(event.target.value as ReadingFilter)}>
                <option value="all">Any status</option>
                <option value="unread">Not started</option>
                <option value="opened">In progress</option>
                <option value="read">Finished</option>
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select value={sort} onChange={event => setSort(event.target.value as SortFilter)}>
                <option value="featured">Featured</option>
                <option value="newest">Newest</option>
                <option value="title">Title</option>
                <option value="shortest">Shortest first</option>
                <option value="longest">Longest first</option>
              </select>
            </label>
            <button className={styles.clearButton} type="button" onClick={clearFilters}>Clear filters</button>
          </div>
        </details>
      </div>

      <div className={styles.shelfChips} aria-label="Browse by shelf">
        <button aria-pressed={shelf === "all"} className={shelf === "all" ? styles.activeShelf : ""} type="button" onClick={() => setShelf("all")}>All</button>
        {visibleShelves.map(item => (
          <button aria-pressed={shelf === item.id} className={shelf === item.id ? styles.activeShelf : ""} type="button" key={item.id} onClick={() => setShelf(item.id)}>{item.shortName}</button>
        ))}
      </div>

      <div className={styles.resultsHeader} role="status" aria-live="polite" aria-atomic="true">
        <strong>
          {filtered.length.toLocaleString()} {isBaselineCatalog ? "available" : "shown"}
        </strong>
      </div>

      {filtered.length ? (
        <>
          <div className={styles.bookGrid}>
            {filtered.slice(0, visibleCount).map((book, index) => <SiteV2BookCard book={book} key={book.id} priority={index < 4} />)}
          </div>
          {visibleCount < filtered.length && (
            <div className={styles.loadMoreRow}>
              <button className={styles.secondaryButton} type="button" onClick={() => setVisibleCount(count => count + 30)}>
                Show 30 more
              </button>
              <span>Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}</span>
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyState}>
          <h2>No books match those filters.</h2>
          <p>Clear the filters or try a broader search.</p>
          <button className={styles.secondaryButton} type="button" onClick={clearFilters}>Show all books</button>
        </div>
      )}
    </section>
  );
}
