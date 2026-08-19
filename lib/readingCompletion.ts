import { canonicalBookId } from "@/lib/bookAliases";

export const READ_BOOKS_KEY = "jju.readBooks";
export const READ_EVENTS_KEY = "jju.readingEvents";
export const COMPLETION_SYNC_KEY = "jju.completedBooks.sync.v1";

export type CompletionStateEntry = {
  completed: boolean;
  updatedAt: string;
};

export type CompletionState = Record<string, CompletionStateEntry>;

function parseTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

function isNewer(left: string, right: string) {
  return Date.parse(left || "1970-01-01") > Date.parse(right || "1970-01-01");
}

export function readCompletionState(): CompletionState {
  if (typeof window === "undefined") return {};
  const state: CompletionState = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(COMPLETION_SYNC_KEY) || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [storedId, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
        if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
        const bookId = canonicalBookId(storedId);
        const entry = rawEntry as Partial<CompletionStateEntry>;
        const candidate = { completed: entry.completed !== false, updatedAt: parseTimestamp(entry.updatedAt) };
        if (bookId && (!state[bookId] || isNewer(candidate.updatedAt, state[bookId].updatedAt))) state[bookId] = candidate;
      }
    }
  } catch {
    // The legacy completion list remains the recovery source.
  }

  const eventTimes = new Map<string, string>();
  try {
    const events = JSON.parse(localStorage.getItem(READ_EVENTS_KEY) || "[]") as unknown;
    if (Array.isArray(events)) {
      for (const event of events) {
        if (!event || typeof event !== "object") continue;
        const item = event as { bookId?: unknown; finishedAt?: unknown };
        const bookId = canonicalBookId(String(item.bookId || ""));
        const finishedAt = parseTimestamp(item.finishedAt);
        if (bookId && isNewer(finishedAt, eventTimes.get(bookId) || "")) eventTimes.set(bookId, finishedAt);
      }
    }
  } catch {
    // Missing event history only removes a legacy timestamp hint.
  }

  try {
    const completed = JSON.parse(localStorage.getItem(READ_BOOKS_KEY) || "[]") as unknown;
    if (Array.isArray(completed)) {
      for (const storedId of completed) {
        const bookId = canonicalBookId(String(storedId));
        if (!bookId || state[bookId]) continue;
        state[bookId] = { completed: true, updatedAt: eventTimes.get(bookId) || "" };
      }
    }
  } catch {
    // Invalid legacy data behaves like an empty list.
  }
  return state;
}

export function writeCompletionState(state: CompletionState) {
  if (typeof window === "undefined") return;
  const normalized: CompletionState = {};
  for (const [storedId, entry] of Object.entries(state)) {
    const bookId = canonicalBookId(storedId);
    if (!bookId) continue;
    const candidate = { completed: entry.completed, updatedAt: parseTimestamp(entry.updatedAt) };
    if (!normalized[bookId] || isNewer(candidate.updatedAt, normalized[bookId].updatedAt)) normalized[bookId] = candidate;
  }
  const completed = Object.entries(normalized)
    .filter(([, entry]) => entry.completed)
    .map(([bookId]) => bookId)
    .sort();
  localStorage.setItem(COMPLETION_SYNC_KEY, JSON.stringify(normalized));
  localStorage.setItem(READ_BOOKS_KEY, JSON.stringify(completed));
}

export function updateCompletionState(bookId: string, completed: boolean, updatedAt = new Date().toISOString()) {
  const canonicalId = canonicalBookId(bookId);
  if (!canonicalId) return readCompletionState();
  const state = readCompletionState();
  state[canonicalId] = { completed, updatedAt: parseTimestamp(updatedAt) || new Date().toISOString() };
  writeCompletionState(state);
  return state;
}

export function completionSet(state = readCompletionState()) {
  return new Set(Object.entries(state).filter(([, entry]) => entry.completed).map(([bookId]) => bookId));
}

export function completionEntryIsNewer(left: CompletionStateEntry, right: CompletionStateEntry) {
  return isNewer(left.updatedAt, right.updatedAt);
}
