export const READER_DATA_OWNER_KEY = "jju.readerData.owner.v1";

const READER_DATA_KEYS = [
  "jju.account",
  "jju.readBooks",
  "jju.readerProgress",
  "jju.readingEvents",
  "jju.completedBooks.sync.v1",
  "jju.actualReadingSeconds",
  "jju.readingHistory",
  "jju.readerBookmarks",
  "jju.readerNotes",
  "jju.readerQuotes",
  "jju.savedBooks",
  "jju.savedBooks.sync.v1",
] as const;

export type ReaderDataScopeResult = "guest-adopted" | "same-account" | "account-switched";

let memoryOwner = "";
let accountSwitchRevision = 0;

function safeGet(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function safeRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* In-memory ownership still protects this tab. */ }
}

function storedAccountEmail() {
  try {
    const parsed = JSON.parse(safeGet("jju.account") || "null") as { email?: unknown } | null;
    return typeof parsed?.email === "string" ? parsed.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

function dispatchReaderDataEvents() {
  try { window.dispatchEvent(new Event("jju-account")); } catch { /* Optional UI notification. */ }
  try { window.dispatchEvent(new Event("jju-reading-history")); } catch { /* Optional UI notification. */ }
  try { window.dispatchEvent(new Event("jju-saved-books")); } catch { /* Optional UI notification. */ }
}

function removeGuestTombstones() {
  try {
    const parsed = JSON.parse(safeGet("jju.completedBooks.sync.v1") || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const active = Object.fromEntries(
        Object.entries(parsed as Record<string, { completed?: unknown }>).filter(([, entry]) => entry?.completed !== false),
      );
      safeSet("jju.completedBooks.sync.v1", JSON.stringify(active));
    }
  } catch {
    safeRemove("jju.completedBooks.sync.v1");
  }

  try {
    const parsed = JSON.parse(safeGet("jju.savedBooks.sync.v1") || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const active = Object.fromEntries(
        Object.entries(parsed as Record<string, { saved?: unknown }>).filter(([, entry]) => entry?.saved !== false),
      );
      safeSet("jju.savedBooks.sync.v1", JSON.stringify(active));
    }
  } catch {
    safeRemove("jju.savedBooks.sync.v1");
  }
}

export function currentReaderDataOwner() {
  if (typeof window === "undefined") return "";
  const storedOwner = safeGet(READER_DATA_OWNER_KEY) || "";
  if (storedOwner) memoryOwner = storedOwner;
  return storedOwner || memoryOwner;
}

export function readerDataBelongsTo(userId: string) {
  return Boolean(userId) && currentReaderDataOwner() === userId;
}

export function readerDataAccountSwitchRevision() {
  return accountSwitchRevision;
}

export function clearReaderLocalData({ removeOwner = false }: { removeOwner?: boolean } = {}) {
  if (typeof window === "undefined") return;
  for (const key of READER_DATA_KEYS) safeRemove(key);
  if (removeOwner) {
    safeRemove(READER_DATA_OWNER_KEY);
    memoryOwner = "";
  }
  dispatchReaderDataEvents();
}

export function prepareReaderDataScope(userId: string, email = ""): ReaderDataScopeResult {
  if (typeof window === "undefined" || !userId) return "same-account";
  const owner = currentReaderDataOwner();
  if (!owner) {
    const previousEmail = storedAccountEmail();
    const nextEmail = email.trim().toLowerCase();
    if (previousEmail && nextEmail && previousEmail !== nextEmail) {
      clearReaderLocalData();
      accountSwitchRevision += 1;
      memoryOwner = userId;
      safeSet(READER_DATA_OWNER_KEY, userId);
      dispatchReaderDataEvents();
      return "account-switched";
    }
    // Positive guest activity can seed the first verified account. A guest
    // deletion has no account context, so it must never erase cloud data.
    removeGuestTombstones();
    memoryOwner = userId;
    safeSet(READER_DATA_OWNER_KEY, userId);
    dispatchReaderDataEvents();
    return "guest-adopted";
  }
  if (owner === userId) return "same-account";

  clearReaderLocalData();
  accountSwitchRevision += 1;
  memoryOwner = userId;
  safeSet(READER_DATA_OWNER_KEY, userId);
  dispatchReaderDataEvents();
  return "account-switched";
}

export function removeReaderDataOwner() {
  if (typeof window === "undefined") return;
  safeRemove(READER_DATA_OWNER_KEY);
  memoryOwner = "";
}
