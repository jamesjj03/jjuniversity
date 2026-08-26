"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import CoverImage from "@/components/CoverImage";
import { GuardedAdminLink, useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import {
  canonicalWorkshopPath,
  WORKSHOP_MODES,
  WORKSHOP_TOOLS,
  workshopModeForPath,
  workshopPathMatches,
  type WorkshopModeId,
} from "@/lib/workshopNavigation";
import {
  openWorkshopFinder,
  readWorkshopRecent,
  rememberWorkshopRecent,
  WORKSHOP_OPEN_FINDER_EVENT,
  WORKSHOP_RECENT_EVENT,
  type WorkshopRecentItem,
} from "@/lib/workshopRecent";
import legacyStyles from "@/app/admin/AdminWorkspace.module.css";
import styles from "./WorkshopShell.module.css";

type BookIndexItem = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  creator: string;
  series: string;
  tags: string[];
  status: string;
  visibility: "main" | "archive";
  coverFile: string;
};

type Overlay = "finder" | "tools" | null;

const ROUTE_IDENTITIES: Array<{
  href: string;
  label: string;
  description: string;
  kind: WorkshopRecentItem["kind"];
}> = [
  { href: "/admin/books/new", label: "New book", description: "Start a hidden draft", kind: "book" },
  { href: "/admin/books", label: "Book library", description: "Search or browse every book", kind: "book" },
  { href: "/admin/organize", label: "Collections organizer", description: "Drag, remove, and reorder books", kind: "collection" },
  { href: "/admin/topics", label: "Topics and descriptions", description: "Audit the library's editorial labels", kind: "collection" },
  { href: "/admin/taxonomy-review", label: "Taxonomy review", description: "Review shelves, topics, and edge cases", kind: "collection" },
  { href: "/admin/print/proofs", label: "Print proof gallery", description: "Inspect rendered physical-book pages", kind: "print" },
  { href: "/admin/print", label: "Print editor", description: "Make physical-edition decisions", kind: "print" },
  { href: "/admin/narrators", label: "Narrators", description: "Assign and review narration work", kind: "audio" },
  { href: "/admin/audio", label: "Audio review", description: "Listen to sealed audiobook editions", kind: "audio" },
  { href: "/admin/reading", label: "Reading activity", description: "Signed-in reader analytics", kind: "review" },
  { href: "/admin/manuscript-case", label: "Capitalization review", description: "Continue a reviewed case batch", kind: "review" },
  { href: "/admin/editorial", label: "Editorial records", description: "Inspect editorial review records", kind: "review" },
  { href: "/admin/atlas", label: "Atlas review", description: "Review maps, inventory, and lineage", kind: "review" },
  { href: "/admin/arena", label: "Arena", description: "Review local source candidates", kind: "review" },
  { href: "/admin/reviews", label: "Review queue", description: "Decisions that require your eyes", kind: "review" },
  { href: "/admin/legacy", label: "Legacy workspace", description: "Retained compatibility tools", kind: "tool" },
  { href: "/admin/more", label: "Workshop tools", description: "Specialized and retained tools", kind: "tool" },
];

function ModeIcon({ mode }: { mode: WorkshopModeId }) {
  if (mode === "books") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c2.7-.7 5.4-.2 8 1.5v12c-2.6-1.7-5.3-2.2-8-1.5v-12Zm16 0c-2.7-.7-5.4-.2-8 1.5v12c2.6-1.7 5.3-2.2 8-1.5v-12Z" /></svg>;
  }
  if (mode === "collections") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-7.5 9 7.5 4 7.5-4M4.5 16l7.5 4 7.5-4" /></svg>;
  }
  if (mode === "print") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H4V9h16v8h-3M7 14h10v7H7v-7Z" /><path d="M17 11h.01" /></svg>;
  }
  if (mode === "audio") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h4v7H6a2 2 0 0 1-2-2v-5Zm16 0h-4v7h2a2 2 0 0 0 2-2v-5Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v17H5V4Zm4-1h6v4H9V3Z" /><path d="m8.5 13 2.2 2.2 4.8-5" /></svg>;
}

function BookStatus({ status }: { status: string }) {
  const label = status === "ready"
    ? "Published"
    : status === "coming-soon"
      ? "Coming soon"
      : status === "needs-review"
        ? "Needs review"
        : status === "unavailable"
          ? "Unavailable"
          : "Hidden draft";
  return <span>{label}</span>;
}

function finderScore(book: BookIndexItem, query: string) {
  const title = book.title.toLocaleLowerCase();
  const id = book.id.toLocaleLowerCase();
  const subtitle = book.subtitle.toLocaleLowerCase();
  const description = book.description.toLocaleLowerCase();
  const series = book.series.toLocaleLowerCase();
  const creator = book.creator.toLocaleLowerCase();
  const tags = book.tags.join(" ").toLocaleLowerCase();
  if (title === query || id === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  if (subtitle.startsWith(query) || series.startsWith(query)) return 3;
  if (`${subtitle} ${series} ${creator} ${tags} ${description} ${id}`.includes(query)) return 4;
  return 99;
}

function routeIdentity(pathname: string, books: BookIndexItem[], indexSettled: boolean) {
  const bookMatch = pathname.match(/^\/admin\/books\/([^/]+)(?:\/(details|manuscript))?$/);
  if (bookMatch && bookMatch[1] !== "new") {
    const id = decodeURIComponent(bookMatch[1]);
    const book = books.find(item => item.id === id || item.slug === id);
    if (!book && !indexSettled) return null;
    return {
      href: `/admin/books/${encodeURIComponent(id)}${bookMatch[2] === "details" ? "/details" : ""}`,
      label: book?.title || id.replaceAll("-", " "),
      description: bookMatch[2] === "details" ? "Book details" : "Manuscript",
      kind: "book" as const,
    };
  }
  return ROUTE_IDENTITIES.find(item => workshopPathMatches(pathname, item.href)) || null;
}

export default function WorkshopShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { adminBasePath, hasUnsavedChanges, unsavedLabels } = useAdminUnsavedChanges();
  const canonicalPath = canonicalWorkshopPath(pathname, adminBasePath);
  const activeMode = workshopModeForPath(canonicalPath);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [finderReturnHref, setFinderReturnHref] = useState("/admin/books");
  const [query, setQuery] = useState("");
  const [books, setBooks] = useState<BookIndexItem[]>([]);
  const [indexState, setIndexState] = useState<"loading" | "ready" | "error">("loading");
  const [recent, setRecent] = useState<WorkshopRecentItem[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const finderInputRef = useRef<HTMLInputElement>(null);
  const toolsCloseRef = useRef<HTMLButtonElement>(null);

  const openFinderOverlay = useCallback(() => {
    const actualPath = canonicalWorkshopPath(window.location.pathname, adminBasePath);
    const actualHref = `${actualPath}${window.location.search}`;
    setFinderReturnHref(
      actualPath === "/admin" || actualPath.startsWith("/admin/books/")
        ? "/admin/books"
        : actualHref,
    );
    setQuery("");
    setOverlay("finder");
  }, [adminBasePath, setFinderReturnHref, setOverlay, setQuery]);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/book-index", { cache: "no-store" })
      .then(async response => {
        const result = await response.json().catch(() => ({})) as { books?: unknown };
        if (!response.ok || !Array.isArray(result.books)) throw new Error("Book index unavailable");
        const safeBooks = result.books
          .filter(book => Boolean(book && typeof book === "object"))
          .map(value => {
            const book = value as Partial<BookIndexItem>;
            return {
              id: String(book.id || "").trim(),
              slug: String(book.slug || book.id || "").trim(),
              title: String(book.title || "").trim(),
              subtitle: String(book.subtitle || "").trim(),
              description: String(book.description || "").trim(),
              creator: String(book.creator || "").trim(),
              series: String(book.series || "").trim(),
              tags: Array.isArray(book.tags) ? book.tags.map(String).filter(Boolean) : [],
              status: String(book.status || "hidden").trim(),
              visibility: book.visibility === "archive" ? "archive" as const : "main" as const,
              coverFile: String(book.coverFile || "").trim(),
            };
          })
          .filter((book): book is BookIndexItem => Boolean(book.id && book.title));
        if (!safeBooks.length) throw new Error("Book index is empty");
        if (active) {
          setBooks(safeBooks);
          setIndexState("ready");
        }
      })
      .catch(() => {
        if (active) setIndexState("error");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const syncRecent = () => setRecent(readWorkshopRecent());
    const timer = window.setTimeout(syncRecent, 0);
    window.addEventListener(WORKSHOP_RECENT_EVENT, syncRecent);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(WORKSHOP_RECENT_EVENT, syncRecent);
    };
  }, []);

  useEffect(() => {
    const openFinder = () => openFinderOverlay();
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        openFinder();
      }
    };
    window.addEventListener(WORKSHOP_OPEN_FINDER_EVENT, openFinder);
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener(WORKSHOP_OPEN_FINDER_EVENT, openFinder);
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [openFinderOverlay]);

  useEffect(() => {
    if (canonicalPath === "/admin") return;
    if (/^\/admin\/books\/[^/]+$/.test(canonicalPath)) return;
    const identity = routeIdentity(canonicalPath, books, indexState !== "loading");
    if (!identity) return;
    rememberWorkshopRecent({
      ...identity,
      href: identity.href === canonicalPath ? `${identity.href}${window.location.search}` : identity.href,
    });
  }, [books, canonicalPath, indexState]);

  useEffect(() => {
    if (!overlay) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      if (overlay === "finder") finderInputRef.current?.focus();
      else toolsCloseRef.current?.focus();
    }, 0);

    function handleModalKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverlay(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(overlayRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) || [])].filter(element => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleModalKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleModalKey);
      previousFocus?.focus();
    };
  }, [overlay]);

  const finderResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      const recentBookIds = recent
        .filter(item => item.kind === "book")
        .map(item => item.href.match(/^\/admin\/books\/([^/?]+)/)?.[1])
        .filter((id): id is string => Boolean(id));
      return recentBookIds
        .map(id => {
          try {
            const decoded = decodeURIComponent(id);
            return books.find(book => book.id === decoded || book.slug === decoded);
          } catch {
            return undefined;
          }
        })
        .filter((book): book is BookIndexItem => Boolean(book))
        .slice(0, 6);
    }
    return books
      .map(book => ({ book, score: finderScore(book, normalized) }))
      .filter(result => result.score < 99)
      .sort((left, right) => left.score - right.score || left.book.title.localeCompare(right.book.title))
      .slice(0, 8)
      .map(result => result.book);
  }, [books, query, recent]);

  const currentIdentity = routeIdentity(canonicalPath, books, indexState !== "loading");
  const routeTitle = canonicalPath === "/admin" ? "Home" : currentIdentity?.label || activeMode?.label || "Workshop";
  const routeParent = canonicalPath === "/admin" ? "JJU Workshop" : activeMode?.label || "Workshop";
  const activeSubnavHref = activeMode?.subnav
    .map(item => item.href)
    .sort((left, right) => right.length - left.length)
    .find(href => workshopPathMatches(canonicalPath, href));

  function openOverlay(next: Exclude<Overlay, null>) {
    if (next === "finder") {
      openFinderOverlay();
      return;
    }
    setOverlay(next);
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target) setOverlay(null);
  }

  function closeBookFinder() {
    setOverlay(null);
  }

  return (
    <div className={`${legacyStyles.shell} ${styles.shell}`}>
      <nav className={styles.skipNav} aria-label="Skip links">
        <a className={styles.skipLink} href="#workshop-content">Skip to Workshop content</a>
      </nav>

      <aside className={styles.sidebar} aria-label="JJU Workshop">
        <GuardedAdminLink className={styles.brand} href="/admin" aria-label="Workshop home">
          <span className={styles.brandMark}>JJ</span>
          <span><strong>JJU Workshop</strong><small>Your publishing workspace</small></span>
        </GuardedAdminLink>
        <button className={styles.sidebarFinder} type="button" onClick={() => openOverlay("finder")} aria-keyshortcuts="Control+K Meta+K">
          <span aria-hidden="true">⌕</span>
          <span><strong>Find any book</strong><small>Open in two taps</small></span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className={styles.primaryNav} aria-label="Workshop modes">
          {WORKSHOP_MODES.map(mode => {
            const active = activeMode?.id === mode.id;
            return (
              <GuardedAdminLink className={active ? styles.activeMode : styles.mode} href={mode.href} aria-current={active ? "page" : undefined} key={mode.id}>
                <span className={styles.modeIcon}><ModeIcon mode={mode.id} /></span>
                <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
              </GuardedAdminLink>
            );
          })}
        </nav>
        <div className={styles.sidebarUtility}>
          <button type="button" onClick={() => openOverlay("tools")}>All Workshop tools</button>
          <GuardedAdminLink href="/">View public site</GuardedAdminLink>
        </div>
      </aside>

      <div className={styles.stage}>
        <header className={styles.topBar}>
          <GuardedAdminLink className={styles.mobileBrand} href="/admin" aria-label="Workshop home"><span>JJ</span><strong>Workshop</strong></GuardedAdminLink>
          <div className={styles.routeIdentity}>
            <span>{routeParent}</span>
            <strong>{routeTitle}</strong>
          </div>
          <div className={styles.topActions}>
            <span
              className={hasUnsavedChanges ? styles.unsavedState : styles.savedState}
              title={hasUnsavedChanges ? `Unsaved in ${unsavedLabels.join(", ")}` : "No unprotected changes on this page"}
              role="status"
              aria-live="polite"
            >
              <i aria-hidden="true" />
              <span>{hasUnsavedChanges ? "Unsaved" : "Safe to leave"}</span>
            </span>
            <button className={styles.finderButton} type="button" onClick={() => openOverlay("finder")} aria-label="Find any book">
              <span aria-hidden="true">⌕</span><strong>Find book</strong>
            </button>
            <button className={styles.toolsButton} type="button" onClick={() => openOverlay("tools")} aria-label="Open all Workshop tools" aria-expanded={overlay === "tools"}>•••</button>
          </div>
        </header>

        {activeMode && activeMode.subnav.length > 0 && (
          <nav className={styles.contextNav} aria-label={`${activeMode.label} tools`}>
            <div>
              {activeMode.subnav.map(item => {
                const active = activeSubnavHref === item.href;
                return <GuardedAdminLink className={active ? styles.activeContext : styles.contextLink} href={item.href} aria-current={active ? "page" : undefined} key={item.href}>{item.shortLabel || item.label}</GuardedAdminLink>;
              })}
            </div>
          </nav>
        )}

        <div id="workshop-content" className={styles.content} tabIndex={-1}>{children}</div>
      </div>

      <nav className={styles.bottomNav} aria-label="Workshop modes">
        {WORKSHOP_MODES.map(mode => {
          const active = activeMode?.id === mode.id;
          return (
            <GuardedAdminLink className={active ? styles.activeBottomMode : styles.bottomMode} href={mode.href} aria-current={active ? "page" : undefined} key={mode.id}>
              <ModeIcon mode={mode.id} />
              <span>{mode.label}</span>
            </GuardedAdminLink>
          );
        })}
      </nav>

      {overlay === "finder" && (
        <div className={styles.overlay} onMouseDown={closeFromBackdrop}>
          <section ref={overlayRef} className={styles.finderDialog} role="dialog" aria-modal="true" aria-labelledby="workshop-finder-title">
            <header className={styles.dialogHeader}>
              <div><span>Books</span><h2 id="workshop-finder-title">Find any book</h2></div>
              <button type="button" onClick={() => setOverlay(null)} aria-label="Close book finder">Close</button>
            </header>
            <label className={styles.globalSearch}>
              <span>Title, subtitle, series, or book ID</span>
              <input ref={finderInputRef} type="search" inputMode="search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="Start typing a title…" />
            </label>
            <div className={styles.finderBody}>
              {indexState === "loading" ? (
                <div className={styles.finderMessage}><strong>Opening the library…</strong><span>Loading the current protected book index.</span></div>
              ) : indexState === "error" ? (
                <div className={styles.finderMessage} role="alert"><strong>The book index could not be opened safely.</strong><span>You can still use the full Books page; no partial list is shown here.</span></div>
              ) : finderResults.length ? (
                <div className={styles.finderResults}>
                  {!query.trim() && <p className={styles.resultsLabel}>Recently opened books</p>}
                  {finderResults.map(book => {
                    const manuscriptHref = `/admin/books/${encodeURIComponent(book.id)}?from=${encodeURIComponent(finderReturnHref)}`;
                    const detailsHref = `/admin/books/${encodeURIComponent(book.id)}/details?from=${encodeURIComponent(finderReturnHref)}`;
                    return (
                      <article className={styles.finderResult} key={book.id}>
                        <GuardedAdminLink className={styles.bookResultMain} href={manuscriptHref} prefetch={false} onClick={closeBookFinder}>
                          <span className={styles.finderCover}>
                            <CoverImage alt="" fallbackSrc={coverFallbackSrc(book)} height={96} sizes="64px" src={coverWebpSrc(book)} width={64} />
                          </span>
                          <span className={styles.finderCopy}><BookStatus status={book.status} /><strong>{book.title}</strong><small>{book.subtitle || book.series || book.id}</small></span>
                          <span className={styles.openBook}>Open manuscript <b aria-hidden="true">→</b></span>
                        </GuardedAdminLink>
                        <GuardedAdminLink className={styles.detailsLink} href={detailsHref} prefetch={false} onClick={closeBookFinder}>Details</GuardedAdminLink>
                      </article>
                    );
                  })}
                </div>
              ) : query.trim() ? (
                <div className={styles.finderMessage}><strong>No books match “{query.trim()}.”</strong><span>Try fewer words or browse the full library.</span></div>
              ) : (
                <div className={styles.finderMessage}><strong>Type a few letters to find any book.</strong><span>Your recently opened books will appear here next time.</span></div>
              )}
            </div>
            <footer className={styles.dialogFooter}>
              <GuardedAdminLink href="/admin/books" onClick={() => setOverlay(null)}>Browse the full library</GuardedAdminLink>
              <span>{books.length ? `${books.length} books available` : "Protected library"}</span>
            </footer>
          </section>
        </div>
      )}

      {overlay === "tools" && (
        <div className={styles.overlay} onMouseDown={closeFromBackdrop}>
          <section ref={overlayRef} className={styles.toolsDialog} role="dialog" aria-modal="true" aria-labelledby="workshop-tools-title">
            <header className={styles.dialogHeader}>
              <div><span>Workshop</span><h2 id="workshop-tools-title">All tools</h2></div>
              <button ref={toolsCloseRef} type="button" onClick={() => setOverlay(null)}>Close</button>
            </header>
            <div className={styles.toolList}>
              {WORKSHOP_TOOLS.map(item => (
                <GuardedAdminLink href={item.href} onClick={() => {
                  rememberWorkshopRecent({ href: item.href, label: item.label, description: item.description, kind: "tool" });
                  setOverlay(null);
                }} key={`${item.href}-${item.label}`}>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span><b aria-hidden="true">→</b>
                </GuardedAdminLink>
              ))}
            </div>
            <footer className={styles.toolsFooter}>
              <GuardedAdminLink href="/" onClick={() => setOverlay(null)}>View public JJ University <span aria-hidden="true">↗</span></GuardedAdminLink>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export function WorkshopFinderButton({ className, children = "Find any book" }: { className?: string; children?: ReactNode }) {
  return <button className={className} type="button" onClick={openWorkshopFinder}>{children}</button>;
}
