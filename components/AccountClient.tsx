"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabaseClient";

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
};

type CloudCompletedBook = {
  book_id: string;
};

const ACCOUNT_KEY = "jju.account";
const READ_KEY = "jju.readBooks";
const PROGRESS_KEY = "jju.readerProgress";
const READ_EVENTS_KEY = "jju.readingEvents";
const ACTUAL_TIME_KEY = "jju.actualReadingSeconds";
const HISTORY_KEY = "jju.readingHistory";

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)) as T;
  } catch {
    return fallback;
  }
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
  localStorage.removeItem(ACTUAL_TIME_KEY);
  localStorage.removeItem(HISTORY_KEY);
  window.dispatchEvent(new Event("jju-account"));
  window.dispatchEvent(new Event("jju-reading-history"));
}

export default function AccountClient() {
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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);

  const syncLocalToCloud = useCallback(async (nextUser: User) => {
    if (!supabase) return;

    const localRead = readJson<string[]>(READ_KEY, []);
    const localProgress = readJson<Record<string, number>>(PROGRESS_KEY, {});
    const localActualSeconds = readJson<Record<string, number>>(ACTUAL_TIME_KEY, {});
    const now = new Date().toISOString();
    const progressRows = Object.entries({ ...localProgress, ...localActualSeconds })
      .map(([bookId]) => {
        const sectionIndex = Number(localProgress[bookId] || 0);
        const actualSeconds = Number(localActualSeconds[bookId] || 0);
        if (!bookId || (!sectionIndex && !actualSeconds)) return null;
        return {
          user_id: nextUser.id,
          book_id: bookId,
          section_index: sectionIndex,
          actual_seconds: actualSeconds,
          last_read_at: now,
          updated_at: now,
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
    const completedRows = localRead
      .filter(Boolean)
      .map(bookId => ({
        user_id: nextUser.id,
        book_id: bookId,
        completed_at: now,
      }));

    await Promise.all([
      progressRows.length
        ? supabase.from("reading_progress").upsert(progressRows, { onConflict: "user_id,book_id" })
        : Promise.resolve(),
      completedRows.length
        ? supabase.from("completed_books").upsert(completedRows, { onConflict: "user_id,book_id" })
        : Promise.resolve(),
    ]);
  }, [supabase]);

  const loadCloud = useCallback(async (nextUser: User) => {
    if (!supabase) return;
    writeLocalAccount({
      name: String(nextUser.user_metadata?.display_name || nextUser.email || "JJU Reader"),
      email: nextUser.email || "",
    });
    await syncLocalToCloud(nextUser);

    const [progressResult, completedResult] = await Promise.all([
      supabase.from("reading_progress").select("book_id,section_index,actual_seconds"),
      supabase.from("completed_books").select("book_id"),
    ]);

    if (progressResult.error || completedResult.error) {
      setMessage("Supabase account tables are not set up yet.");
      return;
    }

    setDisplayName(String(nextUser.user_metadata?.display_name || ""));
    setEmail(nextUser.email || "");
    setCloudProgress(progressResult.data || []);
    setCloudCompleted(completedResult.data || []);
  }, [supabase, syncLocalToCloud]);

  useEffect(() => {
    fetch("/books.json")
      .then(response => response.json())
      .then(data => setBooks(Array.isArray(data) ? data : data.books || []))
      .catch(() => setBooks([]));

    const refreshLocal = () => {
      const local = readLocalAccount();
      setDisplayName(current => current || local?.name || "");
      setEmail(current => current || local?.email || "");
      setReadBooks(new Set(readJson<string[]>(READ_KEY, [])));
      setProgress(readJson<Record<string, number>>(PROGRESS_KEY, {}));
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
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { display_name: displayName.trim() || "JJU Reader" },
          },
        });
        if (error) throw error;
        setMessage("Check your email to verify the account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        setPassword("");
        setMessage("Signed in.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Auth failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    if (!supabase || !user) return;
    const nextName = displayName.trim() || "JJU Reader";
    setDeleteArmed(false);
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ data: { display_name: nextName } });
    setBusy(false);
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
      redirectTo: `${window.location.origin}/auth/callback?next=/account`,
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
    if (supabase && user) {
      await Promise.all([
        supabase.from("reading_progress").delete().eq("user_id", user.id),
        supabase.from("completed_books").delete().eq("user_id", user.id),
        supabase.from("reading_sessions").delete().eq("user_id", user.id),
      ]);
      setCloudProgress([]);
      setCloudCompleted([]);
    }
    clearLocalReadingMemory();
    setReadBooks(new Set());
    setProgress({});
    setEvents([]);
    setBusy(false);
    setMessage(user ? "Reading data cleared on this device and account." : "Local reading data cleared.");
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
      const response = await fetch("/api/account/delete", { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not delete account.");

      await supabase.auth.signOut().catch(() => undefined);
      writeLocalAccount(null);
      clearLocalReadingMemory();
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
    <main className="page accountPage accountPageClean">
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
                <p>{supabase ? "Use an account when cloud sync is ready. Local reading memory works either way." : "Supabase is not configured yet. Reading memory is saved locally on this device."}</p>
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
    </main>
  );
}
