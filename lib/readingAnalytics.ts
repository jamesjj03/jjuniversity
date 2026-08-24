import "server-only";

import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";

const ANALYTICS_SOURCES = ["reader_engaged_minute", "qualified_read"] as const;
const ANALYTICS_WINDOW_DAYS = 30;
const RECENT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1_000;
const MAX_WINDOW_ROWS = 100_000;
const BOOK_LOOKUP_CHUNK_SIZE = 100;
const REPORT_TIME_ZONE = "America/New_York";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const displayDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

type AnalyticsSource = typeof ANALYTICS_SOURCES[number];

type ReadingSessionRow = {
  id: number;
  userId: string;
  bookId: string;
  seconds: number;
  startedAtMs: number;
  endedAtMs: number;
  source: AnalyticsSource;
};

export type ReadingAnalyticsCoverage = {
  label: "Signed-in Reader activity only";
  detail: string;
  qualifiedReadDefinition: string;
};

export type ReadingAnalyticsSummaryData = {
  engagedMinutes7d: number;
  engagedMinutes30d: number;
  qualifiedReads30d: number;
  uniqueReaders30d: number;
  topBook30d: null | {
    bookId: string;
    title: string;
    engagedMinutes: number;
    qualifiedReads: number;
  };
};

export type ReadingAnalyticsTrendPoint = {
  date: string;
  label: string;
  engagedMinutes: number;
  qualifiedReads: number;
  uniqueReaders: number;
};

export type ReadingAnalyticsBookRow = {
  bookId: string;
  title: string;
  titleAvailable: boolean;
  engagedMinutes7d: number;
  engagedMinutes30d: number;
  qualifiedReads30d: number;
  uniqueReaders30d: number;
  lastActivityAt: string;
};

export type ReadingAnalyticsAvailable = {
  status: "available";
  generatedAt: string;
  windowStart: string;
  coverage: ReadingAnalyticsCoverage;
  eventRows30d: number;
  summary: ReadingAnalyticsSummaryData;
  trend: ReadingAnalyticsTrendPoint[];
  books: ReadingAnalyticsBookRow[];
};

export type ReadingAnalyticsUnavailable = {
  status: "unavailable";
  generatedAt: string;
  coverage: ReadingAnalyticsCoverage;
  message: string;
};

export type ReadingAnalyticsResult = ReadingAnalyticsAvailable | ReadingAnalyticsUnavailable;

const COVERAGE: ReadingAnalyticsCoverage = {
  label: "Signed-in Reader activity only",
  detail: "Directional, client-reported activity from the signed-in web Reader. Anonymous reading, signed-out reading, offline time, print, and audio are not counted.",
  qualifiedReadDefinition: "A qualified read is recorded after two engaged minutes and either movement between sections or at least half of a one-section book.",
};

class ReadingAnalyticsLoadError extends Error {
  constructor(
    message: string,
    readonly safeMessage = "Reading analytics could not be loaded. No partial totals are shown.",
  ) {
    super(message);
    this.name = "ReadingAnalyticsLoadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSessionRow(value: unknown): ReadingSessionRow {
  if (!isRecord(value)) throw new ReadingAnalyticsLoadError("A reading_sessions row was not an object.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");

  const id = Number(value.id);
  const userId = typeof value.user_id === "string" ? value.user_id : "";
  const bookId = typeof value.book_id === "string" ? value.book_id.trim() : "";
  const seconds = Number(value.seconds);
  const source = value.source;
  const startedAtMs = typeof value.started_at === "string" ? Date.parse(value.started_at) : Number.NaN;
  const endedAtMs = typeof value.ended_at === "string" ? Date.parse(value.ended_at) : Number.NaN;

  if (!Number.isSafeInteger(id) || id <= 0) throw new ReadingAnalyticsLoadError("A reading_sessions row had an invalid id.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");
  if (!UUID_PATTERN.test(userId)) throw new ReadingAnalyticsLoadError("A reading_sessions row had an invalid user_id.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");
  if (!bookId || bookId.length > 500) throw new ReadingAnalyticsLoadError("A reading_sessions row had an invalid book_id.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");
  if (source !== "reader_engaged_minute" && source !== "qualified_read") throw new ReadingAnalyticsLoadError("A reading_sessions row had an unexpected source.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");
  if (!Number.isInteger(seconds) || seconds < 0) throw new ReadingAnalyticsLoadError("A reading_sessions row had invalid seconds.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");
  if (source === "reader_engaged_minute" && seconds !== 60) throw new ReadingAnalyticsLoadError("An engaged-minute row did not represent exactly one minute.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");
  if (source === "qualified_read" && seconds !== 0) throw new ReadingAnalyticsLoadError("A qualified-read row had non-zero seconds.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs < startedAtMs) throw new ReadingAnalyticsLoadError("A reading_sessions row had invalid timestamps.", "Reading analytics contain a record this report could not verify. No partial totals are shown.");

  return { id, userId, bookId, seconds, startedAtMs, endedAtMs, source };
}

function formatDayKey(timestampMs: number) {
  const parts = dayKeyFormatter.formatToParts(new Date(timestampMs));
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  if (!year || !month || !day) throw new ReadingAnalyticsLoadError("A trend date could not be formatted.");
  return `${year}-${month}-${day}`;
}

function displayDay(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return displayDayFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function humanizeBookId(bookId: string) {
  const value = bookId.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return "Catalog title unavailable";
  return value.replace(/\b\w/g, character => character.toUpperCase());
}

async function readWindowRows(nowIso: string, windowStartIso: string) {
  const supabase = createSupabaseAdminClient();
  const countResult = await supabase
    .from("reading_sessions")
    .select("id", { count: "exact", head: true })
    .in("source", [...ANALYTICS_SOURCES])
    .gte("ended_at", windowStartIso)
    .lte("ended_at", nowIso);

  if (countResult.error) throw new ReadingAnalyticsLoadError(`reading_sessions count failed: ${countResult.error.code || "unknown"}`);
  if (!Number.isSafeInteger(countResult.count) || (countResult.count ?? -1) < 0) throw new ReadingAnalyticsLoadError("reading_sessions returned no trustworthy count.");
  const rowCount = countResult.count ?? 0;
  if (rowCount > MAX_WINDOW_ROWS) {
    throw new ReadingAnalyticsLoadError(
      `The analytics window contained ${rowCount} rows, above the ${MAX_WINDOW_ROWS} row safety limit.`,
      "The last 30 days contain more activity than this report can safely total. No partial totals are shown.",
    );
  }

  const rows: ReadingSessionRow[] = [];
  for (let offset = 0; offset < rowCount; offset += PAGE_SIZE) {
    const result = await supabase
      .from("reading_sessions")
      .select("id,user_id,book_id,seconds,started_at,ended_at,source")
      .in("source", [...ANALYTICS_SOURCES])
      .gte("ended_at", windowStartIso)
      .lte("ended_at", nowIso)
      .order("id", { ascending: true })
      .range(offset, Math.min(offset + PAGE_SIZE - 1, rowCount - 1));

    if (result.error) throw new ReadingAnalyticsLoadError(`reading_sessions page failed: ${result.error.code || "unknown"}`);
    for (const row of result.data || []) rows.push(parseSessionRow(row));
  }

  if (rows.length !== rowCount) {
    throw new ReadingAnalyticsLoadError(
      `reading_sessions changed while loading: expected ${rowCount}, received ${rows.length}.`,
      "Reading activity changed while this report was loading. Refresh to try again; no partial totals are shown.",
    );
  }
  return rows;
}

async function readBookTitles(bookIds: string[]) {
  if (!bookIds.length) return new Map<string, string>();
  const supabase = createSupabaseAdminClient();
  const titles = new Map<string, string>();

  for (let offset = 0; offset < bookIds.length; offset += BOOK_LOOKUP_CHUNK_SIZE) {
    const chunk = bookIds.slice(offset, offset + BOOK_LOOKUP_CHUNK_SIZE);
    const result = await supabase.from("book_catalog").select("id,title").in("id", chunk);
    if (result.error) throw new ReadingAnalyticsLoadError(`book_catalog title lookup failed: ${result.error.code || "unknown"}`);

    for (const value of result.data || []) {
      if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.title !== "string" || !value.title.trim()) {
        throw new ReadingAnalyticsLoadError("book_catalog returned an invalid title row.");
      }
      if (titles.has(value.id)) throw new ReadingAnalyticsLoadError("book_catalog returned a duplicate title row.");
      titles.set(value.id, value.title.trim());
    }
  }
  return titles;
}

type MutableBookMetrics = {
  bookId: string;
  engagedSeconds7d: number;
  engagedSeconds30d: number;
  qualifiedReads30d: number;
  readers: Set<string>;
  lastActivityMs: number;
};

type MutableTrendMetrics = {
  engagedSeconds: number;
  qualifiedReads: number;
  readers: Set<string>;
};

async function loadReadingAnalytics(now: Date): Promise<ReadingAnalyticsAvailable> {
  if (!hasSupabaseAdminConfig()) {
    throw new ReadingAnalyticsLoadError(
      "Supabase admin configuration is missing.",
      "Reading analytics are unavailable because the Workshop's private data connection is not configured. No totals are shown.",
    );
  }

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new ReadingAnalyticsLoadError("The report clock was invalid.");
  const windowStartMs = nowMs - ANALYTICS_WINDOW_DAYS * DAY_MS;
  const recentStartMs = nowMs - RECENT_WINDOW_DAYS * DAY_MS;
  const nowIso = now.toISOString();
  const windowStartIso = new Date(windowStartMs).toISOString();
  const rows = await readWindowRows(nowIso, windowStartIso);
  const bookIds = [...new Set(rows.map(row => row.bookId))].sort((left, right) => left.localeCompare(right));
  const titles = await readBookTitles(bookIds);

  const overallReaders = new Set<string>();
  const byBook = new Map<string, MutableBookMetrics>();
  const byDay = new Map<string, MutableTrendMetrics>();
  let engagedSeconds7d = 0;
  let engagedSeconds30d = 0;
  let qualifiedReads30d = 0;

  for (const row of rows) {
    overallReaders.add(row.userId);
    const book = byBook.get(row.bookId) || {
      bookId: row.bookId,
      engagedSeconds7d: 0,
      engagedSeconds30d: 0,
      qualifiedReads30d: 0,
      readers: new Set<string>(),
      lastActivityMs: row.endedAtMs,
    };
    const dayKey = formatDayKey(row.endedAtMs);
    const day = byDay.get(dayKey) || { engagedSeconds: 0, qualifiedReads: 0, readers: new Set<string>() };

    book.readers.add(row.userId);
    book.lastActivityMs = Math.max(book.lastActivityMs, row.endedAtMs);
    day.readers.add(row.userId);

    if (row.source === "reader_engaged_minute") {
      engagedSeconds30d += row.seconds;
      book.engagedSeconds30d += row.seconds;
      day.engagedSeconds += row.seconds;
      if (row.endedAtMs >= recentStartMs) {
        engagedSeconds7d += row.seconds;
        book.engagedSeconds7d += row.seconds;
      }
    } else {
      qualifiedReads30d += 1;
      book.qualifiedReads30d += 1;
      day.qualifiedReads += 1;
    }

    byBook.set(row.bookId, book);
    byDay.set(dayKey, day);
  }

  const trendKeys = new Set<string>();
  for (let cursor = windowStartMs; cursor <= nowMs; cursor += DAY_MS) trendKeys.add(formatDayKey(cursor));
  trendKeys.add(formatDayKey(nowMs));
  for (const key of byDay.keys()) trendKeys.add(key);

  const trend = [...trendKeys]
    .sort((left, right) => left.localeCompare(right))
    .map<ReadingAnalyticsTrendPoint>(date => {
      const day = byDay.get(date);
      return {
        date,
        label: displayDay(date),
        engagedMinutes: (day?.engagedSeconds || 0) / 60,
        qualifiedReads: day?.qualifiedReads || 0,
        uniqueReaders: day?.readers.size || 0,
      };
    });

  const books = [...byBook.values()]
    .map<ReadingAnalyticsBookRow>(book => ({
      bookId: book.bookId,
      title: titles.get(book.bookId) || humanizeBookId(book.bookId),
      titleAvailable: titles.has(book.bookId),
      engagedMinutes7d: book.engagedSeconds7d / 60,
      engagedMinutes30d: book.engagedSeconds30d / 60,
      qualifiedReads30d: book.qualifiedReads30d,
      uniqueReaders30d: book.readers.size,
      lastActivityAt: new Date(book.lastActivityMs).toISOString(),
    }))
    .sort((left, right) => (
      right.engagedMinutes30d - left.engagedMinutes30d
      || right.qualifiedReads30d - left.qualifiedReads30d
      || right.uniqueReaders30d - left.uniqueReaders30d
      || left.title.localeCompare(right.title)
    ));

  const top = books[0] || null;
  return {
    status: "available",
    generatedAt: nowIso,
    windowStart: windowStartIso,
    coverage: COVERAGE,
    eventRows30d: rows.length,
    summary: {
      engagedMinutes7d: engagedSeconds7d / 60,
      engagedMinutes30d: engagedSeconds30d / 60,
      qualifiedReads30d,
      uniqueReaders30d: overallReaders.size,
      topBook30d: top ? {
        bookId: top.bookId,
        title: top.title,
        engagedMinutes: top.engagedMinutes30d,
        qualifiedReads: top.qualifiedReads30d,
      } : null,
    },
    trend,
    books,
  };
}

export async function readReadingAnalytics(): Promise<ReadingAnalyticsResult> {
  const now = new Date();
  try {
    return await loadReadingAnalytics(now);
  } catch (error) {
    const failure = error instanceof ReadingAnalyticsLoadError
      ? error
      : new ReadingAnalyticsLoadError(error instanceof Error ? error.message : "Unknown reading analytics failure.");
    console.warn(JSON.stringify({
      level: "warn",
      message: "Reading analytics load failed",
      reason: failure.message,
    }));
    return {
      status: "unavailable",
      generatedAt: now.toISOString(),
      coverage: COVERAGE,
      message: failure.safeMessage,
    };
  }
}
