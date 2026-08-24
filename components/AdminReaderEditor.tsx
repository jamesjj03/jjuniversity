"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Book = {
  id: string;
  title: string;
  coverFile?: string;
};

type Section = {
  id: string;
  index: number;
  title: string;
  kind?: string;
  html: string;
  text?: string;
  wordCount?: number;
};

type ContentBook = {
  id: string;
  title: string;
  creator?: string;
  description?: string;
  contentFile?: string;
  contentSource?: string;
  sections: Section[];
};

type Props = {
  book: Book;
  onDirtyChange?: (dirty: boolean) => void;
  recoveryStorageKey?: string;
  showContentMetadata?: boolean;
};

type RecoverySection = Pick<Section, "id" | "index" | "title" | "kind" | "html">;

type ManuscriptSnapshot = {
  contentTitle: string;
  contentCreator: string;
  contentDescription: string;
  selectedSectionId: string;
  sections: RecoverySection[];
};

type ManuscriptRecoveryEnvelope = {
  schemaVersion: 1;
  bookId: string;
  savedAt: string;
  baseContentVersion: string;
  baseline: ManuscriptSnapshot;
  draft: ManuscriptSnapshot;
};

type RecoveryReadResult =
  | { envelope: ManuscriptRecoveryEnvelope; issue: "" }
  | { envelope: null; issue: string }
  | null;

const SECTION_KINDS = ["chapter", "title", "dedication", "toc", "acknowledgments", "about", "copyright", "backmatter", "default"];
const MANUSCRIPT_RECOVERY_SCHEMA_VERSION = 1;

function snapshotSection(section: Section, index: number): RecoverySection {
  return {
    id: section.id,
    index,
    title: section.title,
    kind: section.kind || "chapter",
    html: section.html,
  };
}

function manuscriptSnapshot({
  contentTitle,
  contentCreator,
  contentDescription,
  selectedSectionId,
  sections,
}: {
  contentTitle: string;
  contentCreator: string;
  contentDescription: string;
  selectedSectionId: string;
  sections: Section[];
}): ManuscriptSnapshot {
  return {
    contentTitle,
    contentCreator,
    contentDescription,
    selectedSectionId,
    sections: sections.map(snapshotSection),
  };
}

function comparableSnapshot(snapshot: ManuscriptSnapshot) {
  return {
    contentTitle: snapshot.contentTitle,
    contentCreator: snapshot.contentCreator,
    contentDescription: snapshot.contentDescription,
    sections: snapshot.sections,
  };
}

function snapshotsMatch(left: ManuscriptSnapshot, right: ManuscriptSnapshot) {
  return JSON.stringify(comparableSnapshot(left)) === JSON.stringify(comparableSnapshot(right));
}

function parseSnapshot(value: unknown): ManuscriptSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.contentTitle !== "string"
    || typeof record.contentCreator !== "string"
    || typeof record.contentDescription !== "string"
    || typeof record.selectedSectionId !== "string"
    || !Array.isArray(record.sections)
    || record.sections.length === 0
  ) return null;

  const sections: RecoverySection[] = [];
  const ids = new Set<string>();
  for (const [index, valueSection] of record.sections.entries()) {
    if (!valueSection || typeof valueSection !== "object") return null;
    const section = valueSection as Record<string, unknown>;
    if (
      typeof section.id !== "string"
      || !section.id
      || ids.has(section.id)
      || typeof section.title !== "string"
      || typeof section.html !== "string"
      || (section.kind !== undefined && typeof section.kind !== "string")
    ) return null;
    ids.add(section.id);
    sections.push({
      id: section.id,
      index,
      title: section.title,
      kind: section.kind || "chapter",
      html: section.html,
    });
  }

  return {
    contentTitle: record.contentTitle,
    contentCreator: record.contentCreator,
    contentDescription: record.contentDescription,
    selectedSectionId: ids.has(record.selectedSectionId) ? record.selectedSectionId : sections[0].id,
    sections,
  };
}

function readRecovery(storageKey: string, bookId: string): RecoveryReadResult {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { envelope: null, issue: "The saved phone draft is not readable. It has not been deleted." };
    }
    const record = parsed as Record<string, unknown>;
    const baseline = parseSnapshot(record.baseline);
    const draft = parseSnapshot(record.draft);
    if (
      record.schemaVersion !== MANUSCRIPT_RECOVERY_SCHEMA_VERSION
      || record.bookId !== bookId
      || typeof record.savedAt !== "string"
      || !Number.isFinite(Date.parse(record.savedAt))
      || typeof record.baseContentVersion !== "string"
      || !record.baseContentVersion
      || !baseline
      || !draft
    ) {
      return { envelope: null, issue: "The saved phone draft uses an unknown or incomplete format. It has not been deleted." };
    }
    return {
      envelope: {
        schemaVersion: MANUSCRIPT_RECOVERY_SCHEMA_VERSION,
        bookId,
        savedAt: record.savedAt,
        baseContentVersion: record.baseContentVersion,
        baseline,
        draft,
      },
      issue: "",
    };
  } catch {
    return { envelope: null, issue: "The saved phone draft could not be opened safely. It has not been deleted." };
  }
}

function writeRecovery(storageKey: string, envelope: ManuscriptRecoveryEnvelope) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(envelope));
    return "";
  } catch {
    return "This phone could not update the recovery draft. Keep this page open until the manuscript saves.";
  }
}

function removeRecovery(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
    return window.localStorage.getItem(storageKey) === null;
  } catch {
    return false;
  }
}

function readerStyle() {
  return `
    .adminReaderDoc {
      min-height: 560px;
      padding: clamp(24px, 4vw, 48px);
      background: #f4ead9;
      color: #251d14;
      border-radius: 8px;
      outline: none;
      font-family: Verdana, Tahoma, Arial, sans-serif;
      font-size: 20px;
      line-height: 1.72;
      overflow-wrap: break-word;
    }
    .adminReaderDoc h1, .adminReaderDoc h2, .adminReaderDoc h3 { color: #140f09; line-height: 1.15; }
    .adminReaderDoc h1:first-child, .adminReaderDoc h2:first-child, .adminReaderDoc h3:first-child,
    .adminReaderDoc .bordered-title, .adminReaderDoc .chapter-title, .adminReaderDoc .page-title {
      display: block;
      text-align: center;
      margin-left: auto;
      margin-right: auto;
    }
    .adminReaderDoc img { max-width: 100%; height: auto; display: block; margin: 18px auto; }
  `;
}

export default function AdminReaderEditor({ book, onDirtyChange, recoveryStorageKey, showContentMetadata = true }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const injectedHtmlRef = useRef("");
  const dirtyCallbackRef = useRef(onDirtyChange);
  const bookTitleRef = useRef(book.title);
  const recoveryTimerRef = useRef<number | null>(null);
  const latestRecoveryRef = useRef<ManuscriptRecoveryEnvelope | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [html, setHtml] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionKind, setSectionKind] = useState("chapter");
  const [contentTitle, setContentTitle] = useState(book.title);
  const [contentCreator, setContentCreator] = useState("");
  const [contentDescription, setContentDescription] = useState("");
  const [contentFile, setContentFile] = useState("");
  const [editMode, setEditMode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [contentVersion, setContentVersion] = useState("");
  const [baseline, setBaseline] = useState<ManuscriptSnapshot | null>(null);
  const [recovery, setRecovery] = useState<ManuscriptRecoveryEnvelope | null>(null);
  const [recoveryIssue, setRecoveryIssue] = useState("");
  const [recoveryChecked, setRecoveryChecked] = useState(!recoveryStorageKey);
  const [recoveryStorageError, setRecoveryStorageError] = useState("");

  const section = useMemo(() => sections.find(item => item.id === sectionId) || sections[0], [sectionId, sections]);
  const recoveryDecisionPending = Boolean(recovery || recoveryIssue);
  const editorLocked = busy || Boolean(loadError) || !recoveryChecked || recoveryDecisionPending;
  const recoveryBlockedReason = useMemo(() => {
    if (!recovery) return "";
    if (recovery.baseContentVersion !== contentVersion) {
      return "The live manuscript changed after this phone draft was created. Restore is blocked so the newer manuscript cannot be overwritten.";
    }
    if (!baseline || !snapshotsMatch(recovery.baseline, baseline)) {
      return "The loaded manuscript no longer matches this draft’s safe baseline. Restore is blocked until the versions can be reconciled manually.";
    }
    return "";
  }, [baseline, contentVersion, recovery]);
  const draftSnapshot = useMemo(() => manuscriptSnapshot({
    contentTitle,
    contentCreator,
    contentDescription,
    selectedSectionId: section?.id || "",
    sections: sections.map((item, index) => item.id === section?.id ? {
      ...item,
      index,
      title: sectionTitle,
      kind: sectionKind,
      html,
      text: undefined,
      wordCount: undefined,
    } : { ...item, index }),
  }), [contentCreator, contentDescription, contentTitle, html, section?.id, sectionKind, sectionTitle, sections]);

  useEffect(() => {
    dirtyCallbackRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    bookTitleRef.current = book.title;
  }, [book.title]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => dirtyCallbackRef.current?.(false), []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
      latestRecoveryRef.current = null;
      setBusy(true);
      setLoadError("");
      setSections([]);
      setSectionId("");
      setHtml("");
      setContentVersion("");
      setBaseline(null);
      setRecovery(null);
      setRecoveryIssue("");
      setRecoveryChecked(!recoveryStorageKey);
      setRecoveryStorageError("");
      setDirty(false);
      setMessage("Loading JSON content editor...");
    });

    fetch(`/api/admin/content/${encodeURIComponent(book.id)}`)
      .then(async response => {
        const data = await response.json() as ContentBook & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load book content.");
        const nextVersion = response.headers.get("etag");
        if (!nextVersion) throw new Error("The manuscript source returned no version. Editing is locked until it is reloaded safely.");
        if (cancelled) return;
        const nextSections = Array.isArray(data.sections) ? [...data.sections].sort((a, b) => a.index - b.index) : [];
        const first = nextSections[0];
        const nextTitle = data.title || bookTitleRef.current;
        const nextCreator = data.creator || "";
        const nextDescription = data.description || "";
        const nextBaseline = manuscriptSnapshot({
          contentTitle: nextTitle,
          contentCreator: nextCreator,
          contentDescription: nextDescription,
          selectedSectionId: first?.id || "",
          sections: nextSections,
        });
        setSections(nextSections);
        setSectionId(first?.id || "");
        setHtml(first?.html || "");
        setSectionTitle(first?.title || "");
        setSectionKind(first?.kind || "chapter");
        setContentTitle(nextTitle);
        setContentCreator(nextCreator);
        setContentDescription(nextDescription);
        setContentFile(data.contentFile || "");
        setContentVersion(nextVersion);
        setBaseline(nextBaseline);
        if (recoveryStorageKey) {
          const savedRecovery = readRecovery(recoveryStorageKey, book.id);
          setRecovery(savedRecovery?.envelope || null);
          setRecoveryIssue(savedRecovery?.issue || "");
          setRecoveryChecked(true);
        }
        setDirty(false);
        setMessage(`${nextSections.length} sections ready${data.contentFile ? ` from ${data.contentFile}` : ""}${data.contentSource ? ` (${data.contentSource})` : ""}.`);
      })
      .catch(error => {
        if (!cancelled) {
          const nextMessage = error instanceof Error ? error.message : "Could not load book content.";
          setLoadError(nextMessage);
          setMessage(nextMessage);
          setSections([]);
          setSectionId("");
          setHtml("");
          setContentVersion("");
          setBaseline(null);
          setDirty(false);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [book.id, recoveryStorageKey]);

  useEffect(() => {
    const node = editorRef.current;
    if (!node || injectedHtmlRef.current === html) return;
    node.innerHTML = html;
    injectedHtmlRef.current = html;
  }, [html, section?.id]);

  useEffect(() => {
    if (
      !recoveryStorageKey
      || !recoveryChecked
      || !dirty
      || !contentVersion
      || !baseline
      || recoveryDecisionPending
      || draftSnapshot.sections.length === 0
    ) {
      if (!dirty) latestRecoveryRef.current = null;
      return;
    }

    const envelope: ManuscriptRecoveryEnvelope = {
      schemaVersion: MANUSCRIPT_RECOVERY_SCHEMA_VERSION,
      bookId: book.id,
      savedAt: new Date().toISOString(),
      baseContentVersion: contentVersion,
      baseline,
      draft: draftSnapshot,
    };
    latestRecoveryRef.current = envelope;
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => {
      const error = writeRecovery(recoveryStorageKey, envelope);
      setRecoveryStorageError(error);
      recoveryTimerRef.current = null;
    }, 180);

    return () => {
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
  }, [baseline, book.id, contentVersion, dirty, draftSnapshot, recoveryChecked, recoveryDecisionPending, recoveryStorageKey]);

  useEffect(() => {
    if (!recoveryStorageKey) return;
    const flushRecovery = () => {
      const envelope = latestRecoveryRef.current;
      if (envelope) writeRecovery(recoveryStorageKey, envelope);
    };
    const flushHiddenRecovery = () => {
      if (document.visibilityState === "hidden") flushRecovery();
    };
    window.addEventListener("pagehide", flushRecovery);
    document.addEventListener("visibilitychange", flushHiddenRecovery);
    return () => {
      window.removeEventListener("pagehide", flushRecovery);
      document.removeEventListener("visibilitychange", flushHiddenRecovery);
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
  }, [recoveryStorageKey]);

  function chooseSection(id: string) {
    if (id === section?.id) return;
    if (dirty) {
      setMessage("Save this manuscript before switching sections.");
      return;
    }
    const next = sections.find(item => item.id === id);
    setSectionId(id);
    setHtml(next?.html || "");
    setSectionTitle(next?.title || "");
    setSectionKind(next?.kind || "chapter");
    setDirty(false);
  }

  function syncFromEditor() {
    const nextHtml = editorRef.current?.innerHTML || "";
    injectedHtmlRef.current = nextHtml;
    setHtml(nextHtml);
    setDirty(true);
  }

  function currentHtml() {
    return editorRef.current?.innerHTML || html;
  }

  function sectionsForSave(nextHtml = currentHtml()) {
    return sections.map((item, index) => {
      if (item.id !== section?.id) return { ...item, index };
      return {
        ...item,
        index,
        title: sectionTitle,
        kind: sectionKind,
        html: nextHtml,
        text: undefined,
        wordCount: undefined,
      };
    });
  }

  function restoreRecoveryDraft() {
    if (!recovery || recoveryBlockedReason || !baseline) return;
    const liveById = new Map(sections.map(item => [item.id, item]));
    const restoredSections = recovery.draft.sections.map((savedSection, index): Section => ({
      ...(liveById.get(savedSection.id) || {}),
      ...savedSection,
      index,
      text: undefined,
      wordCount: undefined,
    }));
    const selectedId = restoredSections.some(item => item.id === recovery.draft.selectedSectionId)
      ? recovery.draft.selectedSectionId
      : restoredSections[0]?.id || "";
    const selected = restoredSections.find(item => item.id === selectedId) || restoredSections[0];

    setSections(restoredSections);
    setSectionId(selected?.id || "");
    setHtml(selected?.html || "");
    setSectionTitle(selected?.title || "");
    setSectionKind(selected?.kind || "chapter");
    setContentTitle(recovery.draft.contentTitle);
    setContentCreator(recovery.draft.contentCreator);
    setContentDescription(recovery.draft.contentDescription);
    setRecovery(null);
    setRecoveryIssue("");
    setDirty(true);
    setMessage(`Restored the phone draft saved ${new Date(recovery.savedAt).toLocaleString()}. Review it, then save the manuscript.`);
  }

  function discardRecoveryDraft() {
    if (!recoveryStorageKey) return;
    if (!removeRecovery(recoveryStorageKey)) {
      setMessage("This phone could not discard the recovery draft. It remains stored; try again before editing.");
      return;
    }
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = null;
    latestRecoveryRef.current = null;
    setRecovery(null);
    setRecoveryIssue("");
    setRecoveryStorageError("");
    setMessage("Discarded the phone recovery draft. The loaded manuscript was not changed.");
  }

  function markDirty() {
    setDirty(true);
  }

  function addSection() {
    if (dirty) {
      setMessage("Save this manuscript before adding another section.");
      return;
    }
    const nextIndex = sections.length;
    const nextId = `section-${String(nextIndex + 1).padStart(3, "0")}-${Date.now().toString(36)}`;
    const nextSection: Section = {
      id: nextId,
      index: nextIndex,
      title: `Section ${nextIndex + 1}`,
      kind: "chapter",
      html: "<p>Start writing here.</p>",
      text: "Start writing here.",
      wordCount: 3,
    };

    setSections(current => [...current, nextSection]);
    setSectionId(nextId);
    setHtml(nextSection.html);
    setSectionTitle(nextSection.title);
    setSectionKind(nextSection.kind || "chapter");
    setDirty(true);
    setMessage("New section added. Save JSON when it looks right.");
  }

  function deleteSection() {
    if (!section || sections.length <= 1) return;
    if (dirty) {
      setMessage("Save this manuscript before deleting a section.");
      return;
    }
    const nextSections = sections
      .filter(item => item.id !== section.id)
      .map((item, index) => ({ ...item, index }));
    const next = nextSections[Math.min(sectionIndex(), nextSections.length - 1)] || nextSections[0];

    setSections(nextSections);
    setSectionId(next?.id || "");
    setHtml(next?.html || "");
    setSectionTitle(next?.title || "");
    setSectionKind(next?.kind || "chapter");
    setDirty(true);
    setMessage("Section removed locally. Save JSON to commit it.");
  }

  function sectionIndex() {
    return Math.max(0, sections.findIndex(item => item.id === section?.id));
  }

  function moveSection(direction: -1 | 1) {
    if (!section) return;
    if (dirty) {
      setMessage("Save this manuscript before changing the section order.");
      return;
    }
    const currentIndex = sectionIndex();
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= sections.length) return;
    const reordered = [...sections];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    setSections(reordered.map((item, index) => ({ ...item, index })));
    setDirty(true);
    setMessage(`Moved “${section.title}” ${direction < 0 ? "earlier" : "later"}. Save Manuscript to keep the new order.`);
  }

  function runEditorCommand(command: string, value?: string) {
    if (!editorRef.current || !editMode) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    syncFromEditor();
  }

  function setBlock(tag: "p" | "h1" | "h2" | "h3" | "blockquote") {
    runEditorCommand("formatBlock", tag);
  }

  async function saveSection() {
    if (!section || !contentVersion || !baseline || recoveryDecisionPending) {
      setMessage("Reload this manuscript before saving; its source version is missing.");
      return;
    }
    const nextHtml = currentHtml();
    const submittedSections = sectionsForSave(nextHtml);
    if (recoveryStorageKey) {
      const pendingEnvelope: ManuscriptRecoveryEnvelope = {
        schemaVersion: MANUSCRIPT_RECOVERY_SCHEMA_VERSION,
        bookId: book.id,
        savedAt: new Date().toISOString(),
        baseContentVersion: contentVersion,
        baseline,
        draft: manuscriptSnapshot({
          contentTitle,
          contentCreator,
          contentDescription,
          selectedSectionId: section.id,
          sections: submittedSections,
        }),
      };
      latestRecoveryRef.current = pendingEnvelope;
      const recoveryError = writeRecovery(recoveryStorageKey, pendingEnvelope);
      setRecoveryStorageError(recoveryError);
    }
    setBusy(true);
    setMessage("Saving JSON content...");

    try {
      const response = await fetch(`/api/admin/content/${encodeURIComponent(book.id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": contentVersion,
        },
        body: JSON.stringify({
          sectionId: section.id,
          html: nextHtml,
          title: sectionTitle,
          kind: sectionKind,
          book: {
            title: contentTitle,
            creator: contentCreator,
            description: contentDescription,
            sections: submittedSections,
          },
          message: `Edit ${contentTitle || book.title} JSON content`,
        }),
      });
      const data = await response.json() as ContentBook & { commit?: string; error?: string; note?: string; saved?: boolean };
      if (!response.ok) throw new Error(data.error || "Save failed.");
      const nextVersion = response.headers.get("etag");
      if (!data.saved || !nextVersion) throw new Error("The manuscript save could not be verified with a new source version. Your phone draft is still preserved.");
      const nextSections = Array.isArray(data.sections) ? [...data.sections].sort((a: Section, b: Section) => a.index - b.index) : submittedSections;
      const nextSection = nextSections.find((item: Section) => item.id === section.id) || nextSections[0];
      const nextTitle = data.title || contentTitle;
      const nextCreator = data.creator || contentCreator;
      const nextDescription = data.description || contentDescription;
      const nextBaseline = manuscriptSnapshot({
        contentTitle: nextTitle,
        contentCreator: nextCreator,
        contentDescription: nextDescription,
        selectedSectionId: nextSection?.id || "",
        sections: nextSections,
      });
      setSections(nextSections);
      setHtml(nextSection?.html || nextHtml);
      setSectionTitle(nextSection?.title || sectionTitle);
      setSectionKind(nextSection?.kind || sectionKind);
      setSectionId(nextSection?.id || "");
      setContentTitle(nextTitle);
      setContentCreator(nextCreator);
      setContentDescription(nextDescription);
      setContentFile(data.contentFile || contentFile);
      setContentVersion(nextVersion);
      setBaseline(nextBaseline);
      setDirty(false);
      if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
      latestRecoveryRef.current = null;
      const recoveryCleared = !recoveryStorageKey || removeRecovery(recoveryStorageKey);
      if (recoveryCleared) {
        setRecoveryStorageError("");
      } else {
        setRecoveryStorageError("The manuscript saved, but this phone could not clear its old recovery copy. Discard that copy before restoring anything later.");
      }
      const savedMessage = data.commit ? `Saved live through GitHub: ${data.commit}` : data.note || "Saved JSON content locally.";
      setMessage(recoveryCleared ? savedMessage : `${savedMessage} The old phone recovery copy could not be cleared.`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Save failed.";
      setMessage(recoveryStorageKey ? `${errorMessage} Your phone recovery draft remains saved.` : errorMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adminPanel adminReaderPanel" aria-busy={busy}>
      <style>{readerStyle()}</style>
      <div className="pathBuilderTop">
        <div>
          <p className="kicker">Content Editor</p>
          <h2>{showContentMetadata ? "Edit JSON book content" : "Edit the manuscript"}</h2>
          <p>{showContentMetadata ? "Edit the live JSON sections the reader uses." : "Choose one section, edit it, then save before moving to another."}</p>
          {contentFile && <p className="modelStatus ready">Source: public/book-content/{contentFile}</p>}
        </div>
        <div className="adminActions">
          <button type="button" className="resetBtn" disabled={editorLocked} onClick={() => setEditMode(value => !value)}>{editMode ? "Preview" : "Edit"}</button>
          <button type="button" className="resetBtn" disabled={editorLocked} onClick={addSection}>Add Section</button>
          <button type="button" className="resetBtn" disabled={editorLocked || !section || sections.length <= 1} onClick={deleteSection}>Delete Section</button>
          <button type="button" id="admin-manuscript-save" className="formBtn" disabled={editorLocked || !contentVersion || !section || !dirty} onClick={() => void saveSection()}>{busy ? "Saving..." : dirty ? "Save Manuscript" : "Manuscript Saved"}</button>
        </div>
      </div>

      {recoveryDecisionPending && (
        <section className="adminNotice" role="alert" aria-labelledby="manuscript-recovery-title">
          <h3 id="manuscript-recovery-title">Unsaved manuscript found on this phone</h3>
          <p id="manuscript-recovery-detail">
            {recovery
              ? <>Saved {new Date(recovery.savedAt).toLocaleString()}. {recoveryBlockedReason || "It matches the exact manuscript version now loaded. Restore it or keep the loaded copy."}</>
              : recoveryIssue}
          </p>
          <div className="adminActions">
            <button
              type="button"
              className="formBtn"
              style={{ minHeight: 44 }}
              disabled={!recovery || Boolean(recoveryBlockedReason) || busy}
              aria-describedby="manuscript-recovery-detail"
              onClick={restoreRecoveryDraft}
            >
              {recoveryBlockedReason || !recovery ? "Restore blocked" : "Restore phone draft"}
            </button>
            <button
              type="button"
              className="resetBtn"
              style={{ minHeight: 44 }}
              disabled={busy}
              onClick={discardRecoveryDraft}
            >
              Discard phone draft
            </button>
          </div>
        </section>
      )}

      {message && <div className="adminNotice" role="status" aria-live="polite">{message}</div>}
      {recoveryStorageError && <div className="adminNotice" role="alert">{recoveryStorageError}</div>}

      <fieldset className="adminReaderFields" disabled={editorLocked} aria-busy={busy}>
      {showContentMetadata && <section className="contentMetaGrid">
        <label>
          <span>Content title</span>
          <input className="input" value={contentTitle} onChange={event => { setContentTitle(event.target.value); markDirty(); }} />
        </label>
        <label>
          <span>Creator</span>
          <input className="input" value={contentCreator} onChange={event => { setContentCreator(event.target.value); markDirty(); }} />
        </label>
        <label>
          <span>Content description</span>
          <textarea value={contentDescription} onChange={event => { setContentDescription(event.target.value); markDirty(); }} />
        </label>
      </section>}

      <div className="adminReaderGrid adminReaderGridClean">
        <aside className="adminReaderSidebar">
          <label>
            <span>Section</span>
            <select className="select" value={section?.id || ""} onChange={event => chooseSection(event.target.value)}>
              {sections.map(item => <option value={item.id} key={item.id}>{item.index + 1}. {item.title}</option>)}
            </select>
          </label>

          <label>
            <span>Section title</span>
            <input className="input" value={sectionTitle} onChange={event => { setSectionTitle(event.target.value); markDirty(); }} />
          </label>

          <label>
            <span>Section kind</span>
            <select className="select" value={sectionKind} onChange={event => { setSectionKind(event.target.value); markDirty(); }}>
              {SECTION_KINDS.map(kind => <option key={kind}>{kind}</option>)}
            </select>
          </label>

          <div className="adminActions" aria-label="Section order">
            <button className="resetBtn" type="button" disabled={!section || sectionIndex() === 0} onClick={() => moveSection(-1)}>Move earlier</button>
            <button className="resetBtn" type="button" disabled={!section || sectionIndex() === sections.length - 1} onClick={() => moveSection(1)}>Move later</button>
          </div>

        </aside>

        <div className="adminReaderSurface">
          <div className="adminFormatToolbar" aria-label="Formatting tools">
            <button type="button" onClick={() => runEditorCommand("bold")} disabled={!editMode} title="Bold"><strong>B</strong></button>
            <button type="button" onClick={() => runEditorCommand("italic")} disabled={!editMode} title="Italic"><em>I</em></button>
            <button type="button" onClick={() => runEditorCommand("underline")} disabled={!editMode} title="Underline"><span>U</span></button>
            <button type="button" onClick={() => setBlock("p")} disabled={!editMode}>P</button>
            <button type="button" onClick={() => setBlock("h2")} disabled={!editMode}>H2</button>
            <button type="button" onClick={() => setBlock("h3")} disabled={!editMode}>H3</button>
            <button type="button" onClick={() => runEditorCommand("justifyCenter")} disabled={!editMode}>Center</button>
            <button type="button" onClick={() => runEditorCommand("justifyLeft")} disabled={!editMode}>Left</button>
            <button type="button" onClick={() => runEditorCommand("insertUnorderedList")} disabled={!editMode}>List</button>
            <button type="button" onClick={() => setBlock("blockquote")} disabled={!editMode}>Quote</button>
            <button type="button" onClick={() => runEditorCommand("removeFormat")} disabled={!editMode}>Clear</button>
          </div>

          <div
            ref={editorRef}
            className="adminReaderDoc"
            contentEditable={editMode && !editorLocked}
            role="textbox"
            aria-label={section ? `Manuscript text for ${section.title}` : "Manuscript text"}
            aria-multiline="true"
            suppressContentEditableWarning
            onInput={syncFromEditor}
          />
        </div>
      </div>
      </fieldset>
    </section>
  );
}
