"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import type { WorkshopBook } from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";

type NewBookDraft = {
  title: string;
  id: string;
  creator: string;
  description: string;
  tags: string;
  text: string;
  visibility: "main" | "archive";
  archiveCategory: string;
};

type RecoveryEnvelope = {
  savedAt: string;
  baseVersion: string;
  draft: NewBookDraft;
};

function isNewBookDraft(value: unknown): value is NewBookDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.title === "string"
    && typeof draft.id === "string"
    && typeof draft.creator === "string"
    && typeof draft.description === "string"
    && typeof draft.tags === "string"
    && typeof draft.text === "string"
    && (draft.visibility === "main" || draft.visibility === "archive")
    && typeof draft.archiveCategory === "string";
}

function isRecoveryEnvelope(value: unknown): value is RecoveryEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  return typeof envelope.savedAt === "string"
    && typeof envelope.baseVersion === "string"
    && isNewBookDraft(envelope.draft);
}

const EMPTY_DRAFT: NewBookDraft = {
  title: "",
  id: "",
  creator: "James Johnson",
  description: "",
  tags: "",
  text: "",
  visibility: "main",
  archiveCategory: "Unsorted Archive",
};

const RECOVERY_KEY = "jju.workshop.new-book.v1";

export default function NewBookForm({
  initialVersion,
  source,
  supabaseWriteLocked,
}: {
  initialVersion: string;
  source: string;
  supabaseWriteLocked: boolean;
}) {
  const router = useRouter();
  const { resolveAdminHref, setUnsaved } = useAdminUnsavedChanges();
  const sourceKey = "new-book-route";
  const initialDraft = useMemo(() => EMPTY_DRAFT, []);
  const [draft, setDraft] = useState<NewBookDraft>(initialDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const [phoneRecoverySaved, setPhoneRecoverySaved] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryEnvelope | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(RECOVERY_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecoveryEnvelope(parsed)) {
          setRecoveryBlocked(true);
          return;
        }
        if (JSON.stringify(parsed.draft) !== JSON.stringify(initialDraft)) {
          setRecovery(parsed);
          setPhoneRecoverySaved(true);
        }
      } catch {
        setRecoveryBlocked(true);
        setStorageNotice("This browser could not read its saved phone draft. The data was left untouched and editing is locked.");
      } finally {
        setRecoveryChecked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initialDraft]);

  useEffect(() => {
    if (!recoveryChecked || recovery || recoveryBlocked) return;
    const timer = window.setTimeout(() => {
      try {
        if (dirty) {
          const serialized = JSON.stringify({
            savedAt: new Date().toISOString(),
            baseVersion: initialVersion,
            draft,
          } satisfies RecoveryEnvelope);
          window.localStorage.setItem(RECOVERY_KEY, serialized);
          if (window.localStorage.getItem(RECOVERY_KEY) !== serialized) {
            throw new Error("Phone recovery verification failed.");
          }
          setPhoneRecoverySaved(true);
          setStorageNotice("");
        } else {
          window.localStorage.removeItem(RECOVERY_KEY);
          if (window.localStorage.getItem(RECOVERY_KEY) !== null) {
            throw new Error("Phone recovery cleanup failed.");
          }
          setPhoneRecoverySaved(false);
          setStorageNotice("");
        }
      } catch {
        setPhoneRecoverySaved(false);
        setStorageNotice("This browser could not save phone recovery. Keep this page open until you can create the book or copy the draft somewhere safe.");
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, initialVersion, recovery, recoveryBlocked, recoveryChecked]);

  useEffect(() => {
    setUnsaved(sourceKey, dirty, "New book draft");
  }, [dirty, setUnsaved]);

  useEffect(() => () => setUnsaved(sourceKey, false), [setUnsaved]);

  function patchDraft(patch: Partial<NewBookDraft>) {
    if (busy || recovery || recoveryBlocked) return;
    setNotice("");
    setPhoneRecoverySaved(false);
    setDraft(current => ({ ...current, ...patch }));
  }

  function restoreRecovery() {
    if (!recovery) return;
    setDraft(recovery.draft);
    setRecovery(null);
    setPhoneRecoverySaved(true);
    setStorageNotice("");
    const versionChanged = recovery.baseVersion !== initialVersion;
    setNotice(versionChanged
      ? "Recovered this phone draft onto the latest loaded catalog. Its book ID will be checked again when you create it."
      : `Recovered the phone draft saved ${new Date(recovery.savedAt).toLocaleString()}.`);
  }

  function discardRecovery() {
    try {
      window.localStorage.removeItem(RECOVERY_KEY);
      if (window.localStorage.getItem(RECOVERY_KEY) !== null) throw new Error("Phone recovery cleanup failed.");
      setRecovery(null);
      setPhoneRecoverySaved(false);
      setStorageNotice("");
      setNotice("Discarded the phone recovery draft. No book was created.");
    } catch {
      setStorageNotice("This browser could not discard the phone recovery draft. It remains locked and untouched.");
    }
  }

  function discardUnreadableRecovery() {
    try {
      window.localStorage.removeItem(RECOVERY_KEY);
      if (window.localStorage.getItem(RECOVERY_KEY) !== null) throw new Error("Phone recovery cleanup failed.");
      setRecoveryBlocked(false);
      setPhoneRecoverySaved(false);
      setStorageNotice("");
      setNotice("Discarded the unreadable phone recovery data. No book was created.");
    } catch {
      setStorageNotice("This browser could not discard the unreadable recovery data. It remains locked and untouched.");
    }
  }

  async function createBook() {
    if (busy || recovery || recoveryBlocked) return;
    if (supabaseWriteLocked) {
      setNotice("Creation is safety-locked until the catalog CAS migration is applied and verified.");
      return;
    }
    if (!draft.title.trim()) {
      setNotice("Give the book a title before creating the draft.");
      return;
    }

    setBusy(true);
    setNotice("Creating a hidden book and its first manuscript section...");
    try {
      const response = await fetch("/api/admin/book-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": initialVersion,
        },
        body: JSON.stringify({
          ...draft,
          status: "hidden",
          tags: draft.tags.split(",").map(tag => tag.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; book?: WorkshopBook };
      if (!response.ok) {
        const suffix = response.status === 409 ? " Your phone draft is still preserved." : "";
        throw new Error(`${payload.error || "The draft book could not be created."}${suffix}`);
      }
      const bookId = String(payload.book?.id || "").trim();
      if (!bookId) throw new Error("The book was created but no book ID was returned. Reload Books before trying again.");

      try {
        window.localStorage.removeItem(RECOVERY_KEY);
      } catch {
        // The remote creation succeeded. A stale phone recovery prompt is safer than retrying creation.
      }
      setUnsaved(sourceKey, false);
      const returnHref = "/admin/books?status=hidden";
      router.push(resolveAdminHref(`/admin/books/${encodeURIComponent(bookId)}?from=${encodeURIComponent(returnHref)}`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The draft book could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {recovery && (
        <section className={styles.recoveryBanner} role="status">
          <div>
            <strong>Unfinished book found on this phone</strong>
            <span>Saved {new Date(recovery.savedAt).toLocaleString()}. Restore it or start clean.</span>
          </div>
          <div className={styles.inlineActions}>
            <button className={styles.primaryButton} type="button" onClick={restoreRecovery}>Restore draft</button>
            <button className={styles.quietButton} type="button" onClick={discardRecovery}>Discard</button>
          </div>
        </section>
      )}

      {recoveryBlocked && (
        <section className={styles.recoveryBanner} role="alert">
          <div>
            <strong>Phone recovery needs attention</strong>
            <span>The saved data could not be read safely. It was left untouched and editing is locked until you explicitly discard it.</span>
          </div>
          <div className={styles.inlineActions}>
            <button className={styles.quietButton} type="button" onClick={discardUnreadableRecovery}>Discard unreadable draft</button>
          </div>
        </section>
      )}

      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {storageNotice && <div className={styles.notice} role="alert">{storageNotice}</div>}

      <div className={styles.editorGrid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <p className={styles.eyebrow}>New hidden draft</p>
            <h2>Start the book</h2>
            <p>Only the title is required. You can finish details and manuscript sections after creation.</p>
          </header>

          <fieldset disabled={busy || Boolean(recovery) || recoveryBlocked} style={{ border: 0, margin: 0, padding: 0 }}>
            <div className={styles.fieldGrid}>
              <label className={`${styles.field} ${styles.fullField}`}>
                Title
                <input autoFocus required value={draft.title} onChange={event => patchDraft({ title: event.target.value })} />
              </label>
              <label className={styles.field}>
                Creator
                <input value={draft.creator} onChange={event => patchDraft({ creator: event.target.value })} />
              </label>
              <label className={styles.field}>
                Topics and tags
                <input value={draft.tags} onChange={event => patchDraft({ tags: event.target.value })} placeholder="History, Culture" />
              </label>
              <label className={`${styles.field} ${styles.fullField}`}>
                Description
                <textarea value={draft.description} onChange={event => patchDraft({ description: event.target.value })} />
              </label>
              <label className={styles.field}>
                Placement
                <select value={draft.visibility} onChange={event => patchDraft({ visibility: event.target.value as NewBookDraft["visibility"] })}>
                  <option value="main">Main Library</option>
                  <option value="archive">Archive</option>
                </select>
              </label>
              {draft.visibility === "archive" && (
                <label className={styles.field}>
                  Archive category
                  <input value={draft.archiveCategory} onChange={event => patchDraft({ archiveCategory: event.target.value })} />
                </label>
              )}
              <label className={`${styles.field} ${styles.fullField}`}>
                Starting manuscript text (optional)
                <textarea value={draft.text} onChange={event => patchDraft({ text: event.target.value })} placeholder="Paste a first section, or leave this blank." />
              </label>
            </div>

            <details className={styles.advanced}>
              <summary>Choose the book ID</summary>
              <label className={styles.field}>
                Custom ID (optional)
                <input value={draft.id} onChange={event => patchDraft({ id: event.target.value })} placeholder="Generated from the title when blank" />
              </label>
            </details>
          </fieldset>
        </section>

        <aside className={styles.panel}>
          <header className={styles.panelHeader}>
            <p className={styles.eyebrow}>What happens</p>
            <h2>Created hidden</h2>
          </header>
          <div className={styles.statusCallout}>
            <strong>Readers will not see this book yet.</strong>
            <span>A successful creation returns both the catalog row and first manuscript, then opens the new book workspace.</span>
          </div>
          <div className={styles.capabilityList}>
            <div className={styles.capabilityNote}>Loaded from {source}. Creation uses this exact catalog version and stops if someone else changed it first.</div>
            {supabaseWriteLocked && (
              <div className={styles.capabilityNote}><strong>Creation is safety-locked.</strong> You can keep a recoverable phone draft, but no Supabase book can be created until the catalog CAS migration is applied and verified.</div>
            )}
          </div>
        </aside>
      </div>

      <div className={styles.saveDock} role="status" aria-live="polite">
        <span>{dirty
          ? phoneRecoverySaved
            ? "This new book is saved on this phone until creation"
            : storageNotice
              ? "Phone recovery is not currently saved"
              : "Saving this new book on this phone..."
          : "Nothing has been entered yet"}</span>
        <button className={styles.primaryButton} type="button" disabled={busy || Boolean(recovery) || recoveryBlocked || supabaseWriteLocked || !draft.title.trim()} onClick={() => void createBook()}>
          {busy ? "Creating..." : supabaseWriteLocked ? "Creation locked" : "Create hidden draft"}
        </button>
      </div>
    </>
  );
}
