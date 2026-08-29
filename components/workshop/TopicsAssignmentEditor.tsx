"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import styles from "./TopicsAssignmentEditor.module.css";

export type TopicAssignmentBook = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  visibility: string;
  coverSrc: string;
  fallbackCoverSrc: string;
};

type TopicAuthorityDocument = {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  topicsByBook: Record<string, string[]>;
};

type TopicDiagnostics = {
  valid: boolean;
  catalogBookCount: number;
  assignedBookCount: number;
  unassignedBookCount: number;
  overlapBookCount: number;
  totalAssignments: number;
  missingBookIds: string[];
  unknownBookIds: string[];
};

type TopicApiBook = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  topics: string[];
  hasAuthorityEntry: boolean;
};

type TopicSnapshot = {
  authority: TopicAuthorityDocument;
  approvedTopics: string[];
  books: TopicApiBook[];
  diagnostics: TopicDiagnostics;
  source: "github" | "file";
  catalogSource: "supabase" | "github" | "file";
  writable: boolean;
  persistenceBoundary: string;
};

type TopicSaveResponse = {
  saved?: boolean;
  authority?: TopicAuthorityDocument;
  diagnostics?: TopicDiagnostics;
  target?: string;
  note?: string;
  error?: string;
};

type TopicFilter = "problem" | "unassigned" | "any";
type SaveState = "ready" | "saving" | "saved" | "failed" | "conflict";

type HistoryEntry = {
  bookId: string;
  before: string[];
  after: string[];
};

type RecoveryEnvelope = {
  schemaVersion: 1;
  baseVersion: string;
  baseRevision: number;
  savedAt: string;
  topicsByBook: Record<string, string[]>;
};

type BookDiff = {
  id: string;
  title: string;
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
  repair?: "create-entry" | "remove-unknown";
};

type DamagedRecovery = {
  key: string;
  raw: string;
  reason: string;
};

const STORAGE_PREFIX = "jju.topic-assignments.v1.";
const UNSAVED_SCOPE = "topic-assignments";
const PAGE_SIZE = 48;

function cleanVersion(value: string | null | undefined) {
  return String(value || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

function recoveryKey(version: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(cleanVersion(version))}`;
}

function sortText(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function canonicalTopics(value: readonly string[]) {
  return [...new Set(value)].sort(sortText);
}

function topicListsEqual(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  return left.every((topic, index) => topic === right[index]);
}

function authorityEqual(left: Record<string, string[]> | null, right: Record<string, string[]> | null) {
  if (!left || !right) return left === right;
  const leftIds = Object.keys(left).sort(sortText);
  const rightIds = Object.keys(right).sort(sortText);
  if (leftIds.length !== rightIds.length || leftIds.some((id, index) => id !== rightIds[index])) return false;
  return leftIds.every(id => topicListsEqual(left[id] || [], right[id] || []));
}

function cloneTopicsByBook(value: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(value).map(([id, topics]) => [id, [...topics]]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTopicAuthority(value: unknown): value is TopicAuthorityDocument {
  if (!isObject(value) || !Number.isSafeInteger(value.schemaVersion) || !Number.isSafeInteger(value.revision)) return false;
  if (typeof value.updatedAt !== "string" || !isObject(value.topicsByBook)) return false;
  return Object.values(value.topicsByBook).every(topics => Array.isArray(topics) && topics.every(topic => typeof topic === "string"));
}

function isTopicSnapshot(value: unknown): value is TopicSnapshot {
  if (!isObject(value) || !isTopicAuthority(value.authority)) return false;
  if (!Array.isArray(value.approvedTopics) || !value.approvedTopics.every(topic => typeof topic === "string")) return false;
  if (!Array.isArray(value.books) || !value.books.every(book => (
    isObject(book)
    && typeof book.id === "string"
    && typeof book.title === "string"
    && typeof book.status === "string"
    && typeof book.visibility === "string"
    && Array.isArray(book.topics)
    && book.topics.every(topic => typeof topic === "string")
    && typeof book.hasAuthorityEntry === "boolean"
  ))) return false;
  return isObject(value.diagnostics)
    && typeof value.diagnostics.valid === "boolean"
    && typeof value.diagnostics.catalogBookCount === "number"
    && typeof value.diagnostics.assignedBookCount === "number"
    && typeof value.diagnostics.unassignedBookCount === "number"
    && typeof value.diagnostics.overlapBookCount === "number"
    && typeof value.diagnostics.totalAssignments === "number"
    && Array.isArray(value.diagnostics.missingBookIds)
    && value.diagnostics.missingBookIds.every(id => typeof id === "string")
    && Array.isArray(value.diagnostics.unknownBookIds)
    && value.diagnostics.unknownBookIds.every(id => typeof id === "string")
    && typeof value.source === "string"
    && typeof value.catalogSource === "string"
    && typeof value.writable === "boolean"
    && typeof value.persistenceBoundary === "string";
}

function sanitizeRecovery(
  value: unknown,
  version: string,
  revision: number,
  approvedTopics: ReadonlySet<string>,
  bookIds: readonly string[],
) {
  if (!isObject(value)
    || value.schemaVersion !== 1
    || cleanVersion(String(value.baseVersion || "")) !== cleanVersion(version)
    || value.baseRevision !== revision
    || !isObject(value.topicsByBook)) return null;

  const submittedIds = Object.keys(value.topicsByBook).sort(sortText);
  const expectedIds = [...bookIds].sort(sortText);
  if (submittedIds.length !== expectedIds.length || submittedIds.some((id, index) => id !== expectedIds[index])) return null;
  const topicsByBook: Record<string, string[]> = {};
  for (const id of expectedIds) {
    const topics = value.topicsByBook[id];
    if (!Array.isArray(topics) || !topics.every(topic => typeof topic === "string" && approvedTopics.has(topic))) return null;
    topicsByBook[id] = canonicalTopics(topics);
  }
  return {
    schemaVersion: 1 as const,
    baseVersion: cleanVersion(version),
    baseRevision: revision,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    topicsByBook,
  };
}

function needsReview(topics: readonly string[]) {
  return topics.length < 2 || topics.length > 6;
}

function topicCountLabel(count: number) {
  if (count === 0) return "Unassigned";
  if (count === 1) return "Needs another look";
  if (count > 6) return "Heavy assignment";
  return `${count} overlapping Topics`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "previously"
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function TopicsAssignmentEditor({ books }: { books: TopicAssignmentBook[] }) {
  const editorRef = useRef<HTMLElement>(null);
  const { setUnsaved } = useAdminUnsavedChanges();
  const visualBookById = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const [snapshot, setSnapshot] = useState<TopicSnapshot | null>(null);
  const [sourceVersion, setSourceVersion] = useState("");
  const [sourceTopics, setSourceTopics] = useState<Record<string, string[]> | null>(null);
  const [draftTopics, setDraftTopics] = useState<Record<string, string[]> | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TopicFilter>("problem");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [activeBookId, setActiveBookId] = useState("");
  const [topicQuery, setTopicQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("ready");
  const [notice, setNotice] = useState("");
  const [recoverySavedAt, setRecoverySavedAt] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [olderRecoveryCount, setOlderRecoveryCount] = useState(0);
  const [damagedRecovery, setDamagedRecovery] = useState<DamagedRecovery | null>(null);
  const [repairMode, setRepairMode] = useState(false);
  const [staleSource, setStaleSource] = useState(false);

  const dirty = useMemo(() => !authorityEqual(sourceTopics, draftTopics), [draftTopics, sourceTopics]);
  const editingLocked = staleSource || Boolean(damagedRecovery) || saveState === "saving";
  const approvedTopicSet = useMemo(() => new Set(snapshot?.approvedTopics || []), [snapshot?.approvedTopics]);
  const bookIds = useMemo(() => snapshot?.books.map(book => book.id).sort(sortText) || [], [snapshot?.books]);
  const apiBookById = useMemo(() => new Map(snapshot?.books.map(book => [book.id, book]) || []), [snapshot?.books]);

  const loadAuthority = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/admin/topics", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as unknown;
      const repairableSnapshot = response.status === 409 && isTopicSnapshot(payload);
      if (!response.ok && !repairableSnapshot) {
        const detail = isObject(payload) && typeof payload.error === "string" ? payload.error : "";
        throw new Error(detail || "Could not load the authoritative Topic assignments.");
      }
      if (!isTopicSnapshot(payload)) throw new Error("The Topic API returned an invalid authority document. Editing stays locked.");
      const etag = cleanVersion(response.headers.get("etag"));
      if (!etag) throw new Error("The Topic API returned no exact source version. Editing stays locked.");

      const approved = new Set(payload.approvedTopics);
      const nextBookIds = payload.books.map(book => book.id).sort(sortText);
      const nextSource = Object.fromEntries(Object.entries(payload.authority.topicsByBook).map(([id, topics]) => [id, canonicalTopics(topics)]));
      let nextDraft = Object.fromEntries(nextBookIds.map(id => [id, canonicalTopics(payload.authority.topicsByBook[id] || [])]));
      let recoveredAt = "";
      let olderCount = 0;
      let damaged: DamagedRecovery | null = null;

      try {
        const currentKey = recoveryKey(etag);
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index) || "";
          if (key.startsWith(STORAGE_PREFIX) && key !== currentKey) olderCount += 1;
        }
        const stored = window.localStorage.getItem(currentKey);
        if (stored) {
          try {
            const recovered = sanitizeRecovery(JSON.parse(stored), etag, payload.authority.revision, approved, nextBookIds);
            if (!recovered) {
              damaged = { key: currentKey, raw: stored, reason: "This version's phone draft is incomplete or does not match the approved Topic authority." };
            } else if (!authorityEqual(nextDraft, recovered.topicsByBook)) {
              nextDraft = recovered.topicsByBook;
              recoveredAt = recovered.savedAt;
            }
          } catch {
            damaged = { key: currentKey, raw: stored, reason: "This version's phone draft is not readable JSON." };
          }
        }
        setRecoveryError("");
      } catch {
        setRecoveryError("Phone recovery storage is unavailable. Topic editing still works, but this browser cannot protect a local draft.");
      }

      setSnapshot(payload);
      setSourceVersion(etag);
      setSourceTopics(nextSource);
      setDraftTopics(nextDraft);
      setHistory([]);
      setActiveBookId(current => {
        if (nextBookIds.includes(current)) return current;
        const firstUnassigned = payload.books.find(book => (nextDraft[book.id] || []).length === 0)?.id;
        return firstUnassigned || nextBookIds[0] || "";
      });
      setRecoverySavedAt(recoveredAt);
      setOlderRecoveryCount(olderCount);
      setDamagedRecovery(damaged);
      setRepairMode(repairableSnapshot || !payload.diagnostics.valid);
      setStaleSource(false);
      setSaveState(recoveredAt ? "saved" : "ready");
      setNotice(damaged
        ? "A damaged current-version phone draft was quarantined. Export or explicitly discard it before editing."
        : repairableSnapshot || !payload.diagnostics.valid
          ? `Loaded a repairable Topic authority: ${payload.diagnostics.missingBookIds.length} missing catalog entries and ${payload.diagnostics.unknownBookIds.length} unknown entries. The complete repair draft can save only with the exact source version.`
          : recoveredAt
        ? `Recovered this version's phone draft from ${formatDate(recoveredAt)}.`
        : "Loaded the exact authoritative Topic version. Nothing has been changed.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load Topic assignments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAuthority(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAuthority]);

  useEffect(() => {
    setUnsaved(UNSAVED_SCOPE, dirty, "Topic assignments");
  }, [dirty, setUnsaved]);

  useEffect(() => () => setUnsaved(UNSAVED_SCOPE, false), [setUnsaved]);

  useEffect(() => {
    if (!snapshot || !sourceVersion || !sourceTopics || !draftTopics || damagedRecovery) return;
    const timer = window.setTimeout(() => {
      try {
        const key = recoveryKey(sourceVersion);
        if (!dirty) {
          window.localStorage.removeItem(key);
          setRecoverySavedAt("");
          return;
        }
        const savedAt = new Date().toISOString();
        const envelope: RecoveryEnvelope = {
          schemaVersion: 1,
          baseVersion: sourceVersion,
          baseRevision: snapshot.authority.revision,
          savedAt,
          topicsByBook: draftTopics,
        };
        window.localStorage.setItem(key, JSON.stringify(envelope));
        setRecoverySavedAt(savedAt);
        setRecoveryError("");
      } catch {
        setRecoveryError("Phone recovery autosave failed. Export the exact diff before leaving this page.");
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [damagedRecovery, dirty, draftTopics, snapshot, sourceTopics, sourceVersion]);

  const orderedBooks = useMemo(() => {
    if (!snapshot || !draftTopics) return [];
    return snapshot.books.map(apiBook => {
      const visual = visualBookById.get(apiBook.id);
      return {
        id: apiBook.id,
        title: visual?.title || apiBook.title,
        subtitle: visual?.subtitle || "",
        status: visual?.status || apiBook.status,
        visibility: visual?.visibility || apiBook.visibility,
        coverSrc: visual?.coverSrc || "/file.svg",
        fallbackCoverSrc: visual?.fallbackCoverSrc || "/file.svg",
        topics: draftTopics[apiBook.id] || [],
      };
    }).sort((left, right) => sortText(left.title, right.title));
  }, [draftTopics, snapshot, visualBookById]);

  const problemBooks = useMemo(() => orderedBooks.filter(book => needsReview(book.topics)), [orderedBooks]);

  const filteredBooks = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase("en");
    return orderedBooks.filter(book => {
      if (filter === "unassigned" && book.topics.length !== 0) return false;
      if (filter === "problem" && !needsReview(book.topics)) return false;
      return !cleanQuery || `${book.title} ${book.subtitle} ${book.id} ${book.status} ${book.visibility} ${book.topics.join(" ")}`
        .toLocaleLowerCase("en")
        .includes(cleanQuery);
    });
  }, [filter, orderedBooks, query]);

  const activeBook = useMemo(() => orderedBooks.find(book => book.id === activeBookId) || null, [activeBookId, orderedBooks]);

  const visibleApprovedTopics = useMemo(() => {
    if (!snapshot || !activeBook) return [];
    const cleanQuery = topicQuery.trim().toLocaleLowerCase("en");
    return snapshot.approvedTopics
      .filter(topic => !cleanQuery || topic.toLocaleLowerCase("en").includes(cleanQuery))
      .sort((left, right) => Number(activeBook.topics.includes(right)) - Number(activeBook.topics.includes(left)) || sortText(left, right));
  }, [activeBook, snapshot, topicQuery]);

  const diffs = useMemo<BookDiff[]>(() => {
    if (!sourceTopics || !draftTopics) return [];
    const validIds = new Set(bookIds);
    const catalogDiffs = bookIds.flatMap(id => {
      const before = sourceTopics[id] || [];
      const after = draftTopics[id] || [];
      const missingEntry = !Object.hasOwn(sourceTopics, id);
      if (!missingEntry && topicListsEqual(before, after)) return [];
      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      return [{
        id,
        title: visualBookById.get(id)?.title || apiBookById.get(id)?.title || id,
        before,
        after,
        added: after.filter(topic => !beforeSet.has(topic)),
        removed: before.filter(topic => !afterSet.has(topic)),
        ...(missingEntry ? { repair: "create-entry" as const } : {}),
      }];
    });
    const unknownDiffs = Object.keys(sourceTopics)
      .filter(id => !validIds.has(id))
      .map(id => ({
        id,
        title: `Unknown authority entry: ${id}`,
        before: sourceTopics[id] || [],
        after: [],
        added: [],
        removed: sourceTopics[id] || [],
        repair: "remove-unknown" as const,
      }));
    return [...catalogDiffs, ...unknownDiffs].sort((left, right) => sortText(left.title, right.title));
  }, [apiBookById, bookIds, draftTopics, sourceTopics, visualBookById]);

  function applyTopics(bookId: string, nextTopics: string[]) {
    if (!draftTopics || !approvedTopicSet.size || editingLocked) return;
    const before = draftTopics[bookId] || [];
    const after = canonicalTopics(nextTopics.filter(topic => approvedTopicSet.has(topic)));
    if (topicListsEqual(before, after)) return;
    setHistory(current => [...current, { bookId, before: [...before], after: [...after] }].slice(-80));
    setDraftTopics(current => current ? { ...current, [bookId]: after } : current);
    setSaveState("ready");
    setNotice(`${visualBookById.get(bookId)?.title || apiBookById.get(bookId)?.title || bookId}: ${topicCountLabel(after.length)}. Browser recovery will autosave this draft.`);
  }

  function toggleTopic(bookId: string, topic: string) {
    const current = draftTopics?.[bookId] || [];
    applyTopics(bookId, current.includes(topic) ? current.filter(item => item !== topic) : [...current, topic]);
  }

  function undo() {
    const last = editingLocked ? undefined : history.at(-1);
    if (!last || !draftTopics) return;
    setDraftTopics(current => current ? { ...current, [last.bookId]: [...last.before] } : current);
    setHistory(current => current.slice(0, -1));
    setActiveBookId(last.bookId);
    setSaveState("ready");
    setNotice(`Undid the last Topic change for ${visualBookById.get(last.bookId)?.title || apiBookById.get(last.bookId)?.title || last.bookId}.`);
  }

  function focusBook(bookId: string, scroll = true) {
    const index = filteredBooks.findIndex(book => book.id === bookId);
    if (index >= limit) setLimit(Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE);
    setActiveBookId(bookId);
    setTopicQuery("");
    if (scroll) window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function nextNeedsReview() {
    const queue = problemBooks.filter(book => {
      const cleanQuery = query.trim().toLocaleLowerCase("en");
      return !cleanQuery || `${book.title} ${book.subtitle} ${book.id} ${book.topics.join(" ")}`.toLocaleLowerCase("en").includes(cleanQuery);
    });
    if (!queue.length) {
      setNotice("No book in the current search needs Topic-count review.");
      return;
    }
    const currentIndex = queue.findIndex(book => book.id === activeBookId);
    const next = queue[(currentIndex + 1 + queue.length) % queue.length];
    setFilter("problem");
    focusBook(next.id);
    setNotice(`Reviewing ${next.title}: ${topicCountLabel(next.topics.length)}.`);
  }

  function exportDiff() {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      baseVersion: sourceVersion,
      baseRevision: snapshot?.authority.revision,
      persistenceBoundary: snapshot?.persistenceBoundary,
      changes: diffs,
      note: "Exact Topic assignment diff only. This export does not change the catalog, GitHub, Supabase, or the public site.",
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jju-topic-assignment-diff.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Exported the exact Topic assignment diff. No authoritative data was changed.");
  }

  function downloadDamagedRecovery() {
    if (!damagedRecovery) return;
    const blob = new Blob([damagedRecovery.raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jju-topic-assignments-damaged-recovery.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Downloaded the damaged recovery exactly as stored. It remains quarantined until you explicitly discard it.");
  }

  function discardDamagedRecovery() {
    if (!damagedRecovery) return;
    const confirmed = window.confirm("Discard this damaged current-version phone recovery and start clean from the exact authoritative source? The downloaded copy is the only way to preserve it.");
    if (!confirmed) return;
    try {
      window.localStorage.removeItem(damagedRecovery.key);
      setDamagedRecovery(null);
      setRecoverySavedAt("");
      setRecoveryError("");
      setHistory([]);
      setNotice("Discarded the damaged phone recovery and unlocked a clean exact-version draft. No authoritative data was changed.");
    } catch {
      setRecoveryError("This browser could not discard the damaged recovery. Editing and autosave remain locked.");
    }
  }

  async function saveAuthoritative() {
    if (!snapshot || !sourceTopics || !draftTopics || !sourceVersion || !dirty || staleSource || damagedRecovery || saveState === "saving" || !snapshot.writable) return;
    setSaveState("saving");
    setNotice("Saving the reviewed Topic assignments against the exact loaded version…");
    let wasConflict = false;
    try {
      const response = await fetch("/api/admin/topics", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": sourceVersion,
        },
        body: JSON.stringify({
          authority: {
            ...snapshot.authority,
            topicsByBook: draftTopics,
          },
          message: `Update JJU Topic assignments from Workshop (${new Date().toISOString().slice(0, 10)})`,
        }),
      });
      const payload = await response.json().catch(() => ({})) as TopicSaveResponse;
      if (!response.ok) {
        if (response.status === 409) {
          wasConflict = true;
          setStaleSource(true);
          setSaveState("conflict");
          throw new Error(`${payload.error || "The Topic authority changed after this desk loaded."} Nothing was overwritten; this browser draft remains stored under the old version.`);
        }
        throw new Error(payload.error || "The reviewed Topic assignments could not be saved.");
      }
      const nextVersion = cleanVersion(response.headers.get("etag"));
      if (!nextVersion || !isTopicAuthority(payload.authority)) throw new Error("The save returned no verified Topic authority version. Reload before editing again.");
      const nextSource = Object.fromEntries(bookIds.map(id => [id, canonicalTopics(payload.authority?.topicsByBook[id] || [])]));
      try {
        window.localStorage.removeItem(recoveryKey(sourceVersion));
      } catch {
        // The exact-version authoritative save already succeeded; a stale recovery copy cannot overwrite it.
      }
      setSnapshot(current => current ? {
        ...current,
        authority: payload.authority as TopicAuthorityDocument,
        diagnostics: payload.diagnostics || current.diagnostics,
      } : current);
      setSourceVersion(nextVersion);
      setSourceTopics(nextSource);
      setDraftTopics(cloneTopicsByBook(nextSource));
      setHistory([]);
      setRecoverySavedAt("");
      setDamagedRecovery(null);
      setRepairMode(false);
      setStaleSource(false);
      setSaveState("saved");
      setNotice(`Saved ${diffs.length} changed book${diffs.length === 1 ? "" : "s"} to ${payload.target || "the Topic authority"} with an exact version match.${payload.note ? ` ${payload.note}` : ""}`);
    } catch (error) {
      if (!wasConflict) setSaveState("failed");
      setNotice(error instanceof Error ? error.message : "The reviewed Topic assignments could not be saved.");
    }
  }

  async function reloadLatest() {
    if (saveState === "saving") return;
    if (dirty) {
      const confirmed = window.confirm("Reload the newest Topic authority? This browser draft will remain stored under its old version, but it will no longer be applied to the newer file.");
      if (!confirmed) return;
      if (snapshot && draftTopics && sourceVersion) {
        try {
          const savedAt = new Date().toISOString();
          const envelope: RecoveryEnvelope = {
            schemaVersion: 1,
            baseVersion: sourceVersion,
            baseRevision: snapshot.authority.revision,
            savedAt,
            topicsByBook: draftTopics,
          };
          window.localStorage.setItem(recoveryKey(sourceVersion), JSON.stringify(envelope));
        } catch {
          setRecoveryError("The old-version phone draft could not be refreshed before reloading. Export the exact diff before continuing.");
          return;
        }
      }
    }
    await loadAuthority();
  }

  if (loading) return <section className={styles.loading} aria-live="polite">Loading the exact Topic authority…</section>;

  if (loadError || !snapshot || !sourceTopics || !draftTopics) {
    return (
      <section className={styles.errorPanel} role="alert">
        <p className={styles.eyebrow}>Topic assignment workbench</p>
        <h2>Editing is safely locked</h2>
        <p>{loadError || "The complete Topic authority could not be verified."}</p>
        <button type="button" onClick={() => void loadAuthority()}>Try loading again</button>
      </section>
    );
  }

  return (
    <section className={styles.workbench} aria-label="Authoritative Topic assignment editor">
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Fast assignment workbench</p>
          <h2>Every book. Overlap stays.</h2>
          <p>Tap a book, then tap any approved Topic to add or remove it. Two, three, or six genuine Topics are fine; this desk never forces one exclusive category.</p>
        </div>
        <div className={styles.sourceCard}>
          <strong>{snapshot.source === "github" ? "GitHub Topic authority" : "Local Topic authority"}</strong>
          <span>{snapshot.diagnostics.catalogBookCount} complete catalog records · revision {snapshot.authority.revision}</span>
          <code>{sourceVersion}</code>
        </div>
      </header>

      <section className={styles.persistenceNotice} aria-label="Topic persistence boundary">
        <strong>{snapshot.writable ? "Explicit save is available" : "Authoritative save is locked"}</strong>
        <span>{snapshot.persistenceBoundary}</span>
        <small>The public bundle changes only after the saved authority reaches a deployment. This editor does not write Topic assignments to Supabase.</small>
      </section>

      {repairMode && (
        <section className={styles.repairNotice} role="status">
          <strong>Complete-authority repair mode</strong>
          <span>
            This source has {snapshot.diagnostics.missingBookIds.length} missing catalog entr{snapshot.diagnostics.missingBookIds.length === 1 ? "y" : "ies"}
            {" and "}{snapshot.diagnostics.unknownBookIds.length} unknown entr{snapshot.diagnostics.unknownBookIds.length === 1 ? "y" : "ies"}.
            The draft creates every missing ID and removes every unknown ID; the exact-version save still fails closed if anything changed elsewhere.
          </span>
        </section>
      )}

      {damagedRecovery && (
        <section className={styles.damagedRecovery} role="alert">
          <div>
            <strong>Damaged current-version phone recovery</strong>
            <span>{damagedRecovery.reason} It has not been cleared or overwritten. Editing and autosave are locked.</span>
          </div>
          <div>
            <button type="button" onClick={downloadDamagedRecovery}>Download raw recovery</button>
            <button type="button" className={styles.discardButton} onClick={discardDamagedRecovery}>Discard &amp; start clean</button>
          </div>
        </section>
      )}

      {(recoverySavedAt || olderRecoveryCount > 0 || recoveryError) && (
        <section className={styles.recoveryNotice} role="status">
          <strong>{recoverySavedAt ? `Phone draft protected ${formatDate(recoverySavedAt)}` : "Phone recovery status"}</strong>
          <span>
            {olderRecoveryCount > 0 ? `${olderRecoveryCount} older-version draft${olderRecoveryCount === 1 ? " is" : "s are"} isolated and will never auto-apply. ` : ""}
            {recoveryError}
          </span>
        </section>
      )}

      {staleSource && (
        <section className={styles.conflictNotice} role="alert">
          <div>
            <strong>A newer Topic authority exists</strong>
            <span>This draft cannot overwrite it. Your old-version phone recovery and exact diff remain available.</span>
          </div>
          <button type="button" onClick={() => void reloadLatest()} disabled={saveState === "saving"}>Reload latest</button>
        </section>
      )}

      {notice && <div className={styles.notice} role="status" aria-live="polite">{notice}</div>}

      <div className={styles.controls}>
        <label className={styles.searchField}>
          Search all {snapshot.diagnostics.catalogBookCount} books
          <input
            type="search"
            value={query}
            onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
            placeholder="Title, ID, Topic, status…"
          />
        </label>
        <div className={styles.filterGroup} role="group" aria-label="Book assignment filter">
          <button type="button" aria-pressed={filter === "problem"} className={filter === "problem" ? styles.activeFilter : ""} onClick={() => { setFilter("problem"); setLimit(PAGE_SIZE); }}>
            Needs review <strong>{problemBooks.length}</strong>
          </button>
          <button type="button" aria-pressed={filter === "unassigned"} className={filter === "unassigned" ? styles.activeFilter : ""} onClick={() => { setFilter("unassigned"); setLimit(PAGE_SIZE); }}>
            Unassigned <strong>{orderedBooks.filter(book => book.topics.length === 0).length}</strong>
          </button>
          <button type="button" aria-pressed={filter === "any"} className={filter === "any" ? styles.activeFilter : ""} onClick={() => { setFilter("any"); setLimit(PAGE_SIZE); }}>
            Every book <strong>{orderedBooks.length}</strong>
          </button>
        </div>
        <div className={styles.momentumActions}>
          <button type="button" onClick={nextNeedsReview}>Next needs review</button>
          <button type="button" onClick={undo} disabled={!history.length || editingLocked}>Undo</button>
        </div>
      </div>

      <div className={styles.assignmentLayout}>
        <div className={styles.catalogPanel}>
          <div className={styles.resultLine}>
            <span><strong>{filteredBooks.length}</strong> match · showing {Math.min(limit, filteredBooks.length)}</span>
            <span>Problem means 0–1 or 7+ Topics; healthy overlap is never flagged.</span>
          </div>
          <div className={styles.bookGrid}>
            {filteredBooks.slice(0, limit).map(book => (
              <article className={`${styles.bookCard} ${activeBookId === book.id ? styles.activeBookCard : ""}`} key={book.id}>
                <button type="button" className={styles.bookIdentity} onClick={() => focusBook(book.id)} aria-label={`Edit Topics for ${book.title}`}>
                  <span className={styles.coverFrame}>
                    <Image
                      src={book.coverSrc}
                      alt=""
                      fill
                      sizes="(max-width: 760px) 72px, 88px"
                      unoptimized
                      onError={event => swapCover(event.currentTarget, book.fallbackCoverSrc)}
                    />
                  </span>
                  <span className={styles.bookCopy}>
                    <strong>{book.title}</strong>
                    <small>{book.subtitle || book.id}</small>
                    <em className={needsReview(book.topics) ? styles.problemCount : styles.healthyCount}>{topicCountLabel(book.topics.length)}</em>
                  </span>
                </button>
                <div className={styles.currentTopics} aria-label={`Current Topics for ${book.title}`}>
                  {book.topics.length ? book.topics.map(topic => (
                    <button key={topic} type="button" onClick={() => toggleTopic(book.id, topic)} disabled={editingLocked} aria-label={`Remove ${topic} from ${book.title}`}>
                      {topic}<span aria-hidden="true">×</span>
                    </button>
                  )) : <span className={styles.noTopics}>No Topics yet</span>}
                </div>
                <button type="button" className={styles.editButton} onClick={() => focusBook(book.id)}>Edit Topics</button>
              </article>
            ))}
          </div>
          {!filteredBooks.length && <p className={styles.emptyState}>No book matches this search and filter.</p>}
          {limit < filteredBooks.length && (
            <button type="button" className={styles.showMore} onClick={() => setLimit(current => current + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, filteredBooks.length - limit)} more books
            </button>
          )}
        </div>

        <section className={styles.topicEditor} ref={editorRef} aria-labelledby="topic-editor-title">
          {activeBook ? (
            <>
              <header className={styles.editorHeader}>
                <span className={styles.editorCover}>
                  <Image src={activeBook.coverSrc} alt="" fill sizes="74px" unoptimized onError={event => swapCover(event.currentTarget, activeBook.fallbackCoverSrc)} />
                </span>
                <div>
                  <p className={styles.eyebrow}>Active book</p>
                  <h3 id="topic-editor-title">{activeBook.title}</h3>
                  <span>{topicCountLabel(activeBook.topics.length)} · {activeBook.status} / {activeBook.visibility}</span>
                </div>
              </header>
              <div className={styles.selectedTopics}>
                <strong>Assigned now</strong>
                <div>
                  {activeBook.topics.length ? activeBook.topics.map(topic => (
                    <button key={topic} type="button" onClick={() => toggleTopic(activeBook.id, topic)} disabled={editingLocked}>
                      {topic}<span aria-hidden="true">Remove</span>
                    </button>
                  )) : <p>No Topic is assigned. Use the approved list below.</p>}
                </div>
              </div>
              <label className={styles.topicSearch}>
                Find an approved Topic
                <input type="search" value={topicQuery} onChange={event => setTopicQuery(event.target.value)} placeholder="Type a Topic name…" />
              </label>
              <div className={styles.topicBank} role="group" aria-label={`Approved Topics for ${activeBook.title}`}>
                {visibleApprovedTopics.map(topic => {
                  const selected = activeBook.topics.includes(topic);
                  return (
                    <button
                      key={topic}
                      type="button"
                      className={selected ? styles.selectedTopic : ""}
                      aria-pressed={selected}
                      disabled={editingLocked}
                      onClick={() => toggleTopic(activeBook.id, topic)}
                    >
                      <span aria-hidden="true">{selected ? "✓" : "+"}</span>{topic}
                    </button>
                  );
                })}
              </div>
              {!visibleApprovedTopics.length && <p className={styles.emptyState}>No approved Topic matches that search.</p>}
              <div className={styles.editorActions}>
                <button type="button" onClick={nextNeedsReview}>Next needs review</button>
                <button type="button" onClick={undo} disabled={!history.length || editingLocked}>Undo last change</button>
              </div>
            </>
          ) : <p className={styles.emptyState}>Choose a book to edit its approved Topic assignments.</p>}
        </section>
      </div>

      <section className={styles.diffPanel} aria-labelledby="topic-diff-title">
        <header>
          <div>
            <p className={styles.eyebrow}>Exact diff</p>
            <h3 id="topic-diff-title">{diffs.length ? `${diffs.length} changed book${diffs.length === 1 ? "" : "s"}` : "No assignment changes"}</h3>
          </div>
          <button type="button" onClick={exportDiff} disabled={!diffs.length}>Export diff JSON</button>
        </header>
        {diffs.length ? (
          <div className={styles.diffList}>
            {diffs.map(diff => (
              <details key={diff.id}>
                <summary>
                  <strong>{diff.title}</strong>
                  <span>{diff.repair === "create-entry" ? "create missing entry" : diff.repair === "remove-unknown" ? "remove unknown entry" : `+${diff.added.length} / −${diff.removed.length}`}</span>
                </summary>
                <div>
                  {diff.repair === "create-entry" && <p className={styles.repairChange}><strong>Repair:</strong> create the missing complete-catalog authority entry.</p>}
                  {diff.repair === "remove-unknown" && <p className={styles.repairChange}><strong>Repair:</strong> remove an ID that is not in the authoritative catalog.</p>}
                  <p><strong>Before:</strong> {diff.before.length ? diff.before.join(" · ") : "No Topics"}</p>
                  <p><strong>After:</strong> {diff.after.length ? diff.after.join(" · ") : "No Topics"}</p>
                  {diff.added.length > 0 && <p className={styles.added}><strong>Added:</strong> {diff.added.join(" · ")}</p>}
                  {diff.removed.length > 0 && <p className={styles.removed}><strong>Removed:</strong> {diff.removed.join(" · ")}</p>}
                </div>
              </details>
            ))}
          </div>
        ) : <p className={styles.emptyState}>The browser draft exactly matches revision {snapshot.authority.revision}.</p>}
      </section>

      {dirty && (
        <div className={styles.saveDock} role="region" aria-label="Topic assignment save controls">
          <div>
            <strong>{staleSource ? "Newer authority detected" : damagedRecovery ? "Damaged recovery blocks editing" : repairMode ? `${diffs.length} authority repair${diffs.length === 1 ? "" : "s"}` : `${diffs.length} changed book${diffs.length === 1 ? "" : "s"}`}</strong>
            <span>{recoverySavedAt ? `Phone draft protected ${formatDate(recoverySavedAt)}` : "Phone recovery pending"}</span>
          </div>
          <div>
            <button type="button" onClick={undo} disabled={!history.length || editingLocked}>Undo</button>
            <button
              type="button"
              className={styles.saveButton}
              onClick={() => void saveAuthoritative()}
              disabled={!snapshot.writable || staleSource || damagedRecovery !== null || saveState === "saving"}
            >
              {saveState === "saving" ? "Saving exact version…" : staleSource ? "Reload required" : damagedRecovery ? "Resolve phone recovery" : repairMode ? "Save complete repair" : "Save Topic assignments"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function swapCover(image: HTMLImageElement, fallbackSrc: string) {
  if (image.dataset.fallbackApplied === "true") {
    image.src = "/file.svg";
    return;
  }
  image.dataset.fallbackApplied = "true";
  image.src = fallbackSrc;
}
