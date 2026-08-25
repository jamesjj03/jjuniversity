"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";
import { readPreferencesV2 } from "@/lib/preferencesV2";
import { canonicalBookId } from "@/lib/bookAliases";
import { safeAuthReturnPath } from "@/lib/authReturnPath";
import {
  clearSiteV2SavedBooksEverywhere,
  retrySavedBooksSync,
  SITE_V2_SAVED_SYNC_KEY,
} from "@/components/site-v2/useSiteV2SavedBooks";
import { SITE_V2_SAVED_KEY } from "@/lib/siteV2";
import {
  COMPLETION_SYNC_KEY,
  completionEntryIsNewer,
  completionSet,
  readCompletionState,
  writeCompletionState,
  type CompletionState,
} from "@/lib/readingCompletion";
import {
  prepareReaderDataScope,
  readerDataBelongsTo,
  removeReaderDataOwner,
} from "@/lib/readerDataOwnership";

type Book = {
  id: string;
  title?: string;
  readingMinutes?: number | null;
};

type ReadEvent = {
  bookId: string;
  finishedAt: string;
};

type LocalAccount = {
  name?: string;
  email?: string;
};

type CloudProgress = {
  book_id: string;
  section_index: number;
  actual_seconds?: number | null;
  last_read_at?: string | null;
};

type CloudCompletedBook = {
  book_id: string;
  is_completed?: boolean | null;
  completed_at?: string | null;
  state_changed_at?: string | null;
  updated_at?: string | null;
};

type ReadingHistoryItem = {
  bookId: string;
  requestedId?: string;
  title?: string;
  sectionIndex?: number;
  sectionTitle?: string;
  actualSeconds?: number;
  updatedAt?: string;
};

type AccountClientProps = {
  variant?: "default" | "site-v2";
  returnPath?: string;
  initialMessage?: string;
};

const ACCOUNT_KEY = "jju.account";
const READ_KEY = "jju.readBooks";
const PROGRESS_KEY = "jju.readerProgress";
const READ_EVENTS_KEY = "jju.readingEvents";
const ACTUAL_TIME_KEY = "jju.actualReadingSeconds";
const HISTORY_KEY = "jju.readingHistory";
const BOOKMARKS_KEY = "jju.readerBookmarks";
const NOTES_KEY = "jju.readerNotes";
const QUOTES_KEY = "jju.readerQuotes";

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
}

function canonicalizeNumericRecord(record: Record<string, number>) {
  const result: Record<string, number> = {};
  for (const [storedId, value] of Object.entries(record)) {
    const canonicalId = canonicalBookId(storedId);
    if (!canonicalId) continue;
    result[canonicalId] = Math.max(result[canonicalId] || 0, Number(value) || 0);
  }
  return result;
}

function readLocalAccount(): LocalAccount | null {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null") as LocalAccount | null;
  } catch {
    return null;
  }
}

function writeLocalAccount(account: LocalAccount | null) {
  if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  else localStorage.removeItem(ACCOUNT_KEY);
  window.dispatchEvent(new Event("jju-account"));
}

function minutesLabel(minutes: number) {
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  return `${hours} hr${mins ? ` ${mins} min` : ""}`;
}

function isVerified(user: User | null) {
  return Boolean(user?.email_confirmed_at);
}

function clearLocalReadingMemory() {
  localStorage.removeItem(READ_KEY);
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(READ_EVENTS_KEY);
  localStorage.removeItem(COMPLETION_SYNC_KEY);
  localStorage.removeItem(ACTUAL_TIME_KEY);
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(BOOKMARKS_KEY);
  localStorage.removeItem(NOTES_KEY);
  localStorage.removeItem(QUOTES_KEY);
  localStorage.removeItem(SITE_V2_SAVED_KEY);
  localStorage.removeItem(SITE_V2_SAVED_SYNC_KEY);
  window.dispatchEvent(new Event("jju-account"));
  window.dispatchEvent(new Event("jju-reading-history"));
  window.dispatchEvent(new Event("jju-saved-books"));
}

function firstSupabaseError(results: unknown[]) {
  for (const result of results) {
    if (!result || typeof result !== "object" || !("error" in result)) continue;
    const error = (result as { error?: { message?: string } | null }).error;
    if (error) return error.message || "A cloud reading-data request failed.";
  }
  return "";
}

export default function AccountClient({
  variant = "default",
  returnPath = "/account",
  initialMessage = "",
}: AccountClientProps = {}) {
  const PageRoot = variant === "site-v2" ? "div" : "main";
  const supabase = useMemo(() => hasSupabaseConfig() ? createSupabaseBrowserClient() : null, []);
  const [books, setBooks] = useState<Book[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [readBooks, setReadBooks] = useState<Set<string>>(new Set());
  const [, setProgress] = useState<Record<string, number>>({});
  const [, setEvents] = useState<ReadEvent[]>([]);
  const [cloudProgress, setCloudProgress] = useState<CloudProgress[]>([]);
  const [cloudCompleted, setCloudCompleted] = useState<CloudCompletedBook[]>([]);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const syncLocalToCloud = useCallback(async (nextUser: User) => {
    if (!supabase || !isVerified(nextUser)) return;
    prepareReaderDataScope(nextUser.id, nextUser.email || "");

    const rememberPlace = readPreferencesV2().saveProgress;
    const localCompletionState = readCompletionState();
    const localProgress = canonicalizeNumericRecord(readJson<Record<string, number>>(PROGRESS_KEY, {}));
    const localActualSeconds = canonicalizeNumericRecord(readJson<Record<string, number>>(ACTUAL_TIME_KEY, {}));
    const localHistory = readJson<ReadingHistoryItem[]>(HISTORY_KEY, []);
    const historyByBook = new Map<string, ReadingHistoryItem>();
    for (const item of localHistory) {
      if (!item.bookId) continue;
      const canonicalId = canonicalBookId(item.bookId);
      const current = historyByBook.get(canonicalId);
      if (current?.updatedAt && Date.parse(current.updatedAt) >= Date.parse(item.updatedAt || "")) continue;
      historyByBook.set(canonicalId, { ...item, bookId: canonicalId });
    }
    const now = new Date().toISOString();
    const progressRows = (rememberPlace ? Object.entries({ ...localProgress, ...localActualSeconds }) : [])
      .map(([bookId]) => {
        const sectionIndex = Number(localProgress[bookId] || 0);
        const actualSeconds = Number(localActualSeconds[bookId] || 0);
        if (!bookId || (!sectionIndex && !actualSeconds)) return null;
        return {
          user_id: nextUser.id,
          book_id: bookId,
          section_index: sectionIndex,
          actual_seconds: actualSeconds,
          last_read_at: historyByBook.get(bookId)?.updatedAt || now,
          updated_at: historyByBook.get(bookId)?.updatedAt || now,
        };
      })
      .filter((row): row is {
        user_id: string;
        book_id: string;
        section_index: number;
        actual_seconds: number;
        last_read_at: string;
        updated_at: string;
      } => Boolean(row));
    const completedRows = Object.entries(localCompletionState)
      .filter(([bookId]) => Boolean(bookId))
      .map(([bookId, entry]) => ({
        user_id: nextUser.id,
        book_id: bookId,
        is_completed: entry.completed,
        completed_at: entry.updatedAt || now,
        state_changed_at: entry.updatedAt || now,
      }));
    const syncResults = await Promise.all([
      progressRows.length
        ? supabase.from("reading_progress").upsert(progressRows, { onConflict: "user_id,book_id" })
        : Promise.resolve(),
      completedRows.length
        ? supabase.from("completed_books").upsert(completedRows, { onConflict: "user_id,book_id" })
        : Promise.resolve(),
    ]);
    const syncError = firstSupabaseError(syncResults);
    if (syncError) throw new Error(syncError);
  }, [supabase]);

  const loadCloud = useCallback(async (nextUser: User) => {
    if (!supabase) return;
    prepareReaderDataScope(nextUser.id, nextUser.email || "");
    const rememberPlace = readPreferencesV2().saveProgress;
    const [profileResult, progressResult, completedResult] = await Promise.all([
      supabase.from("profiles").select("display_name,email").eq("id", nextUser.id).maybeSingle(),
      supabase.from("reading_progress").select("book_id,section_index,actual_seconds,last_read_at"),
      supabase.from("completed_books").select("book_id,is_completed,completed_at,state_changed_at,updated_at"),
    ]);
    if (!readerDataBelongsTo(nextUser.id)) return;

    const profileName = String(profileResult.data?.display_name || nextUser.user_metadata?.display_name || nextUser.email || "JJU Reader");
    writeLocalAccount({ name: profileName, email: nextUser.email || "" });

    if (progressResult.error || completedResult.error) {
      setMessage("Supabase account tables are not set up yet.");
      return;
    }

    const localProgress = canonicalizeNumericRecord(readJson<Record<string, number>>(PROGRESS_KEY, {}));
    const localActualSeconds = canonicalizeNumericRecord(readJson<Record<string, number>>(ACTUAL_TIME_KEY, {}));
    const remoteProgress = progressResult.data || [];
    const remoteProgressByBook = new Map<string, CloudProgress>();
    for (const item of remoteProgress) {
      const canonicalId = canonicalBookId(item.book_id);
      const current = remoteProgressByBook.get(canonicalId);
      const currentDate = Date.parse(current?.last_read_at || "");
      const itemDate = Date.parse(item.last_read_at || "");
      remoteProgressByBook.set(canonicalId, {
        book_id: canonicalId,
        section_index: itemDate > currentDate ? Number(item.section_index || 0) : Number(current?.section_index || item.section_index || 0),
        actual_seconds: Math.max(Number(current?.actual_seconds || 0), Number(item.actual_seconds || 0)),
        last_read_at: itemDate > currentDate ? item.last_read_at : current?.last_read_at || item.last_read_at,
      });
    }
    const normalizedRemoteProgress = [...remoteProgressByBook.values()];
    const progressIds = new Set([
      ...Object.keys(localProgress),
      ...Object.keys(localActualSeconds),
      ...(rememberPlace ? remoteProgressByBook.keys() : []),
    ]);
    const mergedProgress: Record<string, number> = {};
    const mergedActualSeconds: Record<string, number> = {};
    const localHistoryByBook = new Map<string, ReadingHistoryItem>();
    for (const item of readJson<ReadingHistoryItem[]>(HISTORY_KEY, [])) {
      if (!item.bookId) continue;
      const canonicalId = canonicalBookId(item.bookId);
      const current = localHistoryByBook.get(canonicalId);
      if (!current?.updatedAt || Date.parse(item.updatedAt || "") > Date.parse(current.updatedAt)) {
        localHistoryByBook.set(canonicalId, { ...item, bookId: canonicalId });
      }
    }
    for (const bookId of progressIds) {
      const remote = remoteProgressByBook.get(bookId);
      const localHistory = localHistoryByBook.get(bookId);
      const remoteIsNewer = Date.parse(remote?.last_read_at || "") > Date.parse(localHistory?.updatedAt || "");
      const sectionIndex = remoteIsNewer
        ? Number(remote?.section_index || 0)
        : Number(localProgress[bookId] ?? remote?.section_index ?? 0);
      const actualSeconds = Math.max(Number(localActualSeconds[bookId] || 0), Number(remote?.actual_seconds || 0));
      if (sectionIndex) mergedProgress[bookId] = sectionIndex;
      if (actualSeconds) mergedActualSeconds[bookId] = actualSeconds;
    }

    const mergedCompletionState: CompletionState = { ...readCompletionState() };
    for (const item of (completedResult.data || []) as CloudCompletedBook[]) {
      const canonicalId = canonicalBookId(item.book_id);
      if (!canonicalId) continue;
      const candidate = {
        completed: item.is_completed !== false,
        updatedAt: item.state_changed_at || item.updated_at || item.completed_at || "",
      };
      const current = mergedCompletionState[canonicalId];
      if (!current || completionEntryIsNewer(candidate, current)) mergedCompletionState[canonicalId] = candidate;
    }
    const mergedCompleted = completionSet(mergedCompletionState);
    const historyByBook = new Map<string, ReadingHistoryItem>();
    for (const item of readJson<ReadingHistoryItem[]>(HISTORY_KEY, [])) {
      if (!item.bookId) continue;
      const canonicalId = canonicalBookId(item.bookId);
      const current = historyByBook.get(canonicalId);
      if (current?.updatedAt && Date.parse(current.updatedAt) >= Date.parse(item.updatedAt || "")) continue;
      historyByBook.set(canonicalId, { ...item, bookId: canonicalId });
    }
    if (rememberPlace) {
      for (const item of normalizedRemoteProgress) {
        if (!item.book_id || !item.last_read_at) continue;
        const local = historyByBook.get(item.book_id);
        if (local?.updatedAt && Date.parse(local.updatedAt) >= Date.parse(item.last_read_at)) continue;
        historyByBook.set(item.book_id, {
          bookId: item.book_id,
          title: local?.title || "",
          sectionIndex: mergedProgress[item.book_id] || Number(item.section_index || 0),
          sectionTitle: local?.sectionTitle || "",
          actualSeconds: mergedActualSeconds[item.book_id] || Number(item.actual_seconds || 0),
          updatedAt: item.last_read_at,
        });
      }
    }
    const mergedHistory = [...historyByBook.values()]
      .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
      .slice(0, 24);

    try {
      if (rememberPlace) {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(mergedProgress));
        localStorage.setItem(ACTUAL_TIME_KEY, JSON.stringify(mergedActualSeconds));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(mergedHistory));
      }
      writeCompletionState(mergedCompletionState);
      window.dispatchEvent(new Event("jju-account"));
      window.dispatchEvent(new Event("jju-reading-history"));
    } catch {
      // Keep cloud data available even if this browser has disabled storage.
    }

    if (isVerified(nextUser)) {
      try {
        await syncLocalToCloud(nextUser);
      } catch {
        setMessage("Your local reading data is safe, but cloud sync did not finish. Try signing in again shortly.");
      }
    }
    if (!readerDataBelongsTo(nextUser.id)) return;

    setDisplayName(profileName);
    setEmail(nextUser.email || "");
    setCloudProgress(rememberPlace
      ? [...progressIds].map(bookId => ({
        book_id: bookId,
        section_index: mergedProgress[bookId] || 0,
        actual_seconds: mergedActualSeconds[bookId] || 0,
      }))
      : normalizedRemoteProgress);
    setCloudCompleted([...mergedCompleted].map(bookId => ({ book_id: bookId })));
    retrySavedBooksSync();
  }, [supabase, syncLocalToCloud]);

  useEffect(() => {
    fetch("/api/books")
      .then(response => response.json())
      .then(data => setBooks(Array.isArray(data) ? data : data.books || []))
      .catch(() => setBooks([]));

    const refreshLocal = () => {
      const local = readLocalAccount();
      setDisplayName(current => current || local?.name || "");
      setEmail(current => current || local?.email || "");
       setReadBooks(completionSet());
      setProgress(canonicalizeNumericRecord(readJson<Record<string, number>>(PROGRESS_KEY, {})));
      setEvents(readJson<ReadEvent[]>(READ_EVENTS_KEY, []));
    };

    refreshLocal();
    window.addEventListener("jju-account", refreshLocal);
    window.addEventListener("storage", refreshLocal);
    return () => {
      window.removeEventListener("jju-account", refreshLocal);
      window.removeEventListener("storage", refreshLocal);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) void loadCloud(data.user);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user || null;
      setUser(nextUser);
      if (nextUser) void loadCloud(nextUser);
      else {
        setCloudProgress([]);
        setCloudCompleted([]);
      }
    });

    return () => listener.subscription.unsubscribe();
    // loadCloud is intentionally a single refresh path for auth transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const bookMap = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const verified = isVerified(user);
  const completedCount = Math.max(readBooks.size, cloudCompleted.length);
  const localMinutesRead = [...readBooks].reduce((sum, id) => sum + Number(bookMap.get(id)?.readingMinutes || 0), 0);
  const cloudActualMinutes = Math.round(cloudProgress.reduce((sum, item) => sum + Number(item.actual_seconds || 0), 0) / 60);
  const readingMinutes = cloudActualMinutes || localMinutesRead;
  const callbackReturnPath = safeAuthReturnPath(
    returnPath,
    variant === "site-v2" ? "/site-v2/account" : "/account",
    typeof window === "undefined" ? undefined : window.location.origin,
  );
  const authRedirectUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}/auth/callback${variant === "site-v2" ? `?next=${encodeURIComponent(callbackReturnPath)}` : ""}`;
  const passwordResetRedirectUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}/auth/callback?next=${encodeURIComponent(callbackReturnPath)}`;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("auth")) return;

    params.delete("auth");
    params.delete("message");
    const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", cleanUrl);
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setMessage("Supabase is not configured yet.");
      return;
    }
    setBusy(true);
    setMessage("");

    try {
      if (password.length < 6) throw new Error("Use at least 6 characters for the password.");

      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: authRedirectUrl,
            data: { display_name: displayName.trim() || "JJU Reader" },
          },
        });
        if (error) throw error;
        setPassword("");
        if (data.session && data.user) {
          setUser(data.user);
          await loadCloud(data.user);
          setMessage("Account created and signed in.");
        } else if (data.user?.email_confirmed_at) {
          setMessage("Account created. You can sign in now.");
        } else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMessage("That email may already have an account. Try signing in or send a password reset.");
        } else {
          setMessage("Check your email to verify the account. Cloud sync will turn on after verification.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        setPassword("");
        if (callbackReturnPath !== "/account" && callbackReturnPath !== "/site-v2/account") {
          window.location.assign(callbackReturnPath);
          return;
        }
        setMessage("Signed in.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Auth failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    const targetEmail = (user?.email || email).trim();
    if (!supabase || !targetEmail) {
      setMessage("Enter your email first.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: targetEmail,
      options: {
        emailRedirectTo: authRedirectUrl,
      },
    });
    setBusy(false);
    setMessage(error ? error.message : "Verification email requested. Check your inbox and spam folder.");
  }

  async function saveProfile() {
    if (!supabase || !user) return;
    const nextName = displayName.trim() || "JJU Reader";
    setDeleteArmed(false);
    setBusy(true);
    const [authResult, initialProfileResult] = await Promise.all([
      supabase.auth.updateUser({ data: { display_name: nextName } }),
      supabase.from("profiles").update({
        email: user.email || "",
        display_name: nextName,
      }).eq("id", user.id).select("id"),
    ]);
    const profileResult = !initialProfileResult.error && !initialProfileResult.data?.length
      ? await supabase.from("profiles").insert({
        id: user.id,
        email: user.email || "",
        display_name: nextName,
      })
      : initialProfileResult;
    setBusy(false);
    const error = authResult.error || profileResult.error;
    if (error) setMessage(error.message);
    else {
      writeLocalAccount({ name: nextName, email: user.email || "" });
      setMessage("Profile saved.");
    }
  }

  async function requestPasswordReset() {
    if (!supabase || !email.trim()) {
      setMessage("Enter your email first.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: passwordResetRedirectUrl,
    });
    setBusy(false);
    setMessage(error ? error.message : "Password reset email sent.");
  }

  async function updatePassword() {
    if (!supabase || newPassword.length < 6) {
      setMessage("Use at least 6 characters for the new password.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setNewPassword("");
      setMessage("Password updated.");
    }
  }

  async function signOut() {
    if (!supabase) return;
    setDeleteArmed(false);
    await supabase.auth.signOut();
    writeLocalAccount(null);
    setUser(null);
    setMessage("Signed out. Local reading progress is still on this device.");
  }

  async function clearReadingData() {
    setDeleteArmed(false);
    setBusy(true);
    let cloudClearError = "";
    if (supabase && user) {
      try {
        await clearSiteV2SavedBooksEverywhere();
      } catch {
        cloudClearError = "Saved Books could not be cleared from the account.";
      }
      const clearResults = await Promise.all([
        supabase.rpc("clear_completed_books", { expected_user_id: user.id }),
        supabase.from("reading_progress").delete().eq("user_id", user.id),
        supabase.rpc("clear_reading_sessions", { expected_user_id: user.id }),
        supabase.from("reader_bookmarks").delete().eq("user_id", user.id),
        supabase.from("reader_notes").delete().eq("user_id", user.id),
        supabase.from("reader_quotes").delete().eq("user_id", user.id),
        supabase.rpc("clear_reader_canonicalization_audit", { expected_user_id: user.id }),
      ]);
      cloudClearError = cloudClearError || firstSupabaseError(clearResults);
      setCloudProgress([]);
      setCloudCompleted([]);
    }
    clearLocalReadingMemory();
    setReadBooks(new Set());
    setProgress({});
    setEvents([]);
    setBusy(false);
    setMessage(cloudClearError
      ? "Reading data was cleared on this device, but the account copy could not be fully cleared. Try again shortly."
      : user
        ? "Cleared here and from the current account. A device that stayed offline may need one more clear after it reconnects."
        : "Local reading data cleared.");
  }

  async function deleteAccount() {
    if (!supabase || !user) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      setMessage("Press Delete Account again to permanently remove this account.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUserId: user.id }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not delete account.");

      await supabase.auth.signOut().catch(() => undefined);
      writeLocalAccount(null);
      clearLocalReadingMemory();
      removeReaderDataOwner();
      setReadBooks(new Set());
      setProgress({});
      setEvents([]);
      setCloudProgress([]);
      setCloudCompleted([]);
      setUser(null);
      setDeleteArmed(false);
      setMessage("Account deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageRoot className={`page accountPage accountPageClean${variant === "site-v2" ? " siteV2AccountPage" : ""}`}>
      <section className="accountHero accountHeroClean">
        <h1>Account</h1>
      </section>

      {message && <div className="adminNotice accountNotice">{message}</div>}

      <section className="accountMainGrid accountMainClean">
        <section className="accountModule accountAuthModule">
          {!user ? (
            <form className="accountForm" onSubmit={submitAuth}>
              <div className="accountModuleHeader">
                <h2>{mode === "sign-up" ? "Create account" : "Sign in"}</h2>
                <p>{supabase
                  ? variant === "site-v2"
                    ? "You don't need an account to read or save your progress. Sign in to sync it across devices."
                    : "Use an account when cloud sync is ready. Local reading memory works either way."
                  : "Supabase is not configured yet. Reading memory is saved locally on this device."}</p>
              </div>

              {mode === "sign-up" && (
                <label>
                  <span>Display name</span>
                  <input className="input" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="JJU Reader" />
                </label>
              )}

              <label>
                <span>Email</span>
                <input className="input" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required />
              </label>

              <label>
                <span>Password</span>
                <input className="input" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="6+ characters" minLength={6} required />
              </label>

              <div className="accountButtonRow">
                <button className="formBtn" disabled={busy || !supabase} type="submit">{busy ? "Working..." : mode === "sign-up" ? "Create Account" : "Sign In"}</button>
                <button className="resetBtn" type="button" onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}>
                  {mode === "sign-up" ? "Use existing account" : "Create account"}
                </button>
              </div>
              {mode === "sign-up" && <button className="accountTextButton" disabled={busy || !supabase || !email.trim()} type="button" onClick={resendVerification}>Resend verification email</button>}
              {mode === "sign-in" && <button className="accountTextButton" disabled={busy || !supabase} type="button" onClick={requestPasswordReset}>Send password reset email</button>}
            </form>
          ) : (
            <div className="accountForm">
              <div className="accountModuleHeader">
                <h2>Signed in</h2>
                <p>{verified ? "This account is verified." : "Verify your email before cloud sync writes turn on."}</p>
              </div>

              <label>
                <span>Display name</span>
                <input className="input" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="JJU Reader" />
              </label>

              <label>
                <span>Email</span>
                <input className="input" value={email} disabled />
              </label>

              <div className="accountButtonRow">
                <button className="formBtn" disabled={busy} onClick={saveProfile}>Save Profile</button>
                <button className="resetBtn" disabled={busy} onClick={signOut}>Sign Out</button>
              </div>
              {!verified && <button className="accountTextButton" disabled={busy || !supabase} type="button" onClick={resendVerification}>Resend verification email</button>}

              <div className="accountPasswordBox">
                <label>
                  <span>New password</span>
                  <input className="input" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="6+ characters" minLength={6} />
                </label>
                <button className="resetBtn" disabled={busy || newPassword.length < 6} onClick={updatePassword}>Update Password</button>
              </div>

              <div className="accountDangerZone">
                <button className="resetBtn dangerBtn" disabled={busy} onClick={deleteAccount}>
                  {deleteArmed ? "Confirm Delete Account" : "Delete Account"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="accountLocalStats" aria-label="Local reading data">
          <div className="accountSyncList">
            <div>
              <strong>{completedCount}</strong>
              <span>books read</span>
            </div>
            <div>
              <strong>{minutesLabel(readingMinutes)}</strong>
              <span>total reading time</span>
            </div>
          </div>

          <button className="resetBtn" disabled={busy} type="button" onClick={clearReadingData}>Clear Reading Data</button>
        </section>
      </section>
    </PageRoot>
  );
}
