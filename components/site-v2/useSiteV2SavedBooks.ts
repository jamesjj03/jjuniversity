"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { canonicalBookId } from "@/lib/bookAliases";
import { SITE_V2_SAVED_KEY } from "@/lib/siteV2";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import {
  currentReaderDataOwner,
  prepareReaderDataScope,
  readerDataAccountSwitchRevision,
  readerDataBelongsTo,
} from "@/lib/readerDataOwnership";

const SAVED_STATE_KEY = "jju.savedBooks.sync.v1";
const SAVED_EVENT = "jju-saved-books";
const SYNC_EVENT = "jju-cloud-sync";
const EMPTY_SAVED_IDS = new Set<string>();
const subscribers = new Set<() => void>();
const statusSubscribers = new Set<() => void>();

type SavedStateEntry = {
  saved: boolean;
  updatedAt: string;
};

type SavedState = Record<string, SavedStateEntry>;
export type SavedBooksSyncStatus = "local" | "syncing" | "synced" | "retrying";

let listening = false;
let cachedSignature = "";
let cachedSavedIds = EMPTY_SAVED_IDS;
let cachedState: SavedState = {};
let cachedOwner = "";
let cachedAccountSwitchRevision = readerDataAccountSwitchRevision();
let syncStatus: SavedBooksSyncStatus = "local";
let syncStarted = false;
let syncPromise: Promise<void> | null = null;
let syncUserId = "";
let authSubscription: { unsubscribe: () => void } | null = null;
let cloudConsumerCount = 0;
let cloudSyncGeneration = 0;

function safeStorageGet(key: string) {
  try { return window.localStorage.getItem(key); } catch { return undefined; }
}

function safeStorageSet(key: string, value: string) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

function safeStorageRemove(key: string) {
  try { window.localStorage.removeItem(key); return true; } catch { return false; }
}

function safeDispatch(event: Event) {
  try { window.dispatchEvent(event); } catch { /* Sync remains functional without UI events. */ }
}

function validTimestamp(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return Number.isFinite(Date.parse(value)) ? value : "";
}

function newerThan(left: string, right: string) {
  return Date.parse(left || "1970-01-01") > Date.parse(right || "1970-01-01");
}

function preferredSavedEntry(left: SavedStateEntry | undefined, right: SavedStateEntry) {
  if (!left) return right;
  if (newerThan(left.updatedAt, right.updatedAt)) return left;
  if (newerThan(right.updatedAt, left.updatedAt)) return right;
  // Match the database tie-breaker: an unsave wins when timestamps are equal.
  return left.saved === false ? left : right;
}

function readSavedState() {
  if (typeof window === "undefined") return {};
  const switchRevision = readerDataAccountSwitchRevision();
  if (switchRevision !== cachedAccountSwitchRevision) {
    cachedState = {};
    cachedSavedIds = EMPTY_SAVED_IDS;
    cachedSignature = "";
    cachedAccountSwitchRevision = switchRevision;
  }
  const owner = currentReaderDataOwner();
  if (cachedOwner && owner && cachedOwner !== owner) {
    cachedState = {};
    cachedSavedIds = EMPTY_SAVED_IDS;
    cachedSignature = "";
  }
  if (owner) cachedOwner = owner;
  const legacyStored = safeStorageGet(SITE_V2_SAVED_KEY);
  const stateStored = safeStorageGet(SAVED_STATE_KEY);
  if (legacyStored === undefined || stateStored === undefined) return cachedState;
  const legacyRaw = legacyStored || "[]";
  const stateRaw = stateStored || "{}";
  const signature = `${legacyRaw}\n${stateRaw}`;
  if (signature === cachedSignature) return cachedState;

  const next: SavedState = {};
  try {
    const value = JSON.parse(stateRaw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [storedId, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const canonicalId = canonicalBookId(storedId);
        if (!canonicalId) continue;
        const candidate = entry as Partial<SavedStateEntry>;
        const normalized = {
          saved: candidate.saved !== false,
          updatedAt: validTimestamp(candidate.updatedAt),
        };
        if (!next[canonicalId] || newerThan(normalized.updatedAt, next[canonicalId].updatedAt)) next[canonicalId] = normalized;
      }
    }
  } catch {
    // The legacy list below remains the recovery source.
  }

  try {
    const legacy = JSON.parse(legacyRaw) as unknown;
    if (Array.isArray(legacy)) {
      for (const value of legacy) {
        const canonicalId = canonicalBookId(String(value));
        if (canonicalId && !next[canonicalId]) next[canonicalId] = { saved: true, updatedAt: "" };
      }
    }
  } catch {
    // Invalid local data behaves like an empty list.
  }

  cachedSignature = signature;
  cachedState = next;
  cachedSavedIds = new Set(Object.entries(next).filter(([, entry]) => entry.saved).map(([bookId]) => bookId));
  return next;
}

function readSavedIds() {
  readSavedState();
  return cachedSavedIds;
}

function writeSavedState(state: SavedState) {
  const normalized: SavedState = {};
  for (const [storedId, entry] of Object.entries(state)) {
    const canonicalId = canonicalBookId(storedId);
    if (!canonicalId) continue;
    if (!normalized[canonicalId] || newerThan(entry.updatedAt, normalized[canonicalId].updatedAt)) {
      normalized[canonicalId] = { saved: entry.saved, updatedAt: validTimestamp(entry.updatedAt) };
    }
  }
  const savedIds = Object.entries(normalized).filter(([, entry]) => entry.saved).map(([bookId]) => bookId).sort();
  const stateWritten = safeStorageSet(SAVED_STATE_KEY, JSON.stringify(normalized));
  const legacyWritten = safeStorageSet(SITE_V2_SAVED_KEY, JSON.stringify(savedIds));
  cachedState = normalized;
  cachedSavedIds = new Set(savedIds);
  cachedSignature = stateWritten && legacyWritten ? "" : "memory";
  notifySubscribers(stateWritten && legacyWritten);
}

function setSyncStatus(next: SavedBooksSyncStatus) {
  if (syncStatus === next) return;
  syncStatus = next;
  statusSubscribers.forEach(notify => notify());
  safeDispatch(new CustomEvent(SYNC_EVENT, { detail: { area: "saved-books", status: next } }));
}

function notifySubscribers(invalidate = true) {
  if (invalidate) cachedSignature = "";
  subscribers.forEach(notify => notify());
}

function handleStorage(event: StorageEvent) {
  if (event.key && event.key !== SITE_V2_SAVED_KEY && event.key !== SAVED_STATE_KEY) return;
  notifySubscribers();
}

function handleSavedEvent() {
  notifySubscribers();
}

function startListening() {
  if (listening) return;
  window.addEventListener("storage", handleStorage);
  window.addEventListener(SAVED_EVENT, handleSavedEvent);
  listening = true;
}

function stopListening() {
  if (!listening) return;
  window.removeEventListener("storage", handleStorage);
  window.removeEventListener(SAVED_EVENT, handleSavedEvent);
  listening = false;
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  startListening();
  return () => {
    subscribers.delete(notify);
    if (!subscribers.size) stopListening();
  };
}

function subscribeStatus(notify: () => void) {
  statusSubscribers.add(notify);
  return () => statusSubscribers.delete(notify);
}

async function verifiedUser() {
  if (!hasSupabaseConfig()) return null;
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email_confirmed_at) return null;
  return data.user;
}

async function pushSavedEntry(userId: string, bookId: string, entry: SavedStateEntry) {
  const supabase = createSupabaseBrowserClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("saved_books").upsert({
    user_id: userId,
    book_id: canonicalBookId(bookId),
    is_saved: entry.saved,
    saved_at: entry.saved ? entry.updatedAt || now : now,
    state_changed_at: entry.updatedAt || now,
  }, { onConflict: "user_id,book_id" }).select("book_id,is_saved,state_changed_at").single();
  if (error) throw error;
  return data;
}

async function reconcileSavedBooks(userId: string, email = "") {
  if (syncPromise) {
    if (syncUserId === userId) return syncPromise;
    await syncPromise;
    return reconcileSavedBooks(userId, email);
  }
  prepareReaderDataScope(userId, email);
  syncUserId = userId;
  syncPromise = (async () => {
    setSyncStatus("syncing");
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.from("saved_books").select("book_id,is_saved,state_changed_at");
    if (error) throw error;
    if (!readerDataBelongsTo(userId)) return;

    const local = { ...readSavedState() };
    const remote: SavedState = {};
    for (const row of data || []) {
      const canonicalId = canonicalBookId(String(row.book_id || ""));
      if (!canonicalId) continue;
      const candidate = { saved: row.is_saved !== false, updatedAt: validTimestamp(row.state_changed_at) };
      if (!remote[canonicalId] || newerThan(candidate.updatedAt, remote[canonicalId].updatedAt)) remote[canonicalId] = candidate;
    }

    const now = new Date().toISOString();
    const uploads: Array<Promise<{ bookId: string; entry: SavedStateEntry }>> = [];
    for (const bookId of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const localEntry = local[bookId];
      const remoteEntry = remote[bookId];
      if (!localEntry && remoteEntry) {
        local[bookId] = remoteEntry;
      } else if (localEntry && !remoteEntry) {
        const uploadEntry = { ...localEntry, updatedAt: localEntry.updatedAt || now };
        local[bookId] = uploadEntry;
        uploads.push(pushSavedEntry(userId, bookId, uploadEntry).then(row => ({
          bookId,
          entry: {
            saved: row?.is_saved !== false,
            updatedAt: validTimestamp(row?.state_changed_at) || uploadEntry.updatedAt,
          },
        })));
      } else if (localEntry && remoteEntry && newerThan(remoteEntry.updatedAt, localEntry.updatedAt)) {
        local[bookId] = remoteEntry;
      } else if (localEntry && remoteEntry && newerThan(localEntry.updatedAt, remoteEntry.updatedAt)) {
        uploads.push(pushSavedEntry(userId, bookId, localEntry).then(row => ({
          bookId,
          entry: {
            saved: row?.is_saved !== false,
            updatedAt: validTimestamp(row?.state_changed_at) || localEntry.updatedAt,
          },
        })));
      }
    }

    const uploadedRows = await Promise.all(uploads);
    if (!readerDataBelongsTo(userId)) return;
    for (const { bookId, entry } of uploadedRows) {
      local[bookId] = preferredSavedEntry(local[bookId], entry);
    }

    // Preserve a same-tab toggle made while reconciliation was in flight.
    const current = readSavedState();
    for (const [bookId, entry] of Object.entries(current)) {
      local[bookId] = preferredSavedEntry(local[bookId], entry);
    }
    writeSavedState(local);
    setSyncStatus("synced");
  })().catch(() => {
    setSyncStatus("retrying");
  }).finally(() => {
    syncPromise = null;
    syncUserId = "";
  });
  return syncPromise;
}

async function handleAuth(_event: AuthChangeEvent, session: Session | null) {
  const user = session?.user;
  if (!user?.email_confirmed_at) {
    setSyncStatus("local");
    return;
  }
  prepareReaderDataScope(user.id, user.email || "");
  await reconcileSavedBooks(user.id, user.email || "");
}

function startCloudSync() {
  if (syncStarted || !hasSupabaseConfig()) return;
  syncStarted = true;
  const generation = ++cloudSyncGeneration;
  let authEventSerial = 0;
  const supabase = createSupabaseBrowserClient();
  void supabase.auth.getSession().then(({ data }) => {
    if (syncStarted && generation === cloudSyncGeneration && authEventSerial === 0) void handleAuth("INITIAL_SESSION", data.session);
  });
  authSubscription = supabase.auth.onAuthStateChange((event, session) => {
    authEventSerial += 1;
    const eventSerial = authEventSerial;
    window.setTimeout(() => {
      if (syncStarted && generation === cloudSyncGeneration && eventSerial === authEventSerial) void handleAuth(event, session);
    }, 0);
  }).data.subscription;
  window.addEventListener("online", retrySavedBooksSync);
}

function stopCloudSync() {
  authSubscription?.unsubscribe();
  authSubscription = null;
  syncStarted = false;
  cloudSyncGeneration += 1;
  window.removeEventListener("online", retrySavedBooksSync);
}

export function useSiteV2SavedBookIds() {
  useEffect(() => {
    cloudConsumerCount += 1;
    startCloudSync();
    return () => {
      cloudConsumerCount = Math.max(0, cloudConsumerCount - 1);
      if (!cloudConsumerCount) stopCloudSync();
    };
  }, []);
  return useSyncExternalStore(subscribe, readSavedIds, () => EMPTY_SAVED_IDS);
}

export function useSiteV2SavedBooksSyncStatus() {
  useEffect(() => {
    cloudConsumerCount += 1;
    startCloudSync();
    return () => {
      cloudConsumerCount = Math.max(0, cloudConsumerCount - 1);
      if (!cloudConsumerCount) stopCloudSync();
    };
  }, []);
  return useSyncExternalStore(subscribeStatus, () => syncStatus, () => "local" as SavedBooksSyncStatus);
}

export function retrySavedBooksSync() {
  void verifiedUser().then(user => {
    if (user) void reconcileSavedBooks(user.id, user.email || "");
  });
}

export function toggleSiteV2SavedBook(bookId: string) {
  const canonicalId = canonicalBookId(bookId);
  if (!canonicalId) return;
  const next = { ...readSavedState() };
  const entry = { saved: !(next[canonicalId]?.saved ?? false), updatedAt: new Date().toISOString() };
  next[canonicalId] = entry;

  try {
    writeSavedState(next);
  } catch {
    return;
  }

  void verifiedUser().then(async user => {
    if (!user) return;
    const scope = prepareReaderDataScope(user.id, user.email || "");
    if (scope !== "same-account") {
      await reconcileSavedBooks(user.id, user.email || "");
      return;
    }
    try {
      setSyncStatus("syncing");
      const row = await pushSavedEntry(user.id, canonicalId, entry);
      const current = { ...readSavedState() };
      if (current[canonicalId]?.updatedAt === entry.updatedAt) {
        current[canonicalId] = {
          saved: row?.is_saved !== false,
          updatedAt: validTimestamp(row?.state_changed_at) || entry.updatedAt,
        };
        writeSavedState(current);
      }
      setSyncStatus("synced");
    } catch {
      setSyncStatus("retrying");
    }
  });
}

export function clearLocalSavedBooksSyncState() {
  try {
    safeStorageRemove(SITE_V2_SAVED_KEY);
    safeStorageRemove(SAVED_STATE_KEY);
    cachedState = {};
    cachedSavedIds = EMPTY_SAVED_IDS;
    cachedOwner = currentReaderDataOwner();
    cachedSignature = "memory";
    notifySubscribers(false);
  } catch {
    return;
  }
}

export async function clearSiteV2SavedBooksEverywhere() {
  const now = new Date().toISOString();
  const user = await verifiedUser();
  const owner = currentReaderDataOwner();

  if (!user && !owner) {
    clearLocalSavedBooksSyncState();
    setSyncStatus("local");
    return;
  }

  if (user) prepareReaderDataScope(user.id, user.email || "");
  const next = { ...readSavedState() };

  for (const bookId of Object.keys(next)) next[bookId] = { saved: false, updatedAt: now };
  writeSavedState(next);

  if (user) {
    setSyncStatus("syncing");
    const supabase = createSupabaseBrowserClient();
    const clearResult = await supabase.rpc("clear_saved_books", { expected_user_id: user.id });
    if (clearResult.error) {
      setSyncStatus("retrying");
      throw clearResult.error;
    }
    const { data, error } = await supabase.from("saved_books").select("book_id,is_saved,state_changed_at");
    if (error) throw error;
    if (!readerDataBelongsTo(user.id)) throw new Error("The signed-in account changed before Saved Books could be cleared.");
    for (const row of data || []) {
      const canonicalId = canonicalBookId(String(row.book_id || ""));
      if (canonicalId) next[canonicalId] = {
        saved: false,
        updatedAt: validTimestamp(row.state_changed_at) || now,
      };
    }
    writeSavedState(next);
  }

  if (!user || !Object.keys(next).length) {
    setSyncStatus(user ? "synced" : "local");
    return;
  }
  setSyncStatus("synced");
}

export const SITE_V2_SAVED_SYNC_KEY = SAVED_STATE_KEY;
