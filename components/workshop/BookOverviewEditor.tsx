"use client";

import { useEffect, useMemo, useState } from "react";
import { GuardedAdminLink, useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import {
  normalizeWorkshopBook,
  workshopBookPublicState,
  type WorkshopBook,
} from "@/lib/workshopBooks";
import styles from "@/app/admin/WorkshopCore.module.css";

type OverviewDraft = {
  title: string;
  subtitle: string;
  creator: string;
  series: string;
  description: string;
  tags: string;
  status: string;
  visibility: "main" | "archive";
  archiveCategory: string;
  coverFile: string;
  bookFile: string;
};

const OVERVIEW_DRAFT_FIELDS = [
  "title",
  "subtitle",
  "creator",
  "series",
  "description",
  "tags",
  "status",
  "visibility",
  "archiveCategory",
  "coverFile",
  "bookFile",
] as const satisfies ReadonlyArray<keyof OverviewDraft>;

type OverviewDraftField = typeof OVERVIEW_DRAFT_FIELDS[number];

const OVERVIEW_DRAFT_LABELS: Record<OverviewDraftField, string> = {
  title: "Title",
  subtitle: "Subtitle",
  creator: "Creator",
  series: "Series",
  description: "Description",
  tags: "Topics and tags",
  status: "Edition eligibility",
  visibility: "Placement",
  archiveCategory: "Archive category",
  coverFile: "Cover file",
  bookFile: "Content/source file",
};

type RecoveryEnvelopeV2 = {
  schemaVersion: 2;
  bookId: string;
  baseVersion: string;
  savedAt: string;
  baseline: OverviewDraft;
  draft: OverviewDraft;
  changedFields: OverviewDraftField[];
};

type LegacyRecoveryEnvelope = {
  bookId: string;
  baseVersion: string;
  savedAt: string;
  draft: OverviewDraft;
};

type RecoveryCandidate =
  | { kind: "v2"; storageKey: string; envelope: RecoveryEnvelopeV2 }
  | { kind: "legacy"; storageKey: string; envelope: LegacyRecoveryEnvelope }
  | { kind: "blocked"; storageKey: string; legacy: boolean; reason: string };

type RecoveryConflict = {
  field: OverviewDraftField;
  label: string;
  phoneValue: string;
  workshopValue: string;
};

type RecoveryResult = {
  mergedFields: OverviewDraftField[];
  alreadyPresentFields: OverviewDraftField[];
  conflicts: RecoveryConflict[];
};

type Props = {
  initialBook: WorkshopBook;
  initialVersion: string;
  supabaseWriteGateUnavailable?: boolean;
  onSaved?: (book: WorkshopBook) => void;
};

function draftFromBook(book: WorkshopBook): OverviewDraft {
  return {
    title: book.title,
    subtitle: book.subtitle,
    creator: book.creator,
    series: book.series,
    description: book.description,
    tags: book.tags.join(", "),
    status: book.status,
    visibility: book.visibility,
    archiveCategory: book.archiveCategory,
    coverFile: book.coverFile,
    bookFile: book.bookFile,
  };
}

function tagsFromDraft(value: string) {
  return [...new Set(value.split(",").map(tag => tag.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function legacyStorageKey(bookId: string) {
  return `jju.workshop.book-overview.${bookId}.v1`;
}

function storageKey(bookId: string) {
  return `jju.workshop.book-overview.${bookId}.v2`;
}

function cleanVersion(value: string) {
  return value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

function isOverviewDraft(value: unknown): value is OverviewDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return OVERVIEW_DRAFT_FIELDS.every(field => typeof draft[field] === "string")
    && (draft.visibility === "main" || draft.visibility === "archive");
}

function changedDraftFields(baseline: OverviewDraft, draft: OverviewDraft) {
  return OVERVIEW_DRAFT_FIELDS.filter(field => baseline[field] !== draft[field]);
}

function copyDraftField<Field extends OverviewDraftField>(
  target: OverviewDraft,
  source: OverviewDraft,
  field: Field,
) {
  target[field] = source[field];
}

function isValidSavedAt(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseV2Recovery(value: unknown, bookId: string): RecoveryEnvelopeV2 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schemaVersion !== 2
    || envelope.bookId !== bookId
    || typeof envelope.baseVersion !== "string"
    || !envelope.baseVersion.trim()
    || !isValidSavedAt(envelope.savedAt)
    || !isOverviewDraft(envelope.baseline)
    || !isOverviewDraft(envelope.draft)
    || !Array.isArray(envelope.changedFields)
  ) return null;

  const storedFields = envelope.changedFields;
  if (storedFields.some(field => !OVERVIEW_DRAFT_FIELDS.includes(field as OverviewDraftField))) return null;
  const actualFields = changedDraftFields(envelope.baseline, envelope.draft);
  if (
    storedFields.length !== actualFields.length
    || actualFields.some((field, index) => storedFields[index] !== field)
  ) return null;

  return {
    schemaVersion: 2,
    bookId,
    baseVersion: cleanVersion(envelope.baseVersion),
    savedAt: envelope.savedAt,
    baseline: envelope.baseline,
    draft: envelope.draft,
    changedFields: actualFields,
  };
}

function parseLegacyRecovery(value: unknown, bookId: string): LegacyRecoveryEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.bookId !== bookId
    || typeof envelope.baseVersion !== "string"
    || !envelope.baseVersion.trim()
    || !isValidSavedAt(envelope.savedAt)
    || !isOverviewDraft(envelope.draft)
  ) return null;
  return {
    bookId,
    baseVersion: cleanVersion(envelope.baseVersion),
    savedAt: envelope.savedAt,
    draft: envelope.draft,
  };
}

function displayDraftValue(value: string) {
  return value || "(blank)";
}

export default function BookOverviewEditor({
  initialBook,
  initialVersion,
  supabaseWriteGateUnavailable = false,
  onSaved,
}: Props) {
  const sourceKey = `book-overview:${initialBook.id}`;
  const { setUnsaved } = useAdminUnsavedChanges();
  const initialDraft = useMemo(() => draftFromBook(initialBook), [initialBook]);
  const [book, setBook] = useState(initialBook);
  const [baseline, setBaseline] = useState(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [recovery, setRecovery] = useState<RecoveryCandidate | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<RecoveryResult | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const changedFields = useMemo(() => changedDraftFields(baseline, draft), [baseline, draft]);
  const dirty = changedFields.length > 0;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const currentKey = storageKey(initialBook.id);
        const currentRaw = window.localStorage.getItem(currentKey);
        if (currentRaw) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(currentRaw);
          } catch {
            setRecovery({
              kind: "blocked",
              storageKey: currentKey,
              legacy: false,
              reason: "This phone draft is damaged or unreadable, so it was not opened or overwritten.",
            });
            return;
          }
          const envelope = parseV2Recovery(parsed, initialBook.id);
          if (!envelope) {
            setRecovery({
              kind: "blocked",
              storageKey: currentKey,
              legacy: false,
              reason: "This phone draft does not match the current recovery format, so it was not opened or overwritten.",
            });
            return;
          }
          if (envelope.changedFields.length) {
            setRecovery({ kind: "v2", storageKey: currentKey, envelope });
          } else {
            window.localStorage.removeItem(currentKey);
          }
          return;
        }

        const oldKey = legacyStorageKey(initialBook.id);
        const oldRaw = window.localStorage.getItem(oldKey);
        if (oldRaw) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(oldRaw);
          } catch {
            setRecovery({
              kind: "blocked",
              storageKey: oldKey,
              legacy: true,
              reason: "An older phone draft is damaged or unreadable. It was not opened or deleted.",
            });
            return;
          }
          const envelope = parseLegacyRecovery(parsed, initialBook.id);
          if (envelope) {
            setRecovery({ kind: "legacy", storageKey: oldKey, envelope });
          } else {
            setRecovery({
              kind: "blocked",
              storageKey: oldKey,
              legacy: true,
              reason: "An older phone draft could not be verified. It was not opened or deleted.",
            });
          }
        }
      } catch {
        setNotice("Phone recovery storage is unavailable in this browser. Nothing was deleted.");
      } finally {
        setRecoveryChecked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initialBook.id, initialDraft, initialVersion]);

  useEffect(() => {
    if (!recoveryChecked) return;
    if (recovery) return;
    const timer = window.setTimeout(() => {
      try {
        if (dirty) {
          const envelope: RecoveryEnvelopeV2 = {
            schemaVersion: 2,
            bookId: initialBook.id,
            baseVersion: cleanVersion(version),
            savedAt: new Date().toISOString(),
            baseline,
            draft,
            changedFields,
          };
          window.localStorage.setItem(storageKey(initialBook.id), JSON.stringify(envelope));
        } else {
          window.localStorage.removeItem(storageKey(initialBook.id));
        }
      } catch {
        setNotice(current => current || "This browser could not update the phone recovery draft.");
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [baseline, changedFields, dirty, draft, initialBook.id, recovery, recoveryChecked, version]);

  useEffect(() => {
    setUnsaved(sourceKey, dirty, `${initialBook.title} details`);
  }, [dirty, initialBook.title, setUnsaved, sourceKey]);

  useEffect(() => () => setUnsaved(sourceKey, false), [setUnsaved, sourceKey]);

  function patch(next: Partial<OverviewDraft>) {
    if (busy) return;
    setNotice("");
    setDraft(current => ({ ...current, ...next }));
  }

  function restoreRecovery() {
    if (!recovery) return;
    if (recovery.kind === "blocked") return;

    if (recovery.kind === "legacy") {
      if (cleanVersion(recovery.envelope.baseVersion) !== cleanVersion(version)) return;
      setDraft(recovery.envelope.draft);
      try {
        window.localStorage.removeItem(recovery.storageKey);
      } catch {
        setNotice("The older phone draft was restored, but this browser could not clear the old recovery copy.");
        setRecovery(null);
        return;
      }
      setRecovery(null);
      setNotice(`Recovered the older phone draft saved ${new Date(recovery.envelope.savedAt).toLocaleString()}. Its source version exactly matched the Workshop copy.`);
      return;
    }

    const nextDraft = { ...baseline };
    const mergedFields: OverviewDraftField[] = [];
    const alreadyPresentFields: OverviewDraftField[] = [];
    const conflicts: RecoveryConflict[] = [];

    for (const field of recovery.envelope.changedFields) {
      const baselineValue = recovery.envelope.baseline[field];
      const phoneValue = recovery.envelope.draft[field];
      const workshopValue = baseline[field];
      if (workshopValue === baselineValue) {
        copyDraftField(nextDraft, recovery.envelope.draft, field);
        mergedFields.push(field);
      } else if (workshopValue === phoneValue) {
        alreadyPresentFields.push(field);
      } else {
        conflicts.push({
          field,
          label: OVERVIEW_DRAFT_LABELS[field],
          phoneValue,
          workshopValue,
        });
      }
    }

    setDraft(nextDraft);
    const result = { mergedFields, alreadyPresentFields, conflicts };
    setRecoveryResult(result);
    if (conflicts.length) {
      setNotice("Safe phone changes were merged. Fields changed in both places kept the newer Workshop value and are listed for review.");
      return;
    }

    try {
      window.localStorage.removeItem(recovery.storageKey);
    } catch {
      setNotice("Phone changes were safely merged, but this browser could not clear the previous recovery copy.");
      setRecovery(null);
      return;
    }
    setRecovery(null);
    const mergedLabels = mergedFields.map(field => OVERVIEW_DRAFT_LABELS[field]);
    const matchingLabels = alreadyPresentFields.map(field => OVERVIEW_DRAFT_LABELS[field]);
    setNotice(mergedLabels.length
      ? `Recovered ${mergedLabels.join(", ")}. No newer Workshop fields were overwritten.${matchingLabels.length ? ` Already matched: ${matchingLabels.join(", ")}.` : ""}`
      : `The phone changes already match the Workshop for ${matchingLabels.join(", ") || "every changed field"}. Nothing was overwritten.`);
  }

  function discardRecovery() {
    if (!recovery) return;
    try {
      window.localStorage.removeItem(recovery.storageKey);
    } catch {
      setNotice("This browser could not discard the stored phone draft.");
      return;
    }
    setRecovery(null);
    setRecoveryResult(null);
    setNotice("Discarded the phone recovery draft. The Workshop copy was not changed.");
  }

  function ignoreLegacyRecovery() {
    if (!recovery || !recovery.storageKey.endsWith(".v1")) return;
    setRecovery(null);
    setRecoveryResult(null);
    setNotice("The older phone draft remains stored and was not applied. You can continue with the Workshop copy.");
  }

  function acceptSafeRecoveryMerge() {
    if (!recovery || recovery.kind !== "v2" || !recoveryResult) return;
    try {
      window.localStorage.removeItem(recovery.storageKey);
    } catch {
      setNotice("The merge is ready, but this browser could not clear the previous recovery copy.");
      return;
    }
    setRecovery(null);
    setNotice("Safe phone changes are now in the form. Conflicting fields still use the newer Workshop values shown below.");
  }

  function undoRecoveryMerge() {
    if (!recovery) return;
    try {
      window.localStorage.removeItem(recovery.storageKey);
    } catch {
      setNotice("This browser could not discard the stored phone draft.");
      return;
    }
    setDraft(baseline);
    setRecovery(null);
    setRecoveryResult(null);
    setNotice("Undid the phone recovery. The loaded Workshop values remain in the form.");
  }

  async function save() {
    if (!dirty || busy || recovery || supabaseWriteGateUnavailable) return;
    setBusy(true);
    setNotice("Saving this book’s details...");
    try {
      const response = await fetch(`/api/admin/books/${encodeURIComponent(initialBook.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": version,
        },
        body: JSON.stringify({
          patch: {
            title: draft.title,
            subtitle: draft.subtitle,
            creator: draft.creator,
            series: draft.series,
            description: draft.description,
            tags: tagsFromDraft(draft.tags),
            status: draft.status,
            visibility: draft.visibility,
            archiveCategory: draft.visibility === "archive" ? draft.archiveCategory : "",
            coverFile: draft.coverFile,
            bookFile: draft.bookFile,
          },
          message: `Update ${draft.title || initialBook.title} from JJU Workshop`,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; note?: string; book?: WorkshopBook };
      if (!response.ok) {
        if (response.status === 409) throw new Error(`${payload.error || "The catalog changed."} Your phone draft is still preserved.`);
        throw new Error(payload.error || "This book could not be saved.");
      }
      const nextVersion = response.headers.get("etag");
      if (!nextVersion || !payload.book) throw new Error("The save returned no safe catalog version. Reload before editing again.");
      const savedBook = normalizeWorkshopBook(payload.book);
      const savedDraft = draftFromBook(savedBook);
      setBook(savedBook);
      setDraft(savedDraft);
      setBaseline(savedDraft);
      setVersion(nextVersion);
      setRecoveryResult(null);
      let cleanupNote = "";
      try {
        window.localStorage.removeItem(storageKey(initialBook.id));
        window.localStorage.removeItem(legacyStorageKey(initialBook.id));
      } catch {
        cleanupNote = " The browser could not clear its local recovery copy.";
      }
      onSaved?.(savedBook);
      setNotice(`${payload.note || "Book details saved."}${cleanupNote}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "This book could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const previewBook = normalizeWorkshopBook({
    ...book,
    ...draft,
    tags: tagsFromDraft(draft.tags),
  });

  const recoverySavedAt = recovery && recovery.kind !== "blocked"
    ? new Date(recovery.envelope.savedAt).toLocaleString()
    : null;
  const legacyRecoveryIsCurrent = recovery?.kind === "legacy"
    && cleanVersion(recovery.envelope.baseVersion) === cleanVersion(version);
  const recoveryLocksEditor = Boolean(recovery);

  return (
    <>
      {supabaseWriteGateUnavailable && (
        <section className={styles.recoveryBanner} role="alert">
          <div>
            <strong>Supabase saving is safety-locked</strong>
            <span>
              This catalog has no verified atomic revision. You can draft changes on this phone, but Save stays disabled until the catalog CAS migration is applied and verified.
            </span>
          </div>
        </section>
      )}

      {recovery && (
        <section className={styles.recoveryBanner} role="status">
          <div>
            <strong>
              {recovery.kind === "blocked"
                ? "Phone draft held for safety"
                : recoveryResult?.conflicts.length
                  ? "Phone draft has cross-device conflicts"
                  : "Unsaved phone draft found"}
            </strong>
            {recovery.kind === "blocked" ? (
              <span>{recovery.reason}</span>
            ) : recoveryResult?.conflicts.length ? (
              <span>
                {recoveryResult.mergedFields.length
                  ? `Restored ${recoveryResult.mergedFields.map(field => OVERVIEW_DRAFT_LABELS[field]).join(", ")}. `
                  : "No non-conflicting phone fields needed restoring. "}
                {recoveryResult.alreadyPresentFields.length
                  ? `Already matched: ${recoveryResult.alreadyPresentFields.map(field => OVERVIEW_DRAFT_LABELS[field]).join(", ")}. `
                  : ""}
                Kept the newer Workshop value for {recoveryResult.conflicts.map(conflict => conflict.label).join(", ")} because both copies changed.
              </span>
            ) : recovery.kind === "legacy" && !legacyRecoveryIsCurrent ? (
              <span>
                Saved {recoverySavedAt}. This older draft has no field baseline and the Workshop changed afterward, so restoring it is blocked.
              </span>
            ) : recovery.kind === "v2" && cleanVersion(recovery.envelope.baseVersion) !== cleanVersion(version) ? (
              <span>
                Saved {recoverySavedAt}. The Workshop changed afterward. Safe merge restores only fields that were not also changed elsewhere.
              </span>
            ) : (
              <span>Saved {recoverySavedAt}. Its loaded source version matches this Workshop copy.</span>
            )}

            {recoveryResult?.conflicts.length ? (
              <details className={styles.advanced} open>
                <summary>Review fields kept from the Workshop</summary>
                {recoveryResult.conflicts.map(conflict => (
                  <div key={conflict.field}>
                    <strong>{conflict.label}</strong>
                    <span>Workshop: {displayDraftValue(conflict.workshopValue)}</span>
                    <span>Phone draft: {displayDraftValue(conflict.phoneValue)}</span>
                  </div>
                ))}
              </details>
            ) : null}
          </div>
          <div className={styles.inlineActions}>
            {recovery.kind === "v2" && !recoveryResult && (
              <button className={styles.primaryButton} type="button" onClick={restoreRecovery}>Merge phone changes</button>
            )}
            {recovery.kind === "legacy" && legacyRecoveryIsCurrent && (
              <button className={styles.primaryButton} type="button" onClick={restoreRecovery}>Restore matching draft</button>
            )}
            {recovery.kind === "v2" && recoveryResult?.conflicts.length ? (
              <>
                <button className={styles.primaryButton} type="button" onClick={acceptSafeRecoveryMerge}>Continue with safe merge</button>
                <button className={styles.quietButton} type="button" onClick={undoRecoveryMerge}>Undo recovery</button>
              </>
            ) : (
              <button className={styles.quietButton} type="button" onClick={discardRecovery}>Discard</button>
            )}
            {(recovery.kind === "legacy" || recovery.kind === "blocked" && recovery.legacy) && !legacyRecoveryIsCurrent && (
              <button className={styles.quietButton} type="button" onClick={ignoreLegacyRecovery}>Leave stored and continue</button>
            )}
          </div>
        </section>
      )}

      {!recovery && recoveryResult?.conflicts.length ? (
        <section className={styles.recoveryBanner} role="status">
          <div>
            <strong>Cross-device values kept for review</strong>
            <span>The safe phone changes are in the form. These newer Workshop values were not overwritten:</span>
            <details className={styles.advanced}>
              <summary>Compare {recoveryResult.conflicts.length} conflict{recoveryResult.conflicts.length === 1 ? "" : "s"}</summary>
              {recoveryResult.conflicts.map(conflict => (
                <div key={conflict.field}>
                  <strong>{conflict.label}</strong>
                  <span>Workshop: {displayDraftValue(conflict.workshopValue)}</span>
                  <span>Phone draft: {displayDraftValue(conflict.phoneValue)}</span>
                </div>
              ))}
            </details>
          </div>
          <button className={styles.quietButton} type="button" onClick={() => setRecoveryResult(null)}>Dismiss comparison</button>
        </section>
      ) : null}

      {notice && <div className={styles.notice} role="status">{notice}</div>}

      <div className={styles.editorGrid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <p className={styles.eyebrow}>Overview</p>
            <h2>Book details</h2>
            <p>Edit what readers see. Technical file references stay under Advanced.</p>
          </header>

          <fieldset disabled={busy || recoveryLocksEditor} style={{ border: 0, margin: 0, padding: 0 }}>
            <div className={styles.fieldGrid}>
              <label className={`${styles.field} ${styles.fullField}`}>
                Title
                <input value={draft.title} onChange={event => patch({ title: event.target.value })} />
              </label>
              <label className={styles.field}>
                Subtitle
                <input value={draft.subtitle} onChange={event => patch({ subtitle: event.target.value })} />
              </label>
              <label className={styles.field}>
                Creator
                <input value={draft.creator} onChange={event => patch({ creator: event.target.value })} />
              </label>
              <label className={`${styles.field} ${styles.fullField}`}>
                Description
                <textarea value={draft.description} onChange={event => patch({ description: event.target.value })} />
              </label>
              <label className={styles.field}>
                Series
                <input value={draft.series} onChange={event => patch({ series: event.target.value })} />
              </label>
              <label className={styles.field}>
                Topics and tags
                <input value={draft.tags} onChange={event => patch({ tags: event.target.value })} placeholder="History, Power, Biography" />
              </label>
              <label className={styles.field}>
                Edition eligibility
                <select value={draft.status} onChange={event => patch({ status: event.target.value })}>
                  <option value="ready">Ready for next public edition</option>
                  <option value="coming-soon">Coming soon</option>
                  <option value="hidden">Hidden draft</option>
                  <option value="needs-review">Needs editorial review</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label className={styles.field}>
                Placement
                <select value={draft.visibility} onChange={event => patch({ visibility: event.target.value as OverviewDraft["visibility"] })}>
                  <option value="main">Main Library</option>
                  <option value="archive">Archive</option>
                </select>
              </label>
              {draft.visibility === "archive" && (
                <label className={`${styles.field} ${styles.fullField}`}>
                  Archive category
                  <input value={draft.archiveCategory} onChange={event => patch({ archiveCategory: event.target.value })} />
                </label>
              )}
            </div>

            <details className={styles.advanced}>
              <summary>Advanced file references</summary>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  Cover file
                  <input value={draft.coverFile} onChange={event => patch({ coverFile: event.target.value })} />
                </label>
                <label className={styles.field}>
                  Content/source file
                  <input value={draft.bookFile} onChange={event => patch({ bookFile: event.target.value })} />
                </label>
              </div>
            </details>
          </fieldset>
        </section>

        <aside className={styles.panel}>
          <header className={styles.panelHeader}>
            <p className={styles.eyebrow}>Reader consequence</p>
            <h2>{workshopBookPublicState(previewBook)}</h2>
          </header>
          <div className={styles.statusCallout}>
            <strong>{dirty ? "Changes are only on this phone" : "Matches the loaded Workshop copy"}</strong>
            <span>Saving details uses the exact loaded catalog version. It makes this book eligible for a future public edition; it does not publish immediately.</span>
          </div>
          <div className={styles.capabilityList}>
            <GuardedAdminLink className={styles.secondaryButton} href={`/admin/books/${encodeURIComponent(book.id)}/publication`}>
              Check publication status
            </GuardedAdminLink>
            <GuardedAdminLink className={styles.secondaryButton} href={`/admin/organize?book=${encodeURIComponent(book.id)}`}>
              Organize this book
            </GuardedAdminLink>
            <GuardedAdminLink className={styles.quietButton} href={`/books/${encodeURIComponent(book.slug || book.id)}`}>
              Preview public page
            </GuardedAdminLink>
          </div>
          <details className={styles.advanced}>
            <summary>Loaded source version</summary>
            <code>{version.replace(/^"|"$/g, "")}</code>
          </details>
        </aside>
      </div>

      <div className={styles.saveDock} role="status" aria-live="polite">
        <span>
          {supabaseWriteGateUnavailable
            ? dirty ? "Draft changes are stored on this phone; Supabase saving is locked" : "Supabase saving is locked"
            : recoveryLocksEditor
              ? "Resolve the phone recovery before editing or saving"
              : dirty ? "Book details have unsaved changes" : "Book details are saved"}
        </span>
        <button className={styles.primaryButton} type="button" disabled={!dirty || busy || recoveryLocksEditor || supabaseWriteGateUnavailable} onClick={() => void save()}>
          {busy ? "Saving..." : supabaseWriteGateUnavailable ? "Saving locked" : "Save details"}
        </button>
      </div>
    </>
  );
}
