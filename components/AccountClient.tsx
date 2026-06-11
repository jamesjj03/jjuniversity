"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
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
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<ReadEvent[]>([]);
  const [cloudProgress, setCloudProgress] = useState<CloudProgress[]>([]);
  const [cloudCompleted, setCloudCompleted] = useState<CloudCompletedBook[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
  const localProgressCount = Object.keys(progress).length;
  const localMinutesRead = [...readBooks].reduce((sum, id) => sum + Number(bookMap.get(id)?.readingMinutes || 0), 0);
  const cloudActualMinutes = Math.round(cloudProgress.reduce((sum, item) => sum + Number(item.actual_seconds || 0), 0) / 60);
  const readingMinutes = cloudActualMinutes || localMinutesRead;
  const cloudSyncState = !supabase ? "Not configured" : user ? verified ? "Ready" : "Verify email" : "Sign in";

  async function loadCloud(nextUser: User) {
    if (!supabase) return;
    writeLocalAccount({
      name: String(nextUser.user_metadata?.display_name || nextUser.email || "JJU Reader"),
      email: nextUser.email || "",
    });

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
  }

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

  async function syncLocalToCloud() {
    if (!supabase || !user) return;
    if (!verified) {
      setMessage("Verify your email before syncing reading memory to the cloud.");
      return;
    }

    setBusy(true);
    const now = new Date().toISOString();
    const progressRows = Object.entries(progress).map(([bookId, sectionIndex]) => ({
      user_id: user.id,
      book_id: bookId,
      section_index: Math.max(0, Number(sectionIndex) || 0),
      last_read_at: now,
      updated_at: now,
    }));
    const completedRows = [...readBooks].map(bookId => ({
      user_id: user.id,
      book_id: bookId,
      completed_at: events.find(event => event.bookId === bookId)?.finishedAt || now,
    }));

    const calls = [];
    if (progressRows.length) calls.push(supabase.from("reading_progress").upsert(progressRows, { onConflict: "user_id,book_id" }));
    if (completedRows.length) calls.push(supabase.from("completed_books").upsert(completedRows, { onConflict: "user_id,book_id" }));
    const results = await Promise.all(calls);
    const error = results.find(result => result.error)?.error;
    setBusy(false);

    if (error) setMessage(error.message.includes("does not exist") ? "Supabase account tables are not set up yet." : error.message);
    else {
      await loadCloud(user);
      setMessage("Reading memory synced.");
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    writeLocalAccount(null);
    setUser(null);
    setMessage("Signed out. Local reading progress is still on this device.");
  }

  function clearReadingData() {
    localStorage.removeItem(READ_KEY);
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(READ_EVENTS_KEY);
    localStorage.removeItem(ACTUAL_TIME_KEY);
    localStorage.removeItem(HISTORY_KEY);
    setReadBooks(new Set());
    setProgress({});
    setEvents([]);
    window.dispatchEvent(new Event("jju-account"));
    window.dispatchEvent(new Event("jju-reading-history"));
    setMessage("Local reading data cleared.");
  }

  return (
    <main className="page accountPage accountPageClean">
      <section className="accountHero accountHeroClean">
        <h1>Account</h1>
        <div className="accountHeroActions">
          <Link className="btn primary" href="/library">Open Library</Link>
          <Link className="btn secondary" href="/settings">Reader Settings</Link>
        </div>
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
            </div>
          )}
        </section>

        <section className="accountModule accountReadingRoomModule">
          <div className="accountModuleHeader">
            <h2>Reading Room</h2>
            <p>Local reading memory from this device.</p>
          </div>

          <div className="accountSyncList">
            <div>
              <strong>{completedCount}</strong>
              <span>books read</span>
            </div>
            <div>
              <strong>{minutesLabel(readingMinutes)}</strong>
              <span>total reading time</span>
            </div>
            <div>
              <strong>{localProgressCount}</strong>
              <span>books opened</span>
            </div>
            <div>
              <strong>{events.length}</strong>
              <span>finish events</span>
            </div>
          </div>

          {user && (
            <button className="formBtn accountWideButton" disabled={!verified || busy} onClick={syncLocalToCloud}>
              {busy ? "Syncing..." : "Sync This Device"}
            </button>
          )}

          <div className="accountRuleCard">
            <span>{user ? cloudSyncState : "Local only"}</span>
            <p>{user ? "Cloud sync only writes after email verification." : "No account required. This data stays in your browser."}</p>
          </div>

          <button className="resetBtn accountWideButton" type="button" onClick={clearReadingData}>Clear Reading Data</button>
        </section>
      </section>
    </main>
  );
}
