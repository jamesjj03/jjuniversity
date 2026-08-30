"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import {
  COLLECTIONS_DRAFT_SCHEMA_VERSION,
  COLLECTIONS_DRAFT_STORAGE_PREFIX,
  COLLECTIONS_MEMBERSHIP_EDITOR_SCOPE,
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
} from "@/lib/collectionsOrganizer";
import type { PathsFile } from "@/lib/paths";
import styles from "./CollectionsWall.module.css";

type StoredDraft = {
  key: string;
  envelope: CollectionsDraftEnvelope;
};

type DropTarget = {
  collectionId: string;
  index: number | null;
};

type DraggedBook = {
  bookId: string;
  fromCollectionId: string | null;
};

type PointerDrag = DraggedBook & {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
};

type BankMode = "loose" | "all";

const BANK_ID = "__collections_bank__";

function makeDraftId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanBookId(value: string) {
  return value.trim().toLowerCase();
}

function bookSearchText(book: OrganizerBook) {
  return `${book.title} ${book.subtitle} ${book.id}`.toLocaleLowerCase();
}

function formatSavedAt(value: string | null) {
  if (!value) return "not saved on this phone yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "saved on this phone"
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function draftDiscardId(key: string) {
  return `collections-wall-discard-${encodeURIComponent(key)}`;
}

function storageDraftsForVersion(baseVersion: string, source: PathsFile) {
  const current: StoredDraft[] = [];
  let staleCount = 0;
  let corruptCount = 0;
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
      corruptCount += 1;
      continue;
    }
    const envelope = parseCollectionsDraftEnvelope(parsed);
    if (!envelope) {
      corruptCount += 1;
      continue;
    }
    if (!key.startsWith(currentPrefix) || cleanAdminVersion(envelope.baseVersion) !== cleanAdminVersion(baseVersion)) {
      staleCount += 1;
      continue;
    }
    if (!pathsEqual(envelope.paths, source)) current.push({ key, envelope });
  }

  current.sort((left, right) => Date.parse(right.envelope.savedAt) - Date.parse(left.envelope.savedAt));
  return { current, staleCount, corruptCount };
}

function getFocusable(container: HTMLElement | null) {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter(control => control.offsetParent !== null);
}

export default function CollectionsWall({ books, initialBookId = "" }: { books: OrganizerBook[]; initialBookId?: string }) {
  const { setUnsaved } = useAdminUnsavedChanges();
  const boardRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const draggedBookRef = useRef<DraggedBook | null>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const initialFocusHandledRef = useRef("");
  const recoveryGateRef = useRef<HTMLElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);

  const bookById = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const canonicalBooks = useMemo(() => books.filter(book => !book.legacyAlias), [books]);
  const validBookIds = useMemo(() => new Set(canonicalBooks.map(book => book.id)), [canonicalBooks]);

  const [sourcePaths, setSourcePaths] = useState<PathsFile | null>(null);
  const [draftPaths, setDraftPaths] = useState<PathsFile | null>(null);
  const [sourceVersion, setSourceVersion] = useState("");
  const [undoStack, setUndoStack] = useState<PathsFile[]>([]);
  const [redoStack, setRedoStack] = useState<PathsFile[]>([]);
  const [activeDraftId, setActiveDraftId] = useState(makeDraftId);
  const [phoneSavedAt, setPhoneSavedAt] = useState<string | null>(null);
  const [phoneStorageError, setPhoneStorageError] = useState("");
  const [recoveryCandidates, setRecoveryCandidates] = useState<StoredDraft[]>([]);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [olderDraftCount, setOlderDraftCount] = useState(0);
  const [corruptDraftCount, setCorruptDraftCount] = useState(0);
  const [pendingDiscardKey, setPendingDiscardKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [staleSource, setStaleSource] = useState(false);

  const [draggedBook, setDraggedBook] = useState<DraggedBook | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [bankMode, setBankMode] = useState<BankMode>("loose");
  const [bankQuery, setBankQuery] = useState("");
  const [bankExpanded, setBankExpanded] = useState(false);
  const [bankPriority, setBankPriority] = useState<string[]>([]);
  const [findQuery, setFindQuery] = useState("");
  const [spotlightId, setSpotlightId] = useState("");
  const [moveSheetBookId, setMoveSheetBookId] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conversationNote, setConversationNote] = useState("");

  const dirty = useMemo(
    () => Boolean(sourcePaths && draftPaths && !pathsEqual(sourcePaths, draftPaths)),
    [draftPaths, sourcePaths],
  );
  const noteDirty = conversationNote.trim().length > 0;
  const editingLocked = busy || recoveryCandidates.length > 0 || !sourcePaths || !draftPaths;

  const clearDrag = useCallback(() => {
    pointerDragRef.current = null;
    pointerPositionRef.current = null;
    draggedBookRef.current = null;
    setDraggedBook(null);
    setDropTarget(null);
  }, []);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

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
        try {
          const stored = storageDraftsForVersion(nextVersion, nextPaths);
          setRecoveryCandidates(stored.current);
          setOlderDraftCount(stored.staleCount);
          setCorruptDraftCount(stored.corruptCount);
        } catch {
          setPhoneStorageError("Phone recovery storage is unavailable. Editing still works, but this browser cannot protect a local draft.");
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
  }, []);

  useEffect(() => {
    setUnsaved("collections-wall", dirty || noteDirty, "Collections Wall");
  }, [dirty, noteDirty, setUnsaved]);

  useEffect(() => () => setUnsaved("collections-wall", false), [setUnsaved]);

  const collections = useMemo(() => draftPaths ? organizerCollections(draftPaths) : [], [draftPaths]);
  const assignments = useMemo(
    () => draftPaths ? collectionAssignments(draftPaths) : new Map<string, string[]>(),
    [draftPaths],
  );
  const collectionById = useMemo(() => new Map(collections.map(collection => [collection.id, collection])), [collections]);
  const diagnostics = useMemo(
    () => draftPaths ? diagnoseOrganizerPaths(draftPaths, validBookIds) : [],
    [draftPaths, validBookIds],
  );
  const blockingDiagnostics = diagnostics.filter(item => item.blocking && !item.passed);
  const diffs = useMemo(
    () => sourcePaths && draftPaths ? diffOrganizerPaths(sourcePaths, draftPaths) : [],
    [draftPaths, sourcePaths],
  );

  const unassignedBooks = useMemo(() => {
    const priority = new Map(bankPriority.map((id, index) => [id, index]));
    return canonicalBooks
      .filter(book => !(assignments.get(book.id)?.length))
      .sort((left, right) => {
        const leftPriority = priority.get(left.id);
        const rightPriority = priority.get(right.id);
        if (leftPriority !== undefined || rightPriority !== undefined) {
          return (leftPriority ?? Number.MAX_SAFE_INTEGER) - (rightPriority ?? Number.MAX_SAFE_INTEGER);
        }
        return left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" });
      });
  }, [assignments, bankPriority, canonicalBooks]);

  const readyMainUnassignedCount = useMemo(
    () => unassignedBooks.filter(book => book.status === "ready" && book.visibility === "main").length,
    [unassignedBooks],
  );

  const bankBooks = useMemo(() => {
    const query = bankQuery.trim().toLocaleLowerCase();
    const source = bankMode === "loose"
      ? unassignedBooks
      : [...canonicalBooks].sort((left, right) => left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" }));
    return query ? source.filter(book => bookSearchText(book).includes(query)) : source;
  }, [bankMode, bankQuery, canonicalBooks, unassignedBooks]);

  const collectionGroups = useMemo(() => {
    const editorial = collections.filter(collection => collection.sourceBucket === "series");
    const ordered = collections.filter(collection => collection.sourceBucket !== "series");
    return [
      { id: "editorial", title: "Editorial Collections", collections: editorial },
      { id: "ordered", title: "Ordered sets", collections: ordered },
    ].filter(group => group.collections.length);
  }, [collections]);

  const persistPhoneDraft = useCallback((paths: PathsFile, announce = false) => {
    if (!sourcePaths || !sourceVersion || pathsEqual(sourcePaths, paths) || recoveryCandidates.length) return;
    try {
      const key = collectionDraftStorageKey(sourceVersion, activeDraftId);
      const savedAt = new Date().toISOString();
      const existingRaw = window.localStorage.getItem(key);
      const existing = existingRaw ? parseCollectionsDraftEnvelope(JSON.parse(existingRaw) as unknown) : null;
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
      if (announce) setNotice("Saved a recoverable draft on this phone. The live Collections were not changed.");
    } catch {
      setPhoneStorageError("This browser could not update the recovery draft. Nothing authoritative was changed.");
    }
  }, [activeDraftId, recoveryCandidates.length, sourcePaths, sourceVersion]);

  useEffect(() => {
    if (!recoveryChecked || recoveryCandidates.length || !draftPaths || !sourcePaths || !sourceVersion) return;
    if (!dirty) {
      try {
        window.localStorage.removeItem(collectionDraftStorageKey(sourceVersion, activeDraftId));
      } catch {
        // A clean source needs no recovery draft.
      }
      return;
    }
    const timer = window.setTimeout(() => persistPhoneDraft(draftPaths), 320);
    return () => window.clearTimeout(timer);
  }, [activeDraftId, dirty, draftPaths, persistPhoneDraft, recoveryCandidates.length, recoveryChecked, sourcePaths, sourceVersion]);

  useEffect(() => {
    if (!recoveryChecked || recoveryCandidates.length || !dirty || !draftPaths) return;
    const flush = () => persistPhoneDraft(draftPaths);
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [dirty, draftPaths, persistPhoneDraft, recoveryCandidates.length, recoveryChecked]);

  useEffect(() => {
    if (!pendingDiscardKey) return;
    const frame = window.requestAnimationFrame(() => {
      const confirmation = document.getElementById(draftDiscardId(pendingDiscardKey));
      confirmation?.scrollIntoView({ behavior: "smooth", block: "center" });
      confirmation?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingDiscardKey]);

  useEffect(() => {
    if (!recoveryCandidates.length) return;
    const frame = window.requestAnimationFrame(() => getFocusable(recoveryGateRef.current)[0]?.focus());
    function trapRecoveryFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const controls = getFocusable(recoveryGateRef.current);
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
    document.addEventListener("keydown", trapRecoveryFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trapRecoveryFocus);
    };
  }, [recoveryCandidates.length]);

  const resolveDropTarget = useCallback((clientX: number, clientY: number): DropTarget | null => {
    const hit = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(
      "[data-collection-drop-index], [data-collection-drop-id]",
    );
    if (!hit) return null;
    const collectionId = hit.dataset.collectionId || hit.dataset.collectionDropId || "";
    if (collectionId !== BANK_ID && !collectionById.has(collectionId)) return null;
    if (hit.dataset.collectionDropIndex !== undefined) {
      const baseIndex = Number(hit.dataset.collectionDropIndex);
      if (!Number.isInteger(baseIndex) || baseIndex < 0) return null;
      const rect = hit.getBoundingClientRect();
      return { collectionId, index: clientX > rect.left + rect.width / 2 ? baseIndex + 1 : baseIndex };
    }
    return { collectionId, index: null };
  }, [collectionById]);

  useEffect(() => {
    if (!draggedBook) return;
    let frame = 0;
    const tick = () => {
      const position = pointerPositionRef.current;
      if (!position) return;
      const { x, y } = position;
      if (dragGhostRef.current) {
        dragGhostRef.current.style.left = `${x}px`;
        dragGhostRef.current.style.top = `${y}px`;
      }
      const hit = document.elementFromPoint(x, y);
      const horizontal = hit?.closest<HTMLElement>("[data-horizontal-scroll]");
      if (horizontal) {
        const rect = horizontal.getBoundingClientRect();
        const edge = Math.min(72, rect.width * 0.2);
        if (x < rect.left + edge) horizontal.scrollLeft -= 18;
        else if (x > rect.right - edge) horizontal.scrollLeft += 18;
      }
      const board = boardRef.current;
      if (board) {
        const rect = board.getBoundingClientRect();
        const edge = Math.min(84, rect.height * 0.24);
        if (y >= rect.top && y < rect.top + edge) board.scrollTop -= 16;
        else if (y <= rect.bottom && y > rect.bottom - edge) board.scrollTop += 16;
      }
      const nextTarget = resolveDropTarget(x, y);
      setDropTarget(current => (
        current?.collectionId === nextTarget?.collectionId && current?.index === nextTarget?.index
          ? current
          : nextTarget
      ));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [draggedBook, resolveDropTarget]);

  useEffect(() => {
    if (!draggedBook) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDrag();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") clearDrag();
    };
    window.addEventListener("blur", clearDrag);
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", clearDrag);
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [clearDrag, draggedBook]);

  const activeModal = Boolean(moveSheetBookId || reviewOpen);
  useEffect(() => {
    if (!activeModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => getFocusable(modalRef.current)[0]?.focus(), 0);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (busyRef.current) return;
        event.preventDefault();
        setMoveSheetBookId("");
        setReviewOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = getFocusable(modalRef.current);
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
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      queueMicrotask(() => modalReturnFocusRef.current?.focus());
    };
  }, [activeModal]);

  useEffect(() => {
    if (!spotlightId) return;
    const timer = window.setTimeout(() => setSpotlightId(""), 2600);
    return () => window.clearTimeout(timer);
  }, [spotlightId]);

  useEffect(() => {
    const requested = cleanBookId(initialBookId);
    if (!requested || !draftPaths || recoveryCandidates.length || initialFocusHandledRef.current === requested) return;
    initialFocusHandledRef.current = requested;
    const timer = window.setTimeout(() => focusBook(requested), 80);
    return () => window.clearTimeout(timer);
    // focusBook intentionally follows the loaded authoritative membership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPaths, initialBookId, recoveryCandidates.length]);

  function commit(transform: (current: PathsFile) => PathsFile, message: string) {
    if (!draftPaths || editingLocked) return;
    setUndoStack(current => [...current.slice(-29), clonePathsFile(draftPaths)]);
    setRedoStack([]);
    setDraftPaths(preparePathsForSave(transform(draftPaths)));
    setNotice(message);
  }

  function undo() {
    if (!draftPaths || !undoStack.length || busy) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(current => current.slice(0, -1));
    setRedoStack(current => [...current.slice(-29), clonePathsFile(draftPaths)]);
    setDraftPaths(previous);
    setNotice("Undid the last Collection move. The authoritative file was not touched.");
  }

  function redo() {
    if (!draftPaths || !redoStack.length || busy) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(current => current.slice(0, -1));
    setUndoStack(current => [...current.slice(-29), clonePathsFile(draftPaths)]);
    setDraftPaths(next);
    setNotice("Redid the Collection move in this recoverable draft.");
  }

  function sendToBank(bookId: string) {
    const currentCollections = assignments.get(bookId) || [];
    if (!currentCollections.length) {
      setNotice(`${bookById.get(bookId)?.title || bookId} is already in the bank.`);
      clearDrag();
      return;
    }
    const title = bookById.get(bookId)?.title || bookId;
    commit(
      paths => mapCollections(paths, collection => ({
        ...collection,
        books: collection.books.filter(book => book.id !== bookId),
      })),
      `Moved ${title} to the bank. It is unassigned in this draft.`,
    );
    setBankPriority(current => [bookId, ...current.filter(id => id !== bookId)]);
    setBankMode("loose");
    clearDrag();
  }

  function placeBookAt(bookId: string, targetCollectionId: string, targetIndex: number | null = null) {
    const target = collectionById.get(targetCollectionId);
    if (!target || editingLocked || !bookById.has(bookId)) return;
    const title = bookById.get(bookId)?.title || bookId;
    const currentCollectionIds = assignments.get(bookId) || [];
    const currentIndex = target.books.findIndex(book => book.id === bookId);
    const beforeRemovalIndex = targetIndex ?? target.books.length;
    const nextIndex = Math.max(0, Math.min(
      target.books.length - (currentIndex >= 0 ? 1 : 0),
      currentIndex >= 0 && currentIndex < beforeRemovalIndex ? beforeRemovalIndex - 1 : beforeRemovalIndex,
    ));
    if (currentCollectionIds.length === 1 && currentCollectionIds[0] === targetCollectionId && currentIndex === nextIndex) {
      setNotice(`${title} is already in that position.`);
      clearDrag();
      return;
    }
    const existingMember = collections
      .flatMap(collection => collection.books)
      .find(book => book.id === bookId) || { id: bookId, order: 1, note: "" };
    const previousNames = currentCollectionIds
      .map(id => collectionById.get(id)?.title)
      .filter(Boolean)
      .join(", ");

    commit(paths => mapCollections(paths, collection => {
      const withoutBook = collection.books.filter(book => book.id !== bookId);
      if (collection.id !== targetCollectionId) return { ...collection, books: withoutBook };
      const insertAt = Math.max(0, Math.min(nextIndex, withoutBook.length));
      return {
        ...collection,
        books: [
          ...withoutBook.slice(0, insertAt),
          { ...existingMember, id: bookId, order: insertAt + 1 },
          ...withoutBook.slice(insertAt),
        ],
      };
    }), previousNames
      ? `${currentCollectionIds.includes(targetCollectionId) ? "Reordered" : "Moved"} ${title}${currentCollectionIds.includes(targetCollectionId) ? ` in ${target.title}` : ` from ${previousNames} to ${target.title}`}.`
      : `Moved ${title} from the bank to ${target.title}.`);
    setBankPriority(current => current.filter(id => id !== bookId));
    setSpotlightId(bookId);
    clearDrag();
    window.setTimeout(() => {
      cardRefs.current.get(`${targetCollectionId}:${bookId}`)?.focus({ preventScroll: true });
    }, 0);
  }

  function moveWithinCollection(collectionId: string, bookId: string, direction: -1 | 1) {
    const collection = collectionById.get(collectionId);
    if (!collection) return;
    const index = collection.books.findIndex(book => book.id === bookId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= collection.books.length) return;
    placeBookAt(bookId, collectionId, direction < 0 ? index - 1 : index + 2);
  }

  function beginPointerDrag(event: ReactPointerEvent<HTMLButtonElement>, bookId: string) {
    if (editingLocked || event.button !== 0) return;
    const fromCollectionId = assignments.get(bookId)?.[0] || null;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      bookId,
      fromCollectionId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerDragRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    if (!pointer.active && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 8) return;
    if (!pointer.active) {
      pointer.active = true;
      const next = { bookId: pointer.bookId, fromCollectionId: pointer.fromCollectionId };
      draggedBookRef.current = next;
      setDraggedBook(next);
    }
    event.preventDefault();
    if (dragGhostRef.current) {
      dragGhostRef.current.style.left = `${event.clientX}px`;
      dragGhostRef.current.style.top = `${event.clientY}px`;
    }
  }

  function endPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerDragRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    const target = pointer.active ? resolveDropTarget(event.clientX, event.clientY) : null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (target?.collectionId === BANK_ID) sendToBank(pointer.bookId);
    else if (target) placeBookAt(pointer.bookId, target.collectionId, target.index);
    else clearDrag();
  }

  function cancelPointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearDrag();
  }

  function openMoveSheet(bookId: string, trigger: HTMLElement) {
    modalReturnFocusRef.current = trigger;
    setDestinationQuery("");
    setMoveSheetBookId(bookId);
  }

  function openReview(trigger: HTMLElement) {
    modalReturnFocusRef.current = trigger;
    setReviewOpen(true);
  }

  function focusBook(rawQuery?: string) {
    const query = (rawQuery || findQuery).trim().toLocaleLowerCase();
    if (!query) return;
    const match = canonicalBooks.find(book => book.id === query || book.title.toLocaleLowerCase() === query)
      || canonicalBooks.find(book => book.title.toLocaleLowerCase().startsWith(query))
      || canonicalBooks.find(book => bookSearchText(book).includes(query));
    if (!match) {
      setNotice(`No book matches “${rawQuery || findQuery}.”`);
      return;
    }
    const collectionId = assignments.get(match.id)?.[0];
    const key = collectionId ? `${collectionId}:${match.id}` : `${BANK_ID}:${match.id}`;
    if (!collectionId) {
      setBankMode("loose");
      setBankExpanded(true);
      setBankQuery("");
    }
    window.setTimeout(() => {
      const target = cardRefs.current.get(key);
      if (!target) {
        setNotice(`${match.title} is in the catalog, but its card is not available in this view.`);
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      target.focus({ preventScroll: true });
      setSpotlightId(match.id);
      setNotice(collectionId ? `Found ${match.title} in ${collectionById.get(collectionId)?.title || collectionId}.` : `Found ${match.title} in the bank.`);
    }, 0);
  }

  function restoreDraft(candidate: StoredDraft) {
    if (!sourcePaths) return;
    const restored = rebaseOrganizerMembershipDraft(sourcePaths, candidate.envelope.paths);
    const restoredRevisions = candidate.envelope.revisions
      .map(revision => rebaseOrganizerMembershipDraft(sourcePaths, revision.paths));
    if (!restored || restoredRevisions.some(revision => !revision)) {
      setNotice("That recovery copy could not be safely rebased onto this exact Collections version. Nothing was restored or deleted.");
      return;
    }
    const safeRevisions = restoredRevisions.filter((revision): revision is PathsFile => Boolean(revision));
    setDraftPaths(restored);
    setUndoStack(safeRevisions);
    setRedoStack([]);
    setActiveDraftId(candidate.envelope.draftId);
    setPhoneSavedAt(candidate.envelope.savedAt);
    setRecoveryCandidates([]);
    setPendingDiscardKey("");
    setNotice(`Restored the Collection moves saved ${formatSavedAt(candidate.envelope.savedAt)}.`);
  }

  function startCleanKeepingDrafts() {
    setActiveDraftId(makeDraftId());
    setPhoneSavedAt(null);
    setRecoveryCandidates([]);
    setPendingDiscardKey("");
    setNotice("Started from the authoritative Collections. The older recovery draft remains stored.");
  }

  function discardStoredDraft(candidate: StoredDraft) {
    try {
      window.localStorage.removeItem(candidate.key);
      setRecoveryCandidates(current => current.filter(item => item.key !== candidate.key));
      setPendingDiscardKey("");
      setNotice("Deleted that browser-only recovery draft. The authoritative Collections were not changed.");
    } catch {
      setPhoneStorageError("This browser could not delete the recovery copy. It remains stored and editing stays locked.");
    }
  }

  function buildBoardSummary() {
    const lines = [
      "JJU Collections board",
      dirty ? `${diffs.length} Collection${diffs.length === 1 ? "" : "s"} changed in the current draft.` : "No draft changes yet.",
      "",
    ];
    for (const collection of collections) {
      lines.push(`${collection.title} (${collection.books.length})`);
      lines.push(collection.books.map((member, index) => `${index + 1}. ${bookById.get(member.id)?.title || member.id}`).join("\n") || "[empty]");
      lines.push("");
    }
    lines.push(`BANK / UNASSIGNED (${unassignedBooks.length})`);
    lines.push(unassignedBooks.map(book => book.title).join(" · ") || "[empty]");
    if (conversationNote.trim()) lines.push("", "JAMES'S NOTE", conversationNote.trim());
    if (diffs.length) {
      lines.push("", "CURRENT DRAFT CHANGES");
      for (const diff of diffs) {
        const added = diff.added.map(item => `+ ${bookById.get(item.id)?.title || item.id} at ${item.position}`);
        const removed = diff.removed.map(item => `- ${bookById.get(item.id)?.title || item.id} from ${item.position}`);
        const moved = diff.moved.map(item => `~ ${bookById.get(item.id)?.title || item.id}: ${item.from} -> ${item.to}`);
        lines.push(diff.title, ...added, ...removed, ...moved);
      }
    }
    return lines.join("\n");
  }

  async function copyBoardSummary() {
    const text = buildBoardSummary();
    try {
      await navigator.clipboard.writeText(text);
      if (noteDirty) setConversationNote("");
      setNotice(noteDirty ? "Copied the board, changes, and your note for chat. The copied note is now cleared here." : "Copied the entire board and current changes for chat.");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (copied && noteDirty) setConversationNote("");
      setNotice(copied
        ? noteDirty ? "Copied the board and your note for chat. The copied note is now cleared here." : "Copied the board for chat."
        : "This browser could not copy the board.");
    }
  }

  async function shareBoardSummary() {
    const text = buildBoardSummary();
    if (navigator.share) {
      try {
        await navigator.share({ title: "JJU Collections board", text });
        if (noteDirty) setConversationNote("");
        setNotice(noteDirty ? "Shared the board and your note. The shared note is now cleared here." : "Shared the Collections board.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyBoardSummary();
  }

  async function saveAuthoritative() {
    if (!sourcePaths || !draftPaths || !sourceVersion || !dirty || busy || staleSource || blockingDiagnostics.length) return;
    const prepared = rebaseOrganizerMembershipDraft(sourcePaths, draftPaths);
    if (!prepared) {
      setNotice("Saving is locked because the draft could not be reduced to membership and order changes. Nothing authoritative was changed.");
      return;
    }
    persistPhoneDraft(prepared);
    setBusy(true);
    setNotice("Saving the reviewed Collection order with an exact version match…");
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
          throw new Error(`${payload.error || "Collections changed after this board loaded."} Nothing was overwritten; this phone draft is preserved.`);
        }
        throw new Error(payload.error || "The reviewed Collections could not be saved.");
      }
      const nextEtag = response.headers.get("etag");
      if (!nextEtag || !isOrganizerPathsFile(payload.paths)) throw new Error("The save returned no verified Collections version. Reload before editing again.");
      const savedPaths = preparePathsForSave(payload.paths);
      try {
        window.localStorage.removeItem(collectionDraftStorageKey(sourceVersion, activeDraftId));
      } catch {
        // The exact-version save succeeded; a leftover browser draft is harmless.
      }
      setSourcePaths(savedPaths);
      setDraftPaths(savedPaths);
      setSourceVersion(cleanAdminVersion(nextEtag));
      setUndoStack([]);
      setRedoStack([]);
      setActiveDraftId(makeDraftId());
      setPhoneSavedAt(null);
      setStaleSource(false);
      setReviewOpen(false);
      setNotice(`Saved ${diffs.length} changed Collection${diffs.length === 1 ? "" : "s"} to ${payload.target || "paths.json"} with an exact version match.${payload.note ? ` ${payload.note}` : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The reviewed Collections could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <main className={styles.statePage}>
        <section className={styles.errorPanel} role="alert">
          <span>Collections Wall</span>
          <h1>Editing is safely locked</h1>
          <p>{loadError}</p>
          <button type="button" onClick={() => window.location.reload()}>Try loading again</button>
        </section>
      </main>
    );
  }

  if (!sourcePaths || !draftPaths) {
    return <main className={styles.statePage}><div className={styles.loading} role="status">Opening every Collection…</div></main>;
  }

  const moveBook = moveSheetBookId ? bookById.get(moveSheetBookId) : undefined;
  const moveCollectionId = moveSheetBookId ? assignments.get(moveSheetBookId)?.[0] || "" : "";
  const moveCollection = moveCollectionId ? collectionById.get(moveCollectionId) : undefined;
  const moveIndex = moveCollection?.books.findIndex(book => book.id === moveSheetBookId) ?? -1;
  const destinationCollections = destinationQuery.trim()
    ? collections.filter(collection => collection.title.toLocaleLowerCase().includes(destinationQuery.trim().toLocaleLowerCase()))
    : collections;
  const showNoticeBar = Boolean(notice || phoneStorageError || staleSource || olderDraftCount > 0 || corruptDraftCount > 0);

  return (
    <main className={`${styles.page} ${bankExpanded ? styles.bankIsExpanded : styles.bankIsCompact}`}>
      <header className={styles.commandBar} inert={recoveryCandidates.length > 0 ? true : undefined}>
        <div className={styles.titleBlock}>
          <span>Collections</span>
          <h1>One board. Nothing hidden.</h1>
          <p>{collections.length} Collections · {collections.reduce((sum, collection) => sum + collection.books.length, 0)} placed · {unassignedBooks.length} in the bank</p>
        </div>
        <form className={styles.findForm} onSubmit={event => { event.preventDefault(); focusBook(); }}>
          <label htmlFor="collections-find-book">Find a book</label>
          <div>
            <input
              id="collections-find-book"
              type="search"
              list="collections-book-titles"
              value={findQuery}
              onChange={event => setFindQuery(event.target.value)}
              placeholder="Title or book ID"
            />
            <button type="submit">Find</button>
          </div>
          <datalist id="collections-book-titles">
            {canonicalBooks.map(book => <option value={book.title} key={book.id}>{book.id}</option>)}
          </datalist>
        </form>
        <div className={styles.commandActions}>
          <button type="button" disabled={!undoStack.length || busy} onClick={undo} aria-label="Undo last Collection move">Undo</button>
          <button type="button" disabled={!redoStack.length || busy} onClick={redo} aria-label="Redo Collection move">Redo</button>
          <button type="button" onClick={() => void copyBoardSummary()}>Copy for chat</button>
          <button
            type="button"
            className={dirty || noteDirty ? styles.reviewReady : styles.reviewButton}
            disabled={!dirty && !noteDirty}
            onClick={event => openReview(event.currentTarget)}
          >{diffs.length ? `Review ${diffs.length}` : noteDirty ? "Review note" : "Review"}</button>
        </div>
      </header>

      <section className={`${styles.noticeBar} ${!showNoticeBar ? styles.noticeHidden : ""} ${staleSource || phoneStorageError ? styles.noticeProblem : ""}`} aria-live="polite" aria-hidden={!showNoticeBar} inert={recoveryCandidates.length > 0 ? true : undefined}>
        {showNoticeBar && (
          <>
            <div>
              <strong>{staleSource ? "Newer Collections detected" : phoneStorageError ? "Recovery warning" : dirty ? "Draft protected" : "Board ready"}</strong>
              <span>{staleSource ? "This draft cannot overwrite the newer file. It remains recoverable on this phone." : phoneStorageError || notice}</span>
            </div>
            {(olderDraftCount > 0 || corruptDraftCount > 0) && <small>{olderDraftCount ? `${olderDraftCount} older-version draft${olderDraftCount === 1 ? "" : "s"} kept. ` : ""}{corruptDraftCount ? `${corruptDraftCount} unreadable local entr${corruptDraftCount === 1 ? "y" : "ies"} ignored.` : ""}</small>}
          </>
        )}
      </section>

      {recoveryCandidates.length > 0 && (
        <section ref={recoveryGateRef} className={styles.recoveryGate} role="dialog" aria-modal="true" aria-labelledby="collections-recovery-title" aria-describedby="collections-recovery-description">
          <div>
            <span>Protected phone draft found</span>
            <h2 id="collections-recovery-title">Choose before this board can move anything</h2>
            <p id="collections-recovery-description">The live Collections have not been changed. Restore a draft, keep it stored and start clean, or deliberately delete it.</p>
          </div>
          <div className={styles.recoveryList}>
            {recoveryCandidates.map(candidate => (
              <article key={candidate.key}>
                <div><strong>{formatSavedAt(candidate.envelope.savedAt)}</strong><span>{diffOrganizerPaths(sourcePaths, candidate.envelope.paths).length} changed Collections</span></div>
                <button type="button" onClick={() => restoreDraft(candidate)}>Restore</button>
                <button type="button" onClick={startCleanKeepingDrafts}>Start clean; keep it</button>
                {pendingDiscardKey === candidate.key ? (
                  <span id={draftDiscardId(candidate.key)} className={styles.discardConfirm}>
                    <button type="button" onClick={() => discardStoredDraft(candidate)}>Yes, delete browser draft</button>
                    <button type="button" onClick={() => setPendingDiscardKey("")}>Cancel</button>
                  </span>
                ) : <button type="button" className={styles.deleteDraft} onClick={() => setPendingDiscardKey(candidate.key)}>Delete draft…</button>}
              </article>
            ))}
          </div>
        </section>
      )}

      <div ref={boardRef} className={styles.boardScroll} aria-label="All Collections" inert={recoveryCandidates.length > 0 ? true : undefined}>
        {collectionGroups.map(group => (
          <section className={styles.collectionGroup} aria-labelledby={`collection-group-${group.id}`} key={group.id}>
            <header className={styles.groupHeader}>
              <h2 id={`collection-group-${group.id}`}>{group.title}</h2>
              <span>{group.collections.length}</span>
            </header>
            {group.collections.map(collection => (
              <CollectionShelf
                key={collection.id}
                collection={collection}
                bookById={bookById}
                draggedBookId={draggedBook?.bookId || ""}
                dropTarget={dropTarget}
                editingLocked={editingLocked}
                spotlightId={spotlightId}
                registerCard={(key, element) => {
                  if (element) cardRefs.current.set(key, element);
                  else cardRefs.current.delete(key);
                }}
                onDragStart={beginPointerDrag}
                onDragMove={movePointerDrag}
                onDragEnd={endPointerDrag}
                onDragCancel={cancelPointerDrag}
                onOpenActions={openMoveSheet}
                onBank={sendToBank}
              />
            ))}
          </section>
        ))}
      </div>

      <section
        className={`${styles.bank} ${dropTarget?.collectionId === BANK_ID ? styles.bankDropActive : ""}`}
        data-collection-drop-id={BANK_ID}
        aria-labelledby="collections-bank-title"
        inert={recoveryCandidates.length > 0 ? true : undefined}
      >
        <header className={styles.bankHeader}>
          <div className={styles.bankIdentity}>
            <span>Working bank</span>
            <h2 id="collections-bank-title">Loose books <strong>{unassignedBooks.length}</strong></h2>
            <small>{readyMainUnassignedCount} published/main · dropping here removes a Collection assignment</small>
          </div>
          <div className={styles.bankControls}>
            <div className={styles.bankModes} role="group" aria-label="Books shown in bank">
              <button type="button" aria-pressed={bankMode === "loose"} className={bankMode === "loose" ? styles.activeBankMode : ""} onClick={() => setBankMode("loose")}>Loose</button>
              <button type="button" aria-pressed={bankMode === "all"} className={bankMode === "all" ? styles.activeBankMode : ""} onClick={() => setBankMode("all")}>All books</button>
            </div>
            <label className={styles.bankSearch}>
              <span>Search bank</span>
              <input type="search" value={bankQuery} onChange={event => setBankQuery(event.target.value)} placeholder="Search" />
            </label>
            <button type="button" className={styles.expandBank} onClick={() => setBankExpanded(current => !current)} aria-expanded={bankExpanded}>{bankExpanded ? "Smaller" : "Bigger"}</button>
          </div>
        </header>
        <div className={styles.bankRail} data-horizontal-scroll>
          {bankBooks.map(book => {
            const collectionId = assignments.get(book.id)?.[0] || "";
            return (
              <BankBookCard
                key={book.id}
                book={book}
                currentCollection={collectionId ? collectionById.get(collectionId)?.title || collectionId : "Loose"}
                dragged={draggedBook?.bookId === book.id}
                spotlighted={spotlightId === book.id}
                editingLocked={editingLocked}
                registerCard={element => {
                  const key = `${BANK_ID}:${book.id}`;
                  if (element) cardRefs.current.set(key, element);
                  else cardRefs.current.delete(key);
                }}
                onDragStart={beginPointerDrag}
                onDragMove={movePointerDrag}
                onDragEnd={endPointerDrag}
                onDragCancel={cancelPointerDrag}
                onOpenActions={openMoveSheet}
              />
            );
          })}
          {!bankBooks.length && <div className={styles.emptyBank}>{bankQuery.trim() ? "No books match that search." : "The bank is empty."}</div>}
        </div>
        <footer className={styles.bankFooter}>
          <span>{dirty ? `${diffs.length} Collection${diffs.length === 1 ? "" : "s"} changed · recovery ${formatSavedAt(phoneSavedAt)}` : "Matches the loaded Collections"}</span>
          <div>
            <button type="button" onClick={() => void shareBoardSummary()}>Share board</button>
            <button type="button" disabled={!dirty} onClick={event => openReview(event.currentTarget)}>Review &amp; save</button>
          </div>
        </footer>
      </section>

      {moveSheetBookId && moveBook && (
        <div className={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) setMoveSheetBookId(""); }}>
          <section ref={modalRef} className={styles.moveSheet} role="dialog" aria-modal="true" aria-labelledby="collections-move-title">
            <header className={styles.sheetHeader}>
              <div><span>Move a book</span><h2 id="collections-move-title">{moveBook.title}</h2><p>{moveCollection?.title || "Currently in the bank"}</p></div>
              <button type="button" onClick={() => setMoveSheetBookId("")}>Close</button>
            </header>
            <div className={styles.moveCurrentActions}>
              <button type="button" disabled={!moveCollection || moveIndex <= 0} onClick={() => { moveWithinCollection(moveCollectionId, moveSheetBookId, -1); setMoveSheetBookId(""); }}>Earlier</button>
              <button type="button" disabled={!moveCollection || moveIndex < 0 || moveIndex >= moveCollection.books.length - 1} onClick={() => { moveWithinCollection(moveCollectionId, moveSheetBookId, 1); setMoveSheetBookId(""); }}>Later</button>
              <button type="button" disabled={!moveCollection} className={styles.sendToBank} onClick={() => { sendToBank(moveSheetBookId); setMoveSheetBookId(""); }}>Send to bank</button>
            </div>
            <label className={styles.destinationSearch}>
              Find a destination
              <input autoComplete="off" type="search" value={destinationQuery} onChange={event => setDestinationQuery(event.target.value)} placeholder="Collection name" />
            </label>
            <div className={styles.destinationList}>
              {destinationCollections.map(collection => (
                <button type="button" key={collection.id} onClick={() => { placeBookAt(moveSheetBookId, collection.id); setMoveSheetBookId(""); }}>
                  <span><strong>{collection.title}</strong><small>{collection.books.length} books</small></span>
                  <b>{collection.id === moveCollectionId ? "Move to end" : "Move here"}</b>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {reviewOpen && (
        <div className={styles.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget && !busy) setReviewOpen(false); }}>
          <section ref={modalRef} className={styles.reviewSheet} role="dialog" aria-modal="true" aria-labelledby="collections-review-title">
            <header className={styles.sheetHeader}>
              <div><span>Exact review</span><h2 id="collections-review-title">{diffs.length} changed Collection{diffs.length === 1 ? "" : "s"}</h2><p>The board stays underneath. Nothing saves until the final button.</p></div>
              <button type="button" disabled={busy} onClick={() => setReviewOpen(false)}>Close</button>
            </header>
            <div className={styles.reviewBody}>
              <section className={styles.diagnosticPanel}>
                <header><h3>Safety checks</h3><strong className={blockingDiagnostics.length ? styles.blocked : styles.passed}>{blockingDiagnostics.length ? `${blockingDiagnostics.length} blocked` : "All pass"}</strong></header>
                {diagnostics.map(item => <div className={item.passed ? styles.diagnosticPass : styles.diagnosticFail} key={item.id}><span>{item.passed ? "✓" : "!"}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div></div>)}
              </section>
              <section className={styles.diffPanel}>
                <header><h3>What changed</h3><strong>{diffs.length}</strong></header>
                {!diffs.length ? <p className={styles.noChanges}>This draft matches the loaded source.</p> : diffs.map(diff => (
                  <details key={diff.id} open={diffs.length <= 4}>
                    <summary><span><strong>{diff.title}</strong><small>{diff.id}</small></span><b>{diff.added.length ? `+${diff.added.length} ` : ""}{diff.removed.length ? `−${diff.removed.length} ` : ""}{diff.moved.length ? `${diff.moved.length} reordered` : ""}</b></summary>
                    <div>
                      {diff.added.map(item => <p className={styles.added} key={`a-${item.id}`}>Added {bookById.get(item.id)?.title || item.id} at {item.position}</p>)}
                      {diff.removed.map(item => <p className={styles.removed} key={`r-${item.id}`}>Removed {bookById.get(item.id)?.title || item.id} from {item.position}</p>)}
                      {diff.moved.map(item => <p key={`m-${item.id}`}>Reordered {bookById.get(item.id)?.title || item.id}: {item.from} → {item.to}</p>)}
                    </div>
                  </details>
                ))}
              </section>
              <label className={styles.conversationNote}>
                Note to include when you copy or share this board
                <textarea value={conversationNote} onChange={event => setConversationNote(event.target.value)} placeholder="Example: The System still feels too broad…" />
              </label>
              {notice && <p className={`${styles.reviewNotice} ${staleSource ? styles.reviewNoticeProblem : ""}`} role={staleSource ? "alert" : "status"}>{notice}</p>}
            </div>
            <footer className={styles.reviewFooter}>
              <div><strong>{formatSavedAt(phoneSavedAt)}</strong><span>recoverable phone draft</span></div>
              <button type="button" onClick={() => void copyBoardSummary()}>Copy for chat</button>
              <button
                type="button"
                className={styles.authoritativeSave}
                disabled={!dirty || busy || staleSource || blockingDiagnostics.length > 0}
                onClick={() => void saveAuthoritative()}
              >{busy ? "Saving exact version…" : staleSource ? "Reload required" : blockingDiagnostics.length ? "Fix blocked checks" : "Save Collections"}</button>
            </footer>
          </section>
        </div>
      )}

      {draggedBook && (
        <div
          ref={dragGhostRef}
          className={styles.dragGhost}
          style={{ left: pointerPositionRef.current?.x || 0, top: pointerPositionRef.current?.y || 0 }}
          aria-hidden="true"
        >
          <span>⠿</span><strong>{bookById.get(draggedBook.bookId)?.title || draggedBook.bookId}</strong>
        </div>
      )}
    </main>
  );
}

function CollectionShelf({
  collection,
  bookById,
  draggedBookId,
  dropTarget,
  editingLocked,
  spotlightId,
  registerCard,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onOpenActions,
  onBank,
}: {
  collection: OrganizerCollection;
  bookById: Map<string, OrganizerBook>;
  draggedBookId: string;
  dropTarget: DropTarget | null;
  editingLocked: boolean;
  spotlightId: string;
  registerCard: (key: string, element: HTMLElement | null) => void;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>, bookId: string) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenActions: (bookId: string, trigger: HTMLElement) => void;
  onBank: (bookId: string) => void;
}) {
  return (
    <section className={`${styles.collectionShelf} ${dropTarget?.collectionId === collection.id ? styles.shelfDropActive : ""}`} data-collection-drop-id={collection.id} aria-labelledby={`collection-${collection.id}`}>
      <header className={styles.shelfIdentity}>
        <span>{collection.sourceBucket === "series" ? "Collection" : "Ordered set"}</span>
        <h3 id={`collection-${collection.id}`}>{collection.title}</h3>
        <p>{collection.books.length} book{collection.books.length === 1 ? "" : "s"}</p>
      </header>
      <ol className={styles.shelfRail} data-horizontal-scroll>
        {collection.books.map((member, index) => {
          const book = bookById.get(member.id);
          const dropBefore = dropTarget?.collectionId === collection.id && dropTarget.index === index;
          const dropAfter = dropTarget?.collectionId === collection.id && dropTarget.index === index + 1;
          if (!book) {
            return <li className={styles.missingBook} key={member.id}><strong>{member.id}</strong><span>Missing catalog book</span></li>;
          }
          return (
            <li
              ref={element => registerCard(`${collection.id}:${book.id}`, element)}
              className={`${styles.shelfBook} ${draggedBookId === book.id ? styles.dragging : ""} ${spotlightId === book.id ? styles.spotlight : ""} ${dropBefore ? styles.dropBefore : ""} ${dropAfter ? styles.dropAfter : ""}`}
              data-collection-id={collection.id}
              data-collection-drop-index={index}
              data-book-id={book.id}
              tabIndex={-1}
              key={book.id}
            >
              <div className={styles.coverWrap}>
                <OrganizerCover book={book} sizes="(max-width: 720px) 78px, 92px" />
                <span className={styles.orderBadge}>{index + 1}</span>
                <button
                  type="button"
                  className={styles.dragHandle}
                  disabled={editingLocked}
                  aria-label={`Drag ${book.title}, position ${index + 1} in ${collection.title}`}
                  onPointerDown={event => onDragStart(event, book.id)}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onPointerCancel={onDragCancel}
                  onLostPointerCapture={onDragCancel}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenActions(book.id, event.currentTarget);
                    }
                  }}
                ><span aria-hidden="true">⠿</span></button>
              </div>
              <strong className={styles.bookTitle}>{book.title}</strong>
              <span className={styles.bookStatus}>{book.status === "ready" ? "Published" : book.status.replaceAll("-", " ")}{book.visibility === "archive" ? " · archive" : ""}</span>
              <div className={styles.bookActions}>
                <button type="button" disabled={editingLocked} onClick={event => onOpenActions(book.id, event.currentTarget)}>Move…</button>
                <button type="button" disabled={editingLocked} onClick={() => onBank(book.id)} aria-label={`Send ${book.title} to bank`}>Bank</button>
              </div>
            </li>
          );
        })}
        <li className={`${styles.endDrop} ${dropTarget?.collectionId === collection.id && (dropTarget.index === null || dropTarget.index >= collection.books.length) ? styles.endDropActive : ""}`} data-collection-drop-id={collection.id}>
          <span>{collection.books.length ? "Drop at end" : "Drop the first book here"}</span>
        </li>
      </ol>
    </section>
  );
}

function BankBookCard({
  book,
  currentCollection,
  dragged,
  spotlighted,
  editingLocked,
  registerCard,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onOpenActions,
}: {
  book: OrganizerBook;
  currentCollection: string;
  dragged: boolean;
  spotlighted: boolean;
  editingLocked: boolean;
  registerCard: (element: HTMLElement | null) => void;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>, bookId: string) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenActions: (bookId: string, trigger: HTMLElement) => void;
}) {
  return (
    <article ref={registerCard} className={`${styles.bankBook} ${dragged ? styles.dragging : ""} ${spotlighted ? styles.spotlight : ""}`} data-book-id={book.id} tabIndex={-1}>
      <div className={styles.bankCover}>
        <OrganizerCover book={book} sizes="64px" />
        <button
          type="button"
          className={styles.dragHandle}
          disabled={editingLocked}
          aria-label={`Drag ${book.title} from the bank`}
          onPointerDown={event => onDragStart(event, book.id)}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragCancel}
          onLostPointerCapture={onDragCancel}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenActions(book.id, event.currentTarget);
            }
          }}
        ><span aria-hidden="true">⠿</span></button>
      </div>
      <div className={styles.bankBookCopy}><strong>{book.title}</strong><span>{currentCollection} · {book.status}</span></div>
      <button type="button" className={styles.bankMoveButton} disabled={editingLocked} onClick={event => onOpenActions(book.id, event.currentTarget)}>Move…</button>
    </article>
  );
}

function OrganizerCover({ book, sizes }: { book: OrganizerBook; sizes: string }) {
  const [source, setSource] = useState(book.coverSrc);
  return (
    <span className={styles.coverFrame}>
      <Image
        src={source}
        alt={`${book.title} cover`}
        fill
        sizes={sizes}
        onError={() => setSource(current => current === book.fallbackCoverSrc ? "/file.svg" : book.fallbackCoverSrc)}
      />
    </span>
  );
}
