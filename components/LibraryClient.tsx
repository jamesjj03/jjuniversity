"use client";

import Link from "next/link";
import { SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { PRIMARY_CATEGORIES, TAG_TO_PRIMARY } from "@/lib/taxonomy";
import { coverFallbackSrc, coverWebpSrc, handleCoverError } from "@/lib/cover";
import { applyCoverPalette } from "@/lib/coverPalette";

type Book = {
  id: string;
  title?: string;
  cover?: string;
  coverFile?: string;
  tags?: string[];
  series?: string;
  status?: string;
  description?: string;
  readingLabel?: string | null;
  readingMinutes?: number | null;
  chapterCount?: number | null;
  seriesPath?: boolean;
  similar?: string[];
  hiddenCategories?: string[];
  hiddenShelves?: string[];
  visibility?: string;
  archive?: boolean;
  category?: string;
  archiveCategory?: string;
};

type CurriculumItem = {
  id: string;
  title: string;
  description?: string;
  books?: { id: string; order: number }[];
  deleted?: boolean;
};

type CurriculumData = {
  series?: CurriculumItem[];
  paths?: CurriculumItem[];
  tagPaths?: CurriculumItem[];
  recommendedReading?: CurriculumItem[];
};

type ReadingHistoryItem = {
  bookId: string;
  title?: string;
  actualSeconds?: number;
  updatedAt?: string;
};

const HISTORY_KEY = "jju.readingHistory";
const READ_KEY = "jju.readBooks";
const LIBRARY_STATE_KEY = "jju.libraryState";

function readReadingHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as ReadingHistoryItem[];
    return Array.isArray(items) ? items.filter(item => item.bookId) : [];
  } catch {
    return [];
  }
}

function readCompletedBooks() {
  try {
    const items = JSON.parse(localStorage.getItem(READ_KEY) || "[]") as string[];
    return new Set(Array.isArray(items) ? items.map(item => String(item).trim().toLowerCase()).filter(Boolean) : []);
  } catch {
    return new Set<string>();
  }
}

function normalize(book: Book): Book {
  return {
    ...book,
    id: String(book.id || "").trim().toLowerCase(),
    title: String(book.title || book.id || "Untitled").trim(),
    tags: Array.isArray(book.tags) ? book.tags : [],
    series: String(book.series || "").trim(),
    status: String(book.status || "ready").trim().toLowerCase(),
    description: String(book.description || "").trim(),
    similar: Array.isArray(book.similar) ? book.similar : [],
    hiddenCategories: Array.isArray(book.hiddenCategories) ? book.hiddenCategories.map(String) : [],
    hiddenShelves: Array.isArray(book.hiddenShelves) ? book.hiddenShelves.map(String) : [],
    visibility: book.archive || String(book.visibility || "main").trim().toLowerCase() === "archive" ? "archive" : "main",
    archive: Boolean(book.archive || String(book.visibility || "main").trim().toLowerCase() === "archive"),
    category: String(book.archiveCategory || book.category || "").trim(),
    archiveCategory: String(book.archiveCategory || book.category || "").trim(),
  };
}

function coverFor(book: Book) {
  return coverWebpSrc(book);
}

function legacyCoverFor(book: Book) {
  return coverFallbackSrc(book);
}

function coverFallback(event: SyntheticEvent<HTMLImageElement>) {
  handleCoverError(event.currentTarget);
}

function coverLoaded(event: SyntheticEvent<HTMLImageElement>) {
  applyCoverPalette(event.currentTarget);
}

type LibrarySessionState = {
  libraryMode?: "main" | "archive";
  query?: string;
  category?: string;
  tag?: string;
  seriesId?: string;
  archiveCategory?: string;
  availability?: string;
  sort?: string;
  readingStatus?: "All" | "Unread" | "Read";
  scrollY?: number;
};

function readLibraryState(fallbackMode: "main" | "archive"): LibrarySessionState {
  if (typeof window === "undefined") return { libraryMode: fallbackMode };
  try {
    const saved = JSON.parse(sessionStorage.getItem(LIBRARY_STATE_KEY) || "{}") as LibrarySessionState;
    return {
      ...saved,
      libraryMode: saved.libraryMode || fallbackMode,
      readingStatus: saved.readingStatus || "All",
    };
  } catch {
    return { libraryMode: fallbackMode };
  }
}

function writeLibraryState(patch: LibrarySessionState) {
  if (typeof window === "undefined") return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(LIBRARY_STATE_KEY) || "{}") as LibrarySessionState;
    sessionStorage.setItem(LIBRARY_STATE_KEY, JSON.stringify({ ...saved, ...patch }));
  } catch {
    sessionStorage.setItem(LIBRARY_STATE_KEY, JSON.stringify(patch));
  }
}

function primaryFor(book: Book) {
  const hidden = new Set([...(book.hiddenCategories || []), ...(book.hiddenShelves || [])]);
  const found = new Set<string>();
  (book.tags || [])
    .filter(tag => !hidden.has(tag))
    .forEach(tag => (TAG_TO_PRIMARY[tag] || []).forEach(category => found.add(category)));
  return [...found].filter(category => !hidden.has(category));
}

function titleCaseId(id: string) {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function sortBooksByFeaturedOrder(books: Book[], featuredIds: string[]) {
  const rank = new Map(featuredIds.map((id, index) => [id, index]));

  return [...books].sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const br = rank.has(b.id) ? rank.get(b.id) : Infinity;

    if (ar !== br) return Number(ar) - Number(br);
    return 0;
  });
}

function readingMinutesForSort(book: Book) {
  const minutes = Number(book.readingMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function titleSort(a: Book, b: Book) {
  return (a.title || a.id).localeCompare(b.title || b.id);
}

function readingTimeSort(direction: "asc" | "desc") {
  return (a: Book, b: Book) => {
    const aMinutes = readingMinutesForSort(a);
    const bMinutes = readingMinutesForSort(b);
    if (aMinutes === null && bMinutes === null) return titleSort(a, b);
    if (aMinutes === null) return 1;
    if (bMinutes === null) return -1;
    return direction === "asc" ? aMinutes - bMinutes || titleSort(a, b) : bMinutes - aMinutes || titleSort(a, b);
  };
}

function cleanIds(value: unknown) {
  return Array.isArray(value) ? value.map(id => String(id).trim().toLowerCase()).filter(Boolean) : [];
}

export default function LibraryClient({ archiveMode = false }: { archiveMode?: boolean } = {}) {
  const restoredScroll = useRef(false);
  const initialState = useMemo(() => readLibraryState(archiveMode ? "archive" : "main"), [archiveMode]);
  const [books, setBooks] = useState<Book[]>([]);
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);
  const [newestIds, setNewestIds] = useState<string[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumData>({});
  const [libraryMode, setLibraryMode] = useState<"main" | "archive">(initialState.libraryMode || (archiveMode ? "archive" : "main"));
  const [query, setQuery] = useState(initialState.query || "");
  const [category, setCategory] = useState(initialState.category || "All");
  const [tag, setTag] = useState(initialState.tag || "All");
  const [seriesId, setSeriesId] = useState(initialState.seriesId || "All");
  const [archiveCategory, setArchiveCategory] = useState(initialState.archiveCategory || "All");
  const [availability, setAvailability] = useState(initialState.availability || "Ready");
  const [sort, setSort] = useState(initialState.sort || "Featured");
  const [readingStatus, setReadingStatus] = useState<"All" | "Unread" | "Read">(initialState.readingStatus || "All");
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryItem[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => typeof window === "undefined" ? new Set() : readCompletedBooks());

  useEffect(() => {
    Promise.all([
      fetch("/books.json").then(r => r.json()),
      fetch("/featured.json").then(r => r.json()).catch(() => []),
      fetch("/newest.json").then(r => r.json()).catch(() => []),
      fetch("/site.json").then(r => r.json()).catch(() => ({})),
    ])
      .then(([bookData, featuredData, newestData, siteData]) => {
        const arr = Array.isArray(bookData) ? bookData : bookData.books || [];
        const siteNewestIds = cleanIds(siteData?.library?.newestIds);
        setBooks(arr.map(normalize));
        setFeaturedIds(cleanIds(featuredData));
        setNewestIds(siteNewestIds.length ? siteNewestIds : cleanIds(newestData));
      })
      .catch(() => setBooks([]));

    fetch("/paths.json")
      .then(r => r.json())
      .then(data => setCurriculum(data || {}))
      .catch(() => setCurriculum({}));

  }, []);

  useEffect(() => {
    const refreshHistory = () => setReadingHistory(readReadingHistory());
    refreshHistory();
    window.addEventListener("storage", refreshHistory);
    window.addEventListener("jju-reading-history", refreshHistory);
    return () => {
      window.removeEventListener("storage", refreshHistory);
      window.removeEventListener("jju-reading-history", refreshHistory);
    };
  }, []);

  useEffect(() => {
    const refreshCompleted = () => setCompletedIds(readCompletedBooks());
    refreshCompleted();
    window.addEventListener("storage", refreshCompleted);
    window.addEventListener("jju-account", refreshCompleted);
    return () => {
      window.removeEventListener("storage", refreshCompleted);
      window.removeEventListener("jju-account", refreshCompleted);
    };
  }, []);

  useEffect(() => {
    writeLibraryState({
      libraryMode,
      query,
      category,
      tag,
      seriesId,
      archiveCategory,
      availability,
      sort,
      readingStatus,
      scrollY: window.scrollY,
    });
  }, [archiveCategory, availability, category, libraryMode, query, readingStatus, seriesId, sort, tag]);

  useEffect(() => {
    let frame = 0;
    const saveScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => writeLibraryState({ scrollY: window.scrollY }));
    };
    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", saveScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", saveScroll);
    };
  }, []);

  const showingArchive = libraryMode === "archive";
  const openedIds = useMemo(() => new Set(readingHistory.map(item => item.bookId)), [readingHistory]);
  const recentBooks = useMemo(() => readingHistory
    .map(item => books.find(book => book.id === item.bookId))
    .filter(Boolean)
    .slice(0, 8) as Book[], [books, readingHistory]);
  const publicBooks = useMemo(() => books.filter(book => book.status !== "hidden" && (showingArchive ? book.visibility === "archive" : book.visibility !== "archive")), [books, showingArchive]);
  const visibleTags = useMemo(() => {
    const allowed = category === "All"
      ? new Set(publicBooks.flatMap(book => book.tags || []))
      : new Set(PRIMARY_CATEGORIES.find(item => item.name === category)?.tags || []);

    return ["All", ...Array.from(allowed).filter(Boolean).sort()];
  }, [category, publicBooks]);


  const archiveCategoryOptions = useMemo(() => {
    const categories = publicBooks
      .map(book => String(book.archiveCategory || book.category || "Uncategorized").trim() || "Uncategorized")
      .filter(Boolean);
    return ["All", ...Array.from(new Set(categories)).sort()];
  }, [publicBooks]);

  const allSeriesOptions = useMemo(() => [
    ...(curriculum.series || []),
    ...(curriculum.paths || []),
    ...(curriculum.tagPaths || []),
    ...(curriculum.recommendedReading || []),
  ].filter(item => !item.deleted), [curriculum]);

  const selectedSeries = useMemo(() => allSeriesOptions.find(item => item.id === seriesId), [allSeriesOptions, seriesId]);
  const seriesBookIds = useMemo(() => new Set((selectedSeries?.books || []).map(item => item.id)), [selectedSeries]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();

    const list = publicBooks.filter(book => {
      const primaries = primaryFor(book);
      const haystack = [
        book.title,
        book.id,
        book.description,
        book.archiveCategory,
        book.category,
        ...(book.tags || []).filter(item => !(book.hiddenShelves || []).includes(item)),
        ...primaries,
      ].join(" ").toLowerCase();

      if (q && !haystack.includes(q)) return false;
      if (category !== "All" && !primaries.includes(category)) return false;
      if (tag !== "All" && (!(book.tags || []).includes(tag) || (book.hiddenShelves || []).includes(tag))) return false;
      if (!showingArchive && seriesId !== "All" && !seriesBookIds.has(book.id)) return false;
      if (showingArchive && archiveCategory !== "All") {
        const bookArchiveCategory = String(book.archiveCategory || book.category || "Uncategorized").trim() || "Uncategorized";
        if (bookArchiveCategory !== archiveCategory) return false;
      }
      if (availability === "Ready" && ["unavailable", "coming-soon"].includes(book.status || "ready")) return false;
      if (availability === "Coming Soon" && book.status !== "coming-soon") return false;
      if (availability === "Unavailable" && book.status !== "unavailable") return false;
      if (readingStatus === "Read" && !completedIds.has(book.id)) return false;
      if (readingStatus === "Unread" && completedIds.has(book.id)) return false;

      return true;
    });

    if (sort === "Featured") return sortBooksByFeaturedOrder(list, featuredIds);
    if (sort === "Newest") return newestIds.length ? sortBooksByFeaturedOrder(list, newestIds) : [...list].sort((a, b) => b.id.localeCompare(a.id));
    if (sort === "Shortest") return [...list].sort(readingTimeSort("asc"));
    if (sort === "Longest") return [...list].sort(readingTimeSort("desc"));

    return [...list].sort((a, b) => {
      if (sort === "Title") return titleSort(a, b);
      return (b.tags || []).length - (a.tags || []).length
        || titleSort(a, b);
    });
  }, [archiveCategory, availability, category, completedIds, featuredIds, newestIds, publicBooks, query, readingStatus, seriesBookIds, seriesId, showingArchive, sort, tag]);

  useEffect(() => {
    if (restoredScroll.current || !books.length) return;
    restoredScroll.current = true;
    const saved = readLibraryState(archiveMode ? "archive" : "main");
    if (typeof saved.scrollY !== "number" || saved.scrollY <= 0) return;
    window.requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY || 0, behavior: "auto" }));
  }, [archiveMode, books.length]);

  function saveLibraryPosition() {
    writeLibraryState({ scrollY: window.scrollY });
  }

  function reset() {
    setQuery("");
    setCategory("All");
    setTag("All");
    setSeriesId("All");
    setArchiveCategory("All");
    setAvailability("Ready");
    setReadingStatus("All");
    setSort("Featured");
  }

  function switchLibraryMode(mode: "main" | "archive") {
    setLibraryMode(mode);
    if (mode === "archive") {
      setSeriesId("All");
      setCategory("All");
      setTag("All");
    } else {
      setArchiveCategory("All");
    }
  }

  return (
    <main className={`page libraryPage ${showingArchive ? "archiveMode" : ""}`}>
      <section className="libraryHero">
        <div>
          <h1>Library</h1>
          <p className="libraryTagline">Pick a shelf. Fall down the rabbit hole.</p>
        </div>

      </section>

      <section className="libraryWorkbench">
        <div className="libraryWorkbenchTop">
          <div className="searchPanel">
            <label>
              <span>Search the stacks</span>
              <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try Rome, addiction, empire, Buddhism, CIA..." />
            </label>
          </div>

          <div className="libraryModeToggle" aria-label="Library section">
            <span>Section</span>
            <button className={!showingArchive ? "active" : ""} type="button" onClick={() => switchLibraryMode("main")}>Main</button>
            <button className={showingArchive ? "active" : ""} type="button" onClick={() => switchLibraryMode("archive")}>Archive</button>
          </div>
        </div>

        <div className="filterPanel">
          {showingArchive ? (
            <label>
              <span>Archive category</span>
              <select className="select" value={archiveCategory} onChange={event => setArchiveCategory(event.target.value)}>
                {archiveCategoryOptions.map(item => <option key={item}>{item}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label>
                <span>Category</span>
                <select className="select" value={category} onChange={event => { setCategory(event.target.value); setTag("All"); }}>
                  <option>All</option>
                  {PRIMARY_CATEGORIES.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
                </select>
              </label>

              <label>
                <span>Subcategory</span>
                <select className="select" value={tag} onChange={event => setTag(event.target.value)}>
                  {visibleTags.map(item => <option key={item}>{item}</option>)}
                </select>
              </label>

              <label>
                <span>Series</span>
                <select className="select" value={seriesId} onChange={event => setSeriesId(event.target.value)}>
                  <option>All</option>
                  {allSeriesOptions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </label>
            </>
          )}

          <label>
            <span>Availability</span>
            <select className="select" value={availability} onChange={event => setAvailability(event.target.value)}>
              <option>All</option>
              <option>Ready</option>
              <option>Coming Soon</option>
              <option>Unavailable</option>
            </select>
          </label>

          <label>
            <span>Sort</span>
            <select className="select" value={sort} onChange={event => setSort(event.target.value)}>
              <option>Featured</option>
              <option>Title</option>
              <option>Newest</option>
              <option>Shortest</option>
              <option>Longest</option>
            </select>
          </label>

          <button className="resetBtn" onClick={reset}>Reset</button>
        </div>
      </section>

      {!!recentBooks.length && (
        <section className="recentReadingRail" aria-label="Recently opened books">
          <div className="sectionHeading">
            <h2>Recently Opened</h2>
            <span>{recentBooks.length} saved locally</span>
          </div>
          <div className="railScroller compactRecentRail">
            {recentBooks.map(book => (
              <Link className="railBook recentRailBook" href={`/reader?book=${book.id}`} key={book.id} onClick={saveLibraryPosition}>
                <img src={coverFor(book)} data-fallback-src={legacyCoverFor(book)} alt="" loading="lazy" decoding="async" onError={coverFallback} onLoad={coverLoaded} />
                <span>{book.title || titleCaseId(book.id)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="resultBar">
        <strong>{filtered.length}</strong>
        <span>{category === "All" ? (showingArchive ? "archived books showing" : "books showing") : `${category} books`}</span>
        {showingArchive && archiveCategory !== "All" && <em>{archiveCategory}</em>}
        {!showingArchive && tag !== "All" && <em>{tag}</em>}
        {!showingArchive && selectedSeries && <em>{selectedSeries.title}</em>}
        <div className="readingStatusToggle" aria-label="Reading status">
          {(["All", "Unread", "Read"] as const).map(status => (
            <button className={readingStatus === status ? "active" : ""} key={status} type="button" onClick={() => setReadingStatus(status)}>{status}</button>
          ))}
        </div>
      </div>

      <section className="bookGrid upgradedGrid">
        {filtered.map(book => {
          const unavailable = book.status === "unavailable" || book.status === "coming-soon";
          const completed = completedIds.has(book.id);
          const visibleBookTags = showingArchive
            ? [book.archiveCategory || book.category || "Uncategorized"]
            : (book.tags || []).filter(item => !(book.hiddenShelves || []).includes(item));
          const primaryTag = visibleBookTags[0] || "Uncategorized";
          const moreTags = visibleBookTags.slice(1);
          return (
            <article className={`bookCard upgradedBook ${unavailable ? "unavailable" : ""} ${openedIds.has(book.id) ? "openedBook" : ""} ${completed ? "completedBook" : ""}`} key={book.id}>
              <Link href={unavailable ? "#" : `/reader?book=${book.id}`} onClick={saveLibraryPosition}>
                <img className="cover" src={coverFor(book)} data-fallback-src={legacyCoverFor(book)} alt={book.title || book.id} loading="lazy" decoding="async" onError={coverFallback} onLoad={coverLoaded} />
                <div className="bookInfo">
                  {completed && <span className="readRibbon">Read</span>}
                  {openedIds.has(book.id) && <span className="openedBookBadge">Opened</span>}
                  <h3 className="bookTitle">{book.title || titleCaseId(book.id)}</h3>
                  {((book.readingLabel && book.readingLabel !== "Unknown") || book.chapterCount) && (
                    <div className="bookMetaLine">
                      {book.readingLabel && book.readingLabel !== "Unknown" ? book.readingLabel : "Reading time unknown"}
                      {book.chapterCount ? ` \u2022 ${book.chapterCount} chapters` : ""}
                    </div>
                  )}
                  {book.description && <p className="bookDescription">{book.description}</p>}
                  <div className="bookTags">
                    <span className="bookTagPrimary">{primaryTag}</span>
                    {!!moreTags.length && (
                      <span className="bookTagMore">
                        +{moreTags.length}
                        <span className="bookTagPopover">
                          {moreTags.map(item => <span key={item}>{item}</span>)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </article>
          );
        })}
      </section>
    </main>
  );
}
