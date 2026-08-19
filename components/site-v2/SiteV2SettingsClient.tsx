"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyPreferencesV2ToDocument,
  DEFAULT_PREFERENCES_V2,
  PREFERENCES_EVENT,
  readPreferencesV2,
  type PreferencesV2,
  type ReaderFontV2,
  type ReaderSizeV2,
  type ReaderSpacingV2,
  type ReaderThemeV2,
  type ReaderWidthV2,
  type SiteAccentV2,
  type SiteThemeV2,
  writePreferencesV2,
} from "@/lib/preferencesV2";
import { SITE_V2_SAVED_KEY } from "@/lib/siteV2";
import styles from "./SiteV2.module.css";

const PROGRESS_KEY = "jju.readerProgress";
const READ_KEY = "jju.readBooks";
const READ_EVENTS_KEY = "jju.readingEvents";
const ACTUAL_TIME_KEY = "jju.actualReadingSeconds";
const HISTORY_KEY = "jju.readingHistory";
const BOOKMARKS_KEY = "jju.readerBookmarks";
const NOTES_KEY = "jju.readerNotes";
const QUOTES_KEY = "jju.readerQuotes";
const COMPATIBILITY_PREFERENCES_EVENT = "jju-preferences";
const SAVED_BOOKS_EVENT = "jju-saved-books";
const READING_HISTORY_EVENT = "jju-reading-history";

const PROGRESS_KEYS = [PROGRESS_KEY, READ_KEY, READ_EVENTS_KEY, ACTUAL_TIME_KEY, HISTORY_KEY] as const;
const READER_ARTIFACT_KEYS = [BOOKMARKS_KEY, NOTES_KEY, QUOTES_KEY] as const;

type ClearAction = "progress" | "saved" | "all";

type SiteV2SettingsClientProps = {
  bookIdentityMap: Record<string, string>;
  validBookIds: string[];
};

const SITE_THEMES: Array<{ value: SiteThemeV2; label: string; detail: string }> = [
  { value: "black", label: "Black", detail: "Deep black with warm type" },
  { value: "navy", label: "Navy", detail: "Dark blue with cool depth" },
  { value: "paper", label: "Paper", detail: "Warm light reading surface" },
];

const SITE_ACCENTS: Array<{ value: SiteAccentV2; label: string }> = [
  { value: "gold", label: "Gold" },
  { value: "blue", label: "Blue" },
  { value: "red", label: "Red" },
];

const READER_THEMES: Array<{ value: ReaderThemeV2; label: string }> = [
  { value: "paper", label: "Paper" },
  { value: "light", label: "Light" },
  { value: "night", label: "Night" },
];

const READER_FONTS: Array<{ value: ReaderFontV2; label: string }> = [
  { value: "literata", label: "Literata" },
  { value: "lexend", label: "Lexend" },
  { value: "bitter", label: "Bitter" },
];

const READER_SIZES: Array<{ value: ReaderSizeV2; label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra large" },
];

const READER_SPACING: Array<{ value: ReaderSpacingV2; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "relaxed", label: "Relaxed" },
  { value: "open", label: "Open" },
];

const READER_WIDTHS: Array<{ value: ReaderWidthV2; label: string }> = [
  { value: "focused", label: "Focused" },
  { value: "standard", label: "Standard" },
  { value: "wide", label: "Wide" },
];

function readStoredIds(key: string) {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function canonicalCount(
  ids: string[],
  bookIdentityMap: Record<string, string>,
  validBookIds: Set<string>,
) {
  const canonicalIds = new Set<string>();
  ids.forEach(rawId => {
    const id = rawId.trim();
    const canonicalId = bookIdentityMap[id] || bookIdentityMap[id.toLowerCase()];
    if (canonicalId && validBookIds.has(canonicalId)) canonicalIds.add(canonicalId);
  });
  return canonicalIds.size;
}

function dispatchReadingEvents({ saved = false }: { saved?: boolean } = {}) {
  window.dispatchEvent(new Event(READING_HISTORY_EVENT));
  if (saved) window.dispatchEvent(new Event(SAVED_BOOKS_EVENT));
}

export default function SiteV2SettingsClient({ bookIdentityMap, validBookIds }: SiteV2SettingsClientProps) {
  const [preferences, setPreferences] = useState<PreferencesV2>({ ...DEFAULT_PREFERENCES_V2 });
  const [savedCount, setSavedCount] = useState(0);
  const [readCount, setReadCount] = useState(0);
  const [pendingAction, setPendingAction] = useState<ClearAction | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const validBookIdSet = useMemo(() => new Set(validBookIds), [validBookIds]);

  const refresh = useCallback(() => {
    setPreferences(readPreferencesV2());
    setSavedCount(canonicalCount(readStoredIds(SITE_V2_SAVED_KEY), bookIdentityMap, validBookIdSet));
    setReadCount(canonicalCount(readStoredIds(READ_KEY), bookIdentityMap, validBookIdSet));
  }, [bookIdentityMap, validBookIdSet]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(refresh, 0);
    window.addEventListener(PREFERENCES_EVENT, refresh);
    window.addEventListener(COMPATIBILITY_PREFERENCES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener(SAVED_BOOKS_EVENT, refresh);
    window.addEventListener(READING_HISTORY_EVENT, refresh);

    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener(PREFERENCES_EVENT, refresh);
      window.removeEventListener(COMPATIBILITY_PREFERENCES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SAVED_BOOKS_EVENT, refresh);
      window.removeEventListener(READING_HISTORY_EVENT, refresh);
    };
  }, [refresh]);

  function patchPreferences(patch: Partial<PreferencesV2>) {
    const next = writePreferencesV2({ ...preferences, ...patch });
    applyPreferencesV2ToDocument(next);
    setPreferences(next);
  }

  function requestClear(action: ClearAction) {
    setAnnouncement("");
    setPendingAction(current => current === action ? null : action);
  }

  function confirmClear(action: ClearAction) {
    if (action === "progress" || action === "all") {
      PROGRESS_KEYS.forEach(key => window.localStorage.removeItem(key));
    }
    if (action === "saved" || action === "all") {
      window.localStorage.removeItem(SITE_V2_SAVED_KEY);
    }
    if (action === "all") {
      READER_ARTIFACT_KEYS.forEach(key => window.localStorage.removeItem(key));
    }

    dispatchReadingEvents({ saved: action === "saved" || action === "all" });
    refresh();
    setPendingAction(null);
    setAnnouncement(
      action === "progress"
        ? "Progress and reading history cleared."
        : action === "saved"
          ? "Saved Books cleared."
          : "All local reading data cleared. Your account wasn't changed.",
    );
  }

  return (
    <div className={styles.settingsPage}>
      <header className={styles.settingsHeader}>
        <h1>Settings</h1>
      </header>

      <div className={styles.settingsSections}>
        <section className={styles.settingsPanel} aria-labelledby="site-settings-heading">
          <div className={styles.settingsPanelHeader}>
            <h2 id="site-settings-heading">Site</h2>
          </div>

          <fieldset className={styles.settingsFieldset}>
            <legend>Appearance</legend>
            <div className={styles.appearanceChoices}>
              {SITE_THEMES.map(option => (
                <button
                  aria-pressed={preferences.siteTheme === option.value}
                  className={styles.appearanceChoice}
                  data-selected={preferences.siteTheme === option.value}
                  data-site-preview={option.value}
                  key={option.value}
                  onClick={() => patchPreferences({ siteTheme: option.value })}
                  type="button"
                >
                  <span className={styles.appearancePreview} aria-hidden="true">
                    <span />
                    <span />
                  </span>
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.settingsFieldset}>
            <legend>Highlight</legend>
            <div className={styles.highlightChoices}>
              {SITE_ACCENTS.map(option => (
                <button
                  aria-pressed={preferences.siteAccent === option.value}
                  className={styles.highlightChoice}
                  data-accent-preview={option.value}
                  data-selected={preferences.siteAccent === option.value}
                  key={option.value}
                  onClick={() => patchPreferences({ siteAccent: option.value })}
                  type="button"
                >
                  <span aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className={styles.settingsPanel} aria-labelledby="reader-settings-heading">
          <div className={styles.settingsPanelHeader}>
            <h2 id="reader-settings-heading">Reader</h2>
          </div>

          <ReaderChoice
            label="Theme"
            options={READER_THEMES}
            value={preferences.readerTheme}
            onChange={value => patchPreferences({ readerTheme: value as ReaderThemeV2 })}
          />
          <ReaderChoice
            label="Font"
            options={READER_FONTS}
            value={preferences.readerFont}
            onChange={value => patchPreferences({ readerFont: value as ReaderFontV2 })}
          />
          <ReaderChoice
            label="Text size"
            options={READER_SIZES}
            value={preferences.readerSize}
            onChange={value => patchPreferences({ readerSize: value as ReaderSizeV2 })}
          />
          <ReaderChoice
            label="Line spacing"
            options={READER_SPACING}
            value={preferences.readerSpacing}
            onChange={value => patchPreferences({ readerSpacing: value as ReaderSpacingV2 })}
          />
          <ReaderChoice
            label="Page width"
            options={READER_WIDTHS}
            value={preferences.readerWidth}
            onChange={value => patchPreferences({ readerWidth: value as ReaderWidthV2 })}
          />

          <label className={styles.rememberChoice}>
            <input
              checked={preferences.saveProgress}
              onChange={event => patchPreferences({ saveProgress: event.target.checked })}
              type="checkbox"
            />
            <span>
              <strong>Automatically remember my place</strong>
              <small>Your reading progress stays in this browser unless account sync is on.</small>
            </span>
          </label>
        </section>

        <section className={styles.settingsPanel} aria-labelledby="data-settings-heading">
          <div className={styles.settingsPanelHeader}>
            <h2 id="data-settings-heading">Reading data</h2>
          </div>

          <div className={styles.readingStats} aria-label="Reading data totals">
            <div>
              <strong>{savedCount}</strong>
              <span>Saved books</span>
            </div>
            <div>
              <strong>{readCount}</strong>
              <span>Read books</span>
            </div>
          </div>

          <div className={styles.clearActions}>
            <ClearActionRow
              action="progress"
              description="Removes your place, completed status, reading events, time, and recent history from this browser."
              isPending={pendingAction === "progress"}
              label="Clear progress and history"
              onCancel={() => setPendingAction(null)}
              onConfirm={() => confirmClear("progress")}
              onRequest={() => requestClear("progress")}
            />
            <ClearActionRow
              action="saved"
              description="Removes every book from Saved Books on this device."
              isPending={pendingAction === "saved"}
              label="Clear Saved Books"
              onCancel={() => setPendingAction(null)}
              onConfirm={() => confirmClear("saved")}
              onRequest={() => requestClear("saved")}
            />
            <ClearActionRow
              action="all"
              description="Removes progress, history, saved books, bookmarks, notes, and quotes from this browser. Your account and sign-in stay untouched."
              isPending={pendingAction === "all"}
              label="Clear all local reading data"
              onCancel={() => setPendingAction(null)}
              onConfirm={() => confirmClear("all")}
              onRequest={() => requestClear("all")}
            />
          </div>

          <p className={styles.settingsAnnouncement} aria-live="polite">{announcement}</p>
        </section>
      </div>
    </div>
  );
}

type ReaderChoiceProps = {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
};

function ReaderChoice({ label, options, value, onChange }: ReaderChoiceProps) {
  return (
    <div className={styles.readerChoice}>
      <span className={styles.readerChoiceLabel}>{label}</span>
      <div role="group" aria-label={label}>
        {options.map(option => (
          <button
            aria-pressed={value === option.value}
            data-selected={value === option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type ClearActionRowProps = {
  action: ClearAction;
  description: string;
  isPending: boolean;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
  onRequest: () => void;
};

function ClearActionRow({
  action,
  description,
  isPending,
  label,
  onCancel,
  onConfirm,
  onRequest,
}: ClearActionRowProps) {
  const confirmationId = `clear-${action}-confirmation`;

  return (
    <div className={styles.clearActionRow}>
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        aria-controls={confirmationId}
        aria-expanded={isPending}
        className={styles.settingsClearButton}
        onClick={onRequest}
        type="button"
      >
        Clear
      </button>
      {isPending ? (
        <div className={styles.clearConfirmation} id={confirmationId} role="group" aria-label={`Confirm ${label}`}>
          <strong>Are you sure?</strong>
          <div>
            <button className={styles.settingsCancelButton} onClick={onCancel} type="button">Cancel</button>
            <button className={styles.settingsConfirmButton} onClick={onConfirm} type="button">Yes, clear it</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
