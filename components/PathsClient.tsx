"use client";

import Link from "next/link";
import { SyntheticEvent, useEffect, useMemo, useState } from "react";
import { coverFallbackSrc, coverWebpSrc, handleCoverError } from "@/lib/cover";

type Book = {
  id: string;
  title?: string;
  coverFile?: string;
  tags?: string[];
  status?: string;
  readingLabel?: string | null;
  readingMinutes?: number | null;
  chapterCount?: number | null;
};

type PathBook = {
  id: string;
  order: number;
};

type CurriculumItem = {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  books: PathBook[];
  deleted?: boolean;
};

type CurriculumData = {
  paths?: CurriculumItem[];
  tagPaths?: CurriculumItem[];
};

type Account = {
  name: string;
  email?: string;
  savedPathIds: string[];
  activePathId?: string;
  joinedAt: string;
};

const ACCOUNT_KEY = "jju.account";
const READ_KEY = "jju.readBooks";
const LAST_PATH_KEY = "jju.lastPathId";

function readAccount(): Account | null {
  try {
    const data = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null") as Account | null;
    if (!data?.name) return null;
    return {
      ...data,
      savedPathIds: Array.isArray(data.savedPathIds) ? data.savedPathIds : [],
    };
  } catch {
    return null;
  }
}

function readCompletedBooks() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch {
    return new Set<string>();
  }
}

function saveAccount(account: Account) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  window.dispatchEvent(new Event("jju-account"));
}

function minutesLabel(minutes: number) {
  if (!minutes) return "Time unknown";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

function coverFor(book: Book | undefined, fallbackId: string) {
  return coverWebpSrc(book, fallbackId);
}

function legacyCoverFor(book: Book | undefined, fallbackId: string) {
  return coverFallbackSrc(book, fallbackId);
}

function coverFallback(event: SyntheticEvent<HTMLImageElement>) {
  handleCoverError(event.currentTarget);
}

export default function PathsClient() {
  const [books, setBooks] = useState<Book[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumData>({});
  const [account, setAccount] = useState<Account | null>(null);
  const [completedBooks, setCompletedBooks] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState("");
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState("Ready");

  useEffect(() => {
    fetch("/books.json")
      .then(response => response.json())
      .then(data => setBooks(Array.isArray(data) ? data : data.books || []))
      .catch(() => setBooks([]));

    fetch("/paths.json")
      .then(response => response.json())
      .then(data => {
        setCurriculum(data || {});
        const first = data?.paths?.[0] || data?.tagPaths?.[0];
        setActiveId(localStorage.getItem(LAST_PATH_KEY) || first?.id || "");
      })
      .catch(() => setCurriculum({}));

    const refreshAccount = () => {
      setAccount(readAccount());
      setCompletedBooks(readCompletedBooks());
    };

    refreshAccount();
    window.addEventListener("jju-account", refreshAccount);
    window.addEventListener("storage", refreshAccount);
    return () => {
      window.removeEventListener("jju-account", refreshAccount);
      window.removeEventListener("storage", refreshAccount);
    };
  }, []);

  const bookMap = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const paths = useMemo(() => {
    return [...(curriculum.paths || []), ...(curriculum.tagPaths || [])]
      .filter(item => !item.deleted);
  }, [curriculum]);

  const readyIds = useMemo(() => new Set(books.filter(book => !["unavailable", "coming-soon", "hidden"].includes(book.status || "ready")).map(book => book.id)), [books]);
  const soonIds = useMemo(() => new Set(books.filter(book => book.status === "coming-soon").map(book => book.id)), [books]);
  const unavailableIds = useMemo(() => new Set(books.filter(book => book.status === "unavailable").map(book => book.id)), [books]);

  const pathStats = useMemo(() => {
    const stats = new Map<string, { total: number; ready: number; soon: number; unavailable: number; minutes: number; completed: number }>();
    paths.forEach(path => {
      const uniqueIds = [...new Set(path.books.map(book => book.id))];
      stats.set(path.id, {
        total: uniqueIds.length,
        ready: uniqueIds.filter(id => readyIds.has(id)).length,
        soon: uniqueIds.filter(id => soonIds.has(id)).length,
        unavailable: uniqueIds.filter(id => unavailableIds.has(id)).length,
        minutes: uniqueIds.reduce((sum, id) => sum + Number(bookMap.get(id)?.readingMinutes || 0), 0),
        completed: uniqueIds.filter(id => completedBooks.has(id)).length,
      });
    });
    return stats;
  }, [bookMap, completedBooks, paths, readyIds, soonIds, unavailableIds]);

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    return paths.filter(item => {
      const ids = item.books.map(book => book.id);
      const bookTitles = item.books.map(pathBook => bookMap.get(pathBook.id)?.title || pathBook.id);
      if (availability === "Ready" && !ids.some(id => readyIds.has(id))) return false;
      if (availability === "Coming Soon" && !ids.some(id => soonIds.has(id))) return false;
      if (availability === "Unavailable" && !ids.some(id => unavailableIds.has(id))) return false;
      if (q && ![item.title, item.description, ...(item.tags || []), ...bookTitles].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [availability, bookMap, paths, query, readyIds, soonIds, unavailableIds]);

  const active = visible.find(item => item.id === activeId) || visible[0];
  const activeStats = active ? pathStats.get(active.id) : undefined;
  const activeBooks = (active?.books || []).filter(pathBook => {
    if (availability === "Ready") return readyIds.has(pathBook.id);
    if (availability === "Coming Soon") return soonIds.has(pathBook.id);
    if (availability === "Unavailable") return unavailableIds.has(pathBook.id);
    return true;
  });
  const firstUnread = activeBooks.find(pathBook => readyIds.has(pathBook.id) && !completedBooks.has(pathBook.id)) || activeBooks.find(pathBook => readyIds.has(pathBook.id));
  const savedPathIds = new Set(account?.savedPathIds || []);

  function choosePath(id: string) {
    setActiveId(id);
    localStorage.setItem(LAST_PATH_KEY, id);
  }

  function rememberPath(path: CurriculumItem, makeActive = false) {
    const base = account || {
      name: "Local Reader",
      savedPathIds: [],
      joinedAt: new Date().toISOString(),
    };
    const nextSaved = new Set(base.savedPathIds || []);
    nextSaved.add(path.id);
    const next = {
      ...base,
      savedPathIds: [...nextSaved],
      activePathId: makeActive ? path.id : base.activePathId || path.id,
    };
    setAccount(next);
    saveAccount(next);
  }

  return (
    <main className="page pathsPage">
      <section className="pathsHeroV2">
        <div>
          <p className="kicker">JJ University</p>
          <h1>Choose a series.</h1>
        </div>
      </section>

      <section className="pathsToolbarV2">
        <label>
          <span>Search series</span>
          <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Empire, psychology, Jesus, tech..." />
        </label>
        <label>
          <span>Availability</span>
          <select className="select" value={availability} onChange={event => setAvailability(event.target.value)}>
            <option>Ready</option>
            <option>Coming Soon</option>
            <option>Unavailable</option>
            <option>All</option>
          </select>
        </label>
      </section>

      <section className="pathBrowserV2">
        <section className="pathIndexGrid" aria-label="Reading paths">
          {visible.map(item => {
            const stats = pathStats.get(item.id);
            const completePercent = stats?.total ? Math.round((stats.completed / stats.total) * 100) : 0;
            const previewBooks = item.books.slice(0, 5).map(pathBook => bookMap.get(pathBook.id)).filter(Boolean) as Book[];
            return (
              <button className={item.id === active?.id ? "active pathIndexCard" : "pathIndexCard"} key={item.id} onClick={() => choosePath(item.id)}>
                <span className="pathIndexCopy">
                  <strong>{item.title}</strong>
                  {item.description && <small>{item.description}</small>}
                </span>
                <span className="pathIndexMeta">{stats?.ready || 0} ready / {stats?.total || item.books.length} total / {completePercent}% read</span>
                <span className="pathCoverStrip" aria-hidden="true">
                  {previewBooks.map(book => (
                    <img src={coverFor(book, book.id)} data-fallback-src={legacyCoverFor(book, book.id)} alt="" loading="lazy" decoding="async" onError={coverFallback} key={book.id} />
                  ))}
                </span>
              </button>
            );
          })}
        </section>

        {active && (
          <section className="pathDetailPanelV2">
            <div className="pathDetailHero">
              <div>
                <p className="kicker">{availability === "Ready" ? `${activeStats?.ready || 0} ready books` : `${activeBooks.length} showing`}</p>
                <h2>{active.title}</h2>
                {active.description && <p>{active.description}</p>}
              </div>

              <aside className="pathCourseCard">
                <div><strong>{minutesLabel(activeStats?.minutes || 0)}</strong><span>total reading time</span></div>
                <div><strong>{activeStats?.completed || 0}/{activeStats?.total || 0}</strong><span>books read</span></div>
                <div><strong>{activeStats?.soon || 0}</strong><span>coming soon</span></div>
                <div className="pathProgressTrack"><span style={{ width: `${activeStats?.total ? Math.round(((activeStats.completed || 0) / activeStats.total) * 100) : 0}%` }} /></div>
                <button className="formBtn" onClick={() => rememberPath(active, true)}>{savedPathIds.has(active.id) ? "Set Current Series" : "Save Series"}</button>
                {firstUnread && <Link className="btn secondary" href={`/reader?book=${firstUnread.id}`}>Start Reading</Link>}
              </aside>
            </div>

            <div className="pathCountNote">
              Ready mode hides coming-soon and unavailable books. This series has {activeStats?.ready || 0} ready out of {activeStats?.total || active.books.length} total.
            </div>

            <div className="pathDetailBooksV2">
              {activeBooks.map((pathBook, index) => {
                const book = bookMap.get(pathBook.id);
                const status = book?.status || "ready";
                const locked = ["coming-soon", "unavailable"].includes(status);
                const read = completedBooks.has(pathBook.id);
                return (
                  <Link href={locked ? "#" : `/reader?book=${pathBook.id}`} className={`pathDetailBookV2 ${locked ? "locked" : ""} ${read ? "read" : ""}`} key={`${active.id}-${pathBook.id}-${index}`}>
                    <span className="pathBookNumberV2">{index + 1}</span>
                    <img src={coverFor(book, pathBook.id)} data-fallback-src={legacyCoverFor(book, pathBook.id)} alt="" loading="lazy" decoding="async" onError={coverFallback} />
                    <span>
                      <strong>{book?.title || pathBook.id}</strong>
                      <small>
                        {read ? "Read" : status === "coming-soon" ? "Coming soon" : status === "unavailable" ? "Unavailable" : book?.readingLabel && book.readingLabel !== "Unknown" ? book.readingLabel : "Open reader"}
                        {book?.chapterCount ? ` • ${book.chapterCount} chapters` : ""}
                      </small>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
