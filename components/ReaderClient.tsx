"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import { coverWebpSrc } from "@/lib/cover";

type BookContent = {
  id: string;
  title?: string;
  creator?: string;
  description?: string;
  sections?: Section[];
  error?: string;
};

type BookMeta = {
  id?: string;
  cover?: string;
  coverFile?: string;
};

type Section = {
  id: string;
  index: number;
  title: string;
  kind?: string;
  html: string;
  text?: string;
  wordCount?: number;
};

type Preferences = {
  readerTheme?: "dark" | "paper" | "light" | "night" | "sepia";
  readerSize?: "small" | "medium" | "large" | "xlarge";
  readerWidth?: "narrow" | "focused" | "wide" | "full";
  readerFont?: "dyslexic" | "serif" | "book" | "journal" | "classic";
  readerSpacing?: "tight" | "normal" | "loose";
  saveProgress?: boolean;
};

type SavedQuote = {
  id: string;
  bookId: string;
  bookTitle: string;
  sectionId: string;
  sectionTitle: string;
  text: string;
  savedAt: string;
};

type ReadingHistoryItem = {
  bookId: string;
  requestedId?: string;
  title: string;
  sectionIndex: number;
  sectionTitle?: string;
  actualSeconds: number;
  updatedAt: string;
};

const PREFS_KEY = "jju.preferences";
const PROGRESS_KEY = "jju.readerProgress";
const READ_KEY = "jju.readBooks";
const READ_EVENTS_KEY = "jju.readingEvents";
const ACTUAL_TIME_KEY = "jju.actualReadingSeconds";
const HISTORY_KEY = "jju.readingHistory";
const OPEN_HISTORY_SECONDS = 15;
const AUTO_COMPLETE_SECONDS = 60;
const BOOKMARKS_KEY = "jju.readerBookmarks";
const NOTES_KEY = "jju.readerNotes";
const QUOTES_KEY = "jju.readerQuotes";

function getBookParam() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("book") || "";
}

function readPrefs(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    if (saved.readerFont === "sans" || saved.readerFont === "mono") saved.readerFont = "dyslexic";
    return {
      readerTheme: "paper",
      readerSize: "large",
      readerWidth: "full",
      readerFont: "book",
      readerSpacing: "normal",
      ...saved,
    };
  } catch {
    return { readerTheme: "paper", readerSize: "large", readerWidth: "full", readerFont: "book", readerSpacing: "normal" };
  }
}

function readProgress(id: string, requestedId: string) {
  try {
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return Number(progress[id] ?? progress[requestedId] ?? 0);
  } catch {
    return 0;
  }
}

function readActualSeconds(id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTUAL_TIME_KEY) || "{}") as Record<string, number>;
    return Number(all[id] || 0);
  } catch {
    return 0;
  }
}

function saveActualSeconds(id: string, seconds: number) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTUAL_TIME_KEY) || "{}") as Record<string, number>;
    all[id] = seconds;
    localStorage.setItem(ACTUAL_TIME_KEY, JSON.stringify(all));
  } catch {
    return;
  }
}

function readRecord<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

function writeRecord<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function saveReadingHistory(item: ReadingHistoryItem) {
  try {
    const all = readRecord<ReadingHistoryItem[]>(HISTORY_KEY, []);
    const next = [
      item,
      ...all.filter(entry => entry.bookId !== item.bookId && entry.requestedId !== item.requestedId),
    ].slice(0, 24);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("jju-reading-history"));
  } catch {
    return;
  }
}

function defaultReaderPanelsOpen() {
  if (typeof window === "undefined") return true;
  return !window.matchMedia("(max-width: 1180px)").matches;
}

function readCompletedSet() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch {
    return new Set<string>();
  }
}

function secondsLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!minutes) return `${remainder}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${mins}m`;
}

function sectionMinutes(section: Section | undefined) {
  if (!section) return 0;
  const words = Number(section.wordCount) > 0
    ? Number(section.wordCount)
    : (section.text || plainText(section.html)).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 230));
}

function estimateMinutes(sections: Section[]) {
  const words = sections.reduce((sum, section) => {
    if (Number(section.wordCount) > 0) return sum + Number(section.wordCount);
    const text = section.text || plainText(section.html);
    return sum + text.split(/\s+/).filter(Boolean).length;
  }, 0);
  return Math.max(1, Math.ceil(words / 230));
}

function safeKind(kind: string | undefined) {
  return String(kind || "default").toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "default";
}

function plainText(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleSubtitle(section: Section | undefined, bookTitle: string) {
  if (!section) return "";
  let text = plainText(section.html);
  text = text.replace(new RegExp(`^${escapeRegExp(bookTitle)}\\s*`, "i"), "").trim();
  text = text.replace(/\bby\s+(?:james johnson|jj)\b.*$/i, "").trim();
  if (!text || text.toLowerCase() === bookTitle.trim().toLowerCase()) return "";
  return text;
}

function inferSectionKind(section: Section, visibleIndex: number, bookTitle: string) {
  const rawKind = safeKind(section.kind);
  const title = section.title.trim().toLowerCase();
  const text = plainText(section.html).toLowerCase();
  const normalizedBookTitle = bookTitle.trim().toLowerCase();

  if (rawKind === "toc" || title === "contents" || title === "table of contents") return "toc";
  if (visibleIndex === 0) return "title";
  if (/^dedication$/.test(title)) return "dedication";
  if (/^(prologue|preface|foreword|introduction|epilogue|afterword)$/.test(title)) return "prologue";
  if (/acknowledg(e)?ments?/.test(title)) return "acknowledgments";
  if (/about( the)? author/.test(title)) return "about";
  if (/copyright/.test(title)) return "copyright";
  if (/^chapter\b/i.test(section.title)) return "chapter";
  if (["title", "dedication", "prologue", "acknowledgments", "about", "copyright", "backmatter"].includes(rawKind)) return rawKind;

  const looksLikeTitlePage = visibleIndex === 0
    || (!!normalizedBookTitle && title === normalizedBookTitle)
    || (!!normalizedBookTitle && text.startsWith(normalizedBookTitle) && text.includes("james johnson"));

  if (looksLikeTitlePage) return "title";
  if (rawKind === "chapter") return "chapter";
  return "default";
}

function cleanSectionHtml(html: string) {
  return html
    .replace(/<h[1-6]\b[^>]*class=["'][^"']*(?:chapter-title-page-padding|titled-section-page-padding)[^"']*["'][^>]*>\s*(?:<br\s*\/?\s*>)?\s*<\/h[1-6]>/gi, "")
    .replace(/<p\b[^>]*class=["'][^"']*(?:separator|br)[^"']*["'][^>]*>\s*(?:<br\s*\/?\s*>)?\s*<\/p>/gi, "")
    .replace(/<p\b[^>]*>\s*(?:<br\s*\/?\s*>)?\s*<\/p>/gi, "");
}

function htmlHasOwnHeading(html: string, displayKind: string) {
  if (displayKind === "title") return true;
  return /<(h1|h2|h3)\b/i.test(html) || /class=["'][^"']*(bordered-title|chapter-title|titled-section|page-title)[^"']*["']/i.test(html);
}

function headerLabel(displayKind: string) {
  if (displayKind === "title") return "Title page";
  if (displayKind === "prologue") return "Prologue";
  if (displayKind === "acknowledgments") return "Acknowledgments";
  if (displayKind === "backmatter") return "Back matter";
  return displayKind.replace(/-/g, " ");
}

function titleCoverHtml(bookTitle: string, subtitle: string, coverSrc: string) {
  return `
    <div class="titleCoverPage">
      <img class="titleCoverImage" src="${escapeHtml(coverSrc)}" alt="" />
      <div class="titleCoverText">
        <p class="titleCoverKicker">JJ University</p>
        <h1>${escapeHtml(bookTitle)}</h1>
        ${subtitle ? `<p class="titleCoverSubtitle">${escapeHtml(subtitle)}</p>` : ""}
        <p class="titleCoverCreator">by James Johnson</p>
      </div>
    </div>
  `;
}

function readerStyle(preferences: Preferences) {
  const theme = preferences.readerTheme || "paper";
  const size = preferences.readerSize || "large";
  const width = preferences.readerWidth || "full";
  const font = preferences.readerFont || "book";
  const spacing = preferences.readerSpacing || "normal";
  const colors = {
    dark: { bg: "#151515", page: "#191816", text: "#f5f1e8", muted: "#c7bda8", heading: "#fff", link: "#d6b25e", rule: "rgba(214,178,94,.34)" },
    night: { bg: "#080b10", page: "#0d1118", text: "#dbe7f6", muted: "#9fb1c7", heading: "#fff", link: "#87bfff", rule: "rgba(135,191,255,.32)" },
    paper: { bg: "#efe4cf", page: "#f7eddc", text: "#251d14", muted: "#715f4b", heading: "#140f09", link: "#8a5d13", rule: "rgba(138,93,19,.25)" },
    sepia: { bg: "#e5d2b2", page: "#efe0c6", text: "#2c2117", muted: "#705946", heading: "#120d09", link: "#795817", rule: "rgba(121,88,23,.26)" },
    light: { bg: "#f4f2ed", page: "#fbfaf6", text: "#1d1d1d", muted: "#606060", heading: "#050505", link: "#7b540f", rule: "rgba(123,84,15,.24)" },
  }[theme];
  const fontSize = { small: 16, medium: 18, large: 21, xlarge: 24 }[size];
  const lineHeight = { tight: 1.55, normal: 1.72, loose: 1.95 }[spacing];
  const fontFamily = {
    dyslexic: "Verdana, Tahoma, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    book: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    journal: "'Trebuchet MS', Verdana, Tahoma, sans-serif",
    classic: "'Book Antiqua', 'Palatino Linotype', Georgia, serif",
  }[font];
  const maxWidth = { narrow: "620px", focused: "760px", wide: "940px", full: "1120px" }[width];

  return `
    html, body { margin: 0; min-height: 100%; background: ${colors.bg}; color: ${colors.text}; }
    body { padding: clamp(18px, 3vw, 42px); font-family: ${fontFamily}; font-size: ${fontSize}px; line-height: ${lineHeight}; }
    * { box-sizing: border-box; }
    .readerDoc { max-width: ${maxWidth}; margin: 0 auto; min-height: calc(100vh - 84px); padding: clamp(28px, 5vw, 72px); background: ${colors.page}; border-radius: 8px; box-shadow: 0 16px 48px rgba(0,0,0,.22); overflow-wrap: break-word; }
    .readerContent { min-width: 0; }
    .sectionHeader { margin: 0 0 28px; padding-bottom: 16px; border-bottom: 1px solid ${colors.rule}; }
    .sectionKicker { margin: 0 0 7px; color: ${colors.muted}; font: 700 11px/1.2 Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; }
    .sectionTitle { margin: 0; color: ${colors.heading}; font-size: clamp(1.7rem, 5vw, 3.15rem); line-height: 1.04; }
    .kind-title, .kind-dedication { display: grid; align-content: center; text-align: center; min-height: calc(100vh - 240px); }
    .kind-chapter .sectionHeader, .kind-prologue .sectionHeader, .kind-acknowledgments .sectionHeader, .kind-copyright .sectionHeader, .kind-about .sectionHeader, .kind-backmatter .sectionHeader { text-align: center; }
    .kind-chapter .readerContent > h1:first-child, .kind-chapter .readerContent > h2:first-child, .kind-chapter .readerContent > h3:first-child,
    .kind-prologue .readerContent > h1:first-child, .kind-prologue .readerContent > h2:first-child, .kind-prologue .readerContent > h3:first-child,
    .kind-acknowledgments .readerContent > h1:first-child, .kind-acknowledgments .readerContent > h2:first-child, .kind-acknowledgments .readerContent > h3:first-child,
    .kind-copyright .readerContent > h1:first-child, .kind-copyright .readerContent > h2:first-child, .kind-copyright .readerContent > h3:first-child,
    .kind-about .readerContent > h1:first-child, .kind-about .readerContent > h2:first-child, .kind-about .readerContent > h3:first-child,
    .kind-backmatter .readerContent > h1:first-child, .kind-backmatter .readerContent > h2:first-child, .kind-backmatter .readerContent > h3:first-child { text-align: center; }
    .kind-prologue, .kind-acknowledgments, .kind-copyright, .kind-about, .kind-backmatter { text-align: left; }
    .kind-title .readerContent, .kind-dedication .readerContent { max-width: 820px; margin: 0 auto; }
    .readerDoc.kind-title { min-height: 0; padding: clamp(22px, 4vw, 48px); }
    .kind-title .readerContent { max-width: 980px; width: 100%; }
    .titleCoverPage { display: grid; grid-template-columns:minmax(170px, 34%) minmax(0, 1fr); gap:clamp(22px, 5vw, 58px); align-items:center; min-height: calc(100vh - 190px); text-align:left; }
    .titleCoverImage { width: 100%; max-height: calc(100vh - 220px); object-fit: contain; margin: 0; border-radius: 8px; box-shadow: 0 24px 70px rgba(0,0,0,.34); }
    .titleCoverKicker { margin: 0 0 12px; color: ${colors.muted}; font: 800 12px/1.2 Arial, sans-serif; letter-spacing: .16em; text-transform: uppercase; }
    .titleCoverText h1 { margin: 0; font-size: clamp(2.2rem, 6vw, 5.2rem); line-height: .98; overflow-wrap:anywhere; }
    .titleCoverSubtitle { margin: 16px 0 0; color: ${colors.muted}; font-size: clamp(1rem, 2.3vw, 1.45rem); font-style: italic; line-height:1.25; }
    .titleCoverCreator { margin: 22px 0 0; font-size: clamp(1rem, 2.2vw, 1.3rem); color: ${colors.text}; font-weight:700; }
    .kind-title .readerContent p:first-child strong { font-size: clamp(2.1rem, 7vw, 4.8rem); line-height: 1.02; }
    .kind-title .readerContent p, .kind-dedication .readerContent p { font-size: clamp(1.05rem, 2.2vw, 1.45rem); }
    .kind-dedication .readerContent, .kind-dedication .readerContent p { text-align: center; }
    .chapter-title, .titled-section { text-align: left; margin: 0; }
    .chapter-title .bordered-title, .titled-section .bordered-title { display: block; width: max-content; max-width: 100%; margin: 0 auto .45em; text-align: center; }
    .chapter-title .subtitle, .titled-section .subtitle { margin: 0 auto 1.55em; text-align: center; }
    .chapter-title p, .chapter-title li, .chapter-title blockquote,
    .titled-section p, .titled-section li, .titled-section blockquote,
    .readerContent > p:first-child { text-align: left; }
    .kind-dedication .sectionHeader { border: 0; margin-bottom: 22px; padding-bottom: 0; }
    .kind-dedication .sectionKicker { display: none; }
    .kind-dedication .sectionTitle { font-size: clamp(2.2rem, 7vw, 4.6rem); }
    .kind-chapter, .kind-prologue { padding-top: clamp(24px, 4vw, 52px); }
    .chapter-title, .titled-section { margin-top: 0; }
    .chapter-title-page-padding, .titled-section-page-padding, .separator, .br { display: none !important; height: 0 !important; margin: 0 !important; padding: 0 !important; }
    h1, h2, h3 { color: ${colors.heading}; line-height: 1.15; margin: 1.25em 0 .65em; }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p { margin: 0 0 1.05em; }
    a { color: ${colors.link}; }
    img { max-width: 100%; height: auto; display: block; margin: 22px auto; border-radius: 6px; }
    ul, ol { padding-left: 1.4em; margin: 0 0 1.1em; }
    li { margin: .35em 0; }
    blockquote { border-left: 3px solid ${colors.rule}; margin: 1.4em 0; padding-left: 1em; color: ${colors.muted}; }
    .bordered-title { border: 1px solid ${colors.rule}; display: inline-block; padding: .25em .45em; margin-top: 0; }
    .subtitle { color: ${colors.muted}; margin-top: .7em; }
    @media (max-width: 720px) {
      .titleCoverPage { grid-template-columns: 1fr; text-align: center; justify-items: center; }
      .titleCoverImage { max-width: 260px; }
    }
  `;
}

export default function ReaderClient() {
  const viewerRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const touchStart = useRef<number | null>(null);
  const [requestedId, setRequestedId] = useState("");
  const [bookId, setBookId] = useState("");
  const [bookCoverSrc, setBookCoverSrc] = useState("");
  const [title, setTitle] = useState("Loading book...");
  const [subtitle, setSubtitle] = useState("");
  const [creator, setCreator] = useState("");
  const [status, setStatus] = useState("Loading book content...");
  const [error, setError] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(() => typeof window === "undefined" ? {} : readPrefs());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const [actualSeconds, setActualSeconds] = useState(0);
  const [chapterDrawerOpen, setChapterDrawerOpen] = useState(defaultReaderPanelsOpen);
  const [studyPanelOpen, setStudyPanelOpen] = useState(defaultReaderPanelsOpen);
  const [focusMode, setFocusMode] = useState(false);
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return new Set(readRecord<string[]>(BOOKMARKS_KEY, []));
  });
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    return readRecord<Record<string, string>>(NOTES_KEY, {});
  });
  const [quotes, setQuotes] = useState<SavedQuote[]>(() => {
    if (typeof window === "undefined") return [];
    return readRecord<SavedQuote[]>(QUOTES_KEY, []);
  });
  const [readerMessage, setReaderMessage] = useState("");
  const [completedBooks, setCompletedBooks] = useState<Set<string>>(() => readCompletedSet());

  const visibleSections = useMemo(() => {
    const bodySections = sections.filter(section => inferSectionKind(section, 0, title) !== "toc");
    return bodySections.length ? bodySections : sections;
  }, [sections, title]);

  const section = visibleSections[sectionIndex];
  const displayKind = section ? inferSectionKind(section, sectionIndex, title) : "default";
  const progressPercent = visibleSections.length ? Math.round(((sectionIndex + 1) / visibleSections.length) * 100) : 0;
  const estimatedMinutes = visibleSections.length ? estimateMinutes(visibleSections) : 0;
  const remainingSections = visibleSections.slice(sectionIndex + 1);
  const remainingMinutes = remainingSections.reduce((sum, item) => sum + sectionMinutes(item), 0);
  const currentSectionKey = bookId && section ? `${bookId}::${section.id}` : "";
  const currentNote = currentSectionKey ? notes[currentSectionKey] || "" : "";
  const isBookmarked = currentSectionKey ? bookmarks.has(currentSectionKey) : false;
  const chapterQuotes = section ? quotes.filter(item => item.bookId === bookId && item.sectionId === section.id).slice(0, 4) : [];
  const bookQuotes = quotes.filter(item => item.bookId === bookId);

  function handleReaderKey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target?.tagName || "")) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      nextSection();
    }
    if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      prevSection();
    }
  }

  function bindViewerKeys() {
    const frameWindow = viewerRef.current?.contentWindow;
    if (frameWindow) frameWindow.onkeydown = handleReaderKey;
  }

  function patchPreferences(patch: Partial<Preferences>) {
    const next = { ...readPrefs(), ...preferences, ...patch };
    setPreferences(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("jju-preferences"));
  }

  async function load() {
    try {
      setError("");
      setStatus("Loading book content...");
      const id = getBookParam();
      setRequestedId(id);
      if (!id) {
        setTitle("No book selected");
        setStatus("Open a book from the library.");
        setSections([]);
        return;
      }

      const [item, bookList] = await Promise.all([
        fetch(`/api/book/${encodeURIComponent(id)}`, { cache: "no-store" }).then(async response => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "Book content unavailable.");
          return data as BookContent;
        }),
        fetch("/books.json", { cache: "no-store" }).then(response => response.json()).catch(() => []),
      ]);

      const nextSections = [...(item.sections || [])].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
      const bodySections = nextSections.filter((nextSection, index) => inferSectionKind(nextSection, index, item.title || id) !== "toc");
      const readableCount = bodySections.length || nextSections.length;
      if (!readableCount) throw new Error(`No readable sections found for "${id}".`);

      const canonicalId = item.id || id;
      const books = Array.isArray(bookList) ? bookList : bookList?.books || [];
      const meta = books.find((book: BookMeta) => String(book.id || "").toLowerCase() === canonicalId.toLowerCase())
        || books.find((book: BookMeta) => String(book.id || "").toLowerCase() === id.toLowerCase())
        || { id: canonicalId };
      setBookId(canonicalId);
      setBookCoverSrc(coverWebpSrc(meta, canonicalId));
      setSubtitle(titleSubtitle(bodySections[0] || nextSections[0], item.title || canonicalId));
      setActualSeconds(readActualSeconds(canonicalId));
      setTitle(item.title || canonicalId);
      setCreator(item.creator || "");
      setSections(nextSections);
      setSectionIndex(Math.min(Math.max(0, readProgress(canonicalId, id)), readableCount - 1));
      setStatus("Reading");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Book content unavailable.");
      setStatus("Unavailable");
      setSections([]);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    function handlePreferences() {
      setPreferences(readPrefs());
    }

    window.addEventListener("jju-preferences", handlePreferences);
    window.addEventListener("storage", handlePreferences);
    return () => {
      window.removeEventListener("jju-preferences", handlePreferences);
      window.removeEventListener("storage", handlePreferences);
    };
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id || "");
      setCloudSyncReady(Boolean(data.user?.email_confirmed_at));
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || "");
      setCloudSyncReady(Boolean(session?.user?.email_confirmed_at));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!readerMessage) return;
    const timeout = window.setTimeout(() => setReaderMessage(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [readerMessage]);

  useEffect(() => {
    window.addEventListener("keydown", handleReaderKey);
    return () => window.removeEventListener("keydown", handleReaderKey);
  });

  useEffect(() => {
    if (!bookId || !visibleSections.length || preferences.saveProgress === false) return;

    try {
      const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
      progress[bookId] = sectionIndex;
      if (requestedId && requestedId !== bookId) progress[requestedId] = sectionIndex;
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));

      if (sectionIndex === visibleSections.length - 1 && actualSeconds >= AUTO_COMPLETE_SECONDS) {
        const readBefore = new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
        const read = new Set(readBefore);
        read.add(bookId);
        if (requestedId) read.add(requestedId);
        localStorage.setItem(READ_KEY, JSON.stringify([...read].sort()));

        if (!readBefore.has(bookId)) {
          const events = Array.isArray(JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]"))
            ? JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]")
            : [];
          events.push({ bookId, finishedAt: new Date().toISOString() });
          localStorage.setItem(READ_EVENTS_KEY, JSON.stringify(events.slice(-500)));
        }

        window.dispatchEvent(new Event("jju-account"));
      }
    } catch {
      return;
    }
  }, [actualSeconds, bookId, requestedId, sectionIndex, visibleSections.length, preferences.saveProgress]);

  useEffect(() => {
    const refreshCompleted = () => setCompletedBooks(readCompletedSet());
    window.addEventListener("jju-account", refreshCompleted);
    window.addEventListener("storage", refreshCompleted);
    return () => {
      window.removeEventListener("jju-account", refreshCompleted);
      window.removeEventListener("storage", refreshCompleted);
    };
  }, []);

  useEffect(() => {
    viewerRef.current?.contentWindow?.scrollTo(0, 0);
  }, [section?.id]);

  useEffect(() => {
    if (!bookId || status !== "Reading") return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      setActualSeconds(current => {
        const next = current + 1;
        saveActualSeconds(bookId, next);
        return next;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [bookId, status]);

  useEffect(() => {
    if (!bookId || status !== "Reading" || actualSeconds < OPEN_HISTORY_SECONDS) return;
    saveReadingHistory({
      bookId,
      requestedId,
      title,
      sectionIndex,
      sectionTitle: section?.title,
      actualSeconds,
      updatedAt: new Date().toISOString(),
    });
  }, [actualSeconds, bookId, requestedId, section?.title, sectionIndex, status, title]);

  useEffect(() => {
    if (!userId || !cloudSyncReady || !bookId || !visibleSections.length) return;
    if (actualSeconds % 20 !== 0 && sectionIndex !== visibleSections.length - 1) return;

    const supabase = createSupabaseBrowserClient();
    const now = new Date().toISOString();
    void supabase.from("reading_progress").upsert({
      user_id: userId,
      book_id: bookId,
      section_index: sectionIndex,
      section_count: visibleSections.length,
      progress_percent: progressPercent,
      estimated_minutes: estimatedMinutes,
      actual_seconds: actualSeconds,
      last_read_at: now,
      updated_at: now,
    }, { onConflict: "user_id,book_id" });

    if (sectionIndex === visibleSections.length - 1 && actualSeconds >= AUTO_COMPLETE_SECONDS) {
      void supabase.from("completed_books").upsert({
        user_id: userId,
        book_id: bookId,
        completed_at: now,
      }, { onConflict: "user_id,book_id" });
    }
  }, [actualSeconds, bookId, cloudSyncReady, estimatedMinutes, progressPercent, sectionIndex, userId, visibleSections.length]);

  const cleanedHtml = section ? cleanSectionHtml(section.html) : "";
  const renderedHtml = displayKind === "title" && bookCoverSrc ? titleCoverHtml(title, subtitle, bookCoverSrc) : cleanedHtml;
  const showHeader = section && !["title", "dedication"].includes(displayKind) ? !htmlHasOwnHeading(cleanedHtml, displayKind) : false;
  const srcDoc = section
    ? `<!doctype html>
      <html>
        <head>
          <base target="_blank" />
          <style>${readerStyle(preferences)}</style>
        </head>
        <body>
          <article class="readerDoc readerSection kind-${displayKind}">
            ${showHeader ? `<header class="sectionHeader"><p class="sectionKicker">${escapeHtml(headerLabel(displayKind))}</p><h1 class="sectionTitle">${escapeHtml(section.title)}</h1></header>` : ""}
            <div class="readerContent">${renderedHtml}</div>
          </article>
        </body>
      </html>`
    : "";

  function prevSection() {
    setSectionIndex(index => Math.max(0, index - 1));
  }

  function nextSection() {
    setSectionIndex(index => Math.min(visibleSections.length - 1, index + 1));
  }

  function jumpToSection(index: number) {
    setSectionIndex(Math.max(0, Math.min(visibleSections.length - 1, index)));
  }

  function toggleBookmark() {
    if (!currentSectionKey) return;
    setBookmarks(current => {
      const next = new Set(current);
      if (next.has(currentSectionKey)) {
        next.delete(currentSectionKey);
        setReaderMessage("Bookmark removed.");
      } else {
        next.add(currentSectionKey);
        setReaderMessage("Bookmark saved.");
      }
      writeRecord(BOOKMARKS_KEY, [...next].sort());
      return next;
    });
  }

  function saveNote(value: string) {
    if (!currentSectionKey) return;
    setNotes(current => {
      const next = { ...current, [currentSectionKey]: value };
      if (!value.trim()) delete next[currentSectionKey];
      writeRecord(NOTES_KEY, next);
      return next;
    });
  }

  function saveQuote() {
    if (!section || !bookId) return;
    const selected = viewerRef.current?.contentWindow?.getSelection()?.toString().trim() || "";
    if (!selected) {
      setReaderMessage("Highlight text inside the page first.");
      return;
    }
    const quote: SavedQuote = {
      id: `${bookId}-${section.id}-${Date.now()}`,
      bookId,
      bookTitle: title,
      sectionId: section.id,
      sectionTitle: section.title,
      text: selected.slice(0, 900),
      savedAt: new Date().toISOString(),
    };
    setQuotes(current => {
      const next = [quote, ...current].slice(0, 500);
      writeRecord(QUOTES_KEY, next);
      return next;
    });
    setReaderMessage("Quote saved.");
  }

  function toggleBookComplete() {
    if (!bookId) return;
    try {
      const read = new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
      const alreadyComplete = read.has(bookId) || (requestedId ? read.has(requestedId) : false);
      if (alreadyComplete) {
        read.delete(bookId);
        if (requestedId) read.delete(requestedId);
      } else {
        read.add(bookId);
        if (requestedId) read.add(requestedId);
      }
      localStorage.setItem(READ_KEY, JSON.stringify([...read].sort()));
      setCompletedBooks(read);
      if (!alreadyComplete) {
        const events = Array.isArray(JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]"))
          ? JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]")
          : [];
        events.push({ bookId, finishedAt: new Date().toISOString() });
        localStorage.setItem(READ_EVENTS_KEY, JSON.stringify(events.slice(-500)));
      }
      window.dispatchEvent(new Event("jju-account"));
      setReaderMessage(alreadyComplete ? "Book marked incomplete." : "Book marked complete.");
    } catch {
      setReaderMessage("Could not update completion.");
    }
  }

  function touchEnd(clientX: number) {
    if (touchStart.current === null) return;
    const delta = clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(delta) < 54) return;
    if (delta < 0) nextSection();
    else prevSection();
  }

  async function toggleFullscreen() {
    const node = shellRef.current;
    if (!node) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await node.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <main className={`page readerPage readerPageV2 ${focusMode ? "readerFocusMode" : ""}`}>
      {focusMode && (
        <button className="readerFocusExit" onClick={() => setFocusMode(false)} aria-label="Exit focus mode">
          Exit Focus
        </button>
      )}

      <section className="readerCommandBar">
        <Link className="btn secondary" href="/library">Library</Link>
        <div className="readerTitleBlock">
          <p className="kicker">{status}{creator ? ` / ${creator}` : ""}</p>
          <h1>{title}</h1>
          <span>{section ? section.title : "Choose a book to start reading."}</span>
        </div>
        <div className="readerTopActions">
          <button className="readerToolBtn" onClick={() => setChapterDrawerOpen(open => !open)} aria-label="Toggle chapter list">Chapters</button>
          <button className="readerToolBtn" onClick={() => setStudyPanelOpen(open => !open)} aria-label="Toggle study panel">Study</button>
          <button className="readerToolBtn" onClick={() => setFocusMode(open => !open)} aria-label="Toggle focus mode">Focus</button>
          <button className="readerToolBtn iconTool" onClick={toggleFullscreen} aria-label="Toggle fullscreen" title="Fullscreen">⛶</button>
          <button className="readerToolBtn primaryTool" onClick={() => setSettingsOpen(open => !open)} aria-label="Reader settings">Aa</button>
        </div>
      </section>

      {readerMessage && <div className="readerToast">{readerMessage}</div>}

      {!!visibleSections.length && (
        <section className="readerProgressPanel readerProgressPanelV2">
          <div>
            <strong>{progressPercent}%</strong>
            <span>progress</span>
          </div>
          <div className="readerProgressTrack" aria-label={`Reading progress ${progressPercent}%`}>
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <small>{secondsLabel(actualSeconds)} read</small>
          <small>~{remainingMinutes}m left</small>
        </section>
      )}

      {settingsOpen && (
        <section className="readerSettingsPanel readerSettingsPanelV2" aria-label="Reader settings">
          <div className="readerSettingsHeader">
            <strong>Reader Settings</strong>
            <button onClick={() => setSettingsOpen(false)} aria-label="Close reader settings">x</button>
          </div>
          <label>
            <span>Theme</span>
            <select className="select" value={preferences.readerTheme || "paper"} onChange={event => patchPreferences({ readerTheme: event.target.value as Preferences["readerTheme"] })}>
              <option value="paper">Paper</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="night">Night</option>
              <option value="sepia">Sepia</option>
            </select>
          </label>
          <label>
            <span>Font</span>
            <select className="select" value={preferences.readerFont || "book"} onChange={event => patchPreferences({ readerFont: event.target.value as Preferences["readerFont"] })}>
              <option value="book">Book</option>
              <option value="serif">Serif</option>
              <option value="classic">Classic</option>
              <option value="journal">Journal</option>
              <option value="dyslexic">Readable</option>
            </select>
          </label>
          <label>
            <span>Size</span>
            <select className="select" value={preferences.readerSize || "large"} onChange={event => patchPreferences({ readerSize: event.target.value as Preferences["readerSize"] })}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="xlarge">Extra Large</option>
            </select>
          </label>
          <label>
            <span>Spacing</span>
            <select className="select" value={preferences.readerSpacing || "normal"} onChange={event => patchPreferences({ readerSpacing: event.target.value as Preferences["readerSpacing"] })}>
              <option value="tight">Tight</option>
              <option value="normal">Normal</option>
              <option value="loose">Loose</option>
            </select>
          </label>
          <label>
            <span>Width</span>
            <select className="select" value={preferences.readerWidth || "full"} onChange={event => patchPreferences({ readerWidth: event.target.value as Preferences["readerWidth"] })}>
              <option value="narrow">Narrow</option>
              <option value="focused">Focused</option>
              <option value="wide">Wide</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label className="toggleLine">
            <input type="checkbox" checked={preferences.saveProgress !== false} onChange={event => patchPreferences({ saveProgress: event.target.checked })} />
            Save progress on this device
          </label>
        </section>
      )}

      <section className={`readerWorkbenchV2 ${chapterDrawerOpen ? "" : "chaptersClosed"} ${studyPanelOpen ? "" : "studyClosed"}`}>
        <aside className="readerChapterRail" aria-label="Book chapters">
          <div className="readerRailHeader">
            <p className="kicker">Chapters</p>
            <strong>{visibleSections.length}</strong>
          </div>
          <div className="readerChapterList">
            {visibleSections.map((item, index) => {
              const key = `${bookId}::${item.id}`;
              return (
                <button className={index === sectionIndex ? "active" : ""} key={item.id} onClick={() => jumpToSection(index)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{item.title}</strong>
                  <small>{sectionMinutes(item)}m{bookmarks.has(key) ? " / saved" : ""}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section
          ref={shellRef}
          className="readerStageV2"
          onTouchStart={event => { touchStart.current = event.changedTouches[0]?.clientX ?? null; }}
          onTouchEnd={event => touchEnd(event.changedTouches[0]?.clientX ?? 0)}
        >
          <div className={`readerStageTop ${["title", "dedication"].includes(displayKind) ? "quietStageTop" : ""}`}>
            {!["title", "dedication"].includes(displayKind) && (
              <div>
                <p className="kicker">{section ? headerLabel(displayKind) : "Reader"}</p>
                <strong>{section?.title || title}</strong>
              </div>
            )}
          </div>

          <div className="readerFrameWrap readerFrameWrapV2">
            <div className="readerFloatingNav" aria-label="Page navigation">
              <button className="readerNavBtn" onClick={prevSection} disabled={sectionIndex === 0} aria-label="Previous section"><span aria-hidden="true">‹</span></button>
              <button className="readerNavBtn" onClick={nextSection} disabled={!visibleSections.length || sectionIndex === visibleSections.length - 1} aria-label="Next section"><span aria-hidden="true">›</span></button>
            </div>
            <iframe ref={viewerRef} className="viewer viewerV2" srcDoc={srcDoc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title={section?.title || title} onLoad={bindViewerKeys}></iframe>

            {error && (
              <div className="card readerUnavailable">
                <h2>Book content unavailable.</h2>
                <p>{error}</p>
                <div className="buttonRow">
                  <button className="btn primary" onClick={load}>Try Again</button>
                  <Link className="btn secondary" href="/library">Back To Library</Link>
                </div>
              </div>
            )}
          </div>

          <div className="readerBottomBar">
            <button onClick={toggleBookmark}>{isBookmarked ? "★ Saved" : "☆ Bookmark"}</button>
            <button onClick={saveQuote}>“” Quote</button>
            <button onClick={toggleBookComplete}>{completedBooks.has(bookId) ? "✓ Read" : "✓ Complete"}</button>
          </div>
        </section>

        <aside className="readerStudyPanel" aria-label="Study panel">
          <section className="readerStudyCard">
            <p className="kicker">Section Note</p>
            <textarea value={currentNote} onChange={event => saveNote(event.target.value)} placeholder="Add a private note for this section..." />
          </section>

          <section className="readerStudyCard">
            <div className="readerStudyHeader">
              <p className="kicker">Saved Quotes</p>
              <span>{bookQuotes.length}</span>
            </div>
            <div className="readerQuoteList">
              {chapterQuotes.length ? chapterQuotes.map(quote => (
                <blockquote key={quote.id}>{quote.text}</blockquote>
              )) : (
                <p>Select text inside the page, then save it here.</p>
              )}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
