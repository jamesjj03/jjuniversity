"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import CoverImage from "@/components/CoverImage";
import { GuardedAdminLink, useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import { coverFallbackSrc, coverWebpSrc } from "@/lib/cover";
import type { BookContent } from "@/lib/bookContent";
import {
  bookContentFromAdminPayload,
  mergeManuscriptDrafts,
  manuscriptDraftFromBook,
  manuscriptDraftsMatch,
  normalizeAdminVersion,
  parseManuscriptRecovery,
  type WorkshopManuscriptDraft,
  type WorkshopRecoveryEnvelope,
  type WorkshopDraftSection,
} from "@/lib/workshopManuscriptDraft";
import { workshopBookStatusLabel, type WorkshopBook } from "@/lib/workshopBooks";
import { rememberWorkshopRecent } from "@/lib/workshopRecent";
import styles from "./ManuscriptStudio.module.css";

type Props = {
  book: WorkshopBook;
  content: BookContent;
  initialVersion: string;
  initialSectionId?: string;
  returnHref: string;
};

type SaveResponse = Partial<BookContent> & {
  saved?: boolean;
  commit?: string;
  error?: string;
  note?: string;
};

type RecoveryState = {
  envelope: WorkshopRecoveryEnvelope | null;
  issue: string;
  blockedReason: string;
};

type ConflictState = {
  conflicts: string[];
  latestBook: BookContent;
  latestDraft: WorkshopManuscriptDraft;
  latestVersion: string;
  mergedDraft: WorkshopManuscriptDraft;
};

const AUTO_SAVE_DELAY_MS = 15000;
const LOCAL_RECOVERY_DELAY_MS = 850;

const SECTION_KINDS = [
  ["chapter", "Chapter"],
  ["title", "Title page"],
  ["dedication", "Dedication"],
  ["toc", "Contents"],
  ["acknowledgments", "Acknowledgments"],
  ["about-author", "About the author"],
  ["copyright", "Copyright / disclaimer"],
  ["guide", "Reader guide"],
  ["backmatter", "Back matter"],
  ["default", "Other"],
] as const;

function recoveryStorageKey(bookId: string) {
  return `jju.workshop.book-manuscript.${encodeURIComponent(bookId)}.v1`;
}

function sectionDomId(sectionId: string) {
  return `manuscript-section-${encodeURIComponent(sectionId)}`;
}

function formatSavedTime(value: Date | null) {
  if (!value) return "";
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type SectionBodyProps = {
  editable: boolean;
  epoch: number;
  html: string;
  locked: boolean;
  sectionId: string;
  sectionTitle: string;
  onFocusEditor: (sectionId: string, element: HTMLDivElement | null) => void;
  onHtmlChange: (sectionId: string, html: string) => void;
};

const MISSING_LINK_ATTRIBUTE = "__jju_missing__";
const EPHEMERAL_LINK_SELECTOR = [
  "[data-workshop-disabled-link]",
  "[data-workshop-original-tabindex]",
  "[data-workshop-original-aria-disabled]",
].join(",");
const editorsWithInertLinks = new WeakSet<HTMLDivElement>();

function markEmbeddedLink(editor: HTMLDivElement, anchor: HTMLAnchorElement) {
  editorsWithInertLinks.add(editor);
  if (!anchor.hasAttribute("data-workshop-disabled-link")) {
    anchor.setAttribute("data-workshop-original-tabindex", anchor.getAttribute("tabindex") ?? MISSING_LINK_ATTRIBUTE);
    anchor.setAttribute("data-workshop-original-aria-disabled", anchor.getAttribute("aria-disabled") ?? MISSING_LINK_ATTRIBUTE);
    anchor.setAttribute("data-workshop-disabled-link", "");
  }
  anchor.setAttribute("tabindex", "-1");
  anchor.setAttribute("aria-disabled", "true");
}

function markEmbeddedLinks(editor: HTMLDivElement) {
  const anchors = editor.querySelectorAll<HTMLAnchorElement>("a[href]");
  const hasEphemeralAttributes = editor.querySelector(EPHEMERAL_LINK_SELECTOR) !== null;
  if (anchors.length === 0 && !hasEphemeralAttributes) {
    editorsWithInertLinks.delete(editor);
    return;
  }
  editorsWithInertLinks.add(editor);
  anchors.forEach(anchor => markEmbeddedLink(editor, anchor));
}

function markEmbeddedLinksInAddedNode(editor: HTMLDivElement, node: Node) {
  if (!(node instanceof Element)) return;
  if (node.matches(EPHEMERAL_LINK_SELECTOR) || node.querySelector(EPHEMERAL_LINK_SELECTOR)) {
    editorsWithInertLinks.add(editor);
  }
  if (node instanceof HTMLAnchorElement && node.hasAttribute("href")) markEmbeddedLink(editor, node);
  node.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(anchor => markEmbeddedLink(editor, anchor));
}

function editorHtmlForSave(editor: HTMLDivElement) {
  if (!editorsWithInertLinks.has(editor)) return editor.innerHTML;
  const clone = editor.cloneNode(true) as HTMLDivElement;
  const ephemeralElements = clone.querySelectorAll<HTMLElement>(EPHEMERAL_LINK_SELECTOR);
  if (ephemeralElements.length === 0) {
    editorsWithInertLinks.delete(editor);
    return editor.innerHTML;
  }
  ephemeralElements.forEach(element => {
    if (element instanceof HTMLAnchorElement && element.hasAttribute("data-workshop-disabled-link")) {
      const originalTabIndex = element.getAttribute("data-workshop-original-tabindex");
      const originalAriaDisabled = element.getAttribute("data-workshop-original-aria-disabled");
      if (originalTabIndex === MISSING_LINK_ATTRIBUTE) element.removeAttribute("tabindex");
      else if (originalTabIndex !== null) element.setAttribute("tabindex", originalTabIndex);
      if (originalAriaDisabled === MISSING_LINK_ATTRIBUTE) element.removeAttribute("aria-disabled");
      else if (originalAriaDisabled !== null) element.setAttribute("aria-disabled", originalAriaDisabled);
    }
    element.removeAttribute("data-workshop-disabled-link");
    element.removeAttribute("data-workshop-original-tabindex");
    element.removeAttribute("data-workshop-original-aria-disabled");
  });
  return clone.innerHTML;
}

const SectionBody = memo(function SectionBody({
  editable,
  epoch,
  html,
  locked,
  sectionId,
  sectionTitle,
  onFocusEditor,
  onHtmlChange,
}: SectionBodyProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const appliedEpochRef = useRef(epoch);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const forceSync = appliedEpochRef.current !== epoch;
    appliedEpochRef.current = epoch;
    if (!forceSync && document.activeElement === editor) return;
    if (editorHtmlForSave(editor) !== html) editor.innerHTML = html;
    markEmbeddedLinks(editor);
  }, [epoch, html]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLAnchorElement) {
          if (record.target.hasAttribute("href")) markEmbeddedLink(editor, record.target);
          continue;
        }
        record.addedNodes.forEach(node => markEmbeddedLinksInAddedNode(editor, node));
      }
    });
    observer.observe(editor, {
      attributeFilter: ["href"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  function handleInput(event: FormEvent<HTMLDivElement>) {
    onHtmlChange(sectionId, editorHtmlForSave(event.currentTarget));
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function handleEmbeddedLink(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("a[href]")) {
      event.preventDefault();
    }
  }

  function handleEmbeddedLinkKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      (event.key === "Enter" || event.key === " ")
      && event.target instanceof Element
      && event.target.closest("a[href]")
    ) {
      event.preventDefault();
    }
  }

  return (
    <div
      ref={editorRef}
      className={editable ? styles.editableBody : styles.readBody}
      contentEditable={editable && !locked}
      data-manuscript-editor={sectionId}
      data-workshop-static-links
      role={editable ? "textbox" : undefined}
      aria-label={editable ? `Text for ${sectionTitle || "untitled section"}` : undefined}
      aria-multiline={editable ? true : undefined}
      suppressContentEditableWarning
      data-placeholder="Start writing…"
      onAuxClickCapture={handleEmbeddedLink}
      onClickCapture={handleEmbeddedLink}
      onFocus={event => onFocusEditor(sectionId, event.currentTarget)}
      onInput={handleInput}
      onKeyDownCapture={handleEmbeddedLinkKeyDown}
      onPaste={handlePaste}
    />
  );
}, (previous, next) => (
  previous.sectionId === next.sectionId
  && previous.editable === next.editable
  && previous.locked === next.locked
  && previous.html === next.html
  && previous.epoch === next.epoch
  && previous.sectionTitle === next.sectionTitle
  && previous.onFocusEditor === next.onFocusEditor
  && previous.onHtmlChange === next.onHtmlChange
));

type SectionCardProps = {
  active: boolean;
  editable: boolean;
  editorEpoch: number;
  locked: boolean;
  position: number;
  section: WorkshopDraftSection;
  total: number;
  onDelete: (sectionId: string) => void;
  onFocusEditor: (sectionId: string, element: HTMLDivElement | null) => void;
  onHtmlChange: (sectionId: string, html: string) => void;
  onInsertBelow: (sectionId: string) => void;
  onKindChange: (sectionId: string, kind: string) => void;
  onMove: (sectionId: string, direction: -1 | 1) => void;
  onTitleChange: (sectionId: string, title: string) => void;
};

const SectionCard = memo(function SectionCard({
  active,
  editable,
  editorEpoch,
  locked,
  position,
  section,
  total,
  onDelete,
  onFocusEditor,
  onHtmlChange,
  onInsertBelow,
  onKindChange,
  onMove,
  onTitleChange,
}: SectionCardProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false;
  }

  return (
    <article
      className={`${styles.sectionCard} ${active ? styles.activeSectionCard : ""}`}
      id={sectionDomId(section.id)}
      data-section-id={section.id}
      tabIndex={-1}
    >
      <header className={styles.sectionHeader}>
        <span className={styles.sectionNumber}>{position + 1}</span>
        {editable ? (
          <label className={styles.sectionLabelField}>
            <span>Contents label</span>
            <input
              className={styles.sectionTitleInput}
              value={section.title}
              aria-label={`Contents label for section ${position + 1}`}
              disabled={locked}
              onChange={event => onTitleChange(section.id, event.target.value)}
              onFocus={() => onFocusEditor(section.id, null)}
            />
          </label>
        ) : (
          <h2>{section.title}</h2>
        )}
        {editable && (
          <details ref={menuRef} className={styles.sectionMenu} onKeyDown={event => {
            if (event.key === "Escape") closeMenu();
          }}>
            <summary aria-label={`Options for ${section.title || `section ${position + 1}`}`}>Section options</summary>
            <div className={styles.sectionMenuPanel}>
              <label>
                What kind of section is this?
                <select
                  value={section.kind || "chapter"}
                  disabled={locked}
                  onChange={event => onKindChange(section.id, event.target.value)}
                >
                  {SECTION_KINDS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <div className={styles.sectionMenuActions}>
                <button type="button" disabled={locked} onClick={() => { closeMenu(); onInsertBelow(section.id); }}>Insert below</button>
                <button type="button" disabled={locked || position === 0} onClick={() => { closeMenu(); onMove(section.id, -1); }}>Move earlier</button>
                <button type="button" disabled={locked || position === total - 1} onClick={() => { closeMenu(); onMove(section.id, 1); }}>Move later</button>
                <button type="button" className={styles.dangerButton} disabled={locked || total <= 1} onClick={() => { closeMenu(); onDelete(section.id); }}>Delete section</button>
                <button type="button" className={styles.doneButton} onClick={closeMenu}>Done</button>
              </div>
            </div>
          </details>
        )}
      </header>

      <SectionBody
        editable={editable}
        epoch={editorEpoch}
        html={section.html}
        locked={locked}
        sectionId={section.id}
        sectionTitle={section.title}
        onFocusEditor={onFocusEditor}
        onHtmlChange={onHtmlChange}
      />
    </article>
  );
});

export default function ManuscriptStudio({
  book,
  content,
  initialVersion,
  initialSectionId = "",
  returnHref,
}: Props) {
  const initialDraft = useMemo(() => manuscriptDraftFromBook(content), [content]);
  const initialActiveSectionId = initialDraft.sections.some(section => section.id === initialSectionId)
    ? initialSectionId
    : initialDraft.selectedSectionId;
  const [draft, setDraft] = useState(initialDraft);
  const [baseline, setBaseline] = useState(initialDraft);
  const [version, setVersion] = useState(() => normalizeAdminVersion(initialVersion));
  const [activeSectionId, setActiveSectionId] = useState(initialActiveSectionId);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineQuery, setOutlineQuery] = useState("");
  const [editMode, setEditMode] = useState(true);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [localSavedAt, setLocalSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState("");
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [recoveryStorageError, setRecoveryStorageError] = useState("");

  const draftRef = useRef(draft);
  const baselineRef = useRef(baseline);
  const versionRef = useRef(version);
  const activeSectionRef = useRef(activeSectionId);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const baseBookRef = useRef(content);
  const activeEditorRef = useRef<HTMLDivElement | null>(null);
  const outlineDialogRef = useRef<HTMLElement | null>(null);
  const outlineCloseRef = useRef<HTMLButtonElement | null>(null);
  const outlineReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const conflictDialogRef = useRef<HTMLElement | null>(null);
  const conflictPrimaryRef = useRef<HTMLButtonElement | null>(null);
  const conflictReturnFocusRef = useRef<HTMLElement | null>(null);
  const draftIdRef = useRef("");
  const recoveryKey = recoveryStorageKey(book.id);
  const unsavedSource = `book-studio:${book.id}`;
  const { setUnsaved } = useAdminUnsavedChanges();

  const ensureDraftId = useCallback(() => {
    if (!draftIdRef.current) draftIdRef.current = `draft-${window.crypto.randomUUID()}`;
    return draftIdRef.current;
  }, []);

  const editorLocked = !recoveryChecked || Boolean(recovery) || Boolean(conflict);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  useEffect(() => {
    versionRef.current = version;
  }, [version]);

  useEffect(() => {
    activeSectionRef.current = activeSectionId;
  }, [activeSectionId]);

  useEffect(() => {
    if (!outlineOpen || !window.matchMedia("(max-width: 760px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOutlineOpen(false);
        window.requestAnimationFrame(() => outlineReturnFocusRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(outlineDialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      ) || [])];
      if (focusable.length === 0) {
        event.preventDefault();
        outlineDialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === outlineDialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => outlineCloseRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [outlineOpen]);

  useEffect(() => {
    if (!conflict) return;
    const previousOverflow = document.body.style.overflow;
    conflictReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...(conflictDialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      ) || [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => conflictPrimaryRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      const returnTarget = conflictReturnFocusRef.current;
      if (returnTarget?.isConnected) window.requestAnimationFrame(() => returnTarget.focus());
    };
  }, [conflict]);

  const navigationUnsafe = dirty && (Boolean(conflict) || !localSavedAt || Boolean(recoveryStorageError));

  useEffect(() => {
    dirtyRef.current = dirty;
    setUnsaved(unsavedSource, navigationUnsafe, `${book.title} manuscript`);
  }, [book.title, dirty, navigationUnsafe, setUnsaved, unsavedSource]);

  useEffect(() => () => setUnsaved(unsavedSource, false), [setUnsaved, unsavedSource]);

  const makeRecoveryEnvelope = useCallback((conflicts: string[] = []): WorkshopRecoveryEnvelope => ({
    schemaVersion: 2,
    draftId: ensureDraftId(),
    bookId: book.id,
    savedAt: new Date().toISOString(),
    baseContentVersion: normalizeAdminVersion(versionRef.current),
    conflicts,
    baseline: baselineRef.current,
    draft: {
      ...draftRef.current,
      selectedSectionId: activeSectionRef.current,
    },
  }), [book.id, ensureDraftId]);

  const writeRecovery = useCallback((conflicts: string[] = []) => {
    if (!dirtyRef.current) return true;
    try {
      const existingRaw = window.localStorage.getItem(recoveryKey);
      if (existingRaw) {
        const existing = parseManuscriptRecovery(existingRaw, book.id);
        if (!existing?.envelope || existing.envelope.draftId !== ensureDraftId()) {
          setLocalSavedAt(null);
          setRecoveryStorageError("Another tab has a device draft for this book. This tab will not overwrite it; keep this page open or save to the library.");
          return false;
        }
      }
      const envelope = makeRecoveryEnvelope(conflicts);
      window.localStorage.setItem(recoveryKey, JSON.stringify(envelope));
      const verified = parseManuscriptRecovery(window.localStorage.getItem(recoveryKey) || "", book.id);
      if (!verified?.envelope || verified.envelope.draftId !== envelope.draftId || verified.envelope.savedAt !== envelope.savedAt) {
        throw new Error("Device draft verification failed.");
      }
      setRecoveryStorageError("");
      setLocalSavedAt(new Date());
      return true;
    } catch {
      setRecoveryStorageError("This device could not preserve the latest draft. Keep this page open and use Save now.");
      return false;
    }
  }, [book.id, ensureDraftId, makeRecoveryEnvelope, recoveryKey]);

  const clearRecovery = useCallback((expectedDraftId = "", forceMalformed = false, expectedSavedAt = "") => {
    try {
      const ownedDraftId = expectedDraftId || ensureDraftId();
      const existingRaw = window.localStorage.getItem(recoveryKey);
      if (!existingRaw) {
        setRecoveryStorageError("");
        return true;
      }
      const existing = parseManuscriptRecovery(existingRaw, book.id);
      if (
        (!existing?.envelope && !forceMalformed)
        || (existing?.envelope && (
          existing.envelope.draftId !== ownedDraftId
          || (expectedSavedAt && existing.envelope.savedAt !== expectedSavedAt)
        ))
      ) {
        setLocalSavedAt(null);
        setRecoveryStorageError("A different device draft is stored for this book, so it was left untouched.");
        return false;
      }
      window.localStorage.removeItem(recoveryKey);
      setRecoveryStorageError("");
      return true;
    } catch {
      setRecoveryStorageError("The manuscript saved, but this device could not clear its older recovery copy.");
      return false;
    }
  }, [book.id, ensureDraftId, recoveryKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(recoveryKey);
        if (!raw) return;
        const result = parseManuscriptRecovery(raw, book.id);
        if (!result) return;
        if (!result.envelope) {
          setRecovery({ envelope: null, issue: result.issue, blockedReason: "" });
          return;
        }
        const blockedReason = normalizeAdminVersion(result.envelope.baseContentVersion) !== normalizeAdminVersion(initialVersion)
          ? "The library copy changed after this device saved the draft. The Workshop can merge them for review."
          : !manuscriptDraftsMatch(result.envelope.baseline, initialDraft)
            ? "The library copy no longer matches the draft's starting point. The Workshop can merge them for review."
            : result.envelope.conflicts.length > 0
              ? "This draft contains changes that still need a conflict decision."
            : "";
        if (!blockedReason && manuscriptDraftsMatch(result.envelope.draft, initialDraft)) {
          clearRecovery(result.envelope.draftId, false, result.envelope.savedAt);
        } else {
          setRecovery({ envelope: result.envelope, issue: "", blockedReason });
        }
      } catch {
        setRecovery({ envelope: null, issue: "The saved device draft could not be checked safely. It has not been deleted.", blockedReason: "" });
      } finally {
        setRecoveryChecked(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [book.id, clearRecovery, initialDraft, initialVersion, recoveryKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== recoveryKey || !dirtyRef.current) return;
      const stored = event.newValue ? parseManuscriptRecovery(event.newValue, book.id) : null;
      if (!stored?.envelope || stored.envelope.draftId !== ensureDraftId()) {
        setLocalSavedAt(null);
        setRecoveryStorageError("The device draft changed in another tab. Keep this page open until you save to the library.");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [book.id, ensureDraftId, recoveryKey]);

  useEffect(() => {
    if (!dirty || !recoveryChecked || recovery || conflict) return;
    const timer = window.setTimeout(writeRecovery, LOCAL_RECOVERY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, recovery, recoveryChecked, revision, writeRecovery]);

  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && !conflict) writeRecovery();
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [conflict, writeRecovery]);

  const mutateDraft = useCallback((change: (current: WorkshopManuscriptDraft) => WorkshopManuscriptDraft) => {
    setDraft(current => {
      const next = change(current);
      draftRef.current = next;
      return next;
    });
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    dirtyRef.current = true;
    setDirty(true);
    setLocalSavedAt(null);
    setSaveError("");
    setConflict(null);
  }, []);

  const updateSection = useCallback((sectionId: string, change: Partial<WorkshopDraftSection>) => {
    mutateDraft(current => ({
      ...current,
      sections: current.sections.map(section => section.id === sectionId ? { ...section, ...change } : section),
    }));
  }, [mutateDraft]);

  const handleHtmlChange = useCallback((sectionId: string, html: string) => {
    updateSection(sectionId, { html });
  }, [updateSection]);

  const handleTitleChange = useCallback((sectionId: string, title: string) => {
    updateSection(sectionId, { title });
  }, [updateSection]);

  const handleKindChange = useCallback((sectionId: string, kind: string) => {
    updateSection(sectionId, { kind });
  }, [updateSection]);

  const focusSection = useCallback((sectionId: string, element: HTMLDivElement | null) => {
    setActiveSectionId(sectionId);
    activeSectionRef.current = sectionId;
    activeEditorRef.current = element;
  }, []);

  const rememberSection = useCallback((sectionId: string) => {
    const position = draftRef.current.sections.findIndex(section => section.id === sectionId);
    if (position < 0) return;
    const section = draftRef.current.sections[position];
    const params = new URLSearchParams({ section: section.id });
    if (returnHref) params.set("from", returnHref);
    rememberWorkshopRecent({
      href: `/admin/books/${encodeURIComponent(book.id)}?${params.toString()}`,
      label: book.title,
      description: `Section ${position + 1} of ${draftRef.current.sections.length} · ${section.title || "Untitled section"}`,
      kind: "book",
    });
  }, [book.id, book.title, returnHref]);

  useEffect(() => {
    const timer = window.setTimeout(() => rememberSection(activeSectionRef.current), 0);
    return () => window.clearTimeout(timer);
  }, [rememberSection]);

  const scrollToSection = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId);
    activeSectionRef.current = sectionId;
    activeEditorRef.current = null;
    setOutlineOpen(false);
    rememberSection(sectionId);
    window.requestAnimationFrame(() => {
      const section = document.getElementById(sectionDomId(sectionId));
      section?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (window.matchMedia("(max-width: 760px)").matches) section?.focus({ preventScroll: true });
    });
  }, [rememberSection]);

  function openOutline(event: MouseEvent<HTMLButtonElement>) {
    if (!window.matchMedia("(max-width: 760px)").matches) {
      document.getElementById("manuscript-outline")?.focus({ preventScroll: true });
      return;
    }
    outlineReturnFocusRef.current = event.currentTarget;
    setOutlineOpen(true);
  }

  function closeOutline() {
    setOutlineOpen(false);
    window.requestAnimationFrame(() => outlineReturnFocusRef.current?.focus());
  }

  const moveSection = useCallback((sectionId: string, direction: -1 | 1) => {
    mutateDraft(current => {
      const index = current.sections.findIndex(section => section.id === sectionId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.sections.length) return current;
      const sections = [...current.sections];
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...current, sections: sections.map((section, position) => ({ ...section, index: position })) };
    });
  }, [mutateDraft]);

  const deleteSection = useCallback((sectionId: string) => {
    const current = draftRef.current;
    const index = current.sections.findIndex(section => section.id === sectionId);
    const section = current.sections[index];
    if (!section || current.sections.length <= 1) return;
    if (!window.confirm(`Delete “${section.title || `section ${index + 1}`}” from this manuscript?`)) return;
    const nextActive = current.sections[index + 1]?.id || current.sections[index - 1]?.id || "";
    mutateDraft(value => ({
      ...value,
      sections: value.sections
        .filter(item => item.id !== sectionId)
        .map((item, position) => ({ ...item, index: position })),
    }));
    setActiveSectionId(nextActive);
    activeSectionRef.current = nextActive;
    activeEditorRef.current = null;
  }, [mutateDraft]);

  const insertSectionAt = useCallback((requestedPosition: number) => {
    const current = draftRef.current;
    const position = Math.max(0, Math.min(requestedPosition, current.sections.length));
    const id = `section-${String(position + 1).padStart(3, "0")}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const section: WorkshopDraftSection = {
      id,
      index: position,
      title: "New section",
      kind: "chapter",
      html: "",
    };
    mutateDraft(value => {
      const sections = [...value.sections];
      sections.splice(position, 0, section);
      return { ...value, sections: sections.map((item, index) => ({ ...item, index })) };
    });
    setActiveSectionId(id);
    activeSectionRef.current = id;
    activeEditorRef.current = null;
    setEditorEpoch(value => value + 1);
    window.requestAnimationFrame(() => scrollToSection(id));
  }, [mutateDraft, scrollToSection]);

  const addSection = useCallback(() => {
    insertSectionAt(draftRef.current.sections.length);
  }, [insertSectionAt]);

  const insertSectionBelow = useCallback((sectionId: string) => {
    const index = draftRef.current.sections.findIndex(section => section.id === sectionId);
    insertSectionAt(index < 0 ? draftRef.current.sections.length : index + 1);
  }, [insertSectionAt]);

  const saveNow = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current || recovery || conflict) return;
    const submitted = {
      ...draftRef.current,
      selectedSectionId: activeSectionRef.current,
    };
    const submittedRevision = revisionRef.current;
    const expectedVersion = versionRef.current;
    const submittedBook: BookContent = {
      ...baseBookRef.current,
      title: submitted.contentTitle,
      creator: submitted.contentCreator,
      description: submitted.contentDescription,
      sections: submitted.sections.map((section, index) => ({
        ...section,
        index,
        text: undefined,
        wordCount: undefined,
      })),
    };

    writeRecovery();
    savingRef.current = true;
    setSaving(true);
    setSaveError("");

    try {
      const response = await fetch(`/api/admin/content/${encodeURIComponent(book.id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": expectedVersion,
        },
        body: JSON.stringify({
          sectionId: activeSectionRef.current,
          book: submittedBook,
          message: `Edit ${submitted.contentTitle || book.title} manuscript`,
        }),
      });
      const result = await response.json() as SaveResponse;
      if (!response.ok) {
        if (response.status === 409) {
          const latestResponse = await fetch(`/api/admin/content/${encodeURIComponent(book.id)}`, { cache: "no-store" });
          const latestResult = await latestResponse.json() as BookContent & { error?: string };
          const latestVersion = normalizeAdminVersion(latestResponse.headers.get("etag"));
          const latestBook = bookContentFromAdminPayload(latestResult, baseBookRef.current);
          if (!latestResponse.ok || !latestVersion || !latestBook) {
            throw new Error(latestResult.error || "Another copy changed, and the latest version could not be opened safely.");
          }
          const localAtMerge = {
            ...draftRef.current,
            selectedSectionId: activeSectionRef.current,
          };
          const latestDraft = manuscriptDraftFromBook(latestBook, localAtMerge.selectedSectionId);
          const merged = mergeManuscriptDrafts(baselineRef.current, localAtMerge, latestDraft);
          baseBookRef.current = latestBook;
          versionRef.current = latestVersion;
          baselineRef.current = latestDraft;
          draftRef.current = merged.draft;
          setVersion(latestVersion);
          setBaseline(latestDraft);
          setDraft(merged.draft);
          setActiveSectionId(merged.draft.selectedSectionId);
          activeSectionRef.current = merged.draft.selectedSectionId;
          revisionRef.current += 1;
          setRevision(revisionRef.current);
          dirtyRef.current = true;
          setDirty(true);
          setLocalSavedAt(null);
          setEditorEpoch(value => value + 1);

          if (merged.conflicts.length === 0) {
            writeRecovery();
          } else {
            setConflict({
              conflicts: merged.conflicts,
              latestBook,
              latestDraft,
              latestVersion,
              mergedDraft: merged.draft,
            });
            writeRecovery(merged.conflicts);
          }
          return;
        }
        throw new Error(result.error || "The manuscript could not be saved.");
      }
      const nextVersion = normalizeAdminVersion(response.headers.get("etag"));
      if (!result.saved || !nextVersion || !Array.isArray(result.sections)) {
        throw new Error("The save finished without a verified new version. The device draft is still preserved.");
      }

      const savedBook = bookContentFromAdminPayload(result, baseBookRef.current);
      if (!savedBook) {
        throw new Error("The save finished without a complete verified manuscript. The device draft is still preserved.");
      }
      const savedDraft = manuscriptDraftFromBook(savedBook, submitted.selectedSectionId);
      baseBookRef.current = savedBook;
      versionRef.current = nextVersion;
      baselineRef.current = savedDraft;
      setVersion(nextVersion);
      setBaseline(savedDraft);
      setSavedAt(new Date());

      if (revisionRef.current === submittedRevision) {
        const serverAdjusted = !manuscriptDraftsMatch(savedDraft, submitted);
        draftRef.current = savedDraft;
        setDraft(savedDraft);
        dirtyRef.current = false;
        setDirty(false);
        setLocalSavedAt(null);
        clearRecovery();
        if (serverAdjusted) {
          activeEditorRef.current?.blur();
          setEditorEpoch(value => value + 1);
        }
      } else {
        const currentLocal = {
          ...draftRef.current,
          selectedSectionId: activeSectionRef.current,
        };
        const rebased = mergeManuscriptDrafts(submitted, currentLocal, savedDraft).draft;
        draftRef.current = rebased;
        setDraft(rebased);
        baselineRef.current = savedDraft;
        setBaseline(savedDraft);
        dirtyRef.current = true;
        setDirty(true);
        setLocalSavedAt(null);
        writeRecovery();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The manuscript could not be saved.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [book.id, book.title, clearRecovery, conflict, recovery, writeRecovery]);

  useEffect(() => {
    if (!dirty || saving || !recoveryChecked || recovery || conflict || saveError) return;
    const timer = window.setTimeout(() => void saveNow(), AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [conflict, dirty, recovery, recoveryChecked, revision, saveError, saveNow, saving]);

  function downloadDraftCopy(envelope: WorkshopRecoveryEnvelope) {
    const safeTitle = (envelope.draft.contentTitle || book.title || book.id)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "manuscript";
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${safeTitle}-device-draft.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function restoreDeviceDraft() {
    if (!recovery?.envelope) return;
    const envelope = recovery.envelope;
    const currentBaseline = baselineRef.current;
    const needsMerge = normalizeAdminVersion(envelope.baseContentVersion) !== normalizeAdminVersion(versionRef.current)
      || !manuscriptDraftsMatch(envelope.baseline, currentBaseline);
    const restoredMerge = needsMerge
      ? mergeManuscriptDrafts(envelope.baseline, envelope.draft, currentBaseline)
      : { draft: envelope.draft, conflicts: [] };
    const restored = restoredMerge.draft;
    const conflicts = [...new Set([...envelope.conflicts, ...restoredMerge.conflicts])];
    const replacement: WorkshopRecoveryEnvelope = {
      schemaVersion: 2,
      draftId: ensureDraftId(),
      bookId: book.id,
      savedAt: new Date().toISOString(),
      baseContentVersion: normalizeAdminVersion(versionRef.current),
      conflicts,
      baseline: currentBaseline,
      draft: restored,
    };
    try {
      const currentRaw = window.localStorage.getItem(recoveryKey);
      const currentStored = currentRaw ? parseManuscriptRecovery(currentRaw, book.id) : null;
      if (
        !currentStored?.envelope
        || currentStored.envelope.draftId !== envelope.draftId
        || currentStored.envelope.savedAt !== envelope.savedAt
      ) {
        setLocalSavedAt(null);
        setRecoveryStorageError("The device draft changed in another tab, so this copy was not replaced. Reload before choosing which one to keep.");
        return;
      }
      window.localStorage.setItem(recoveryKey, JSON.stringify(replacement));
      const verified = parseManuscriptRecovery(window.localStorage.getItem(recoveryKey) || "", book.id);
      if (!verified?.envelope || verified.envelope.draftId !== replacement.draftId || verified.envelope.savedAt !== replacement.savedAt) {
        throw new Error("The restored draft could not be verified on this device.");
      }
      setRecoveryStorageError("");
      setLocalSavedAt(new Date());
    } catch {
      setLocalSavedAt(null);
      setRecoveryStorageError("The device could not safely replace the stored draft. The older copy was left in place when possible.");
      return;
    }
    draftRef.current = restored;
    setDraft(restored);
    setActiveSectionId(restored.selectedSectionId);
    activeSectionRef.current = restored.selectedSectionId;
    activeEditorRef.current = null;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    dirtyRef.current = true;
    setDirty(true);
    setRecovery(null);
    setEditorEpoch(value => value + 1);
    if (conflicts.length > 0) {
      setConflict({
        conflicts,
        latestBook: baseBookRef.current,
        latestDraft: currentBaseline,
        latestVersion: versionRef.current,
        mergedDraft: restored,
      });
    } else {
      setConflict(null);
    }
  }

  function discardDeviceDraft() {
    if (!window.confirm("Discard this device draft? This cannot be undone.")) return;
    const expectedDraftId = recovery?.envelope?.draftId || draftIdRef.current;
    if (!clearRecovery(expectedDraftId, !recovery?.envelope, recovery?.envelope?.savedAt || "")) return;
    setRecovery(null);
  }

  function keepLocalConflictChanges() {
    if (!conflict) return;
    baseBookRef.current = conflict.latestBook;
    versionRef.current = conflict.latestVersion;
    baselineRef.current = conflict.latestDraft;
    draftRef.current = conflict.mergedDraft;
    setVersion(conflict.latestVersion);
    setBaseline(conflict.latestDraft);
    setDraft(conflict.mergedDraft);
    setActiveSectionId(conflict.mergedDraft.selectedSectionId);
    activeSectionRef.current = conflict.mergedDraft.selectedSectionId;
    activeEditorRef.current = null;
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    dirtyRef.current = true;
    setDirty(true);
    setLocalSavedAt(null);
    setSaveError("");
    setConflict(null);
    setEditorEpoch(value => value + 1);
    writeRecovery();
  }

  function useLatestLibraryCopy() {
    if (!conflict) return;
    if (!window.confirm("Use the library copy and discard the edits in this device draft? This cannot be undone.")) return;
    baseBookRef.current = conflict.latestBook;
    versionRef.current = conflict.latestVersion;
    baselineRef.current = conflict.latestDraft;
    draftRef.current = conflict.latestDraft;
    setVersion(conflict.latestVersion);
    setBaseline(conflict.latestDraft);
    setDraft(conflict.latestDraft);
    setActiveSectionId(conflict.latestDraft.selectedSectionId);
    activeSectionRef.current = conflict.latestDraft.selectedSectionId;
    activeEditorRef.current = null;
    dirtyRef.current = false;
    setDirty(false);
    setLocalSavedAt(null);
    setSaveError("");
    setConflict(null);
    clearRecovery(draftIdRef.current);
    setEditorEpoch(value => value + 1);
  }

  function applyFormat(command: string, value?: string) {
    const editor = activeEditorRef.current;
    if (!editor || !editMode || editorLocked) return;
    const sectionId = editor.dataset.manuscriptEditor;
    if (!sectionId) return;
    editor.focus();
    document.execCommand(command, false, value);
    handleHtmlChange(sectionId, editorHtmlForSave(editor));
    markEmbeddedLinks(editor);
  }

  function keepSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  const outlineSections = useMemo(() => {
    const query = outlineQuery.trim().toLowerCase();
    return query
      ? draft.sections.filter(section => section.title.toLowerCase().includes(query))
      : draft.sections;
  }, [draft.sections, outlineQuery]);

  const activePosition = useMemo(() => {
    const position = draft.sections.findIndex(section => section.id === activeSectionId);
    return position >= 0 ? position : 0;
  }, [activeSectionId, draft.sections]);
  const activeSection = draft.sections[activePosition];

  const goToSection = useCallback((position: number) => {
    const section = draftRef.current.sections[position];
    if (!section) return;
    scrollToSection(section.id);
  }, [scrollToSection]);

  const statusText = conflict
    ? "Another copy changed — review needed"
    : saveError
    ? "Could not update the library"
    : saving
      ? "Updating the library…"
      : dirty
        ? localSavedAt
          ? `Safe on this device at ${formatSavedTime(localSavedAt)}`
          : "Preserving this draft…"
        : savedAt
          ? `Saved to the library at ${formatSavedTime(savedAt)}`
          : "Saved to the library";

  const publicHref = `/books/${encodeURIComponent(book.slug || book.id)}`;
  const detailsHref = `/admin/books/${encodeURIComponent(book.id)}/details?from=${encodeURIComponent(returnHref)}`;

  return (
    <div className={styles.studio}>
      <header className={styles.studioHeader}>
        <div className={styles.bookIdentity}>
          <div className={styles.cover}>
            <CoverImage
              alt=""
              fallbackSrc={coverFallbackSrc(book)}
              height={210}
              sizes="(max-width: 720px) 92px, 140px"
              src={coverWebpSrc(book)}
              width={140}
            />
          </div>
          <div className={styles.bookHeading}>
            <GuardedAdminLink href={returnHref}>← Back to where I was</GuardedAdminLink>
            <p>{workshopBookStatusLabel(book.status)} · {draft.sections.length} sections</p>
            <h1>{book.title}</h1>
            <span className={saveError ? styles.saveErrorText : styles.saveState}>{statusText}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button type="button" aria-expanded={outlineOpen} aria-controls="manuscript-outline" onClick={openOutline}>Contents</button>
          <button type="button" aria-pressed={!editMode} onClick={() => {
            activeEditorRef.current = null;
            setEditMode(value => !value);
          }}>{editMode ? "Read view" : "Keep editing"}</button>
          <GuardedAdminLink href={detailsHref}>Book details</GuardedAdminLink>
          <GuardedAdminLink href={publicHref}>Public page</GuardedAdminLink>
        </div>
      </header>

      {recovery && (
        <section className={styles.recoveryBanner} role="alert">
          <div>
            <strong>There is an unfinished draft on this device.</strong>
            <p>
              {recovery.envelope
                ? `${new Date(recovery.envelope.savedAt).toLocaleString()}. ${recovery.blockedReason || "It matches the library copy that is open now."} You can leave it stored and come back later.`
                : recovery.issue}
            </p>
          </div>
          <div>
            <button type="button" className={styles.primaryButton} disabled={!recovery.envelope} onClick={restoreDeviceDraft}>{recovery.blockedReason ? "Review and restore" : "Restore draft"}</button>
            {recovery.envelope && <button type="button" onClick={() => downloadDraftCopy(recovery.envelope!)}>Download exact copy</button>}
            <button type="button" onClick={discardDeviceDraft}>Discard device copy</button>
          </div>
        </section>
      )}

      {conflict && (
        <div className={styles.conflictOverlay}>
          <section ref={conflictDialogRef} className={styles.conflictDialog} role="dialog" aria-modal="true" aria-labelledby="manuscript-conflict-title">
            <div>
              <strong id="manuscript-conflict-title">Another copy changed while you were writing.</strong>
              <p>The Workshop kept changes that do not overlap. Choose which copy wins for the parts below.</p>
              <ul className={styles.conflictList}>
                {conflict.conflicts.map(item => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <button ref={conflictPrimaryRef} type="button" className={styles.primaryButton} onClick={keepLocalConflictChanges}>Keep my conflicting edits</button>
              <button type="button" onClick={() => downloadDraftCopy(makeRecoveryEnvelope(conflict.conflicts))}>Download my draft</button>
              <button type="button" className={styles.dangerButton} onClick={useLatestLibraryCopy}>Discard mine; use library</button>
            </div>
          </section>
        </div>
      )}

      {editMode && (
        <div className={styles.formatBar} role="toolbar" aria-label="Text formatting">
          <button type="button" className={styles.mobileContentsButton} aria-expanded={outlineOpen} aria-controls="manuscript-outline" onClick={openOutline}>Contents</button>
          <span>Format text</span>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("bold")}><strong>Bold</strong></button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("italic")}><em>Italic</em></button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("underline")}><u>Underline</u></button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("justifyCenter")}>Center</button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("justifyLeft")}>Align left</button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("formatBlock", "p")}>Body</button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("formatBlock", "h2")}>Chapter title</button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("formatBlock", "h3")}>Subheading</button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("formatBlock", "blockquote")}>Quote</button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("insertUnorderedList")}>Bullets</button>
          <button type="button" onMouseDown={keepSelection} onClick={() => applyFormat("removeFormat")}>Plain text</button>
        </div>
      )}

      <div className={styles.workspace}>
        <aside ref={outlineDialogRef} id="manuscript-outline" className={`${styles.outline} ${outlineOpen ? styles.outlineOpen : ""}`} aria-label="Manuscript contents" role={outlineOpen ? "dialog" : undefined} aria-modal={outlineOpen ? true : undefined} tabIndex={-1}>
          <div className={styles.outlineHeader}>
            <div>
              <strong>Contents</strong>
              <span>{draft.sections.length} sections</span>
            </div>
            <button ref={outlineCloseRef} type="button" onClick={closeOutline}>Close</button>
          </div>
          <label className={styles.outlineSearch}>
            Find a section
            <input type="search" value={outlineQuery} onChange={event => setOutlineQuery(event.target.value)} placeholder="Type a title" />
          </label>
          <nav className={styles.outlineList}>
            {outlineSections.map(section => {
              const position = draft.sections.findIndex(item => item.id === section.id);
              return (
                <button
                  type="button"
                  className={section.id === activeSectionId ? styles.activeOutlineItem : styles.outlineItem}
                  aria-current={section.id === activeSectionId ? "location" : undefined}
                  onClick={() => scrollToSection(section.id)}
                  key={section.id}
                >
                  <span>{position + 1}</span>
                  <strong>{section.title || "Untitled section"}</strong>
                </button>
              );
            })}
            {outlineSections.length === 0 && (
              <p className={styles.outlineEmpty}>No section titles match “{outlineQuery.trim()}”.</p>
            )}
          </nav>
          {editMode && <button type="button" className={styles.addSectionButton} disabled={editorLocked} onClick={addSection}>+ Add a section</button>}
        </aside>

        <section className={editMode ? styles.manuscript : styles.readingManuscript} aria-label={`${book.title} manuscript`}>
          <nav className={styles.sectionNavigator} aria-label="Move through manuscript sections above the editor">
            <button
              type="button"
              disabled={activePosition === 0}
              onClick={() => goToSection(activePosition - 1)}
            >
              <span aria-hidden="true">←</span> Previous
            </button>
            <div>
              <strong>{activePosition + 1} of {draft.sections.length}</strong>
              <span>{activeSection?.title || "Untitled section"}</span>
            </div>
            <button
              type="button"
              disabled={activePosition >= draft.sections.length - 1}
              onClick={() => goToSection(activePosition + 1)}
            >
              Next <span aria-hidden="true">→</span>
            </button>
          </nav>

          {activeSection && (
            <SectionCard
              active
              editable={editMode}
              editorEpoch={editorEpoch}
              key={activeSection.id}
              locked={editorLocked}
              position={activePosition}
              section={activeSection}
              total={draft.sections.length}
              onDelete={deleteSection}
              onFocusEditor={focusSection}
              onHtmlChange={handleHtmlChange}
              onInsertBelow={insertSectionBelow}
              onKindChange={handleKindChange}
              onMove={moveSection}
              onTitleChange={handleTitleChange}
            />
          )}

          <nav className={`${styles.sectionNavigator} ${styles.sectionNavigatorBottom}`} aria-label="Move through manuscript sections below the editor">
            <button
              type="button"
              disabled={activePosition === 0}
              onClick={() => goToSection(activePosition - 1)}
            >
              <span aria-hidden="true">←</span> Previous
            </button>
            <div>
              <strong>{activePosition + 1} of {draft.sections.length}</strong>
              <span>{activeSection?.title || "Untitled section"}</span>
            </div>
            <button
              type="button"
              disabled={activePosition >= draft.sections.length - 1}
              onClick={() => goToSection(activePosition + 1)}
            >
              Next <span aria-hidden="true">→</span>
            </button>
          </nav>
          {editMode && <button type="button" className={styles.endAddButton} disabled={editorLocked} onClick={addSection}>+ Add another section</button>}
        </section>
      </div>

      <div className={styles.saveDock} role="status" aria-live="polite">
        <div>
          <strong>{statusText}</strong>
          {saveError && <span>{saveError} Your device copy is still preserved.</span>}
          {recoveryStorageError && <span>{recoveryStorageError}</span>}
        </div>
        <button type="button" className={styles.primaryButton} disabled={!dirty || saving || Boolean(recovery) || Boolean(conflict)} onClick={() => void saveNow()}>
          {saving ? "Saving…" : dirty ? "Save now" : "Saved"}
        </button>
      </div>
    </div>
  );
}
