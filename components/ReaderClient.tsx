"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import { coverWebpSrc } from "@/lib/cover";
import { bookIdAliasFamily, canonicalBookId } from "@/lib/bookAliases";
import {
  DEFAULT_PREFERENCES_V2,
  PREFERENCES_EVENT,
  READER_FONT_OPTIONS,
  READER_SIZE_OPTIONS,
  READER_SPACING_OPTIONS,
  READER_THEME_OPTIONS,
  READER_WIDTH_OPTIONS,
  readPreferencesV2,
  writePreferencesV2,
  type PreferencesV2,
} from "@/lib/preferencesV2";
import {
  completionEntryIsNewer,
  completionSet,
  readCompletionState,
  updateCompletionState,
  writeCompletionState,
} from "@/lib/readingCompletion";
import {
  currentReaderDataOwner,
  prepareReaderDataScope,
  readerDataBelongsTo,
} from "@/lib/readerDataOwnership";

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

type BookAuditSource = {
  url: string;
  title: string;
  publisher?: string;
};

type BookAuditReceipt = {
  claimId: string;
  sectionId: string;
  sectionTitle: string;
  verdict: "supported" | "contradicted" | "outdated" | "contested";
  sources: BookAuditSource[];
};

type BookAuditSummary = {
  status: "not_started" | "in_progress" | "verified";
  verifiedClaimCount: number;
  receipts: BookAuditReceipt[];
};

type ReaderSectionEntry = {
  section: Section;
  displayKind: string;
  chapterNumber: number | null;
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

type PendingQuoteSelection = {
  bookId: string;
  sectionId: string;
  text: string;
};

type ReaderBookmarkRow = {
  key: string;
  book_id: string;
  section_id: string;
  section_title: string | null;
};

type ReaderNoteRow = {
  key: string;
  book_id: string;
  section_id: string;
  note: string;
};

type ReaderQuoteRow = {
  id: string;
  book_id: string;
  book_title: string | null;
  section_id: string;
  section_title: string | null;
  text: string;
  saved_at: string;
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

const PROGRESS_KEY = "jju.readerProgress";
const READ_EVENTS_KEY = "jju.readingEvents";
const ACTUAL_TIME_KEY = "jju.actualReadingSeconds";
const HISTORY_KEY = "jju.readingHistory";
const OPEN_HISTORY_SECONDS = 15;
const AUTO_COMPLETE_SECONDS = 60;
const ENGAGED_MINUTE_SECONDS = 60;
const QUALIFIED_READ_SECONDS = 120;
const ENGAGEMENT_IDLE_TIMEOUT_MS = 90_000;
const QUALIFIED_SCROLL_DEPTH = 0.5;
const BOOKMARKS_KEY = "jju.readerBookmarks";
const NOTES_KEY = "jju.readerNotes";
const QUOTES_KEY = "jju.readerQuotes";
const READER_THEME_LABELS: Record<PreferencesV2["readerTheme"], string> = {
  paper: "Paper",
  light: "Light",
  night: "Night",
};

type ReaderCloudProgressRow = {
  book_id: string;
  section_index: number | null;
  actual_seconds: number | null;
  last_read_at: string | null;
};
const READER_FONT_LABELS: Record<PreferencesV2["readerFont"], string> = {
  literata: "Literata",
  lexend: "Lexend",
  bitter: "Bitter",
};
const READER_SIZE_LABELS: Record<PreferencesV2["readerSize"], string> = {
  comfortable: "Comfortable",
  large: "Large",
  xlarge: "Extra large",
};
const READER_SIZE_PIXELS: Record<PreferencesV2["readerSize"], number> = {
  comfortable: 21,
  large: 24,
  xlarge: 28,
};
const READER_SPACING_LABELS: Record<PreferencesV2["readerSpacing"], string> = {
  standard: "Standard",
  relaxed: "Relaxed",
  open: "Open",
};
const READER_WIDTH_LABELS: Record<PreferencesV2["readerWidth"], string> = {
  focused: "Focused",
  standard: "Standard",
  wide: "Wide",
};

function getBookParam() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("book") || "";
}

function consumeRestartRequest() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("restart") !== "1") return false;
  url.searchParams.delete("restart");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
}

function readProgress(id: string, requestedId: string) {
  try {
    const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}") as Record<string, unknown>;
    const canonicalId = canonicalBookId(id);
    return Object.entries(progress).reduce((highest, [storedId, value]) => {
      if (storedId !== requestedId && canonicalBookId(storedId) !== canonicalId) return highest;
      return Math.max(highest, Number(value) || 0);
    }, 0);
  } catch {
    return 0;
  }
}

function readActualSeconds(id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTUAL_TIME_KEY) || "{}") as Record<string, number>;
    const canonicalId = canonicalBookId(id);
    return Object.entries(all).reduce((highest, [storedId, value]) => (
      canonicalBookId(storedId) === canonicalId ? Math.max(highest, Number(value) || 0) : highest
    ), 0);
  } catch {
    return 0;
  }
}

function saveActualSeconds(id: string, seconds: number) {
  try {
    const all = JSON.parse(localStorage.getItem(ACTUAL_TIME_KEY) || "{}") as Record<string, number>;
    const canonicalId = canonicalBookId(id);
    for (const storedId of Object.keys(all)) {
      if (storedId !== canonicalId && canonicalBookId(storedId) === canonicalId) delete all[storedId];
    }
    all[canonicalId] = seconds;
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

function parseSectionKey(key: string) {
  const divider = key.indexOf("::");
  if (divider <= 0) return null;
  const bookId = key.slice(0, divider);
  const sectionId = key.slice(divider + 2);
  if (!bookId || !sectionId) return null;
  return { bookId, sectionId };
}

function normalizeQuoteList(items: SavedQuote[]) {
  return items
    .filter(item => item.id && item.bookId && item.sectionId && item.text)
    .sort((a, b) => Date.parse(b.savedAt || "") - Date.parse(a.savedAt || ""))
    .slice(0, 500);
}

function sectionTitleForKey(key: string, currentBookId: string, sections: Section[]) {
  const parsed = parseSectionKey(key);
  if (!parsed || parsed.bookId !== currentBookId) return "";
  return sections.find(item => item.id === parsed.sectionId)?.title || "";
}

function readerBookmarkRow(userId: string, key: string, currentBookId: string, sections: Section[]) {
  const parsed = parseSectionKey(key);
  if (!parsed) return null;
  return {
    user_id: userId,
    key,
    book_id: parsed.bookId,
    section_id: parsed.sectionId,
    section_title: sectionTitleForKey(key, currentBookId, sections),
    updated_at: new Date().toISOString(),
  };
}

function readerNoteRow(userId: string, key: string, value: string) {
  const parsed = parseSectionKey(key);
  if (!parsed) return null;
  return {
    user_id: userId,
    key,
    book_id: parsed.bookId,
    section_id: parsed.sectionId,
    note: value,
    updated_at: new Date().toISOString(),
  };
}

function readerQuoteRow(userId: string, quote: SavedQuote) {
  return {
    user_id: userId,
    id: quote.id,
    book_id: quote.bookId,
    book_title: quote.bookTitle,
    section_id: quote.sectionId,
    section_title: quote.sectionTitle,
    text: quote.text,
    saved_at: quote.savedAt,
  };
}

function saveReadingHistory(item: ReadingHistoryItem) {
  try {
    const all = readRecord<ReadingHistoryItem[]>(HISTORY_KEY, []);
    const canonicalId = canonicalBookId(item.bookId);
    const next = [
      { ...item, bookId: canonicalId },
      ...all.filter(entry => canonicalBookId(entry.bookId) !== canonicalId && entry.requestedId !== item.requestedId),
    ].slice(0, 24);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("jju-reading-history"));
  } catch {
    return;
  }
}

function readCompletedSet() {
  return completionSet();
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

function isTableOfContentsSection(section: Section) {
  const rawKind = safeKind(section.kind);
  const title = section.title.trim().toLowerCase();
  if (/^chapter\b/i.test(section.title)) return false;
  if (title === "contents" || title === "table of contents") return true;
  if (/<nav\b[^>]*(?:epub:type=["']toc["']|id=["']toc["'])/i.test(section.html)) return true;
  return rawKind === "toc";
}

function inferSectionKind(section: Section, visibleIndex: number, bookTitle: string) {
  const rawKind = safeKind(section.kind);
  const title = section.title.trim().toLowerCase();
  const text = plainText(section.html).toLowerCase();
  const normalizedBookTitle = bookTitle.trim().toLowerCase();

  if (isTableOfContentsSection(section)) return "toc";
  // The imported EPUB kind is occasionally wrong. Numbered chapter titles are
  // the one convention that is consistent across the current book corpus.
  if (/^chapter\b/i.test(section.title)) return "chapter";
  if (/^dedication$/.test(title)) return "dedication";
  if (/^prologue$/.test(title)) return "prologue";
  if (/^preface$/.test(title)) return "preface";
  if (/^foreword$/.test(title)) return "foreword";
  if (/^introduction$/.test(title)) return "introduction";
  if (/^epilogue$/.test(title)) return "epilogue";
  if (/^afterword$/.test(title)) return "afterword";
  if (/acknowledg(e)?ments?/.test(title)) return "acknowledgments";
  if (/about( the)? author/.test(title)) return "about";
  if (/copyright/.test(title)) return "copyright";
  if (["title", "dedication", "prologue", "preface", "foreword", "introduction", "epilogue", "afterword", "acknowledgments", "about", "copyright", "backmatter"].includes(rawKind)) return rawKind;

  const looksLikeTitlePage = (!!normalizedBookTitle && title === normalizedBookTitle)
    || (!!normalizedBookTitle && text.startsWith(normalizedBookTitle) && text.includes("james johnson"));

  if (looksLikeTitlePage) return "title";
  if (visibleIndex === 0 && text.split(/\s+/).length < 80 && /\bby\s+(?:james johnson|jj)\b/.test(text)) return "title";
  return "section";
}

function cleanSectionHtml(html: string) {
  return html
    .replace(/<h[1-6]\b[^>]*class=["'][^"']*(?:chapter-title-page-padding|titled-section-page-padding)[^"']*["'][^>]*>\s*(?:<br\s*\/?\s*>)?\s*<\/h[1-6]>/gi, "")
    .replace(/<p\b[^>]*class=["'][^"']*(?:separator|br)[^"']*["'][^>]*>\s*(?:<br\s*\/?\s*>)?\s*<\/p>/gi, "")
    .replace(/<p\b[^>]*>\s*(?:<br\s*\/?\s*>)?\s*<\/p>/gi, "");
}

function sanitizeReaderHtml(html: string) {
  if (typeof DOMParser === "undefined") return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, iframe, object, embed, form, input, button, textarea, select, link, meta, base").forEach(node => node.remove());
  document.querySelectorAll("*").forEach(node => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  document.querySelectorAll("a[href]").forEach(link => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
  return document.body.innerHTML;
}

function htmlHasOwnHeading(html: string, displayKind: string) {
  if (displayKind === "title") return true;
  return /<(h1|h2|h3)\b/i.test(html) || /class=["'][^"']*(bordered-title|chapter-title|titled-section|page-title)[^"']*["']/i.test(html);
}

function headerLabel(displayKind: string) {
  if (displayKind === "title") return "Title page";
  if (displayKind === "dedication") return "Dedication";
  if (displayKind === "prologue") return "Prologue";
  if (displayKind === "preface") return "Preface";
  if (displayKind === "foreword") return "Foreword";
  if (displayKind === "introduction") return "Introduction";
  if (displayKind === "epilogue") return "Epilogue";
  if (displayKind === "afterword") return "Afterword";
  if (displayKind === "frontmatter") return "Front matter";
  if (displayKind === "acknowledgments") return "Acknowledgments";
  if (displayKind === "backmatter") return "Back matter";
  if (displayKind === "about") return "About the author";
  if (displayKind === "copyright") return "Copyright";
  if (displayKind === "chapter") return "Chapter";
  return "Section";
}

function contentsMarker(entry: ReaderSectionEntry) {
  if (entry.chapterNumber) return String(entry.chapterNumber).padStart(2, "0");

  const title = entry.section.title.toLowerCase();
  if (entry.displayKind === "title") return "Title";
  if (entry.displayKind === "dedication") return "Ded";
  if (entry.displayKind === "prologue") return "Pro";
  if (entry.displayKind === "preface") return "Pref";
  if (entry.displayKind === "foreword") return "Fore";
  if (entry.displayKind === "introduction") return "Intro";
  if (entry.displayKind === "epilogue") return "Epi";
  if (entry.displayKind === "afterword") return "After";
  if (entry.displayKind === "acknowledgments") return "Acks";
  if (entry.displayKind === "about") return "About";
  if (entry.displayKind === "copyright") return "Copy";
  if (title.includes("appendix")) return "App";
  if (title.includes("glossary")) return "Gloss";
  if (title.includes("bibliograph") || title.includes("sources")) return "Sources";
  if (title.includes("notes")) return "Notes";
  if (title.includes("index")) return "Index";
  if (entry.displayKind === "frontmatter") return "Front";
  if (entry.displayKind === "backmatter") return "Back";
  return "Sec";
}

function titleCoverHtml(bookTitle: string, subtitle: string, coverSrc: string) {
  const titleClass = bookTitle.trim().length <= 18 ? " shortTitle" : "";
  return `
    <div class="titleCoverPage${titleClass}">
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

function readerStyle(preferences: PreferencesV2) {
  const theme = preferences.readerTheme;
  const size = preferences.readerSize;
  const width = preferences.readerWidth;
  const font = preferences.readerFont;
  const spacing = preferences.readerSpacing;
  const colors = {
    night: { bg: "#080b10", page: "#0d1118", text: "#dbe7f6", muted: "#9fb1c7", heading: "#fff", link: "#87bfff", rule: "rgba(135,191,255,.32)" },
    paper: { bg: "#efe4cf", page: "#f7eddc", text: "#251d14", muted: "#715f4b", heading: "#140f09", link: "#8a5d13", rule: "rgba(138,93,19,.25)" },
    light: { bg: "#f4f2ed", page: "#fbfaf6", text: "#1d1d1d", muted: "#606060", heading: "#050505", link: "#7b540f", rule: "rgba(123,84,15,.24)" },
  }[theme];
  const fontSize = { comfortable: 21, large: 24, xlarge: 28 }[size];
  const lineHeight = { standard: 1.6, relaxed: 1.72, open: 1.9 }[spacing];
  const fontFamily = {
    literata: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    lexend: "'Trebuchet MS', Arial, sans-serif",
    bitter: "Rockwell, 'Courier New', Georgia, serif",
  }[font];
  const maxWidth = { focused: "58ch", standard: "66ch", wide: "76ch" }[width];

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
    .kind-chapter .sectionHeader, .kind-prologue .sectionHeader, .kind-preface .sectionHeader, .kind-foreword .sectionHeader, .kind-introduction .sectionHeader, .kind-epilogue .sectionHeader, .kind-afterword .sectionHeader, .kind-frontmatter .sectionHeader, .kind-section .sectionHeader, .kind-acknowledgments .sectionHeader, .kind-copyright .sectionHeader, .kind-about .sectionHeader, .kind-backmatter .sectionHeader { text-align: center; }
    .kind-chapter .readerContent > h1:first-child, .kind-chapter .readerContent > h2:first-child, .kind-chapter .readerContent > h3:first-child,
    .kind-prologue .readerContent > h1:first-child, .kind-prologue .readerContent > h2:first-child, .kind-prologue .readerContent > h3:first-child,
    .kind-preface .readerContent > h1:first-child, .kind-preface .readerContent > h2:first-child, .kind-preface .readerContent > h3:first-child,
    .kind-foreword .readerContent > h1:first-child, .kind-foreword .readerContent > h2:first-child, .kind-foreword .readerContent > h3:first-child,
    .kind-introduction .readerContent > h1:first-child, .kind-introduction .readerContent > h2:first-child, .kind-introduction .readerContent > h3:first-child,
    .kind-epilogue .readerContent > h1:first-child, .kind-epilogue .readerContent > h2:first-child, .kind-epilogue .readerContent > h3:first-child,
    .kind-afterword .readerContent > h1:first-child, .kind-afterword .readerContent > h2:first-child, .kind-afterword .readerContent > h3:first-child,
    .kind-frontmatter .readerContent > h1:first-child, .kind-frontmatter .readerContent > h2:first-child, .kind-frontmatter .readerContent > h3:first-child,
    .kind-section .readerContent > h1:first-child, .kind-section .readerContent > h2:first-child, .kind-section .readerContent > h3:first-child,
    .kind-acknowledgments .readerContent > h1:first-child, .kind-acknowledgments .readerContent > h2:first-child, .kind-acknowledgments .readerContent > h3:first-child,
    .kind-copyright .readerContent > h1:first-child, .kind-copyright .readerContent > h2:first-child, .kind-copyright .readerContent > h3:first-child,
    .kind-about .readerContent > h1:first-child, .kind-about .readerContent > h2:first-child, .kind-about .readerContent > h3:first-child,
    .kind-backmatter .readerContent > h1:first-child, .kind-backmatter .readerContent > h2:first-child, .kind-backmatter .readerContent > h3:first-child { text-align: center; }
    .kind-prologue, .kind-preface, .kind-foreword, .kind-introduction, .kind-epilogue, .kind-afterword, .kind-frontmatter, .kind-section, .kind-acknowledgments, .kind-copyright, .kind-about, .kind-backmatter { text-align: left; }
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
    .kind-chapter, .kind-prologue, .kind-preface, .kind-foreword, .kind-introduction, .kind-epilogue, .kind-afterword, .kind-frontmatter, .kind-section { padding-top: clamp(24px, 4vw, 52px); }
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
    @media (max-width: 1080px) {
      html, body { min-height: 0; }
      .readerDoc, .kind-title, .kind-dedication, .titleCoverPage { min-height: 0; }
      .titleCoverImage { max-height: none; }
    }
    @media (max-width: 720px) {
      .titleCoverPage { grid-template-columns: 1fr; text-align: center; justify-items: center; }
      .titleCoverImage { max-width: 260px; }
    }
  `;
}

export default function ReaderClient({
  bookQuery,
  libraryHref = "/library",
  libraryLabel = "Library",
  autoOpenDesktopPanels = true,
  contentSource = "live",
  embedded = false,
  variant = "default",
}: {
  bookQuery?: string;
  libraryHref?: string;
  libraryLabel?: string;
  autoOpenDesktopPanels?: boolean;
  contentSource?: "live" | "file";
  embedded?: boolean;
  variant?: "default" | "site-v2";
} = {}) {
  const PageRoot = embedded ? "div" : "main";
  const viewerRef = useRef<HTMLIFrameElement | null>(null);
  const inlineDocumentRef = useRef<HTMLElement | null>(null);
  const fullscreenRootRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const toolsPanelRef = useRef<HTMLElement | null>(null);
  const sizeMenuRef = useRef<HTMLDetailsElement | null>(null);
  const pendingQuoteSelectionRef = useRef<PendingQuoteSelection | null>(null);
  const pageScrollIntentRef = useRef<"none" | "top" | "smart">("none");
  const restartRequestedRef = useRef(false);
  const cloudHydrationRetryRef = useRef(0);
  const pendingCompletionCloudSyncRef = useRef(false);
  const completionMarkedAtSecondRef = useRef<number | null>(null);
  const activeReaderAccountRef = useRef("");
  const lastReaderInteractionAtRef = useRef(0);
  const engagedSessionSecondsRef = useRef(0);
  const engagedMinutesQueuedRef = useRef(0);
  const qualifiedReadQueuedRef = useRef(false);
  const visitedSectionIndexesRef = useRef<Set<number>>(new Set());
  const maxReaderScrollDepthRef = useRef(0);
  const readingSessionStartedAtRef = useRef(0);
  const readingAnalyticsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const touchStart = useRef<number | null>(null);
  const viewerResizeObserverRef = useRef<ResizeObserver | null>(null);
  const chapterPanelId = useId();
  const studyPanelId = useId();
  const settingsPanelId = useId();
  const [requestedId, setRequestedId] = useState("");
  const [bookId, setBookId] = useState("");
  const [bookCoverSrc, setBookCoverSrc] = useState("");
  const [title, setTitle] = useState("Loading book...");
  const [subtitle, setSubtitle] = useState("");
  const [creator, setCreator] = useState("");
  const [status, setStatus] = useState("Loading book content...");
  const [error, setError] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [audit, setAudit] = useState<BookAuditSummary | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [preferences, setPreferences] = useState<PreferencesV2>({ ...DEFAULT_PREFERENCES_V2 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const [cloudProgressHydrated, setCloudProgressHydrated] = useState(false);
  const [cloudSyncAttempt, setCloudSyncAttempt] = useState(0);
  const [actualSeconds, setActualSeconds] = useState(0);
  const [chapterDrawerOpen, setChapterDrawerOpen] = useState(false);
  const [studyPanelOpen, setStudyPanelOpen] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [fullscreenFallbackActive, setFullscreenFallbackActive] = useState(false);
  const noteSaveTimer = useRef<number | null>(null);
  const pendingNoteKeyRef = useRef("");
  const readerMemoryRevisionRef = useRef(0);
  const readerMemoryCloudQueueRef = useRef<Promise<void>>(Promise.resolve());
  const readerMemoryRetryScheduledRef = useRef(false);
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
  const [pendingQuoteText, setPendingQuoteText] = useState("");
  const [readerMessage, setReaderMessage] = useState("");
  const [completedBooks, setCompletedBooks] = useState<Set<string>>(() => readCompletedSet());
  const compactReader = variant === "site-v2";

  const queueReaderMemoryCloudTask = useCallback((task: () => Promise<void>) => {
    const queued = readerMemoryCloudQueueRef.current.then(task, task);
    readerMemoryCloudQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const markReaderMemoryMutation = useCallback(() => {
    const revision = readerMemoryRevisionRef.current + 1;
    readerMemoryRevisionRef.current = revision;
    return revision;
  }, []);

  const queueReaderMemoryMutation = useCallback((revision: number, task: () => Promise<boolean>) => {
    void queueReaderMemoryCloudTask(async () => {
      const synced = await task();
      if (!synced || readerMemoryRevisionRef.current !== revision || !readerDataBelongsTo(userId)) return;
      if (noteSaveTimer.current !== null) return;
      if (readerMemoryRetryScheduledRef.current) return;
      readerMemoryRetryScheduledRef.current = true;
      setCloudSyncAttempt(attempt => attempt + 1);
    }).catch(() => undefined);
  }, [queueReaderMemoryCloudTask, userId]);

  const sectionEntries = useMemo<ReaderSectionEntry[]>(() => {
    const readableSections = sections.filter(section => !isTableOfContentsSection(section));
    const source = readableSections.length ? readableSections : sections;
    const rawKinds = source.map((item, index) => inferSectionKind(item, index, title));
    const firstChapterIndex = rawKinds.indexOf("chapter");
    const lastChapterIndex = rawKinds.lastIndexOf("chapter");

    return source.map((item, index) => {
      let displayKind = rawKinds[index];
      if (displayKind === "section" && firstChapterIndex >= 0) {
        if (index < firstChapterIndex) displayKind = "frontmatter";
        if (index > lastChapterIndex) displayKind = "backmatter";
      }
      const chapterNumber = displayKind === "chapter"
        ? rawKinds.slice(0, index + 1).filter(kind => kind === "chapter").length
        : null;
      return {
        section: item,
        displayKind,
        chapterNumber,
      };
    });
  }, [sections, title]);

  const visibleSections = useMemo(() => sectionEntries.map(item => item.section), [sectionEntries]);
  const chapterCount = useMemo(() => sectionEntries.filter(item => item.displayKind === "chapter").length, [sectionEntries]);
  const sectionEntry = sectionEntries[sectionIndex];
  const section = visibleSections[sectionIndex];
  const displayKind = sectionEntry?.displayKind || "section";
  const completedChapterCount = chapterCount
    ? sectionEntries.slice(0, sectionIndex + 1).filter(item => item.displayKind === "chapter").length
    : 0;
  const progressPercent = chapterCount
    ? Math.round((completedChapterCount / chapterCount) * 100)
    : visibleSections.length > 1
      ? Math.round((sectionIndex / (visibleSections.length - 1)) * 100)
      : 0;
  const pageProgressPercent = visibleSections.length > 1
    ? Math.round((sectionIndex / (visibleSections.length - 1)) * 100)
    : 0;
  const estimatedMinutes = visibleSections.length ? estimateMinutes(visibleSections) : 0;
  const remainingSections = chapterCount
    ? sectionEntries.slice(sectionIndex + 1).filter(item => item.displayKind === "chapter").map(item => item.section)
    : visibleSections.slice(sectionIndex + 1);
  const remainingMinutes = remainingSections.reduce((sum, item) => sum + sectionMinutes(item), 0);
  const lastReadingSectionIndex = chapterCount
    ? sectionEntries.map(item => item.displayKind).lastIndexOf("chapter")
    : Math.max(0, visibleSections.length - 1);
  const hasReachedReadingEnd = visibleSections.length > 0 && sectionIndex >= lastReadingSectionIndex;
  const currentSectionKey = bookId && section ? `${bookId}::${section.id}` : "";
  const currentNote = currentSectionKey ? notes[currentSectionKey] || "" : "";
  const isBookmarked = currentSectionKey ? bookmarks.has(currentSectionKey) : false;
  const isCurrentBookComplete = completedBooks.has(canonicalBookId(bookId));
  const canonicalCurrentBookId = canonicalBookId(bookId);
  const chapterQuotes = section ? quotes.filter(item => canonicalBookId(item.bookId) === canonicalCurrentBookId && item.sectionId === section.id) : [];
  const bookQuotes = quotes.filter(item => canonicalBookId(item.bookId) === canonicalCurrentBookId);
  const savedBookSections = useMemo(() => {
    const bookmarkKeys = [...bookmarks];
    const noteKeys = Object.keys(notes);

    return sectionEntries.flatMap((entry, index) => {
      const sectionId = entry.section.id;
      const bookmarkKey = bookmarkKeys.find(key => {
        const parsed = parseSectionKey(key);
        return parsed?.sectionId === sectionId && canonicalBookId(parsed.bookId) === canonicalCurrentBookId;
      });
      const noteKey = noteKeys.find(key => {
        const parsed = parseSectionKey(key);
        return parsed?.sectionId === sectionId && canonicalBookId(parsed.bookId) === canonicalCurrentBookId;
      });
      const sectionQuotes = quotes.filter(item => canonicalBookId(item.bookId) === canonicalCurrentBookId && item.sectionId === sectionId);
      if (!bookmarkKey && !noteKey && !sectionQuotes.length) return [];

      return [{
        entry,
        index,
        bookmarkKey: bookmarkKey || "",
        noteKey: noteKey || "",
        note: noteKey ? notes[noteKey] || "" : "",
        quotes: sectionQuotes,
      }];
    });
  }, [bookmarks, canonicalCurrentBookId, notes, quotes, sectionEntries]);
  const savedBookBookmarkCount = savedBookSections.filter(item => item.bookmarkKey).length;
  const savedBookNoteCount = savedBookSections.filter(item => item.noteKey).length;
  const savedBookQuoteCount = savedBookSections.reduce((sum, item) => sum + item.quotes.length, 0);

  const markReaderEngagement = useCallback(() => {
    lastReaderInteractionAtRef.current = performance.now();

    let depth = 0;
    if (compactReader) {
      const documentNode = inlineDocumentRef.current;
      if (documentNode) {
        const rect = documentNode.getBoundingClientRect();
        const scrollRange = rect.height - window.innerHeight;
        depth = scrollRange <= 0 ? 1 : Math.max(0, Math.min(1, -rect.top / scrollRange));
      }
    } else {
      const frameWindow = viewerRef.current?.contentWindow;
      const frameDocument = frameWindow?.document;
      if (frameWindow && frameDocument) {
        const documentHeight = Math.max(
          frameDocument.documentElement?.scrollHeight || 0,
          frameDocument.body?.scrollHeight || 0,
        );
        const scrollRange = documentHeight - frameWindow.innerHeight;
        depth = scrollRange <= 0 ? 1 : Math.max(0, Math.min(1, frameWindow.scrollY / scrollRange));
      }
    }

    maxReaderScrollDepthRef.current = Math.max(maxReaderScrollDepthRef.current, depth);
  }, [compactReader]);

  const readerSurfaceIsVisible = useCallback(() => {
    const surface = compactReader ? inlineDocumentRef.current : viewerRef.current;
    if (!surface) return false;
    const rect = surface.getBoundingClientRect();
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const referenceHeight = Math.max(1, Math.min(rect.height, window.innerHeight));
    return visibleHeight / referenceHeight >= 0.5;
  }, [compactReader]);

  const queueReadingAnalyticsRow = useCallback((
    seconds: number,
    source: "reader_engaged_minute" | "qualified_read",
    startedAtMs: number,
    endedAtMs: number,
  ) => {
    if (!userId || !cloudSyncReady || !bookId || !hasSupabaseConfig() || !readerDataBelongsTo(userId)) return false;

    const analyticsUserId = userId;
    const analyticsBookId = canonicalBookId(bookId);
    const queued = readingAnalyticsQueueRef.current.then(async () => {
      if (!readerDataBelongsTo(analyticsUserId)) return;
      const supabase = createSupabaseBrowserClient();
      const result = await supabase.from("reading_sessions").insert({
        user_id: analyticsUserId,
        book_id: analyticsBookId,
        seconds,
        started_at: new Date(startedAtMs).toISOString(),
        ended_at: new Date(endedAtMs).toISOString(),
        source,
      });
      if (result.error) {
        console.warn(JSON.stringify({
          level: "warn",
          message: "Reading analytics sync failed",
          code: result.error.code,
        }));
      }
    });
    readingAnalyticsQueueRef.current = queued.catch(() => undefined);
    return true;
  }, [bookId, cloudSyncReady, userId]);

  const captureQuoteSelection = useCallback(() => {
    if (!compactReader || !bookId || !section || typeof window === "undefined") return null;
    const readerDocument = inlineDocumentRef.current;
    const selection = window.getSelection();
    if (!readerDocument || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    if (!selection.anchorNode || !selection.focusNode) return null;
    if (!readerDocument.contains(selection.anchorNode) || !readerDocument.contains(selection.focusNode)) return null;

    const text = selection.toString().trim().slice(0, 900);
    if (!text) return null;
    const pending = { bookId, sectionId: section.id, text } satisfies PendingQuoteSelection;
    pendingQuoteSelectionRef.current = pending;
    setPendingQuoteText(text);
    return pending;
  }, [bookId, compactReader, section]);

  const jumpToSection = useCallback((index: number, scrollIntent: "none" | "top" | "smart" = "top") => {
    const lastIndex = visibleSections.length - 1;
    if (lastIndex < 0) return;
    const nextIndex = Math.max(0, Math.min(lastIndex, index));
    markReaderEngagement();
    visitedSectionIndexesRef.current.add(nextIndex);
    pendingQuoteSelectionRef.current = null;
    setPendingQuoteText("");
    pageScrollIntentRef.current = scrollIntent;
    setSectionIndex(nextIndex);
    if (bookId && preferences.saveProgress !== false) {
      saveReadingHistory({
        bookId,
        requestedId,
        title,
        sectionIndex: nextIndex,
        sectionTitle: visibleSections[nextIndex]?.title,
        actualSeconds,
        updatedAt: new Date().toISOString(),
      });
    }
  }, [actualSeconds, bookId, markReaderEngagement, preferences.saveProgress, requestedId, title, visibleSections]);

  const prevSection = useCallback((scrollIntent: "none" | "top" | "smart" = "top") => {
    jumpToSection(sectionIndex - 1, scrollIntent);
  }, [jumpToSection, sectionIndex]);

  const nextSection = useCallback((scrollIntent: "none" | "top" | "smart" = "top") => {
    jumpToSection(sectionIndex + 1, scrollIntent);
  }, [jumpToSection, sectionIndex]);

  async function syncBookmarkToCloud(key: string, saved: boolean) {
    if (!userId || !cloudSyncReady || !hasSupabaseConfig() || !readerDataBelongsTo(userId)) return false;
    const supabase = createSupabaseBrowserClient();
    try {
      if (!saved) {
        const result = await supabase.from("reader_bookmarks").delete().eq("user_id", userId).eq("key", key);
        if (result.error) throw result.error;
        return true;
      }
      const row = readerBookmarkRow(userId, key, bookId, visibleSections);
      if (!row) return false;
      const result = await supabase.from("reader_bookmarks").upsert(row, { onConflict: "user_id,key" });
      if (result.error) throw result.error;
      return true;
    } catch {
      setReaderMessage("Bookmark saved here, but account sync needs another try.");
      return false;
    }
  }

  async function syncNoteToCloud(key: string, value: string) {
    if (!userId || !cloudSyncReady || !hasSupabaseConfig() || !readerDataBelongsTo(userId)) return false;
    const supabase = createSupabaseBrowserClient();
    try {
      if (!value.trim()) {
        const result = await supabase.from("reader_notes").delete().eq("user_id", userId).eq("key", key);
        if (result.error) throw result.error;
        return true;
      }
      const row = readerNoteRow(userId, key, value);
      if (!row) return false;
      const result = await supabase.from("reader_notes").upsert(row, { onConflict: "user_id,key" });
      if (result.error) throw result.error;
      return true;
    } catch {
      setReaderMessage("Note saved here, but account sync needs another try.");
      return false;
    }
  }

  async function syncQuoteToCloud(quote: SavedQuote) {
    if (!userId || !cloudSyncReady || !hasSupabaseConfig() || !readerDataBelongsTo(userId)) return false;
    const supabase = createSupabaseBrowserClient();
    try {
      const result = await supabase.from("reader_quotes").upsert(readerQuoteRow(userId, quote), { onConflict: "user_id,id" });
      if (result.error) throw result.error;
      return true;
    } catch {
      setReaderMessage("Quote saved here, but account sync needs another try.");
      return false;
    }
  }

  async function deleteQuoteFromCloud(quoteId: string) {
    if (!userId || !cloudSyncReady || !hasSupabaseConfig() || !readerDataBelongsTo(userId)) return false;
    const supabase = createSupabaseBrowserClient();
    try {
      const result = await supabase.from("reader_quotes").delete().eq("user_id", userId).eq("id", quoteId);
      if (result.error) throw result.error;
      return true;
    } catch {
      setReaderMessage("Quote removed here, but account sync needs another try.");
      return false;
    }
  }

  const handleReaderKey = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    markReaderEngagement();
    if (event.key === "Escape") {
      if (chapterDrawerOpen || settingsOpen || studyPanelOpen || fullscreenFallbackActive) event.preventDefault();
      setChapterDrawerOpen(false);
      setSettingsOpen(false);
      setStudyPanelOpen(false);
      setFullscreenFallbackActive(false);
      sizeMenuRef.current?.removeAttribute("open");
      return;
    }
    if (chapterDrawerOpen || settingsOpen || studyPanelOpen) return;
    if (sizeMenuRef.current?.open) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (event.key === "ArrowRight" && sectionIndex < visibleSections.length - 1) {
      event.preventDefault();
      nextSection("smart");
    }
    if (event.key === "ArrowLeft" && sectionIndex > 0) {
      event.preventDefault();
      prevSection("smart");
    }
  }, [chapterDrawerOpen, fullscreenFallbackActive, markReaderEngagement, nextSection, prevSection, sectionIndex, settingsOpen, studyPanelOpen, visibleSections.length]);

  const syncViewerHeight = useCallback(() => {
    const frame = viewerRef.current;
    if (!frame || typeof window === "undefined") return;
    const useNaturalPageScroll = compactReader && window.matchMedia("(max-width: 1080px)").matches;
    if (!useNaturalPageScroll) {
      frame.style.removeProperty("height");
      return;
    }

    const frameDocument = frame.contentDocument;
    if (!frameDocument) return;
    window.requestAnimationFrame(() => {
      const height = Math.max(
        frameDocument.documentElement?.scrollHeight || 0,
        frameDocument.body?.scrollHeight || 0,
      );
      if (height > 0) frame.style.height = `${Math.ceil(height)}px`;
    });
  }, [compactReader]);

  function bindViewerKeys() {
    viewerResizeObserverRef.current?.disconnect();
    const frameWindow = viewerRef.current?.contentWindow;
    frameWindow?.removeEventListener("keydown", handleReaderKey);
    frameWindow?.removeEventListener("pointerdown", markReaderEngagement);
    frameWindow?.removeEventListener("wheel", markReaderEngagement);
    frameWindow?.removeEventListener("touchmove", markReaderEngagement);
    frameWindow?.removeEventListener("scroll", markReaderEngagement);
    frameWindow?.addEventListener("keydown", handleReaderKey);
    frameWindow?.addEventListener("pointerdown", markReaderEngagement, { passive: true });
    frameWindow?.addEventListener("wheel", markReaderEngagement, { passive: true });
    frameWindow?.addEventListener("touchmove", markReaderEngagement, { passive: true });
    frameWindow?.addEventListener("scroll", markReaderEngagement, { passive: true });
    syncViewerHeight();

    const frameDocument = frameWindow?.document;
    if (frameDocument && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(syncViewerHeight);
      observer.observe(frameDocument.documentElement);
      if (frameDocument.body) observer.observe(frameDocument.body);
      viewerResizeObserverRef.current = observer;
    }
    void frameDocument?.fonts?.ready.then(syncViewerHeight);
    frameDocument?.querySelectorAll("img").forEach(image => image.addEventListener("load", syncViewerHeight, { once: true }));
  }

  function patchPreferences(patch: Partial<PreferencesV2>) {
    const next = writePreferencesV2({ ...readPreferencesV2(), ...preferences, ...patch });
    setPreferences(next);
  }

  function toggleChapterDrawer() {
    setSettingsOpen(false);
    sizeMenuRef.current?.removeAttribute("open");
    setChapterDrawerOpen(open => !open);
  }

  function toggleTools() {
    if (!settingsOpen) captureQuoteSelection();
    setChapterDrawerOpen(false);
    sizeMenuRef.current?.removeAttribute("open");
    setSettingsOpen(open => !open);
  }

  const load = useCallback(async () => {
    try {
      setError("");
      setStatus("Loading book content...");
      const id = String(bookQuery || getBookParam()).trim();
      const restartRequested = consumeRestartRequest();
      restartRequestedRef.current = restartRequested;
      cloudHydrationRetryRef.current = 0;
      pendingCompletionCloudSyncRef.current = false;
      completionMarkedAtSecondRef.current = null;
      setCloudProgressHydrated(false);
      setRequestedId(id);
      if (!id) {
        setTitle("No book selected");
        setStatus("Open a book from the library.");
        setSections([]);
        return;
      }

      const bookListPromise = contentSource === "live"
        ? fetch("/api/books", { cache: "no-store" })
          .then(response => response.json())
          .catch(() => [])
        : null;
      const sourceQuery = contentSource === "file" ? "?source=file" : "";
      const item = await fetch(`/api/book/${encodeURIComponent(id)}${sourceQuery}`, { cache: "no-store" }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Book content unavailable.");
        return data as BookContent;
      });

      const nextSections = [...(item.sections || [])].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
      const bodySections = nextSections.filter(nextSection => !isTableOfContentsSection(nextSection));
      const readableCount = bodySections.length || nextSections.length;
      if (!readableCount) throw new Error(`No readable sections found for "${id}".`);

      const canonicalId = item.id || id;
      setAudit(null);
      const rememberPlace = readPreferencesV2().saveProgress;
      setBookId(canonicalId);
      setBookCoverSrc(coverWebpSrc({ id: canonicalId }, canonicalId));
      setSubtitle(titleSubtitle(bodySections[0] || nextSections[0], item.title || canonicalId));
      setActualSeconds(rememberPlace ? readActualSeconds(canonicalId) : 0);
      setTitle(item.title || canonicalId);
      setCreator(item.creator || "");
      setSections(nextSections);
      pendingQuoteSelectionRef.current = null;
      setPendingQuoteText("");
      setSectionIndex(restartRequested || !rememberPlace ? 0 : Math.min(Math.max(0, readProgress(canonicalId, id)), readableCount - 1));
      setStatus("Reading");

      void fetch(`/api/book/${encodeURIComponent(canonicalId)}/audit`, { cache: "no-store" })
        .then(response => response.ok ? response.json() : null)
        .then(data => setAudit(data as BookAuditSummary | null))
        .catch(() => setAudit(null));

      void bookListPromise?.then(bookList => {
        const books = Array.isArray(bookList) ? bookList : bookList?.books || [];
        const meta = books.find((book: BookMeta) => String(book.id || "").toLowerCase() === canonicalId.toLowerCase())
          || books.find((book: BookMeta) => String(book.id || "").toLowerCase() === id.toLowerCase())
          || { id: canonicalId };
        setBookCoverSrc(coverWebpSrc(meta, canonicalId));
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Book content unavailable.");
      setStatus("Unavailable");
      setSections([]);
    }
  }, [bookQuery, contentSource]);

  useEffect(() => {
    if (!autoOpenDesktopPanels) return;
    const frame = window.requestAnimationFrame(() => {
      const panelsOpen = !window.matchMedia("(max-width: 1180px)").matches;
      setChapterDrawerOpen(panelsOpen);
      setStudyPanelOpen(panelsOpen);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoOpenDesktopPanels]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreenActive(document.fullscreenElement === fullscreenRootRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const retry = () => {
      cloudHydrationRetryRef.current = 0;
      setCloudSyncAttempt(attempt => attempt + 1);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  useEffect(() => {
    if (!userId || !cloudSyncReady || !bookId || !visibleSections.length || !hasSupabaseConfig()) return;
    prepareReaderDataScope(userId);
    let cancelled = false;
    let retryTimeout: number | null = null;

    async function hydrateCloudProgress() {
      const supabase = createSupabaseBrowserClient();
      const canonicalId = canonicalBookId(bookId);
      const cloudBookIds = [...new Set([...bookIdAliasFamily(canonicalId), requestedId].filter(Boolean))];
      const [progressResult, completionResult] = await Promise.all([
        supabase.from("reading_progress")
          .select("book_id,section_index,actual_seconds,last_read_at")
          .eq("user_id", userId)
          .in("book_id", cloudBookIds),
        supabase.from("completed_books")
          .select("book_id,is_completed,completed_at,state_changed_at,updated_at")
          .eq("user_id", userId)
          .in("book_id", cloudBookIds),
      ]);
      if (progressResult.error) throw progressResult.error;
      if (completionResult.error) throw completionResult.error;
      if (cancelled || !readerDataBelongsTo(userId)) return;

      const localCompletionState = readCompletionState();
      const localCompletion = localCompletionState[canonicalId];
      const remoteCompletion = (completionResult.data || []).reduce<{ completed: boolean; updatedAt: string } | null>((latest, row) => {
        const candidate = {
          completed: row.is_completed !== false,
          updatedAt: row.state_changed_at || row.updated_at || row.completed_at || "",
        };
        return !latest || completionEntryIsNewer(candidate, latest) ? candidate : latest;
      }, null);
      if (remoteCompletion && (!localCompletion || completionEntryIsNewer(remoteCompletion, localCompletion))) {
        localCompletionState[canonicalId] = remoteCompletion;
        writeCompletionState(localCompletionState);
      } else if (localCompletion && (!remoteCompletion || completionEntryIsNewer(localCompletion, remoteCompletion))) {
        const completionSync = await supabase.from("completed_books").upsert({
          user_id: userId,
          book_id: canonicalId,
          is_completed: localCompletion.completed,
          completed_at: localCompletion.updatedAt || new Date().toISOString(),
          state_changed_at: localCompletion.updatedAt || new Date().toISOString(),
        }, { onConflict: "user_id,book_id" });
        if (completionSync.error) throw completionSync.error;
      }
      setCompletedBooks(completionSet(localCompletionState));
      window.dispatchEvent(new Event("jju-account"));

      if (preferences.saveProgress !== false && !restartRequestedRef.current) {
        const remote = ((progressResult.data || []) as ReaderCloudProgressRow[]).reduce<ReaderCloudProgressRow | null>((latest, row) => (
          !latest || Date.parse(row.last_read_at || "") > Date.parse(latest.last_read_at || "") ? row : latest
        ), null);
        if (remote) {
          const history = readRecord<ReadingHistoryItem[]>(HISTORY_KEY, [])
            .filter(item => canonicalBookId(item.bookId) === canonicalId)
            .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))[0];
          const remoteIsNewer = Date.parse(remote.last_read_at || "") > Date.parse(history?.updatedAt || "");
          const mergedSeconds = Math.max(readActualSeconds(canonicalId), Number(remote.actual_seconds || 0));
          saveActualSeconds(canonicalId, mergedSeconds);
          setActualSeconds(mergedSeconds);
          if (remoteIsNewer) {
            const nextIndex = Math.min(Math.max(0, Number(remote.section_index || 0)), visibleSections.length - 1);
            const progress = readRecord<Record<string, number>>(PROGRESS_KEY, {});
            for (const storedId of Object.keys(progress)) {
              if (storedId !== canonicalId && canonicalBookId(storedId) === canonicalId) delete progress[storedId];
            }
            progress[canonicalId] = nextIndex;
            writeRecord(PROGRESS_KEY, progress);
            setSectionIndex(nextIndex);
            saveReadingHistory({
              bookId: canonicalId,
              requestedId,
              title,
              sectionIndex: nextIndex,
              sectionTitle: visibleSections[nextIndex]?.title,
              actualSeconds: mergedSeconds,
              updatedAt: remote.last_read_at || new Date().toISOString(),
            });
          }
        }
      }

      cloudHydrationRetryRef.current = 0;
      setCloudProgressHydrated(true);
    }

    void hydrateCloudProgress().catch(() => {
      if (cancelled) return;
      setReaderMessage("Account sync is temporarily unavailable. Your place is safe on this device.");
      if (cloudHydrationRetryRef.current < 2) {
        cloudHydrationRetryRef.current += 1;
        retryTimeout = window.setTimeout(
          () => setCloudSyncAttempt(attempt => attempt + 1),
          3000 * cloudHydrationRetryRef.current,
        );
      }
    });
    return () => {
      cancelled = true;
      if (retryTimeout !== null) window.clearTimeout(retryTimeout);
    };
  }, [bookId, cloudSyncAttempt, cloudSyncReady, preferences.saveProgress, requestedId, title, userId, visibleSections]);

  useEffect(() => {
    if (!fullscreenFallbackActive) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreenFallbackActive]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    function handlePreferences() {
      setPreferences(readPreferencesV2());
    }

    const timeout = window.setTimeout(handlePreferences, 0);
    window.addEventListener(PREFERENCES_EVENT, handlePreferences);
    window.addEventListener("jju-preferences", handlePreferences);
    window.addEventListener("storage", handlePreferences);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener(PREFERENCES_EVENT, handlePreferences);
      window.removeEventListener("jju-preferences", handlePreferences);
      window.removeEventListener("storage", handlePreferences);
    };
  }, []);

  useEffect(() => {
    if (!compactReader) return;
    const bodyStyle = document.body.style;
    const previousOverflowX = bodyStyle.getPropertyValue("overflow-x");
    const previousOverflowXPriority = bodyStyle.getPropertyPriority("overflow-x");
    const previousOverflowY = bodyStyle.getPropertyValue("overflow-y");
    const previousOverflowYPriority = bodyStyle.getPropertyPriority("overflow-y");
    bodyStyle.setProperty("overflow-x", "visible", "important");
    bodyStyle.setProperty("overflow-y", "visible", "important");
    return () => {
      if (previousOverflowX) bodyStyle.setProperty("overflow-x", previousOverflowX, previousOverflowXPriority);
      else bodyStyle.removeProperty("overflow-x");
      if (previousOverflowY) bodyStyle.setProperty("overflow-y", previousOverflowY, previousOverflowYPriority);
      else bodyStyle.removeProperty("overflow-y");
    };
  }, [compactReader]);

  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let authEventRevision = 0;

    function applyAuthenticatedUser(nextUser: User | null) {
      const verified = Boolean(nextUser?.email_confirmed_at);
      if (verified && nextUser) {
        const scope = prepareReaderDataScope(nextUser.id, nextUser.email || "");
        const previousAccount = activeReaderAccountRef.current || currentReaderDataOwner();
        if (activeReaderAccountRef.current !== nextUser.id) {
          if (noteSaveTimer.current !== null) window.clearTimeout(noteSaveTimer.current);
          noteSaveTimer.current = null;
          pendingNoteKeyRef.current = "";
          readerMemoryRevisionRef.current = 0;
          readerMemoryRetryScheduledRef.current = false;
        }
        if (scope === "account-switched" || (previousAccount && previousAccount !== nextUser.id)) {
          setSectionIndex(0);
          setActualSeconds(0);
          setCompletedBooks(new Set());
          setBookmarks(new Set());
          setNotes({});
          setQuotes([]);
          pendingQuoteSelectionRef.current = null;
          setPendingQuoteText("");
        }
        activeReaderAccountRef.current = nextUser.id;
      }
      setCloudProgressHydrated(false);
      setUserId(nextUser?.id || "");
      setCloudSyncReady(verified);
    }

    activeReaderAccountRef.current = currentReaderDataOwner();
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled && authEventRevision === 0) applyAuthenticatedUser(data.user);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventRevision += 1;
      applyAuthenticatedUser(session?.user || null);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!readerMessage) return;
    const timeout = window.setTimeout(() => setReaderMessage(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [readerMessage]);

  useEffect(() => {
    window.addEventListener("keydown", handleReaderKey);
    return () => window.removeEventListener("keydown", handleReaderKey);
  }, [handleReaderKey]);

  useEffect(() => {
    if (!compactReader || !settingsOpen) return;

    function closeToolsFromOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || toolsPanelRef.current?.contains(target) || toolsTriggerRef.current?.contains(target)) return;
      setSettingsOpen(false);
    }

    document.addEventListener("pointerdown", closeToolsFromOutside);
    return () => document.removeEventListener("pointerdown", closeToolsFromOutside);
  }, [compactReader, settingsOpen]);

  useEffect(() => {
    if (!compactReader) return;

    function closeTextFromOutside(event: PointerEvent) {
      const menu = sizeMenuRef.current;
      const target = event.target as Node | null;
      if (!menu?.open || !target || menu.contains(target)) return;
      menu.removeAttribute("open");
    }

    document.addEventListener("pointerdown", closeTextFromOutside);
    return () => document.removeEventListener("pointerdown", closeTextFromOutside);
  }, [compactReader]);

  useEffect(() => {
    if (!bookId || !visibleSections.length) return;

    try {
      const canonicalId = canonicalBookId(bookId);
      if (preferences.saveProgress !== false) {
        const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}") as Record<string, number>;
        for (const storedId of Object.keys(progress)) {
          if (storedId !== canonicalId && canonicalBookId(storedId) === canonicalId) delete progress[storedId];
        }
        progress[canonicalId] = sectionIndex;
        if (requestedId && requestedId !== canonicalId) delete progress[requestedId];
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
      }

      if (hasReachedReadingEnd && actualSeconds >= AUTO_COMPLETE_SECONDS) {
        const readBefore = readCompletedSet();
        const wasAlreadyComplete = readBefore.has(canonicalId);
        if (!wasAlreadyComplete) {
          updateCompletionState(canonicalId, true);
          pendingCompletionCloudSyncRef.current = true;
          completionMarkedAtSecondRef.current = actualSeconds;
          const events = Array.isArray(JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]"))
            ? JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]")
            : [];
          events.push({ bookId, finishedAt: new Date().toISOString() });
          localStorage.setItem(READ_EVENTS_KEY, JSON.stringify(events.slice(-500)));
          window.dispatchEvent(new Event("jju-account"));
        }
      }
    } catch {
      return;
    }
  }, [actualSeconds, bookId, hasReachedReadingEnd, requestedId, sectionIndex, visibleSections.length, preferences.saveProgress]);

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
    if (!compactReader) {
      viewerRef.current?.contentWindow?.scrollTo(0, 0);
      return;
    }

    const intent = pageScrollIntentRef.current;
    pageScrollIntentRef.current = "none";
    if (intent === "none") return;

    const frame = window.requestAnimationFrame(() => {
      const documentNode = inlineDocumentRef.current;
      if (!documentNode) return;
      if (intent === "smart") {
        const top = documentNode.getBoundingClientRect().top;
        if (top >= 0 && top <= 260) return;
      }
      documentNode.scrollIntoView({ block: "start", behavior: "auto" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [compactReader, section?.id]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1080px)");
    const refreshHeight = () => syncViewerHeight();
    media.addEventListener("change", refreshHeight);
    window.addEventListener("resize", refreshHeight);
    return () => {
      media.removeEventListener("change", refreshHeight);
      window.removeEventListener("resize", refreshHeight);
      viewerResizeObserverRef.current?.disconnect();
    };
  }, [syncViewerHeight]);

  useEffect(() => {
    if (!bookId || status !== "Reading") return;
    engagedSessionSecondsRef.current = 0;
    engagedMinutesQueuedRef.current = 0;
    qualifiedReadQueuedRef.current = false;
    visitedSectionIndexesRef.current = new Set();
    maxReaderScrollDepthRef.current = 0;
    readingSessionStartedAtRef.current = Date.now();
    markReaderEngagement();
  }, [bookId, markReaderEngagement, status, userId]);

  useEffect(() => {
    const readerRoot = shellRef.current;
    if (!readerRoot || !bookId || status !== "Reading") return;
    const markInteraction = () => markReaderEngagement();

    readerRoot.addEventListener("pointerdown", markInteraction, { passive: true });
    readerRoot.addEventListener("wheel", markInteraction, { passive: true });
    readerRoot.addEventListener("touchmove", markInteraction, { passive: true });
    window.addEventListener("scroll", markInteraction, { passive: true, capture: true });

    return () => {
      readerRoot.removeEventListener("pointerdown", markInteraction);
      readerRoot.removeEventListener("wheel", markInteraction);
      readerRoot.removeEventListener("touchmove", markInteraction);
      window.removeEventListener("scroll", markInteraction, true);
    };
  }, [bookId, markReaderEngagement, status]);

  useEffect(() => {
    if (!bookId || status !== "Reading") return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      if (!readerSurfaceIsVisible()) return;
      if (performance.now() - lastReaderInteractionAtRef.current > ENGAGEMENT_IDLE_TIMEOUT_MS) return;

      engagedSessionSecondsRef.current += 1;
      visitedSectionIndexesRef.current.add(sectionIndex);
      const sessionSeconds = engagedSessionSecondsRef.current;
      const completedMinutes = Math.floor(sessionSeconds / ENGAGED_MINUTE_SECONDS);
      const now = Date.now();

      while (engagedMinutesQueuedRef.current < completedMinutes) {
        const queued = queueReadingAnalyticsRow(
          ENGAGED_MINUTE_SECONDS,
          "reader_engaged_minute",
          readingSessionStartedAtRef.current,
          now,
        );
        if (!queued) break;
        engagedMinutesQueuedRef.current += 1;
      }

      const isQualified = sessionSeconds >= QUALIFIED_READ_SECONDS
        && (
          visitedSectionIndexesRef.current.size >= 2
          || (visibleSections.length === 1 && maxReaderScrollDepthRef.current >= QUALIFIED_SCROLL_DEPTH)
        );
      if (isQualified && !qualifiedReadQueuedRef.current) {
        const queued = queueReadingAnalyticsRow(
          0,
          "qualified_read",
          readingSessionStartedAtRef.current,
          now,
        );
        if (queued) qualifiedReadQueuedRef.current = true;
      }

      setActualSeconds(current => {
        const next = current + 1;
        if (preferences.saveProgress !== false) saveActualSeconds(bookId, next);
        return next;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [bookId, preferences.saveProgress, queueReadingAnalyticsRow, readerSurfaceIsVisible, sectionIndex, status, visibleSections.length]);

  useEffect(() => {
    if (!bookId || status !== "Reading" || actualSeconds < OPEN_HISTORY_SECONDS || preferences.saveProgress === false) return;
    saveReadingHistory({
      bookId,
      requestedId,
      title,
      sectionIndex,
      sectionTitle: section?.title,
      actualSeconds,
      updatedAt: new Date().toISOString(),
    });
  }, [actualSeconds, bookId, preferences.saveProgress, requestedId, section?.title, sectionIndex, status, title]);

  useEffect(() => {
    if (!userId || !cloudSyncReady || !cloudProgressHydrated || !bookId || !visibleSections.length) return;
    if (!readerDataBelongsTo(userId)) return;
    const shouldSyncCompletion = pendingCompletionCloudSyncRef.current
      && hasReachedReadingEnd
      && actualSeconds >= AUTO_COMPLETE_SECONDS;
    const wasJustCompleted = shouldSyncCompletion && completionMarkedAtSecondRef.current === actualSeconds;
    const shouldSyncProgress = preferences.saveProgress !== false && actualSeconds % 20 === 0;
    if (!shouldSyncProgress && !wasJustCompleted) return;

    const supabase = createSupabaseBrowserClient();
    const now = new Date().toISOString();
    void (async () => {
      if (shouldSyncProgress) {
        const progressResult = await supabase.from("reading_progress").upsert({
          user_id: userId,
          book_id: canonicalBookId(bookId),
          section_index: sectionIndex,
          section_count: visibleSections.length,
          progress_percent: progressPercent,
          estimated_minutes: estimatedMinutes,
          actual_seconds: actualSeconds,
          last_read_at: now,
          updated_at: now,
        }, { onConflict: "user_id,book_id" });
        if (progressResult.error) {
          setReaderMessage("Saved on this device. Account sync will retry automatically.");
          return;
        }
      }

      if (!shouldSyncCompletion) return;
      const completionResult = await supabase.from("completed_books").upsert({
        user_id: userId,
        book_id: canonicalBookId(bookId),
        is_completed: true,
        completed_at: now,
        state_changed_at: now,
      }, { onConflict: "user_id,book_id" });
      if (completionResult.error) {
        setReaderMessage("Finished on this device. Account sync will retry automatically.");
        return;
      }
      pendingCompletionCloudSyncRef.current = false;
      completionMarkedAtSecondRef.current = null;
    })();
  }, [actualSeconds, bookId, cloudProgressHydrated, cloudSyncReady, estimatedMinutes, hasReachedReadingEnd, preferences.saveProgress, progressPercent, sectionIndex, userId, visibleSections.length]);

  useEffect(() => {
    if (!userId || !cloudSyncReady || !hasSupabaseConfig()) return;
    prepareReaderDataScope(userId);
    let cancelled = false;

    async function syncReaderMemory() {
      if (cancelled || !readerDataBelongsTo(userId)) return;
      if (noteSaveTimer.current !== null) return;
      readerMemoryRetryScheduledRef.current = false;
      const supabase = createSupabaseBrowserClient();
      const startingRevision = readerMemoryRevisionRef.current;
      const localBookmarkKeys = readRecord<string[]>(BOOKMARKS_KEY, []);
      const localNotes = readRecord<Record<string, string>>(NOTES_KEY, {});
      const localQuotes = readRecord<SavedQuote[]>(QUOTES_KEY, []);
      const now = new Date().toISOString();

      const [cloudBookmarks, cloudNotes, cloudQuotes] = await Promise.all([
        supabase.from("reader_bookmarks").select("key,book_id,section_id,section_title"),
        supabase.from("reader_notes").select("key,book_id,section_id,note"),
        supabase.from("reader_quotes").select("id,book_id,book_title,section_id,section_title,text,saved_at"),
      ]);
      const cloudError = cloudBookmarks.error || cloudNotes.error || cloudQuotes.error;
      if (cloudError) throw cloudError;

      if (cancelled || !readerDataBelongsTo(userId)) return;
      if (readerMemoryRevisionRef.current !== startingRevision) return;

      const cloudBookmarkKeys = new Set((cloudBookmarks.data || []).map(row => row.key));
      const cloudNoteKeys = new Set((cloudNotes.data || []).map(row => row.key));
      const cloudQuoteIds = new Set((cloudQuotes.data || []).map(row => row.id));
      const bookmarkRows = localBookmarkKeys
        .filter(key => !cloudBookmarkKeys.has(key))
        .map(key => readerBookmarkRow(userId, key, bookId, visibleSections))
        .filter((row): row is NonNullable<ReturnType<typeof readerBookmarkRow>> => Boolean(row));
      const noteRows = Object.entries(localNotes)
        .filter(([key, value]) => value.trim() && !cloudNoteKeys.has(key))
        .map(([key, value]) => readerNoteRow(userId, key, value))
        .filter((row): row is NonNullable<ReturnType<typeof readerNoteRow>> => Boolean(row));
      const quoteRows = localQuotes
        .filter(quote => !cloudQuoteIds.has(quote.id))
        .map(quote => readerQuoteRow(userId, quote));
      const uploadResults = await Promise.all([
        bookmarkRows.length ? supabase.from("reader_bookmarks").upsert(bookmarkRows, { onConflict: "user_id,key" }) : Promise.resolve(null),
        noteRows.length ? supabase.from("reader_notes").upsert(noteRows, { onConflict: "user_id,key" }) : Promise.resolve(null),
        quoteRows.length ? supabase.from("reader_quotes").upsert(quoteRows, { onConflict: "user_id,id" }) : Promise.resolve(null),
      ]);
      const uploadError = uploadResults.find(result => result?.error)?.error;
      if (uploadError) throw uploadError;
      if (cancelled || !readerDataBelongsTo(userId)) return;
      if (readerMemoryRevisionRef.current !== startingRevision) return;

      const mergedBookmarkKeys = new Set(localBookmarkKeys);
      ((cloudBookmarks.data || []) as ReaderBookmarkRow[]).forEach(row => {
        if (row.key) mergedBookmarkKeys.add(row.key);
      });

      const mergedNotes: Record<string, string> = { ...localNotes };
      ((cloudNotes.data || []) as ReaderNoteRow[]).forEach(row => {
        if (row.key && row.note) mergedNotes[row.key] = row.note;
      });

      const quoteMap = new Map<string, SavedQuote>();
      ((cloudQuotes.data || []) as ReaderQuoteRow[]).forEach(row => {
        if (!row.id || !row.book_id || !row.section_id || !row.text) return;
        quoteMap.set(row.id, {
          id: row.id,
          bookId: row.book_id,
          bookTitle: row.book_title || "",
          sectionId: row.section_id,
          sectionTitle: row.section_title || "",
          text: row.text,
          savedAt: row.saved_at || now,
        });
      });
      localQuotes.forEach(quote => quoteMap.set(quote.id, quote));

      const nextBookmarks = new Set([...mergedBookmarkKeys].sort());
      const nextQuotes = normalizeQuoteList([...quoteMap.values()]);

      setBookmarks(nextBookmarks);
      setNotes(mergedNotes);
      setQuotes(nextQuotes);
      writeRecord(BOOKMARKS_KEY, [...nextBookmarks]);
      writeRecord(NOTES_KEY, mergedNotes);
      writeRecord(QUOTES_KEY, nextQuotes);
    }

    void queueReaderMemoryCloudTask(syncReaderMemory).catch(() => {
      if (!cancelled) setReaderMessage("Reader tools are saved here, but account sync needs another try.");
    });

    return () => {
      cancelled = true;
    };
  }, [bookId, cloudSyncAttempt, cloudSyncReady, queueReaderMemoryCloudTask, userId, visibleSections]);

  const cleanedHtml = section ? sanitizeReaderHtml(cleanSectionHtml(section.html)) : "";
  const sectionAuditReceipts = section && audit?.status === "verified"
    ? audit.receipts.filter(receipt => receipt.sectionId === section.id)
    : [];
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

  function chooseSection(index: number) {
    jumpToSection(index);
    if (compactReader) setChapterDrawerOpen(false);
  }

  function toggleBookmark() {
    if (!currentSectionKey) return;
    const shouldSave = !bookmarks.has(currentSectionKey);
    const revision = markReaderMemoryMutation();
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
    queueReaderMemoryMutation(revision, () => syncBookmarkToCloud(currentSectionKey, shouldSave));
  }

  function saveNote(value: string) {
    if (!currentSectionKey) return;
    const key = currentSectionKey;
    markReaderMemoryMutation();
    setNotes(current => {
      const next = { ...current, [key]: value };
      if (!value.trim()) delete next[key];
      writeRecord(NOTES_KEY, next);
      return next;
    });
    if (noteSaveTimer.current !== null) window.clearTimeout(noteSaveTimer.current);
    pendingNoteKeyRef.current = key;
    noteSaveTimer.current = window.setTimeout(() => {
      noteSaveTimer.current = null;
      pendingNoteKeyRef.current = "";
      const revision = markReaderMemoryMutation();
      queueReaderMemoryMutation(revision, () => syncNoteToCloud(key, value));
    }, 600);
  }

  function saveQuote() {
    if (!section || !bookId) return;
    const liveSelection = compactReader ? captureQuoteSelection() : null;
    const pendingSelection = liveSelection || pendingQuoteSelectionRef.current;
    const selectedText = compactReader ? null : viewerRef.current?.contentWindow?.getSelection();
    const selected = compactReader
      ? (pendingSelection?.bookId === bookId && pendingSelection.sectionId === section.id ? pendingSelection.text : "")
      : selectedText?.toString().trim() || "";
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
    const revision = markReaderMemoryMutation();
    setQuotes(current => {
      const next = [quote, ...current].slice(0, 500);
      writeRecord(QUOTES_KEY, next);
      return next;
    });
    queueReaderMemoryMutation(revision, () => syncQuoteToCloud(quote));
    pendingQuoteSelectionRef.current = null;
    setPendingQuoteText("");
    setReaderMessage("Quote saved.");
  }

  function removeSavedBookmark(key: string) {
    if (!key) return;
    const revision = markReaderMemoryMutation();
    setBookmarks(current => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      writeRecord(BOOKMARKS_KEY, [...next].sort());
      return next;
    });
    queueReaderMemoryMutation(revision, () => syncBookmarkToCloud(key, false));
    setReaderMessage("Bookmark removed.");
  }

  function removeSavedNote(key: string) {
    if (!key) return;
    if (pendingNoteKeyRef.current === key && noteSaveTimer.current !== null) {
      window.clearTimeout(noteSaveTimer.current);
      noteSaveTimer.current = null;
      pendingNoteKeyRef.current = "";
    }
    const revision = markReaderMemoryMutation();
    setNotes(current => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      writeRecord(NOTES_KEY, next);
      return next;
    });
    queueReaderMemoryMutation(revision, () => syncNoteToCloud(key, ""));
    setReaderMessage("Note removed.");
  }

  function removeSavedQuote(quoteId: string) {
    if (!quoteId) return;
    const revision = markReaderMemoryMutation();
    setQuotes(current => {
      const next = current.filter(item => item.id !== quoteId);
      if (next.length === current.length) return current;
      writeRecord(QUOTES_KEY, next);
      return next;
    });
    queueReaderMemoryMutation(revision, () => deleteQuoteFromCloud(quoteId));
    setReaderMessage("Quote removed.");
  }

  async function copySavedQuote(text: string) {
    let copyField: HTMLTextAreaElement | null = null;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyField = document.createElement("textarea");
        copyField.value = text;
        copyField.setAttribute("readonly", "");
        copyField.style.position = "fixed";
        copyField.style.opacity = "0";
        document.body.appendChild(copyField);
        copyField.select();
        const copied = document.execCommand("copy");
        if (!copied) throw new Error("Copy command failed");
      }
      setReaderMessage("Quote copied.");
    } catch {
      setReaderMessage("Copy did not work. Select the quote text and copy it manually.");
    } finally {
      copyField?.remove();
    }
  }

  async function toggleBookComplete() {
    if (!bookId) return;
    try {
      const canonicalId = canonicalBookId(bookId);
      const read = readCompletedSet();
      const alreadyComplete = read.has(canonicalId);
      if (alreadyComplete) {
        updateCompletionState(canonicalId, false);
        const progress = readRecord<Record<string, number>>(PROGRESS_KEY, {});
        for (const storedId of Object.keys(progress)) {
          if (canonicalBookId(storedId) === canonicalId) delete progress[storedId];
        }
        if (requestedId) delete progress[requestedId];
        writeRecord(PROGRESS_KEY, progress);
        setSectionIndex(0);
      } else {
        updateCompletionState(canonicalId, true);
      }
      setCompletedBooks(readCompletedSet());
      if (!alreadyComplete) {
        const events = Array.isArray(JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]"))
          ? JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]")
          : [];
        events.push({ bookId, finishedAt: new Date().toISOString() });
        localStorage.setItem(READ_EVENTS_KEY, JSON.stringify(events.slice(-500)));
      }
      window.dispatchEvent(new Event("jju-account"));
      setReaderMessage(alreadyComplete ? "Book marked incomplete." : "Book marked complete.");

      if (userId && cloudSyncReady && hasSupabaseConfig() && readerDataBelongsTo(userId)) {
        const supabase = createSupabaseBrowserClient();
        if (alreadyComplete) {
          const now = new Date().toISOString();
          const cloudBookIds = [...new Set([...bookIdAliasFamily(canonicalId), requestedId].filter(Boolean))];
          const aliasCloudBookIds = cloudBookIds.filter(id => id !== canonicalId);
          const [completionResult, progressResult, aliasProgressResult] = await Promise.all([
            supabase.from("completed_books").upsert({
              user_id: userId,
              book_id: canonicalId,
              is_completed: false,
              completed_at: now,
              state_changed_at: now,
            }, { onConflict: "user_id,book_id" }),
            supabase.from("reading_progress").update({
              section_index: 0,
              progress_percent: 0,
              last_read_at: now,
              updated_at: now,
            }).eq("user_id", userId).eq("book_id", canonicalId),
            aliasCloudBookIds.length
              ? supabase.from("reading_progress").delete().eq("user_id", userId).in("book_id", aliasCloudBookIds)
              : Promise.resolve(null),
          ]);
          if (completionResult.error || progressResult.error || aliasProgressResult?.error) setReaderMessage("Saved on this device, but account sync failed.");
        } else {
          const result = await supabase.from("completed_books").upsert({
            user_id: userId,
            book_id: canonicalId,
            is_completed: true,
            completed_at: new Date().toISOString(),
            state_changed_at: new Date().toISOString(),
          }, { onConflict: "user_id,book_id" });
          if (result.error) setReaderMessage("Saved on this device, but account sync failed.");
        }
      }
    } catch {
      setReaderMessage("Could not update completion.");
    }
  }

  function touchEnd(clientX: number) {
    if (touchStart.current === null) return;
    const delta = clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(delta) < 54) return;
    if (delta < 0 && sectionIndex < visibleSections.length - 1) nextSection("smart");
    if (delta > 0 && sectionIndex > 0) prevSection("smart");
  }

  async function toggleFullscreen() {
    const node = fullscreenRootRef.current;
    if (!node) return;
    if (fullscreenFallbackActive) {
      setFullscreenFallbackActive(false);
    } else if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    } else if (typeof node.requestFullscreen === "function") {
      try {
        await node.requestFullscreen();
      } catch {
        if (compactReader) setFullscreenFallbackActive(true);
      }
    } else if (compactReader) {
      setFullscreenFallbackActive(true);
    }
    setSettingsOpen(false);
    setChapterDrawerOpen(false);
    sizeMenuRef.current?.removeAttribute("open");
  }

  return (
    <PageRoot
      ref={node => { fullscreenRootRef.current = node; }}
      className={`page readerPage readerPageV2 ${compactReader ? "siteV2Reader" : ""} ${fullscreenFallbackActive ? "readerFullscreenFallback" : ""}`}
      data-reader-theme={compactReader ? preferences.readerTheme : undefined}
    >
      <div className={compactReader ? "readerStickyChrome" : undefined} style={compactReader ? undefined : { display: "contents" }}>
      <section className={`readerCommandBar ${compactReader ? "readerCommandBarCompact" : ""}`}>
        <Link className={`btn secondary ${compactReader ? "readerBackLink" : ""}`} href={libraryHref} aria-label={compactReader ? `Back to ${libraryLabel}` : undefined}>
          {compactReader && <span aria-hidden="true">←</span>}
          <span className={compactReader ? "readerBackText" : undefined}>{compactReader ? `Back to ${libraryLabel}` : libraryLabel}</span>
        </Link>
        <div className="readerTitleBlock">
          <p className="kicker">{status}{creator ? ` / ${creator}` : ""}</p>
          <h1>{title}</h1>
          {!compactReader && <span>{section ? section.title : "Choose a book to start reading."}</span>}
        </div>
        {compactReader ? (
          <div className="readerTopActions readerCompactActions">
            <button className="readerToolBtn" type="button" onClick={toggleChapterDrawer} aria-expanded={chapterDrawerOpen} aria-controls={chapterPanelId}>Contents</button>
            <details
              ref={sizeMenuRef}
              className="readerTextMenu"
              onToggle={event => {
                if (!event.currentTarget.open) return;
                setChapterDrawerOpen(false);
                setSettingsOpen(false);
              }}
            >
              <summary>Text</summary>
              <div className="readerTextPopover" aria-label="Reading text settings">
                <strong>Reading text</strong>
                <label>
                  <span>Appearance</span>
                  <select value={preferences.readerTheme} onChange={event => patchPreferences({ readerTheme: event.target.value as PreferencesV2["readerTheme"] })}>
                    {READER_THEME_OPTIONS.map(readerTheme => <option key={readerTheme} value={readerTheme}>{READER_THEME_LABELS[readerTheme]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Typeface</span>
                  <select value={preferences.readerFont} onChange={event => patchPreferences({ readerFont: event.target.value as PreferencesV2["readerFont"] })}>
                    {READER_FONT_OPTIONS.map(readerFont => <option key={readerFont} value={readerFont}>{READER_FONT_LABELS[readerFont]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Size</span>
                  <select value={preferences.readerSize} onChange={event => patchPreferences({ readerSize: event.target.value as PreferencesV2["readerSize"] })}>
                    {READER_SIZE_OPTIONS.map(readerSize => <option key={readerSize} value={readerSize}>{READER_SIZE_LABELS[readerSize]} ({READER_SIZE_PIXELS[readerSize]}px)</option>)}
                  </select>
                </label>
                <label>
                  <span>Spacing</span>
                  <select value={preferences.readerSpacing} onChange={event => patchPreferences({ readerSpacing: event.target.value as PreferencesV2["readerSpacing"] })}>
                    {READER_SPACING_OPTIONS.map(readerSpacing => <option key={readerSpacing} value={readerSpacing}>{READER_SPACING_LABELS[readerSpacing]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Width</span>
                  <select value={preferences.readerWidth} onChange={event => patchPreferences({ readerWidth: event.target.value as PreferencesV2["readerWidth"] })}>
                    {READER_WIDTH_OPTIONS.map(readerWidth => <option key={readerWidth} value={readerWidth}>{READER_WIDTH_LABELS[readerWidth]}</option>)}
                  </select>
                </label>
              </div>
            </details>
            <button ref={toolsTriggerRef} className="readerToolBtn primaryTool" type="button" onPointerDown={() => { captureQuoteSelection(); }} onClick={toggleTools} aria-expanded={settingsOpen} aria-controls={settingsPanelId}>Save</button>
            <button className="readerToolBtn readerFullscreenButton" type="button" onClick={toggleFullscreen} aria-label={fullscreenActive || fullscreenFallbackActive ? "Exit full screen" : "Enter full screen"} aria-pressed={fullscreenActive || fullscreenFallbackActive}>
              {fullscreenActive || fullscreenFallbackActive ? "Exit" : "Full screen"}
            </button>
            {settingsOpen && (
              <section ref={toolsPanelRef} id={settingsPanelId} className="readerSavePopover" aria-label="Save this page">
                <header>
                  <div>
                    <span>Save</span>
                    <strong>{section?.title || "This page"}</strong>
                  </div>
                  <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close save menu">Close</button>
                </header>
                <div className="readerSaveActions">
                  <button type="button" aria-pressed={isBookmarked} onClick={toggleBookmark}>{isBookmarked ? "Remove bookmark" : "Bookmark this page"}</button>
                  <button type="button" onClick={saveQuote}>Save selected quote</button>
                </div>
                {pendingQuoteText && (
                  <p className="readerPendingQuote" aria-live="polite">
                    <span>Selected quote ready</span>
                    <q>{pendingQuoteText.length > 180 ? `${pendingQuoteText.slice(0, 177)}...` : pendingQuoteText}</q>
                  </p>
                )}
                <label className="readerSaveNote">
                  <span>Note for this page</span>
                  <textarea aria-label="Private note for this page" value={currentNote} onChange={event => saveNote(event.target.value)} placeholder="Add a private note..." />
                </label>
                <details className="readerSavedListDisclosure">
                  <summary>
                    <span>Saved in this book</span>
                    <small>{savedBookBookmarkCount + savedBookNoteCount + savedBookQuoteCount}</small>
                  </summary>
                  <div className="readerSavedPageList">
                    {savedBookSections.length ? savedBookSections.map(saved => (
                      <section key={saved.entry.section.id} className="readerSavedPageCard" aria-label={`Saved items for ${saved.entry.section.title}`}>
                        <header className="readerSavedPageHeader">
                          <div className="readerSavedPageHeading">
                            <span>{contentsMarker(saved.entry)}</span>
                            <div>
                              <strong>{saved.entry.section.title}</strong>
                              <small>
                                {[
                                  saved.bookmarkKey ? "bookmark" : "",
                                  saved.noteKey ? "note" : "",
                                  saved.quotes.length ? `${saved.quotes.length} ${saved.quotes.length === 1 ? "quote" : "quotes"}` : "",
                                ].filter(Boolean).join(" · ")}
                              </small>
                            </div>
                          </div>
                          <button type="button" onClick={() => {
                            setSettingsOpen(false);
                            jumpToSection(saved.index, "top");
                          }}>Open page</button>
                        </header>
                        {saved.bookmarkKey && (
                          <div className="readerSavedItem readerSavedBookmarkItem">
                            <span>Bookmark saved</span>
                            <button type="button" onClick={() => removeSavedBookmark(saved.bookmarkKey)}>Remove bookmark</button>
                          </div>
                        )}
                        {saved.noteKey && (
                          <div className="readerSavedItem">
                            <div className="readerSavedItemText">
                              <span>Note</span>
                              <p>{saved.note}</p>
                            </div>
                            <button type="button" onClick={() => removeSavedNote(saved.noteKey)}>Remove note</button>
                          </div>
                        )}
                        {saved.quotes.map(quote => (
                          <div key={quote.id} className="readerSavedItem readerSavedQuoteItem">
                            <div className="readerSavedItemText">
                              <span>Quote</span>
                              <blockquote>{quote.text}</blockquote>
                            </div>
                            <div className="readerSavedQuoteActions">
                              <button type="button" onClick={() => void copySavedQuote(quote.text)}>Copy</button>
                              <button type="button" onClick={() => removeSavedQuote(quote.id)}>Remove</button>
                            </div>
                          </div>
                        ))}
                      </section>
                    )) : <p>Nothing saved in this book yet.</p>}
                  </div>
                </details>
              </section>
            )}
          </div>
        ) : (
          <div className="readerTopActions">
            <button className="readerToolBtn" type="button" onClick={() => setChapterDrawerOpen(open => !open)} aria-expanded={chapterDrawerOpen} aria-controls={chapterPanelId}>Contents</button>
            <button className="readerToolBtn" type="button" onClick={() => setStudyPanelOpen(open => !open)} aria-expanded={studyPanelOpen} aria-controls={studyPanelId}>Study</button>
            <button className="readerToolBtn iconTool" type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen" aria-pressed={fullscreenActive} title="Fullscreen">⛶</button>
            <button className="readerToolBtn primaryTool" type="button" onClick={() => setSettingsOpen(open => !open)} aria-label="Reader settings" aria-expanded={settingsOpen} aria-controls={settingsPanelId}>Aa</button>
          </div>
        )}
      </section>

      {readerMessage && <div className="readerToast" role="status" aria-live="polite" aria-atomic="true">{readerMessage}</div>}

      {!!visibleSections.length && (compactReader ? (
        <section className="readerProgressCompact" aria-label="Reading progress">
          <div className="readerProgressTrack" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pageProgressPercent}>
            <span style={{ width: `${pageProgressPercent}%` }} />
          </div>
          <span>{pageProgressPercent}% complete</span>
          <span>{remainingMinutes ? `About ${remainingMinutes} minutes left` : "Last page"}</span>
        </section>
      ) : (
        <section className="readerProgressPanel readerProgressPanelV2">
          <div>
            <strong>{progressPercent}%</strong>
            <span>progress</span>
          </div>
          <div
            className="readerProgressTrack"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <small>{secondsLabel(actualSeconds)} read</small>
          <small>~{remainingMinutes}m left</small>
        </section>
      ))}

      {compactReader && !!visibleSections.length && (
        <nav className="readerPageNavigation readerPageNavigationTop" aria-label="Page navigation above the text">
          <button className="readerPageEdge" type="button" onClick={() => jumpToSection(0, "smart")} disabled={sectionIndex === 0}>First</button>
          <button type="button" onClick={() => prevSection("smart")} disabled={sectionIndex === 0}>Previous page</button>
          <span aria-live="polite">Page {sectionIndex + 1} of {visibleSections.length}</span>
          <button type="button" onClick={() => nextSection("smart")} disabled={sectionIndex === visibleSections.length - 1}>Next page</button>
          <button className="readerPageEdge" type="button" onClick={() => jumpToSection(visibleSections.length - 1, "smart")} disabled={sectionIndex === visibleSections.length - 1}>Last</button>
        </nav>
      )}
      </div>

      {!compactReader && settingsOpen ? (
        <section id={settingsPanelId} className="readerSettingsPanel readerSettingsPanelV2" aria-label="Reader settings">
          <div className="readerSettingsHeader">
            <strong>Reader Settings</strong>
            <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close reader settings">x</button>
          </div>
          <label><span>Theme</span><select className="select" value={preferences.readerTheme} onChange={event => patchPreferences({ readerTheme: event.target.value as PreferencesV2["readerTheme"] })}>{READER_THEME_OPTIONS.map(readerTheme => <option key={readerTheme} value={readerTheme}>{READER_THEME_LABELS[readerTheme]}</option>)}</select></label>
          <label><span>Font</span><select className="select" value={preferences.readerFont} onChange={event => patchPreferences({ readerFont: event.target.value as PreferencesV2["readerFont"] })}>{READER_FONT_OPTIONS.map(readerFont => <option key={readerFont} value={readerFont}>{READER_FONT_LABELS[readerFont]}</option>)}</select></label>
          <label><span>Size</span><select className="select" value={preferences.readerSize} onChange={event => patchPreferences({ readerSize: event.target.value as PreferencesV2["readerSize"] })}>{READER_SIZE_OPTIONS.map(readerSize => <option key={readerSize} value={readerSize}>{READER_SIZE_LABELS[readerSize]} ({READER_SIZE_PIXELS[readerSize]}px)</option>)}</select></label>
          <label><span>Spacing</span><select className="select" value={preferences.readerSpacing} onChange={event => patchPreferences({ readerSpacing: event.target.value as PreferencesV2["readerSpacing"] })}>{READER_SPACING_OPTIONS.map(readerSpacing => <option key={readerSpacing} value={readerSpacing}>{READER_SPACING_LABELS[readerSpacing]}</option>)}</select></label>
          <label><span>Width</span><select className="select" value={preferences.readerWidth} onChange={event => patchPreferences({ readerWidth: event.target.value as PreferencesV2["readerWidth"] })}>{READER_WIDTH_OPTIONS.map(readerWidth => <option key={readerWidth} value={readerWidth}>{READER_WIDTH_LABELS[readerWidth]}</option>)}</select></label>
          <label className="toggleLine"><input type="checkbox" checked={preferences.saveProgress} onChange={event => patchPreferences({ saveProgress: event.target.checked })} />Remember my place on this device</label>
        </section>
      ) : null}

      <section className={`readerWorkbenchV2 ${compactReader ? "readerCompactWorkbench studyClosed" : ""} ${chapterDrawerOpen ? "" : "chaptersClosed"} ${studyPanelOpen ? "" : "studyClosed"}`}>
        {compactReader && chapterDrawerOpen && (
          <button className="readerDrawerBackdrop" type="button" aria-label="Close chapters" onClick={() => setChapterDrawerOpen(false)} />
        )}
        {(!compactReader || chapterDrawerOpen) && <aside
          id={chapterPanelId}
          className="readerChapterRail"
          aria-label="Book contents"
          role={compactReader ? "dialog" : undefined}
          aria-modal={compactReader ? "true" : undefined}
        >
          <div className="readerRailHeader">
            <div className="readerRailSummary">
              <p className="kicker">Contents</p>
              <strong>{visibleSections.length} sections</strong>
              {chapterCount > 0 && <span>{chapterCount} chapters</span>}
            </div>
            {compactReader && <button className="readerRailClose" type="button" onClick={() => setChapterDrawerOpen(false)}>Close</button>}
          </div>
          <div className="readerChapterList">
            {sectionEntries.map((entry, index) => {
              const item = entry.section;
              const key = `${bookId}::${item.id}`;
              return (
                <button className={index === sectionIndex ? "active" : ""} key={item.id} onClick={() => chooseSection(index)}>
                  <span aria-hidden="true">{contentsMarker(entry)}</span>
                  <strong>{item.title}</strong>
                  <small>{headerLabel(entry.displayKind)} · {sectionMinutes(item)}m{bookmarks.has(key) ? " · saved" : ""}</small>
                </button>
              );
            })}
          </div>
        </aside>}

        <section
          ref={shellRef}
          className="readerStageV2"
          onTouchStart={event => { touchStart.current = event.changedTouches[0]?.clientX ?? null; }}
          onTouchEnd={event => touchEnd(event.changedTouches[0]?.clientX ?? 0)}
        >
          {!compactReader && (
            <div className={`readerStageTop ${["title", "dedication"].includes(displayKind) ? "quietStageTop" : ""}`}>
              {!["title", "dedication"].includes(displayKind) && (
              <div>
                <p className="kicker">{section ? headerLabel(displayKind) : "Reader"}</p>
                <strong>{section?.title || title}</strong>
              </div>
              )}
            </div>
          )}

          <div className={`readerFrameWrap readerFrameWrapV2 ${compactReader ? "readerInlineSurface" : ""}`} data-reader-theme={compactReader ? preferences.readerTheme : undefined}>
            {!compactReader && (
              <div className="readerFloatingNav" aria-label="Page navigation">
                <button className="readerNavBtn" onClick={() => prevSection("top")} disabled={sectionIndex === 0} aria-label="Previous section"><span aria-hidden="true">‹</span></button>
                <button className="readerNavBtn" onClick={() => nextSection("top")} disabled={!visibleSections.length || sectionIndex === visibleSections.length - 1} aria-label="Next section"><span aria-hidden="true">›</span></button>
              </div>
            )}
            {compactReader ? (
              section && (
                <article
                  ref={inlineDocumentRef}
                  className={`readerInlineDocument readerSection kind-${displayKind}`}
                  data-reader-font={preferences.readerFont}
                  data-reader-size={preferences.readerSize}
                  data-reader-spacing={preferences.readerSpacing}
                  data-reader-width={preferences.readerWidth}
                  aria-label={section.title || title}
                  onPointerUp={() => { captureQuoteSelection(); }}
                  onKeyUp={() => { captureQuoteSelection(); }}
                >
                  {showHeader && (
                    <header className="sectionHeader">
                      <p className="sectionKicker">{headerLabel(displayKind)}</p>
                      <h1 className="sectionTitle">{section.title}</h1>
                    </header>
                  )}
                  <div className="readerContent" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                  {sectionAuditReceipts.length > 0 && (
                    <section className="readerEvidenceCard" aria-label="Verified sources for this section">
                      <h2>Verified sources</h2>
                      <p>{sectionAuditReceipts.length} factual claim{sectionAuditReceipts.length === 1 ? "" : "s"} in this section have evidence receipts.</p>
                      <ul>
                        {sectionAuditReceipts.flatMap(receipt => receipt.sources).slice(0, 8).map((source, index) => (
                          <li key={`${source.url}:${index}`}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.publisher && <small>{source.publisher}</small>}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                </article>
              )
            ) : (
              <iframe ref={viewerRef} className="viewer viewerV2" srcDoc={srcDoc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title={section?.title || title} onLoad={bindViewerKeys}></iframe>
            )}

            {error && (
              <div className="card readerUnavailable">
                <h2>Book content unavailable.</h2>
                <p>{error}</p>
                <div className="buttonRow">
                  <button className="btn primary" onClick={load}>Try Again</button>
                  <Link className="btn secondary" href={libraryHref}>Back to {libraryLabel}</Link>
                </div>
              </div>
            )}
          </div>

          {compactReader ? (
            <nav className="readerPageNavigation readerPageNavigationBottom" aria-label="Page navigation below the text">
              <button className="readerPageEdge" type="button" onClick={() => jumpToSection(0, "top")} disabled={sectionIndex === 0}>First</button>
              <button type="button" onClick={() => prevSection("top")} disabled={sectionIndex === 0}>Previous page</button>
              <span aria-live="polite">Page {sectionIndex + 1} of {visibleSections.length}</span>
              <button type="button" onClick={() => nextSection("top")} disabled={sectionIndex === visibleSections.length - 1}>Next page</button>
              <button className="readerPageEdge" type="button" onClick={() => jumpToSection(visibleSections.length - 1, "top")} disabled={sectionIndex === visibleSections.length - 1}>Last</button>
            </nav>
          ) : (
            <div className="readerBottomBar">
              <button type="button" aria-pressed={isBookmarked} onClick={toggleBookmark}>{isBookmarked ? "★ Saved" : "☆ Bookmark"}</button>
              <button type="button" onClick={saveQuote}>“” Quote</button>
              <button type="button" aria-pressed={isCurrentBookComplete} onClick={() => void toggleBookComplete()}>{isCurrentBookComplete ? "✓ Read" : "✓ Complete"}</button>
            </div>
          )}
        </section>

        {!compactReader && <aside id={studyPanelId} className="readerStudyPanel" aria-label="Study panel">
          <section className="readerStudyCard">
            <p className="kicker">Section Note</p>
            <textarea aria-label="Private note for this section" value={currentNote} onChange={event => saveNote(event.target.value)} placeholder="Add a private note for this section..." />
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
        </aside>}
      </section>
    </PageRoot>
  );
}
