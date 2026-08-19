"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalizeTaxonomyReviewDraft,
  taxonomyGroupId,
  type TaxonomyReviewBook,
  type TaxonomyReviewDraft,
  type TaxonomyReviewGroup,
} from "@/lib/taxonomyReviewTypes";
import styles from "./TaxonomyReviewDesk.module.css";

type Mode = "collections" | "shelves" | "topics";
type BankFilter = "all" | "unassigned" | "assigned" | "overlap" | "review";
type SortMode = "title" | "assignment" | "memberships";

type Props = {
  books: TaxonomyReviewBook[];
  initialDraft: TaxonomyReviewDraft;
  initialSavedAt: string | null;
  catalogChanged: boolean;
  localFileSaveAvailable: boolean;
};

const PAGE_SIZE = 48;
const HISTORY_LIMIT = 80;
const LOCAL_DRAFT_KEY = "jju.taxonomyReview.v2";

export default function TaxonomyReviewDesk({ books, initialDraft, initialSavedAt, catalogChanged, localFileSaveAvailable }: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(draft);
  const [history, setHistory] = useState<TaxonomyReviewDraft[]>([]);
  const [future, setFuture] = useState<TaxonomyReviewDraft[]>([]);
  const historyRef = useRef(history);
  const futureRef = useRef(future);
  const [dirty, setDirty] = useState(catalogChanged);
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [mode, setMode] = useState<Mode>("collections");
  const [bankFilter, setBankFilter] = useState<BankFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("title");
  const [query, setQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState(initialDraft.collections[0]?.id || "");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [newGroupName, setNewGroupName] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [browserDraftReady, setBrowserDraftReady] = useState(false);
  const dragIdsRef = useRef<string[]>([]);

  const groups = draft[mode];
  const bookById = useMemo(() => new Map(books.map(book => [book.id, book])), [books]);
  const reviewSet = useMemo(() => new Set(draft.reviewBookIds), [draft.reviewBookIds]);
  const assignments = useMemo(() => buildAssignments(groups), [groups]);
  const collectionAssignments = useMemo(() => buildAssignments(draft.collections), [draft.collections]);
  const collectionStats = useMemo(() => assignmentStats(books, draft.collections, collectionAssignments), [books, collectionAssignments, draft.collections]);
  const modeStats = useMemo(() => assignmentStats(books, groups, assignments), [assignments, books, groups]);
  const collectionOverlaps = useMemo(() => books
    .map(book => ({ book, groupIds: collectionAssignments.get(book.id) || [] }))
    .filter(item => item.groupIds.length > 1), [books, collectionAssignments]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(LOCAL_DRAFT_KEY) || "null") as { savedAt?: string; draft?: TaxonomyReviewDraft } | null;
        const storedTime = Date.parse(stored?.savedAt || "");
        const serverTime = Date.parse(initialSavedAt || "");
        if (
          stored?.draft?.schemaVersion === initialDraft.schemaVersion
          && stored.draft.catalogFingerprint === initialDraft.catalogFingerprint
          && Number.isFinite(storedTime)
          && (!Number.isFinite(serverTime) || storedTime > serverTime)
        ) {
          const recovered = canonicalizeTaxonomyReviewDraft(stored.draft);
          draftRef.current = recovered;
          setDraft(recovered);
          setDirty(true);
          setNotice(localFileSaveAvailable
            ? "Recovered a newer browser autosave. Save the local draft when you are ready to create a backup."
            : "Recovered a newer browser autosave. Export JSON when the review is finished.");
        }
      } catch {
        // A broken browser draft never blocks the server-backed desk.
      } finally {
        setBrowserDraftReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialDraft, initialSavedAt, localFileSaveAvailable]);

  useEffect(() => {
    if (!browserDraftReady || !dirty) return;
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), draft }));
  }, [browserDraftReady, dirty, draft]);

  const commit = useCallback((transform: (current: TaxonomyReviewDraft) => TaxonomyReviewDraft) => {
    const current = draftRef.current;
    const next = transform(current);
    if (next === current) return;
    const nextHistory = [...historyRef.current, current].slice(-HISTORY_LIMIT);
    historyRef.current = nextHistory;
    futureRef.current = [];
    setHistory(nextHistory);
    setFuture([]);
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setNotice("");
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    const current = draftRef.current;
    const nextHistory = historyRef.current.slice(0, -1);
    const nextFuture = [current, ...futureRef.current].slice(0, HISTORY_LIMIT);
    historyRef.current = nextHistory;
    futureRef.current = nextFuture;
    draftRef.current = previous;
    setHistory(nextHistory);
    setFuture(nextFuture);
    setDraft(previous);
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    const current = draftRef.current;
    const nextHistory = [...historyRef.current, current].slice(-HISTORY_LIMIT);
    const nextFuture = futureRef.current.slice(1);
    historyRef.current = nextHistory;
    futureRef.current = nextFuture;
    draftRef.current = next;
    setHistory(nextHistory);
    setFuture(nextFuture);
    setDraft(next);
    setDirty(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const filteredBooks = useMemo(() => {
    const search = query.trim().toLowerCase();
    return books
      .filter(book => {
        if (search && !`${book.title} ${book.subtitle} ${book.id}`.toLowerCase().includes(search)) return false;
        const assigned = (assignments.get(book.id)?.length || 0) > 0;
        const overlapping = (assignments.get(book.id)?.length || 0) > 1;
        if (bankFilter === "unassigned" && assigned) return false;
        if (bankFilter === "assigned" && !assigned) return false;
        if (bankFilter === "overlap" && !overlapping) return false;
        if (bankFilter === "review" && !reviewSet.has(book.id)) return false;
        return true;
      })
      .sort((left, right) => {
        if (sortMode === "assignment") {
          const leftLabel = assignmentLabel(left.id, groups, assignments);
          const rightLabel = assignmentLabel(right.id, groups, assignments);
          const byAssignment = leftLabel.localeCompare(rightLabel, "en", { sensitivity: "base" });
          if (byAssignment) return byAssignment;
        }
        if (sortMode === "memberships") {
          const byMembership = (assignments.get(right.id)?.length || 0) - (assignments.get(left.id)?.length || 0);
          if (byMembership) return byMembership;
        }
        return left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" });
      });
  }, [assignments, bankFilter, books, groups, query, reviewSet, sortMode]);

  const visibleBooks = filteredBooks.slice(0, visibleCount);
  const matchingGroups = useMemo(() => {
    const search = groupQuery.trim().toLowerCase();
    return groups.filter(group => !search || `${group.name} ${group.id}`.toLowerCase().includes(search));
  }, [groupQuery, groups]);
  const activeGroup = groups.find(group => group.id === activeGroupId) || groups[0] || null;
  const activeBooks = activeGroup?.bookIds.map(id => bookById.get(id)).filter(Boolean) as TaxonomyReviewBook[] | undefined;

  function toggleSelected(bookId: string) {
    setSelectedBookIds(current => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setActiveGroupId(draftRef.current[nextMode][0]?.id || "");
    setVisibleCount(PAGE_SIZE);
  }

  function selectVisible() {
    setSelectedBookIds(new Set(visibleBooks.map(book => book.id)));
  }

  function selectedOrDragged(bookId: string) {
    return selectedBookIds.has(bookId) ? [...selectedBookIds] : [bookId];
  }

  function assignCollection(groupId: string, bookIds: string[]) {
    const ids = new Set(bookIds);
    if (!ids.size) return;
    commit(current => ({
      ...current,
      collections: current.collections.map(group => ({
        ...group,
        bookIds: group.id === groupId
          ? [...new Set([...group.bookIds.filter(id => !ids.has(id)), ...ids])]
          : group.bookIds.filter(id => !ids.has(id)),
      })),
    }));
  }

  function addMembership(targetMode: "shelves" | "topics", groupId: string, bookIds: string[]) {
    const ids = new Set(bookIds);
    if (!ids.size) return;
    commit(current => ({
      ...current,
      [targetMode]: current[targetMode].map(group => group.id === groupId
        ? { ...group, bookIds: [...new Set([...group.bookIds, ...ids])] }
        : group),
    }));
  }

  function removeFromActive(bookIds: string[]) {
    const ids = new Set(bookIds);
    if (!ids.size || !activeGroup) return;
    commit(current => ({
      ...current,
      [mode]: current[mode].map(group => group.id === activeGroup.id
        ? { ...group, bookIds: group.bookIds.filter(id => !ids.has(id)) }
        : group),
    }));
  }

  function moveToGroup(groupId: string, bookIds = [...selectedBookIds]) {
    if (mode === "collections") assignCollection(groupId, bookIds);
    else addMembership(mode, groupId, bookIds);
    setActiveGroupId(groupId);
  }

  function updateGroupName(groupId: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    commit(current => ({
      ...current,
      [mode]: current[mode].map(group => group.id === groupId ? { ...group, name: clean } : group),
    }));
  }

  function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    const id = taxonomyGroupId(name, groups.map(group => group.id));
    commit(current => ({
      ...current,
      [mode]: [...current[mode], {
        id,
        name,
        bookIds: [],
        ...(mode === "collections" ? { sourceBucket: "new" as const } : {}),
      }],
    }));
    setNewGroupName("");
    setActiveGroupId(id);
  }

  function deleteActiveGroup() {
    if (!activeGroup || !window.confirm(`Delete ${activeGroup.name}? Its assignments will return to the unassigned bank.`)) return;
    commit(current => ({ ...current, [mode]: current[mode].filter(group => group.id !== activeGroup.id) }));
  }

  function setReview(bookIds: string[], reviewing: boolean) {
    const ids = new Set(bookIds);
    if (!ids.size) return;
    commit(current => ({
      ...current,
      reviewBookIds: reviewing
        ? [...new Set([...current.reviewBookIds, ...ids])]
        : current.reviewBookIds.filter(id => !ids.has(id)),
    }));
  }

  async function saveDraft() {
    setSaving(true);
    setNotice("");
    try {
      const canonical = canonicalizeTaxonomyReviewDraft(draftRef.current);
      const response = await fetch("/api/admin/taxonomy-review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canonical),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The draft could not be saved.");
      draftRef.current = payload.draft;
      setDraft(payload.draft);
      setSavedAt(payload.savedAt);
      setDirty(false);
      window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({ savedAt: payload.savedAt, draft: payload.draft }));
      setNotice("Draft saved locally. The previous version was backed up.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The draft could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function exportDraft() {
    const canonical = canonicalizeTaxonomyReviewDraft(draftRef.current);
    const blob = new Blob([`${JSON.stringify(canonical, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jju-collection-taxonomy-handoff.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice(`Deterministic JSON handoff exported${collectionOverlaps.length ? ` with ${collectionOverlaps.length} Collection overlap${collectionOverlaps.length === 1 ? "" : "s"} still flagged` : ""}. Nothing was applied to the catalog.`);
  }

  function handleDragStart(bookId: string, event: React.DragEvent) {
    const ids = selectedOrDragged(bookId);
    dragIdsRef.current = ids;
    event.dataTransfer.effectAllowed = mode === "collections" ? "move" : "copy";
    event.dataTransfer.setData("text/plain", ids.join(","));
  }

  function handleDrop(groupId: string, event: React.DragEvent) {
    event.preventDefault();
    const transferred = event.dataTransfer.getData("text/plain").split(",").filter(Boolean);
    moveToGroup(groupId, dragIdsRef.current.length ? dragIdsRef.current : transferred);
    dragIdsRef.current = [];
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <Link className={styles.backLink} href="/admin">Back to Admin</Link>
          <p className={styles.eyebrow}>Editorial workspace</p>
          <h1>Collection &amp; Taxonomy Desk</h1>
          <p className={styles.intro}>Build the print-ready Collections by cover, then review broad Shelves and specific Topics as separate, overlapping discovery layers.</p>
        </div>
        <div className={styles.primaryActions}>
          <button type="button" className={styles.quietButton} onClick={undo} disabled={!history.length}>Undo</button>
          <button type="button" className={styles.quietButton} onClick={redo} disabled={!future.length}>Redo</button>
          <button type="button" className={styles.exportButton} onClick={exportDraft}>Export JSON</button>
          {localFileSaveAvailable && (
            <button type="button" className={styles.saveButton} onClick={saveDraft} disabled={saving || !dirty}>
              {saving ? "Saving..." : dirty ? "Save local draft" : "Draft saved"}
            </button>
          )}
        </div>
      </header>

      <section className={styles.safetyStrip} aria-label="Draft safety status">
        <strong>Draft only.</strong>
        <span>This desk cannot change public books, Supabase, or the live taxonomy. Assignments stay in a local draft until an exported handoff is deliberately applied.</span>
        <span className={dirty ? styles.unsaved : styles.saved}>
          {dirty
            ? localFileSaveAvailable ? "Local file backup pending" : "Browser autosave on"
            : savedAt ? `Saved ${formatSavedAt(savedAt)}` : "Starting snapshot"}
        </span>
      </section>

      {catalogChanged && (
        <div className={styles.warning}>The catalog changed since the last local save. Existing decisions were preserved for current books. Review and save this refreshed draft.</div>
      )}
      {notice && <div className={styles.notice} role="status">{notice}</div>}

      <section className={styles.summaryGrid} aria-label="Taxonomy snapshot">
        <SummaryStat value={books.length} label="Available books" />
        <SummaryStat value={draft.collections.length} label="Collections" />
        <SummaryStat value={collectionStats.assigned} label="In a Collection" />
        <SummaryStat value={collectionStats.unassigned} label="No Collection" />
        <SummaryStat value={collectionStats.overlap} label="Collection overlaps" alert={collectionStats.overlap > 0} />
        <SummaryStat value={collectionStats.maxMemberships} label="Max Collections / book" alert={collectionStats.maxMemberships > 1} />
      </section>

      <nav className={styles.modeTabs} aria-label="Taxonomy mode">
        <button type="button" className={mode === "collections" ? styles.activeMode : ""} onClick={() => changeMode("collections")}>
          <strong>Collections</strong><span>Zero or one per book</span>
        </button>
        <button type="button" className={mode === "shelves" ? styles.activeMode : ""} onClick={() => changeMode("shelves")}>
          <strong>Shelves</strong><span>Broad overlap is allowed</span>
        </button>
        <button type="button" className={mode === "topics" ? styles.activeMode : ""} onClick={() => changeMode("topics")}>
          <strong>Topics</strong><span>Specific overlap is allowed</span>
        </button>
      </nav>

      <section className={collectionOverlaps.length ? styles.overlapAuditAlert : styles.overlapAudit} aria-label="Collection overlap audit">
        <div>
          <p className={styles.eyebrow}>Collection integrity</p>
          <strong>{collectionOverlaps.length ? `${collectionOverlaps.length} overlap${collectionOverlaps.length === 1 ? "" : "s"} need review` : "No Collection overlap"}</strong>
          <span>Assigning a cover to a Collection moves it out of every other Collection. Imported overlap stays visible until you choose where it belongs.</span>
        </div>
        {collectionOverlaps.length > 0 && (
          <details>
            <summary>Show overlap list</summary>
            <div className={styles.overlapList}>
              {collectionOverlaps.map(({ book, groupIds }) => (
                <button type="button" key={book.id} onClick={() => {
                  changeMode("collections");
                  setBankFilter("overlap");
                  setQuery(book.title);
                  setSelectedBookIds(new Set([book.id]));
                }}>
                  <strong>{book.title}</strong>
                  <span>{groupIds.map(id => draft.collections.find(group => group.id === id)?.name || id).join(" / ")}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className={styles.desk}>
        <aside className={styles.bank} aria-label="Book bank">
          <div className={styles.bankHeader}>
            <div>
              <p className={styles.eyebrow}>Cover bank</p>
              <h2>{filteredBooks.length} {filteredBooks.length === 1 ? "book" : "books"}</h2>
            </div>
            <span>{selectedBookIds.size} selected</span>
          </div>

          <label className={styles.searchField}>
            <span>Search books</span>
            <input value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="Title, subtitle, or ID" />
          </label>

          <div className={styles.filterRow}>
            {(["all", "unassigned", "assigned", "overlap", "review"] as BankFilter[]).map(filter => (
              <button key={filter} type="button" className={bankFilter === filter ? styles.activeFilter : ""} onClick={() => { setBankFilter(filter); setVisibleCount(PAGE_SIZE); }}>
                {filter === "review" ? "Needs review" : capitalize(filter)}
              </button>
            ))}
          </div>

          <div className={styles.bankTools}>
            <label>Sort
              <select value={sortMode} onChange={event => { setSortMode(event.target.value as SortMode); setVisibleCount(PAGE_SIZE); }}>
                <option value="title">Title</option>
                <option value="assignment">Assignment</option>
                <option value="memberships">Most memberships</option>
              </select>
            </label>
            <button type="button" onClick={selectVisible} disabled={!visibleBooks.length}>Select shown</button>
            <button type="button" onClick={() => setSelectedBookIds(new Set())} disabled={!selectedBookIds.size}>Clear</button>
          </div>

          {selectedBookIds.size > 0 && (
            <div className={styles.selectionBar}>
              <strong>{selectedBookIds.size} selected</strong>
              <button type="button" onClick={() => setReview([...selectedBookIds], true)}>Send to review</button>
              <button type="button" onClick={() => setReview([...selectedBookIds], false)}>Clear review</button>
              <button type="button" onClick={() => removeSelectedFromMode(commit, selectedBookIds, mode)}>Remove from all {modeLabel(mode)}</button>
            </div>
          )}

          <div className={styles.coverGrid}>
            {visibleBooks.map(book => (
              <TaxonomyBookCard
                key={book.id}
                book={book}
                selected={selectedBookIds.has(book.id)}
                review={reviewSet.has(book.id)}
                assignment={assignmentLabel(book.id, groups, assignments)}
                onSelect={() => toggleSelected(book.id)}
                onReview={() => setReview([book.id], !reviewSet.has(book.id))}
                onDragStart={event => handleDragStart(book.id, event)}
              />
            ))}
          </div>

          {!filteredBooks.length && <div className={styles.emptyState}>No covers match these filters.</div>}
          {visibleBooks.length < filteredBooks.length && (
            <button type="button" className={styles.loadMore} onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, filteredBooks.length - visibleBooks.length)} more
            </button>
          )}
        </aside>

        <section className={styles.workspace} aria-label={`${modeLabel(mode)} workspace`}>
          <header className={styles.workspaceHeader}>
            <div>
              <p className={styles.eyebrow}>{mode === "collections" ? "Optional · zero or one" : "Many-to-many"}</p>
              <h2>{modeLabel(mode, false)} groups</h2>
              <p>{mode === "collections" ? "Dropping a book here moves it out of its old Collection." : `Dropping a book adds this ${modeLabel(mode, false)} without removing its other ${modeLabel(mode)}.`}</p>
              <div className={styles.modeMetrics} aria-label={`${modeLabel(mode)} assignment counts`}>
                <span><strong>{modeStats.assigned}</strong> assigned</span>
                <span><strong>{modeStats.unassigned}</strong> unassigned</span>
                <span><strong>{modeStats.overlap}</strong> in multiple</span>
                <span><strong>{modeStats.maxMemberships}</strong> max / book</span>
                <span><strong>{modeStats.largestGroup}</strong> largest group</span>
              </div>
            </div>
            <label className={styles.groupSearch}>Find a group
              <input value={groupQuery} onChange={event => setGroupQuery(event.target.value)} placeholder={mode === "collections" ? "Architects, Mapmakers..." : mode === "shelves" ? "History, Science..." : "Biography, Food..."} />
            </label>
          </header>

          <div className={styles.groupDirectory}>
            {matchingGroups.map(group => (
              <GroupTarget
                key={group.id}
                group={group}
                active={group.id === activeGroup?.id}
                selectedCount={selectedBookIds.size}
                mode={mode}
                onOpen={() => setActiveGroupId(group.id)}
                onAssign={() => moveToGroup(group.id)}
                onDrop={event => handleDrop(group.id, event)}
              />
            ))}
          </div>

          {!matchingGroups.length && <div className={styles.emptyState}>No groups match that search.</div>}

          <form className={styles.addGroup} onSubmit={event => { event.preventDefault(); addGroup(); }}>
            <label>New {modeLabel(mode, false)}
              <input value={newGroupName} onChange={event => setNewGroupName(event.target.value)} placeholder="Name the group" maxLength={100} />
            </label>
            <button type="submit" disabled={!newGroupName.trim()}>Add group</button>
          </form>

          {activeGroup && (
            <section className={styles.groupDetail}>
              <header>
                <div className={styles.renameBlock}>
                  <label htmlFor="active-group-name">Group name</label>
                  <input
                    id="active-group-name"
                    key={`${mode}-${activeGroup.id}-${activeGroup.name}`}
                    defaultValue={activeGroup.name}
                    maxLength={100}
                    onBlur={event => updateGroupName(activeGroup.id, event.target.value)}
                    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  />
                  <code>{activeGroup.id}</code>
                </div>
                <div className={styles.detailActions}>
                  <span>{activeGroup.bookIds.length} books</span>
                  {selectedBookIds.size > 0 && (
                    <button type="button" onClick={() => moveToGroup(activeGroup.id)}>
                      {mode === "collections" ? "Move" : "Add"} {selectedBookIds.size} here
                    </button>
                  )}
                  <button type="button" className={styles.dangerButton} onClick={deleteActiveGroup}>Delete group</button>
                </div>
              </header>

              <div
                className={styles.activeDropZone}
                onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = mode === "collections" ? "move" : "copy"; }}
                onDrop={event => handleDrop(activeGroup.id, event)}
              >
                Drop selected covers here
              </div>

              <div className={styles.assignedGrid}>
                {(activeBooks || []).map(book => (
                  <div className={styles.assignedCard} key={book.id}>
                    <TaxonomyCover book={book} />
                    <strong>{book.title}</strong>
                    <button type="button" onClick={() => removeFromActive([book.id])}>Remove {modeLabel(mode, false)}</button>
                  </div>
                ))}
              </div>
              {!activeGroup.bookIds.length && <div className={styles.emptyState}>This group is empty. Drop a cover here or select books from the bank.</div>}
            </section>
          )}
        </section>
      </section>

      <section className={styles.handoff} aria-labelledby="taxonomy-handoff-title">
        <div>
          <p className={styles.eyebrow}>When the sorting is finished</p>
          <h2 id="taxonomy-handoff-title">Save, export, hand it back</h2>
        </div>
        <ol>
          {localFileSaveAvailable ? (
            <li><strong>Save local draft</strong><span>Writes the current desk to this computer and backs up the previous save. Browser autosave also protects unsaved work.</span></li>
          ) : (
            <li><strong>Browser autosave</strong><span>Keeps the working draft in this browser. Export JSON for the durable handoff when the review is finished.</span></li>
          )}
          <li><strong>Check Collection integrity</strong><span>Zero overlaps is the clean handoff. Books with no Collection are valid and remain in the unassigned bank.</span></li>
          <li><strong>Export JSON</strong><span>Send <code>jju-collection-taxonomy-handoff.json</code> back to Codex. The exported file is stable for review and does not publish anything.</span></li>
          <li><strong>Apply deliberately</strong><span>Codex will show the exact Collection, Shelf, and Topic changes before updating the catalog. Collection membership is never rewritten from this screen.</span></li>
        </ol>
      </section>
    </main>
  );
}

function SummaryStat({ value, label, alert = false }: { value: number; label: string; alert?: boolean }) {
  return <div className={alert ? styles.alertStat : ""}><strong>{value}</strong><span>{label}</span></div>;
}

function TaxonomyBookCard({
  book,
  selected,
  review,
  assignment,
  onSelect,
  onReview,
  onDragStart,
}: {
  book: TaxonomyReviewBook;
  selected: boolean;
  review: boolean;
  assignment: string;
  onSelect: () => void;
  onReview: () => void;
  onDragStart: (event: React.DragEvent) => void;
}) {
  return (
    <article className={`${styles.bookCard} ${selected ? styles.selectedCard : ""}`} draggable onDragStart={onDragStart}>
      <button type="button" className={styles.coverButton} aria-pressed={selected} onClick={onSelect} title={`Select ${book.title}`}>
        <TaxonomyCover book={book} />
        <span className={styles.selectionMark}>{selected ? "Selected" : "Select"}</span>
      </button>
      <div className={styles.cardBody}>
        <strong title={book.title}>{book.title}</strong>
        <span title={assignment}>{assignment}</span>
        <button type="button" className={review ? styles.reviewActive : ""} onClick={onReview}>{review ? "Needs review" : "Mark review"}</button>
      </div>
    </article>
  );
}

function TaxonomyCover({ book }: { book: TaxonomyReviewBook }) {
  const [source, setSource] = useState(book.coverSrc);
  return (
    <span className={styles.coverFrame}>
      <Image
        src={source}
        alt={`${book.title} cover`}
        fill
        sizes="(max-width: 520px) 42vw, (max-width: 1000px) 22vw, 150px"
        onError={() => setSource(current => current === book.fallbackCoverSrc ? "/file.svg" : book.fallbackCoverSrc)}
      />
    </span>
  );
}

function GroupTarget({ group, active, selectedCount, mode, onOpen, onAssign, onDrop }: {
  group: TaxonomyReviewGroup;
  active: boolean;
  selectedCount: number;
  mode: Mode;
  onOpen: () => void;
  onAssign: () => void;
  onDrop: (event: React.DragEvent) => void;
}) {
  return (
    <article
      className={`${styles.groupTarget} ${active ? styles.activeGroup : ""}`}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = mode === "collections" ? "move" : "copy"; }}
      onDrop={onDrop}
    >
      <button type="button" className={styles.groupOpen} onClick={onOpen}>
        <strong>{group.name}</strong>
        <span>{group.bookIds.length} books</span>
      </button>
      <button type="button" className={styles.groupAssign} disabled={!selectedCount} onClick={onAssign}>
        {selectedCount ? `${mode === "collections" ? "Move" : "Add"} ${selectedCount}` : "Drop covers"}
      </button>
    </article>
  );
}

function buildAssignments(groups: TaxonomyReviewGroup[]) {
  const result = new Map<string, string[]>();
  groups.forEach(group => group.bookIds.forEach(bookId => result.set(bookId, [...(result.get(bookId) || []), group.id])));
  return result;
}

function assignmentLabel(bookId: string, groups: TaxonomyReviewGroup[], assignments: Map<string, string[]>) {
  const ids = assignments.get(bookId) || [];
  if (!ids.length) return "Unassigned";
  const names = ids.map(id => groups.find(group => group.id === id)?.name).filter(Boolean) as string[];
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

function removeSelectedFromMode(
  commit: (transform: (current: TaxonomyReviewDraft) => TaxonomyReviewDraft) => void,
  selectedBookIds: Set<string>,
  mode: Mode,
) {
  const ids = new Set(selectedBookIds);
  commit(current => ({
    ...current,
    [mode]: current[mode].map(group => ({ ...group, bookIds: group.bookIds.filter(id => !ids.has(id)) })),
  }));
}

function assignmentStats(
  books: TaxonomyReviewBook[],
  groups: TaxonomyReviewGroup[],
  assignments: Map<string, string[]>,
) {
  const membershipCounts = books.map(book => assignments.get(book.id)?.length || 0);
  return {
    assigned: membershipCounts.filter(count => count > 0).length,
    unassigned: membershipCounts.filter(count => count === 0).length,
    overlap: membershipCounts.filter(count => count > 1).length,
    maxMemberships: Math.max(0, ...membershipCounts),
    largestGroup: Math.max(0, ...groups.map(group => group.bookIds.length)),
  };
}

function modeLabel(mode: Mode, plural = true) {
  const labels: Record<Mode, [string, string]> = {
    collections: ["Collection", "Collections"],
    shelves: ["Shelf", "Shelves"],
    topics: ["Topic", "Topics"],
  };
  return labels[mode][plural ? 1 : 0];
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "locally" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
