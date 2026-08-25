"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import {
  COLLECTIONS_DRAFT_SCHEMA_VERSION,
  COLLECTIONS_DRAFT_STORAGE_PREFIX,
  COLLECTIONS_MEMBERSHIP_EDITOR_SCOPE,
  ORGANIZER_NEEDS_YOU_QUEUES,
  cleanAdminVersion,
  clonePathsFile,
  collectionAssignments,
  collectionDraftStorageKey,
  collectionDraftStoragePrefix,
  diagnoseOrganizerPaths,
  diffOrganizerPaths,
  isOrganizerPathsFile,
  mapCollections,
  organizerCollections,
  parseCollectionsDraftEnvelope,
  pathsEqual,
  preparePathsForSave,
  rebaseOrganizerMembershipDraft,
  type CollectionsDraftEnvelope,
  type OrganizerBook,
  type OrganizerCollection,
  type OrganizerIssueLink,
} from "@/lib/collectionsOrganizer";
import type { PathsFile } from "@/lib/paths";
import styles from "./CollectionsOrganizer.module.css";

type OrganizerView = "needs" | "collections" | "review";
type AddPanelState =
  | { mode: "browse"; targetCollectionId: string }
  | { mode: "place"; bookId: string };

type StoredDraft = {
  key: string;
  envelope: CollectionsDraftEnvelope;
};

const UNCOLLECTED_ID = "__uncollected__";

function makeDraftId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function discardConfirmationDomId(key: string) {
  return `collections-discard-confirm-${encodeURIComponent(key)}`;
}

function formatSavedAt(value: string | null) {
  if (!value) return "not saved on this phone yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "saved on this phone"
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function collectionLabel(collection: OrganizerCollection) {
  return `${collection.title} · ${collection.books.length}`;
}

function findCollectionForBook(paths: PathsFile, bookId: string) {
  return organizerCollections(paths).find(collection => collection.books.some(book => book.id === bookId));
}

function bookSearchText(book: OrganizerBook) {
  return `${book.title} ${book.subtitle} ${book.id}`.toLowerCase();
}

function storageDraftsForVersion(baseVersion: string, source: PathsFile) {
  const current: StoredDraft[] = [];
  let staleCount = 0;
  let corruptCurrentCount = 0;
  let corruptOtherCount = 0;
  const rootPrefix = `${COLLECTIONS_DRAFT_STORAGE_PREFIX}.`;
  const currentPrefix = collectionDraftStoragePrefix(baseVersion);

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.startsWith(rootPrefix)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (key.startsWith(currentPrefix)) corruptCurrentCount += 1;
      else corruptOtherCount += 1;
      continue;
    }
    const envelope = parseCollectionsDraftEnvelope(parsed);
    if (!envelope) {
      if (key.startsWith(currentPrefix)) corruptCurrentCount += 1;
      else corruptOtherCount += 1;
      continue;
    }
    if (cleanAdminVersion(envelope.baseVersion) !== cleanAdminVersion(baseVersion)) {
      staleCount += 1;
      continue;
    }
    if (!pathsEqual(envelope.paths, source)) current.push({ key, envelope });
  }

  current.sort((left, right) => Date.parse(right.envelope.savedAt) - Date.parse(left.envelope.savedAt));
  return { current, staleCount, corruptCurrentCount, corruptOtherCount };
}

export default function CollectionsOrganizer({ books, initialBookId = "" }: { books: OrganizerBook[]; initialBookId?: string }) {
  const { setUnsaved } = useAdminUnsavedChanges();
  const sheetRef = useRef<HTMLElement>(null);
  const sheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const bookById = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const validBookIds = useMemo(() => new Set(books.filter(book => !book.legacyAlias).map(book => book.id)), [books]);
  const [view, setView] = useState<OrganizerView>(initialBookId ? "collections" : "needs");
  const [sourcePaths, setSourcePaths] = useState<PathsFile | null>(null);
  const [draftPaths, setDraftPaths] = useState<PathsFile | null>(null);
  const [sourceVersion, setSourceVersion] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [uncollectedQuery, setUncollectedQuery] = useState("");
  const [showAllUncollected, setShowAllUncollected] = useState(false);
  const [history, setHistory] = useState<PathsFile[]>([]);
  const [activeQueueId, setActiveQueueId] = useState(ORGANIZER_NEEDS_YOU_QUEUES[0].id);
  const [issueIndex, setIssueIndex] = useState(0);
  const [addPanel, setAddPanel] = useState<AddPanelState | null>(null);
  const [addQuery, setAddQuery] = useState("");
  const [sheetTargetId, setSheetTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [staleSource, setStaleSource] = useState(false);
  const [phoneSavedAt, setPhoneSavedAt] = useState<string | null>(null);
  const [phoneStorageError, setPhoneStorageError] = useState("");
  const [activeDraftId, setActiveDraftId] = useState(makeDraftId);
  const [recoveryCandidates, setRecoveryCandidates] = useState<StoredDraft[]>([]);
  const [pendingDiscardKey, setPendingDiscardKey] = useState("");
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [olderDraftCount, setOlderDraftCount] = useState(0);
  const [corruptDraftCount, setCorruptDraftCount] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(
    initialBookId ? { id: initialBookId, token: 1 } : null,
  );

  const dirty = useMemo(() => !pathsEqual(sourcePaths, draftPaths), [draftPaths, sourcePaths]);
  const editingLocked = busy || recoveryCandidates.length > 0 || !sourcePaths || !draftPaths;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError("");
      try {
        const response = await fetch("/api/admin/paths", { cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as unknown;
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error || "")
            : "";
          throw new Error(message || "Could not load the authoritative Collections file.");
        }
        if (!isOrganizerPathsFile(payload)) throw new Error("The Collections API returned an invalid paths document.");
        const etag = response.headers.get("etag");
        if (!etag) throw new Error("The Collections API returned no source version. Editing stays locked.");
        const nextPaths = preparePathsForSave(payload);
        const nextVersion = cleanAdminVersion(etag);
        if (cancelled) return;
        setSourcePaths(nextPaths);
        setDraftPaths(nextPaths);
        setSourceVersion(nextVersion);
        setStaleSource(false);
        const initialCollection = initialBookId ? findCollectionForBook(nextPaths, initialBookId) : organizerCollections(nextPaths)[0];
        setSelectedCollectionId(initialCollection?.id || (initialBookId ? UNCOLLECTED_ID : organizerCollections(nextPaths)[0]?.id || UNCOLLECTED_ID));
        if (initialBookId) setFocusRequest(current => ({ id: initialBookId, token: (current?.token || 0) + 1 }));

        try {
          const stored = storageDraftsForVersion(nextVersion, nextPaths);
          setRecoveryCandidates(stored.current);
          setOlderDraftCount(stored.staleCount);
          setCorruptDraftCount(stored.corruptCurrentCount + stored.corruptOtherCount);
        } catch {
          setPhoneStorageError("Phone recovery storage is unavailable. Collections editing still works, but this browser cannot protect a local draft.");
        } finally {
          setRecoveryChecked(true);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Could not load Collections.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [initialBookId]);

  useEffect(() => {
    setUnsaved("collections-organizer", dirty, "Collections Organizer");
  }, [dirty, setUnsaved]);

  useEffect(() => () => setUnsaved("collections-organizer", false), [setUnsaved]);

  useEffect(() => {
    if (!addPanel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setAddPanel(null);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const controls = [...sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter(control => control.offsetParent !== null);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      queueMicrotask(() => sheetReturnFocusRef.current?.focus());
    };
  }, [addPanel]);

  useEffect(() => {
    if (!pendingDiscardKey) return;
    const frame = window.requestAnimationFrame(() => {
      const confirmation = document.getElementById(discardConfirmationDomId(pendingDiscardKey));
      confirmation?.scrollIntoView({ behavior: "smooth", block: "center" });
      confirmation?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingDiscardKey]);

  const persistPhoneDraft = useCallback((paths: PathsFile, announce = false) => {
    if (!sourcePaths || !sourceVersion || pathsEqual(sourcePaths, paths) || recoveryCandidates.length) return;
    try {
      const key = collectionDraftStorageKey(sourceVersion, activeDraftId);
      const savedAt = new Date().toISOString();
      const existingRaw = window.localStorage.getItem(key);
      const existing = existingRaw
        ? parseCollectionsDraftEnvelope(JSON.parse(existingRaw) as unknown)
        : null;
      const revisions = existing && !pathsEqual(existing.paths, paths)
        ? [...existing.revisions, { savedAt: existing.savedAt, paths: existing.paths }].slice(-5)
        : existing?.revisions || [];
      const envelope: CollectionsDraftEnvelope = {
        schemaVersion: COLLECTIONS_DRAFT_SCHEMA_VERSION,
        draftId: activeDraftId,
        baseVersion: cleanAdminVersion(sourceVersion),
        savedAt,
        paths: preparePathsForSave(paths),
        revisions,
      };
      window.localStorage.setItem(key, JSON.stringify(envelope));
      setPhoneSavedAt(savedAt);
      setPhoneStorageError("");
      if (announce) setNotice("Saved a recoverable phone draft. paths.json was not changed.");
    } catch {
      setPhoneStorageError("This browser could not update the phone draft. Nothing authoritative was changed.");
    }
  }, [activeDraftId, recoveryCandidates.length, sourcePaths, sourceVersion]);

  useEffect(() => {
    if (!recoveryChecked || recoveryCandidates.length || !draftPaths || !sourcePaths || !sourceVersion) return;
    if (!dirty) {
      try {
        window.localStorage.removeItem(collectionDraftStorageKey(sourceVersion, activeDraftId));
      } catch {
        // A clean authoritative copy needs no new recovery write.
      }
      return;
    }
    const timer = window.setTimeout(() => persistPhoneDraft(draftPaths), 320);
    return () => window.clearTimeout(timer);
  }, [activeDraftId, dirty, draftPaths, persistPhoneDraft, recoveryCandidates.length, recoveryChecked, sourcePaths, sourceVersion]);

  useEffect(() => {
    if (!recoveryChecked || recoveryCandidates.length || !dirty || !draftPaths || !sourcePaths || !sourceVersion) return;
    const flushPhoneDraft = () => persistPhoneDraft(draftPaths);
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPhoneDraft();
    };
    window.addEventListener("pagehide", flushPhoneDraft);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushPhoneDraft);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [dirty, draftPaths, persistPhoneDraft, recoveryCandidates.length, recoveryChecked, sourcePaths, sourceVersion]);

  useEffect(() => {
    if (!addPanel) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAddPanel(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addPanel]);

  useEffect(() => {
    if (view !== "collections" || !focusRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`organize-book-${focusRequest.id}`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, selectedCollectionId, view]);

  const collections = useMemo(() => draftPaths ? organizerCollections(draftPaths) : [], [draftPaths]);
  const assignments = useMemo(() => draftPaths ? collectionAssignments(draftPaths) : new Map<string, string[]>(), [draftPaths]);
  const collectionById = useMemo(() => new Map(collections.map(collection => [collection.id, collection])), [collections]);
  const selectedCollection = selectedCollectionId === UNCOLLECTED_ID ? null : collectionById.get(selectedCollectionId) || collections[0] || null;
  const readyMainUncollected = useMemo(() => books
    .filter(book => !book.legacyAlias && book.status === "ready" && book.visibility === "main" && !(assignments.get(book.id)?.length))
    .sort((left, right) => left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" })), [assignments, books]);
  const selectedBookId = focusRequest?.id || "";
  const selectedBook = selectedBookId ? bookById.get(selectedBookId) : undefined;

  const visibleUncollected = useMemo(() => {
    const query = uncollectedQuery.trim().toLowerCase();
    let matches = query
      ? readyMainUncollected.filter(book => bookSearchText(book).includes(query))
      : readyMainUncollected;
    if (selectedBook && !assignments.get(selectedBook.id)?.length) {
      matches = [selectedBook, ...matches.filter(book => book.id !== selectedBook.id)];
    }
    return showAllUncollected || query ? matches : matches.slice(0, 12);
  }, [assignments, readyMainUncollected, selectedBook, showAllUncollected, uncollectedQuery]);

  const matchingCollections = useMemo(() => {
    const query = directoryQuery.trim().toLowerCase();
    return query
      ? collections.filter(collection => `${collection.title} ${collection.id}`.toLowerCase().includes(query))
      : collections;
  }, [collections, directoryQuery]);

  const activeQueue = ORGANIZER_NEEDS_YOU_QUEUES.find(queue => queue.id === activeQueueId) || ORGANIZER_NEEDS_YOU_QUEUES[0];
  const activeIssue = activeQueue.issues[Math.min(issueIndex, activeQueue.issues.length - 1)];
  const diagnostics = useMemo(() => draftPaths ? diagnoseOrganizerPaths(draftPaths, validBookIds) : [], [draftPaths, validBookIds]);
  const diffs = useMemo(() => sourcePaths && draftPaths ? diffOrganizerPaths(sourcePaths, draftPaths) : [], [draftPaths, sourcePaths]);
  const blockingDiagnostics = diagnostics.filter(item => item.blocking && !item.passed);

  const addResults = useMemo(() => {
    if (!addPanel || addPanel.mode !== "browse") return [];
    const query = addQuery.trim().toLowerCase();
    const target = collectionById.get(addPanel.targetCollectionId);
    const targetIds = new Set(target?.books.map(book => book.id) || []);
    return books
      .filter(book => !book.legacyAlias && !targetIds.has(book.id) && (!query || bookSearchText(book).includes(query)))
      .sort((left, right) => {
        const leftAssigned = assignments.get(left.id)?.length ? 1 : 0;
        const rightAssigned = assignments.get(right.id)?.length ? 1 : 0;
        return leftAssigned - rightAssigned || left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" });
      })
      .slice(0, 40);
  }, [addPanel, addQuery, assignments, books, collectionById]);

  function commit(transform: (current: PathsFile) => PathsFile, message: string) {
    if (!draftPaths || editingLocked) return;
    setHistory(current => [...current.slice(-19), clonePathsFile(draftPaths)]);
    setDraftPaths(preparePathsForSave(transform(draftPaths)));
    setNotice(message);
  }

  function undo() {
    if (!history.length || busy) return;
    const previous = history[history.length - 1];
    setHistory(current => current.slice(0, -1));
    setDraftPaths(previous);
    setNotice("Undid the last Collection change. The authoritative file was not touched.");
  }

  function removeBook(collectionId: string, bookId: string) {
    const title = bookById.get(bookId)?.title || bookId;
    commit(paths => mapCollections(paths, collection => collection.id === collectionId
      ? { ...collection, books: collection.books.filter(book => book.id !== bookId) }
      : collection), `${title} is now uncollected in this phone draft.`);
  }

  function moveBook(collectionId: string, bookId: string, direction: -1 | 1) {
    commit(paths => mapCollections(paths, collection => {
      if (collection.id !== collectionId) return collection;
      const booksInCollection = [...collection.books];
      const index = booksInCollection.findIndex(book => book.id === bookId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= booksInCollection.length) return collection;
      [booksInCollection[index], booksInCollection[targetIndex]] = [booksInCollection[targetIndex], booksInCollection[index]];
      return { ...collection, books: booksInCollection };
    }), `Moved ${bookById.get(bookId)?.title || bookId} ${direction < 0 ? "up" : "down"}. Authored order remains explicit.`);
  }

  function addBookToCollection(bookId: string, targetCollectionId: string) {
    const target = collectionById.get(targetCollectionId);
    if (!target) return;
    const previousCollection = assignments.get(bookId)?.map(id => collectionById.get(id)?.title).filter(Boolean).join(", ");
    commit(paths => mapCollections(paths, collection => {
      const withoutBook = collection.books.filter(book => book.id !== bookId);
      if (collection.id !== targetCollectionId) return { ...collection, books: withoutBook };
      if (collection.books.some(book => book.id === bookId)) return collection;
      return { ...collection, books: [...withoutBook, { id: bookId, order: withoutBook.length + 1, note: "" }] };
    }), previousCollection
      ? `Moved ${bookById.get(bookId)?.title || bookId} from ${previousCollection} to ${target.title}.`
      : `Added ${bookById.get(bookId)?.title || bookId} to ${target.title} at the end.`);
    setSelectedCollectionId(targetCollectionId);
    setFocusRequest(current => ({ id: bookId, token: (current?.token || 0) + 1 }));
    setAddPanel(null);
    setAddQuery("");
  }

  function openBook(bookId: string) {
    if (!draftPaths) return;
    const collection = findCollectionForBook(draftPaths, bookId);
    setSelectedCollectionId(collection?.id || UNCOLLECTED_ID);
    setView("collections");
    setFocusRequest(current => ({ id: bookId, token: (current?.token || 0) + 1 }));
  }

  function openCollection(collectionId: string) {
    if (!collectionById.has(collectionId)) return;
    setSelectedCollectionId(collectionId);
    setView("collections");
  }

  function openAddPanel(targetCollectionId: string) {
    sheetReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAddQuery("");
    setAddPanel({ mode: "browse", targetCollectionId });
  }

  function openPlacementPanel(bookId: string) {
    sheetReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstCollectionId = collections[0]?.id || "";
    setSheetTargetId(firstCollectionId);
    setAddPanel({ mode: "place", bookId });
  }

  function restoreDraft(candidate: StoredDraft) {
    if (!sourcePaths) return;
    const restoredPaths = rebaseOrganizerMembershipDraft(sourcePaths, candidate.envelope.paths);
    const restoredRevisions = candidate.envelope.revisions.map(revision => (
      rebaseOrganizerMembershipDraft(sourcePaths, revision.paths)
    ));
    if (!restoredPaths || restoredRevisions.some(revision => !revision)) {
      setNotice("That recovery copy could not be safely rebased onto this exact Collections version. Nothing was restored or deleted; discard it or keep it stored and start clean.");
      return;
    }
    const safeRevisions = restoredRevisions.filter((revision): revision is PathsFile => Boolean(revision));
    try {
      window.localStorage.setItem(candidate.key, JSON.stringify({
        ...candidate.envelope,
        paths: restoredPaths,
        revisions: candidate.envelope.revisions.map((revision, index) => ({
          ...revision,
          paths: safeRevisions[index],
        })),
      } satisfies CollectionsDraftEnvelope));
      setPhoneStorageError("");
    } catch {
      setPhoneStorageError("The draft was restored safely in this tab, but this browser could not replace the stored copy with its sanitized version.");
    }
    setDraftPaths(restoredPaths);
    setHistory(safeRevisions);
    setActiveDraftId(candidate.envelope.draftId);
    setPhoneSavedAt(candidate.envelope.savedAt);
    setRecoveryCandidates([]);
    setPendingDiscardKey("");
    const collection = initialBookId ? findCollectionForBook(restoredPaths, initialBookId) : null;
    if (collection) setSelectedCollectionId(collection.id);
    setNotice(`Restored the membership and order changes saved ${formatSavedAt(candidate.envelope.savedAt)}. Collection names, descriptions, notes, and other fields came from the authoritative Workshop copy.`);
  }

  function keepStoredAndStartClean() {
    setActiveDraftId(makeDraftId());
    setRecoveryCandidates([]);
    setPendingDiscardKey("");
    setPhoneSavedAt(null);
    setNotice("Started from the authoritative Workshop copy. Existing phone drafts remain stored and were not overwritten.");
  }

  function discardStoredDraft(candidate: StoredDraft) {
    try {
      window.localStorage.removeItem(candidate.key);
      setRecoveryCandidates(current => current.filter(item => item.key !== candidate.key));
      setPendingDiscardKey("");
      setNotice("Discarded that phone draft. paths.json was not changed.");
    } catch {
      setPhoneStorageError("This browser could not discard the selected phone draft.");
    }
  }

  async function saveAuthoritative() {
    if (!sourcePaths || !draftPaths || !sourceVersion || !dirty || busy || staleSource || blockingDiagnostics.length) return;
    const prepared = rebaseOrganizerMembershipDraft(sourcePaths, draftPaths);
    if (!prepared) {
      setNotice("Saving is locked because this draft could not be reduced to Collection membership and order changes. Nothing authoritative was changed.");
      return;
    }
    if (pathsEqual(sourcePaths, prepared)) {
      setDraftPaths(sourcePaths);
      setHistory([]);
      setNotice("No Collection membership or order change remained. Any non-editable draft differences were discarded; paths.json was not changed.");
      return;
    }
    persistPhoneDraft(prepared);
    setBusy(true);
    setNotice("Saving the reviewed Collection order to paths.json...");
    try {
      const response = await fetch("/api/admin/paths", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": sourceVersion,
        },
        body: JSON.stringify({
          editorScope: COLLECTIONS_MEMBERSHIP_EDITOR_SCOPE,
          paths: prepared,
          message: `Update JJU Collections from Workshop (${new Date().toISOString().slice(0, 10)})`,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; paths?: unknown; target?: string; note?: string };
      if (!response.ok) {
        if (response.status === 409) {
          setStaleSource(true);
          throw new Error(`${payload.error || "paths.json changed after this organizer loaded."} Nothing was overwritten; this phone draft is preserved under the old version.`);
        }
        throw new Error(payload.error || "The reviewed Collections could not be saved.");
      }
      const nextEtag = response.headers.get("etag");
      if (!nextEtag || !isOrganizerPathsFile(payload.paths)) throw new Error("The save returned no verified paths.json version. Reload before editing again.");
      const savedPaths = preparePathsForSave(payload.paths);
      try {
        window.localStorage.removeItem(collectionDraftStorageKey(sourceVersion, activeDraftId));
      } catch {
        // The authoritative save is already version-verified; a leftover recovery copy is harmless.
      }
      setSourcePaths(savedPaths);
      setDraftPaths(savedPaths);
      setSourceVersion(cleanAdminVersion(nextEtag));
      setHistory([]);
      setActiveDraftId(makeDraftId());
      setPhoneSavedAt(null);
      setStaleSource(false);
      setNotice(`Saved ${diffs.length} changed Collection${diffs.length === 1 ? "" : "s"} to ${payload.target || "paths.json"} with an exact version match.${payload.note ? ` ${payload.note}` : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The reviewed Collections could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel} role="alert">
          <p className={styles.eyebrow}>Collections Organizer</p>
          <h1>Editing is safely locked</h1>
          <p>{loadError}</p>
          <button type="button" onClick={() => window.location.reload()}>Try loading again</button>
        </section>
      </main>
    );
  }

  if (!sourcePaths || !draftPaths) {
    return (
      <main className={styles.page}>
        <div className={styles.loading} role="status">Loading the exact Collections version…</div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Workshop · paths.json authority</p>
          <h1>Collections Organizer</h1>
          <p>Work one Collection at a time. Books may stay uncollected. Nothing becomes authoritative until the exact diff passes review and the loaded version still matches.</p>
        </div>
        <div className={styles.versionCard}>
          <span>Loaded source</span>
          <code title={sourceVersion}>{sourceVersion}</code>
          <strong>{dirty ? "Phone draft differs" : "Matches paths.json"}</strong>
        </div>
      </header>

      {recoveryCandidates.length > 0 && (
        <section className={styles.recoveryPanel} role="status">
          <div>
            <p className={styles.eyebrow}>Recovery paused editing</p>
            <h2>{recoveryCandidates.length} matching phone draft{recoveryCandidates.length === 1 ? "" : "s"} found</h2>
            <p>Each draft was made from this exact paths.json version. Choose one to restore, or start clean while keeping every stored draft untouched.</p>
          </div>
          <div className={styles.recoveryChoices}>
            {recoveryCandidates.map(candidate => (
              <article key={candidate.key}>
                <div>
                  <strong>{formatSavedAt(candidate.envelope.savedAt)}</strong>
                  <span>{diffOrganizerPaths(sourcePaths, candidate.envelope.paths).length} changed Collection{diffOrganizerPaths(sourcePaths, candidate.envelope.paths).length === 1 ? "" : "s"}</span>
                </div>
                <button type="button" className={styles.primaryButton} onClick={() => restoreDraft(candidate)}>Restore this draft</button>
                {pendingDiscardKey === candidate.key ? (
                  <section
                    className={styles.discardConfirmation}
                    id={discardConfirmationDomId(candidate.key)}
                    role="group"
                    aria-label={`Confirm discard of draft saved ${formatSavedAt(candidate.envelope.savedAt)}`}
                  >
                    <div>
                      <strong>Discard this phone copy?</strong>
                      <span>This cannot be undone. The authoritative paths.json file will not change.</span>
                    </div>
                    <button type="button" className={styles.quietButton} onClick={() => setPendingDiscardKey("")}>Keep it</button>
                    <button type="button" className={styles.dangerButton} onClick={() => discardStoredDraft(candidate)}>Yes, discard</button>
                  </section>
                ) : (
                  <button
                    type="button"
                    className={styles.quietButton}
                    aria-controls={discardConfirmationDomId(candidate.key)}
                    onClick={() => setPendingDiscardKey(candidate.key)}
                  >Discard</button>
                )}
              </article>
            ))}
          </div>
          <button type="button" className={styles.secondaryButton} onClick={keepStoredAndStartClean}>Keep stored and start from Workshop</button>
        </section>
      )}

      {(olderDraftCount > 0 || corruptDraftCount > 0 || phoneStorageError) && (
        <section className={styles.safetyNotice} role="status">
          <strong>Older phone work is isolated</strong>
          <span>
            {olderDraftCount > 0 ? `${olderDraftCount} draft${olderDraftCount === 1 ? "" : "s"} belong to older paths.json versions and will not be auto-applied. ` : ""}
            {corruptDraftCount > 0 ? `${corruptDraftCount} unreadable draft${corruptDraftCount === 1 ? "" : "s"} remain untouched. ` : ""}
            {phoneStorageError}
          </span>
        </section>
      )}

      {staleSource && (
        <section className={styles.conflictNotice} role="alert">
          <strong>Authoritative save is locked</strong>
          <span>paths.json changed elsewhere. This version&apos;s phone draft remains recoverable, but it cannot overwrite the newer file. Reload to inspect the new source separately.</span>
        </section>
      )}

      {notice && <div className={styles.notice} role="status" aria-live="polite">{notice}</div>}

      <nav className={styles.viewTabs} aria-label="Collections Organizer views">
        <button type="button" aria-pressed={view === "needs"} className={view === "needs" ? styles.activeView : ""} onClick={() => setView("needs")}>
          <span>Needs You</span><strong>37</strong>
        </button>
        <button type="button" aria-pressed={view === "collections"} className={view === "collections" ? styles.activeView : ""} onClick={() => setView("collections")}>
          <span>Collections</span><strong>{collections.length}</strong>
        </button>
        <button type="button" aria-pressed={view === "review"} className={view === "review" ? styles.activeView : ""} onClick={() => setView("review")}>
          <span>Review</span><strong>{diffs.length}</strong>
        </button>
      </nav>

      {view === "needs" && (
        <section className={styles.needsWorkspace} aria-labelledby="needs-title">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Finite editorial inbox</p>
              <h2 id="needs-title">Only the calls that need your eyes</h2>
              <p>Collections can be changed here. Shelf, Topic, duplicate, and cover cards are deliberately review-only until their own versioned editors exist.</p>
            </div>
            <div className={styles.issueTotal}><strong>37</strong><span>known decisions</span></div>
          </header>

          <div className={styles.queuePicker} role="group" aria-label="Needs You queues">
            {ORGANIZER_NEEDS_YOU_QUEUES.map(queue => (
              <button
                type="button"
                aria-pressed={activeQueue.id === queue.id}
                className={activeQueue.id === queue.id ? styles.activeQueue : ""}
                key={queue.id}
                onClick={() => { setActiveQueueId(queue.id); setIssueIndex(0); }}
              >
                <span>{queue.shortTitle}</span>
                <strong>{queue.issues.length}</strong>
              </button>
            ))}
          </div>

          <div className={styles.queueIntro}>
            <div><strong>{activeQueue.title}</strong><span>{activeQueue.description}</span></div>
            <span>{issueIndex + 1} of {activeQueue.issues.length}</span>
          </div>

          <article className={styles.issueCard}>
            <div className={styles.issueCopy}>
              <p className={styles.eyebrow}>{activeQueue.title}</p>
              <h3>{activeIssue.title}</h3>
              <p className={styles.issueQuestion}>{activeIssue.question}</p>
              <p>{activeIssue.context}</p>
              {activeIssue.recommendation && (
                <div className={styles.recommendation}><strong>Recommended default</strong><span>{activeIssue.recommendation}</span></div>
              )}
            </div>
            {activeIssue.links.length > 0 && (
              <nav className={styles.issueLinks} aria-label="Related books and Collections">
                {activeIssue.links.map(link => (
                  <IssueLink
                    key={`${link.kind}-${link.id}`}
                    link={link}
                    book={link.kind === "book" ? bookById.get(link.id) : undefined}
                    collection={link.kind === "collection" ? collectionById.get(link.id) : undefined}
                    onBook={openBook}
                    onCollection={openCollection}
                  />
                ))}
              </nav>
            )}
          </article>

          <div className={styles.issueNav}>
            <button type="button" disabled={issueIndex === 0} onClick={() => setIssueIndex(current => Math.max(0, current - 1))}>← Previous</button>
            <button type="button" disabled={issueIndex >= activeQueue.issues.length - 1} onClick={() => setIssueIndex(current => Math.min(activeQueue.issues.length - 1, current + 1))}>Next →</button>
          </div>
        </section>
      )}

      {view === "collections" && (
        <section className={styles.collectionsWorkspace} aria-labelledby="collections-title">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Collection-first workspace</p>
              <h2 id="collections-title">One ordered list at a time</h2>
              <p>Add, remove, or use the large Up and Down controls. There is no drag-only interaction and no automatic alphabetizing.</p>
            </div>
            <div className={styles.collectionStats}>
              <span><strong>{collections.length}</strong> Collections</span>
              <span><strong>{collections.reduce((sum, collection) => sum + collection.books.length, 0)}</strong> assignments</span>
              <span><strong>{readyMainUncollected.length}</strong> optional uncollected</span>
            </div>
          </header>

          <label className={styles.mobileCollectionPicker}>
            Choose a Collection
            <select value={selectedCollectionId || collections[0]?.id || UNCOLLECTED_ID} onChange={event => setSelectedCollectionId(event.target.value)}>
              {collections.map(collection => <option value={collection.id} key={collection.id}>{collectionLabel(collection)}</option>)}
              <option value={UNCOLLECTED_ID}>No Collection · {readyMainUncollected.length}</option>
            </select>
          </label>

          <div className={styles.collectionLayout}>
            <aside className={styles.directory} aria-label="Collection directory">
              <label>
                Find a Collection
                <input value={directoryQuery} onChange={event => setDirectoryQuery(event.target.value)} placeholder="Mapmakers, System…" />
              </label>
              <div className={styles.directoryList}>
                {matchingCollections.map(collection => (
                  <button
                    type="button"
                    className={selectedCollection?.id === collection.id ? styles.activeDirectoryItem : ""}
                    key={collection.id}
                    onClick={() => setSelectedCollectionId(collection.id)}
                  >
                    <span>{collection.title}</span><strong>{collection.books.length}</strong>
                  </button>
                ))}
                <button
                  type="button"
                  className={selectedCollectionId === UNCOLLECTED_ID ? styles.activeDirectoryItem : ""}
                  onClick={() => setSelectedCollectionId(UNCOLLECTED_ID)}
                >
                  <span>No Collection</span><strong>{readyMainUncollected.length}</strong>
                </button>
              </div>
            </aside>

            <div className={styles.collectionDetail}>
              {selectedCollectionId === UNCOLLECTED_ID ? (
                <>
                  <header className={styles.detailHeader}>
                    <div>
                      <p className={styles.eyebrow}>Optional by design</p>
                      <h3>No Collection</h3>
                      <p>{readyMainUncollected.length} ready Main Library books are uncollected. That is valid; this is not a cleanup quota.</p>
                    </div>
                  </header>
                  <label className={styles.bookSearch}>
                    Find an uncollected book
                    <input value={uncollectedQuery} onChange={event => setUncollectedQuery(event.target.value)} placeholder="Title or book ID" />
                  </label>
                  <div className={styles.memberList}>
                    {visibleUncollected.map(book => (
                      <article
                        className={`${styles.memberRow} ${styles.uncollectedMember} ${focusRequest?.id === book.id ? styles.focusedMember : ""}`}
                        id={`organize-book-${book.id}`}
                        tabIndex={-1}
                        key={book.id}
                      >
                        <OrganizerCover book={book} />
                        <div className={styles.memberCopy}>
                          <strong>{book.title}</strong>
                          <span>{book.id} · {book.status}{book.legacyAlias ? " · old alias record" : ""}</span>
                        </div>
                        <div className={styles.singleAction}>
                          <button type="button" disabled={editingLocked || book.legacyAlias} onClick={() => openPlacementPanel(book.id)}>
                            {book.legacyAlias ? "Alias only" : "Put in Collection"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!visibleUncollected.length && <div className={styles.emptyState}>No uncollected books match that search.</div>}
                  {!showAllUncollected && !uncollectedQuery && readyMainUncollected.length > visibleUncollected.length && (
                    <button type="button" className={styles.showMoreButton} onClick={() => setShowAllUncollected(true)}>Show all {readyMainUncollected.length}</button>
                  )}
                </>
              ) : selectedCollection ? (
                <>
                  <header className={styles.detailHeader}>
                    <div>
                      <p className={styles.eyebrow}>{selectedCollection.sourceBucket === "series" ? "Editorial Collection" : "Ordered Collection"}</p>
                      <h3>{selectedCollection.title}</h3>
                      <p>{selectedCollection.description || "An authored JJ University Collection."}</p>
                    </div>
                    <button type="button" className={styles.primaryButton} disabled={editingLocked} onClick={() => openAddPanel(selectedCollection.id)}>+ Add books</button>
                  </header>
                  <div className={styles.orderNote}><strong>Authored order</strong><span>{selectedCollection.books.length} books · saved exactly as shown</span></div>
                  <ol className={styles.memberList}>
                    {selectedCollection.books.map((member, index) => {
                      const book = bookById.get(member.id) || {
                        id: member.id,
                        title: member.id,
                        subtitle: "",
                        status: "missing",
                        visibility: "main",
                        coverSrc: "/file.svg",
                        fallbackCoverSrc: "/file.svg",
                        legacyAlias: false,
                      };
                      return (
                        <li
                          className={`${styles.memberRow} ${focusRequest?.id === book.id ? styles.focusedMember : ""}`}
                          id={`organize-book-${book.id}`}
                          tabIndex={-1}
                          key={book.id}
                        >
                          <span className={styles.orderNumber}>{index + 1}</span>
                          <OrganizerCover book={book} />
                          <div className={styles.memberCopy}>
                            <strong>{book.title}</strong>
                            <span>{book.id} · {book.status}{book.visibility === "archive" ? " · archive" : ""}</span>
                          </div>
                          <div className={styles.orderActions}>
                            <button type="button" disabled={editingLocked || index === 0} onClick={() => moveBook(selectedCollection.id, book.id, -1)} aria-label={`Move ${book.title} up`}>↑ Up</button>
                            <button type="button" disabled={editingLocked || index === selectedCollection.books.length - 1} onClick={() => moveBook(selectedCollection.id, book.id, 1)} aria-label={`Move ${book.title} down`}>↓ Down</button>
                            <button type="button" className={styles.removeButton} disabled={editingLocked} onClick={() => removeBook(selectedCollection.id, book.id)}>Remove</button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {!selectedCollection.books.length && <div className={styles.emptyState}>This draft Collection is empty. Review will block an authoritative save until a book is added or the change is undone.</div>}
                </>
              ) : (
                <div className={styles.emptyState}>Choose a Collection.</div>
              )}
            </div>
          </div>
        </section>
      )}

      {view === "review" && (
        <section className={styles.reviewWorkspace} aria-labelledby="review-title">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Deliberate handoff</p>
              <h2 id="review-title">Review the exact Collection diff</h2>
              <p>The phone draft and paths.json are separate. The gold button below is the only action that attempts an authoritative save.</p>
            </div>
            <button type="button" className={styles.secondaryButton} disabled={!dirty || recoveryCandidates.length > 0} onClick={() => persistPhoneDraft(draftPaths, true)}>Save phone draft now</button>
          </header>

          <div className={styles.reviewGrid}>
            <section className={styles.diagnosticsPanel}>
              <div className={styles.panelTitle}>
                <div><p className={styles.eyebrow}>Fail-closed checks</p><h3>Diagnostics</h3></div>
                <strong className={blockingDiagnostics.length ? styles.problemCount : styles.passCount}>{blockingDiagnostics.length ? `${blockingDiagnostics.length} blocked` : "All pass"}</strong>
              </div>
              <div className={styles.diagnosticList}>
                {diagnostics.map(item => (
                  <article className={item.passed ? styles.passedDiagnostic : styles.failedDiagnostic} key={item.id}>
                    <span aria-hidden="true">{item.passed ? "✓" : "!"}</span>
                    <div><strong>{item.label}</strong><p>{item.detail}</p></div>
                  </article>
                ))}
              </div>
            </section>

            <aside className={styles.savePanel}>
              <p className={styles.eyebrow}>Exact compare-and-save</p>
              <h3>{dirty ? `${diffs.length} changed Collection${diffs.length === 1 ? "" : "s"}` : "No Collection changes"}</h3>
              <p>The save includes <code>If-Match: {sourceVersion}</code>. If that version changed, the API returns a conflict and preserves this phone draft.</p>
              <div className={styles.saveFacts}>
                <span><strong>{formatSavedAt(phoneSavedAt)}</strong>phone recovery</span>
                <span><strong>{history.length}</strong>undo step{history.length === 1 ? "" : "s"}</span>
                <span><strong>{blockingDiagnostics.length}</strong>blocking problem{blockingDiagnostics.length === 1 ? "" : "s"}</span>
              </div>
              <button
                type="button"
                className={styles.authoritativeButton}
                disabled={!dirty || busy || staleSource || blockingDiagnostics.length > 0 || recoveryCandidates.length > 0}
                onClick={() => void saveAuthoritative()}
              >
                {busy ? "Saving exact version…" : staleSource ? "Reload required" : "Save Collections to paths.json"}
              </button>
              <small>This does not edit Shelves, Topics, covers, book metadata, manuscripts, or print files.</small>
            </aside>
          </div>

          <section className={styles.diffPanel}>
            <div className={styles.panelTitle}>
              <div><p className={styles.eyebrow}>Before versus after</p><h3>Exact ordered changes</h3></div>
              <strong>{diffs.length}</strong>
            </div>
            {!diffs.length ? (
              <div className={styles.emptyState}>The phone draft exactly matches the loaded paths.json version.</div>
            ) : (
              <div className={styles.diffList}>
                {diffs.map(diff => (
                  <details key={diff.id} open={diffs.length <= 3}>
                    <summary>
                      <span><strong>{diff.title}</strong><small>{diff.id}</small></span>
                      <span>{diff.added.length ? `+${diff.added.length} ` : ""}{diff.removed.length ? `−${diff.removed.length} ` : ""}{diff.moved.length ? `${diff.moved.length} moved` : ""}</span>
                    </summary>
                    <div className={styles.changeSummary}>
                      {diff.added.map(item => <span className={styles.addedChange} key={`add-${item.id}`}>Added {bookById.get(item.id)?.title || item.id} at {item.position}</span>)}
                      {diff.removed.map(item => <span className={styles.removedChange} key={`remove-${item.id}`}>Removed {bookById.get(item.id)?.title || item.id} from {item.position}</span>)}
                      {diff.moved.map(item => <span key={`move-${item.id}`}>Moved {bookById.get(item.id)?.title || item.id}: {item.from} → {item.to}</span>)}
                    </div>
                    <div className={styles.orderCompare}>
                      <div><strong>Before</strong><ol>{diff.beforeIds.map(id => <li key={id}>{bookById.get(id)?.title || id}<small>{id}</small></li>)}</ol></div>
                      <div><strong>Phone draft</strong><ol>{diff.afterIds.map(id => <li key={id}>{bookById.get(id)?.title || id}<small>{id}</small></li>)}</ol></div>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </section>
      )}

      {recoveryCandidates.length === 0 && (
        <div className={styles.saveDock} role="status" aria-live="polite">
          <div>
            <strong>{staleSource ? "Newer paths.json detected" : dirty ? "Changes are in a phone draft" : "Matches the loaded paths.json"}</strong>
            <span>{dirty ? `Recovery ${formatSavedAt(phoneSavedAt)}` : "No authoritative changes waiting"}</span>
          </div>
          <div>
            <button type="button" className={styles.quietButton} disabled={!history.length || busy} onClick={undo}>Undo</button>
            <button type="button" className={styles.primaryButton} disabled={!dirty} onClick={() => setView("review")}>Review {diffs.length || ""}</button>
          </div>
        </div>
      )}

      {addPanel && (
        <div className={styles.sheetBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAddPanel(null); }}>
          <section ref={sheetRef} className={styles.addSheet} role="dialog" aria-modal="true" aria-labelledby="add-sheet-title">
            <header>
              <div>
                <p className={styles.eyebrow}>{addPanel.mode === "browse" ? "Search the catalog" : "Choose a Collection"}</p>
                <h2 id="add-sheet-title">
                  {addPanel.mode === "browse"
                    ? `Add to ${collectionById.get(addPanel.targetCollectionId)?.title || "Collection"}`
                    : `Place ${bookById.get(addPanel.bookId)?.title || addPanel.bookId}`}
                </h2>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setAddPanel(null)} aria-label="Close add-book panel">Close</button>
            </header>

            {addPanel.mode === "browse" ? (
              <>
                <label className={styles.bookSearch}>
                  Find a book
                  <input autoFocus value={addQuery} onChange={event => setAddQuery(event.target.value)} placeholder="Title or book ID" />
                </label>
                <p className={styles.sheetHelp}>Uncollected books appear first. A book already in another Collection is clearly labeled “Move here.”</p>
                <div className={styles.sheetBookList}>
                  {addResults.map(book => {
                    const currentCollectionIds = assignments.get(book.id) || [];
                    const currentNames = currentCollectionIds.map(id => collectionById.get(id)?.title).filter(Boolean).join(", ");
                    return (
                      <article key={book.id}>
                        <OrganizerCover book={book} />
                        <div><strong>{book.title}</strong><span>{currentNames || "No Collection"} · {book.status}</span></div>
                        <button type="button" disabled={editingLocked} onClick={() => addBookToCollection(book.id, addPanel.targetCollectionId)}>{currentNames ? "Move here" : "Add"}</button>
                      </article>
                    );
                  })}
                  {!addResults.length && <div className={styles.emptyState}>No books match that search.</div>}
                </div>
                {addResults.length === 40 && <p className={styles.sheetHelp}>Showing the first 40 matches. Type more of the title to narrow the list.</p>}
              </>
            ) : (
              <div className={styles.placeBookPanel}>
                {bookById.get(addPanel.bookId) && <OrganizerCover book={bookById.get(addPanel.bookId)!} />}
                <label>
                  Collection
                  <select autoFocus value={sheetTargetId} onChange={event => setSheetTargetId(event.target.value)}>
                    {collections.map(collection => <option value={collection.id} key={collection.id}>{collectionLabel(collection)}</option>)}
                  </select>
                </label>
                <button type="button" className={styles.primaryButton} disabled={!sheetTargetId || editingLocked} onClick={() => addBookToCollection(addPanel.bookId, sheetTargetId)}>Add at the end</button>
                <p>Leaving this book uncollected is also valid. Close this panel to make no change.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function OrganizerCover({ book }: { book: OrganizerBook }) {
  const [source, setSource] = useState(book.coverSrc);
  return (
    <span className={styles.coverFrame}>
      <Image
        src={source}
        alt={`${book.title} cover`}
        fill
        sizes="72px"
        onError={() => setSource(current => current === book.fallbackCoverSrc ? "/file.svg" : book.fallbackCoverSrc)}
      />
    </span>
  );
}

function IssueLink({
  link,
  book,
  collection,
  onBook,
  onCollection,
}: {
  link: OrganizerIssueLink;
  book?: OrganizerBook;
  collection?: OrganizerCollection;
  onBook: (bookId: string) => void;
  onCollection: (collectionId: string) => void;
}) {
  if (link.kind === "book") {
    return (
      <button type="button" className={styles.issueBookLink} onClick={() => onBook(link.id)}>
        {book ? <OrganizerCover book={book} /> : <span className={styles.missingCover}>?</span>}
        <span><strong>{link.label || book?.title || link.id}</strong><small>{book ? `${book.id} · ${book.status}` : `${link.id} · not in catalog`}</small></span>
      </button>
    );
  }
  return (
    <button type="button" className={styles.issueCollectionLink} onClick={() => onCollection(link.id)} disabled={!collection}>
      <span>Collection</span><strong>{link.label || collection?.title || link.id}</strong><small>{collection ? `${collection.books.length} ordered books` : "Not found"}</small>
    </button>
  );
}
