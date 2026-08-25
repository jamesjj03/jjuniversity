"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { GuardedAdminLink, useAdminUnsavedChanges } from "@/components/AdminUnsavedChanges";
import type {
  DescriptionAuditBook,
  DescriptionAuditFlag,
  TopicAuditItem,
  TopicDescriptionAudit,
  TopicHealth,
} from "@/lib/topicDescriptionAudit";
import styles from "./TopicsDescriptionDesk.module.css";

type DeskView = "topics" | "books" | "descriptions";
type TopicOutcome = "keep" | "rename" | "merge" | "retire" | "thinking";
type DescriptionOutcome = "keep" | "rewrite" | "fact-check" | "thinking";

type TopicDecision = {
  outcome: TopicOutcome;
  proposedName?: string;
  mergeInto?: string;
  note?: string;
};

type DescriptionDecision = {
  outcome: DescriptionOutcome;
  rewrite?: string;
  note?: string;
};

type ReviewDraft = {
  schemaVersion: 1;
  catalogFingerprint: string;
  updatedAt: string;
  topicDecisions: Record<string, TopicDecision>;
  descriptionDecisions: Record<string, DescriptionDecision>;
};

type StoredOlderDraft = {
  key: string;
  payload: string;
  updatedAt: string;
  decisions: number;
};

type Props = {
  audit: TopicDescriptionAudit;
  catalogFingerprint: string;
  source: "supabase" | "github" | "file";
};

const STORAGE_PREFIX = "jju.topic-description-review.v1.";
const UNSAVED_SCOPE = "topic-description-review";
const BOOK_PAGE_SIZE = 40;
const DESCRIPTION_PAGE_SIZE = 36;

const TOPIC_OUTCOMES: Array<{ value: TopicOutcome; label: string }> = [
  { value: "keep", label: "Keep" },
  { value: "rename", label: "Rename" },
  { value: "merge", label: "Merge" },
  { value: "retire", label: "Retire" },
  { value: "thinking", label: "Think" },
];

const DESCRIPTION_OUTCOMES: Array<{ value: DescriptionOutcome; label: string }> = [
  { value: "keep", label: "Keep" },
  { value: "rewrite", label: "Rewrite" },
  { value: "fact-check", label: "Fact-check" },
  { value: "thinking", label: "Think" },
];

export default function TopicsDescriptionDesk({ audit, catalogFingerprint, source }: Props) {
  const storageKey = `${STORAGE_PREFIX}${catalogFingerprint}`;
  const topicNames = useMemo(() => new Set(audit.topics.map(topic => topic.name)), [audit.topics]);
  const bookIds = useMemo(() => new Set(audit.books.map(book => book.id)), [audit.books]);
  const emptyDraft = useMemo<ReviewDraft>(() => ({
    schemaVersion: 1,
    catalogFingerprint,
    updatedAt: "",
    topicDecisions: {},
    descriptionDecisions: {},
  }), [catalogFingerprint]);
  const { setUnsaved } = useAdminUnsavedChanges();
  const [draft, setDraft] = useState(emptyDraft);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"ready" | "saving" | "saved" | "failed">("ready");
  const [notice, setNotice] = useState("");
  const [olderDrafts, setOlderDrafts] = useState<StoredOlderDraft[]>([]);
  const [view, setView] = useState<DeskView>("topics");
  const [topicQuery, setTopicQuery] = useState("");
  const [topicHealthFilter, setTopicHealthFilter] = useState("needs");
  const [topicSort, setTopicSort] = useState("count-asc");
  const [bookQuery, setBookQuery] = useState("");
  const [bookMembershipFilter, setBookMembershipFilter] = useState("all");
  const [bookLimit, setBookLimit] = useState(BOOK_PAGE_SIZE);
  const [descriptionQuery, setDescriptionQuery] = useState("");
  const [descriptionIssueFilter, setDescriptionIssueFilter] = useState("flagged");
  const [descriptionDecisionFilter, setDescriptionDecisionFilter] = useState("all");
  const [descriptionLimit, setDescriptionLimit] = useState(DESCRIPTION_PAGE_SIZE);

  const bookById = useMemo(() => new Map(audit.books.map(book => [book.id, book])), [audit.books]);
  const similarTopics = useMemo(() => new Set(audit.similarTopicPairs.flatMap(pair => [pair.left, pair.right])), [audit.similarTopicPairs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const recovered = sanitizeDraft(JSON.parse(stored), catalogFingerprint, topicNames, bookIds);
          setDraft(recovered);
          setSaveState("saved");
          setNotice(`Recovered this catalog's browser draft from ${formatDate(recovered.updatedAt)}.`);
        }
        const older: StoredOlderDraft[] = [];
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index) || "";
          if (!key.startsWith(STORAGE_PREFIX) || key === storageKey) continue;
          const payload = window.localStorage.getItem(key) || "";
          if (!payload || payload.length > 2_000_000) continue;
          try {
            const parsed = JSON.parse(payload) as Partial<ReviewDraft>;
            if (parsed.schemaVersion !== 1 || typeof parsed.catalogFingerprint !== "string") continue;
            older.push({
              key,
              payload,
              updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
              decisions: objectSize(parsed.topicDecisions) + objectSize(parsed.descriptionDecisions),
            });
          } catch {
            // Invalid browser data is ignored and never blocks the current catalog.
          }
        }
        setOlderDrafts(older.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 4));
      } catch {
        setSaveState("failed");
        setNotice("Browser recovery is unavailable. Export JSON before leaving this desk.");
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bookIds, catalogFingerprint, storageKey, topicNames]);

  useEffect(() => {
    if (!hydrated || saveState !== "saving") return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(draft));
        setSaveState("saved");
        setUnsaved(UNSAVED_SCOPE, false);
      } catch {
        setSaveState("failed");
        setNotice("Browser autosave failed. Export JSON before leaving this desk.");
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated, saveState, setUnsaved, storageKey]);

  useEffect(() => () => setUnsaved(UNSAVED_SCOPE, false), [setUnsaved]);

  const filteredTopics = useMemo(() => {
    const query = topicQuery.trim().toLocaleLowerCase("en");
    return audit.topics
      .filter(topic => {
        if (query && !`${topic.name} ${topic.bookIds.map(id => bookById.get(id)?.title || id).join(" ")}`.toLocaleLowerCase("en").includes(query)) return false;
        if (topicHealthFilter === "needs") return topic.health !== "healthy" || similarTopics.has(topic.name);
        if (topicHealthFilter === "decided") return Boolean(draft.topicDecisions[topic.name]);
        if (topicHealthFilter === "undecided") return !draft.topicDecisions[topic.name];
        if (["empty", "single", "tiny", "broad", "healthy"].includes(topicHealthFilter)) return topic.health === topicHealthFilter;
        return true;
      })
      .sort((left, right) => {
        if (topicSort === "count-desc") return right.count - left.count || sortText(left.name, right.name);
        if (topicSort === "name") return sortText(left.name, right.name);
        if (topicSort === "decision") {
          const leftDecision = draft.topicDecisions[left.name]?.outcome || "zz";
          const rightDecision = draft.topicDecisions[right.name]?.outcome || "zz";
          return sortText(leftDecision, rightDecision) || sortText(left.name, right.name);
        }
        return left.count - right.count || sortText(left.name, right.name);
      });
  }, [audit.topics, bookById, draft.topicDecisions, similarTopics, topicHealthFilter, topicQuery, topicSort]);

  const filteredBooks = useMemo(() => {
    const query = bookQuery.trim().toLocaleLowerCase("en");
    return audit.books.filter(book => {
      if (query && !`${book.title} ${book.subtitle} ${book.id} ${book.topics.join(" ")}`.toLocaleLowerCase("en").includes(query)) return false;
      if (bookMembershipFilter === "2-4") return book.topics.length >= 2 && book.topics.length <= 4;
      if (bookMembershipFilter === "5+") return book.topics.length >= 5;
      if (bookMembershipFilter !== "all") return book.topics.length === Number(bookMembershipFilter);
      return true;
    });
  }, [audit.books, bookMembershipFilter, bookQuery]);

  const filteredDescriptions = useMemo(() => {
    const query = descriptionQuery.trim().toLocaleLowerCase("en");
    return audit.books.filter(book => {
      if (query && !`${book.title} ${book.id} ${book.description}`.toLocaleLowerCase("en").includes(query)) return false;
      if (descriptionIssueFilter === "flagged" && !book.descriptionFlags.length) return false;
      if (descriptionIssueFilter === "from-to" && !book.descriptionFlags.includes("from-to")) return false;
      if (descriptionIssueFilter === "canned" && !hasCannedOpening(book)) return false;
      if (descriptionIssueFilter === "grammar" && !book.descriptionFlags.includes("grammar")) return false;
      if (descriptionIssueFilter === "short" && book.descriptionLength >= 100) return false;
      if (descriptionIssueFilter === "clean" && book.descriptionFlags.length) return false;
      const decided = Boolean(draft.descriptionDecisions[book.id]);
      if (descriptionDecisionFilter === "decided" && !decided) return false;
      if (descriptionDecisionFilter === "undecided" && decided) return false;
      return true;
    });
  }, [audit.books, descriptionDecisionFilter, descriptionIssueFilter, descriptionQuery, draft.descriptionDecisions]);

  const reviewedTopicCount = Object.keys(draft.topicDecisions).length;
  const reviewedDescriptionCount = Object.keys(draft.descriptionDecisions).length;

  function updateDraft(transform: (current: ReviewDraft) => ReviewDraft) {
    setUnsaved(UNSAVED_SCOPE, true);
    setSaveState("saving");
    setNotice("");
    setDraft(current => ({ ...transform(current), updatedAt: new Date().toISOString() }));
  }

  function setTopicOutcome(topic: string, outcome: TopicOutcome) {
    updateDraft(current => ({
      ...current,
      topicDecisions: {
        ...current.topicDecisions,
        [topic]: {
          ...current.topicDecisions[topic],
          outcome,
          ...(outcome === "rename" ? {} : { proposedName: undefined }),
          ...(outcome === "merge" ? {} : { mergeInto: undefined }),
        },
      },
    }));
  }

  function patchTopicDecision(topic: string, patch: Partial<TopicDecision>) {
    updateDraft(current => ({
      ...current,
      topicDecisions: {
        ...current.topicDecisions,
        [topic]: {
          ...current.topicDecisions[topic],
          ...patch,
          outcome: patch.outcome || current.topicDecisions[topic]?.outcome || "thinking",
        },
      },
    }));
  }

  function clearTopicDecision(topic: string) {
    updateDraft(current => {
      const next = { ...current.topicDecisions };
      delete next[topic];
      return { ...current, topicDecisions: next };
    });
  }

  function setDescriptionOutcome(bookId: string, outcome: DescriptionOutcome) {
    updateDraft(current => ({
      ...current,
      descriptionDecisions: {
        ...current.descriptionDecisions,
        [bookId]: {
          ...current.descriptionDecisions[bookId],
          outcome,
          ...(outcome === "rewrite" ? {} : { rewrite: undefined }),
        },
      },
    }));
  }

  function patchDescriptionDecision(bookId: string, patch: Partial<DescriptionDecision>) {
    updateDraft(current => ({
      ...current,
      descriptionDecisions: {
        ...current.descriptionDecisions,
        [bookId]: {
          ...current.descriptionDecisions[bookId],
          ...patch,
          outcome: patch.outcome || current.descriptionDecisions[bookId]?.outcome || "thinking",
        },
      },
    }));
  }

  function clearDescriptionDecision(bookId: string) {
    updateDraft(current => {
      const next = { ...current.descriptionDecisions };
      delete next[bookId];
      return { ...current, descriptionDecisions: next };
    });
  }

  function openTopic(topic: string) {
    setTopicQuery(topic);
    setTopicHealthFilter("all");
    setView("topics");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportDraft(candidate: ReviewDraft = draft, filename = "jju-topics-descriptions-review.json") {
    const payload = {
      ...candidate,
      auditSnapshot: {
        books: audit.stats.bookCount,
        topics: audit.stats.topicCount,
        fromToDescriptions: audit.stats.fromToDescriptions,
        exactDuplicateTopicLabels: audit.exactDuplicateTopicLabels.length,
        exactDuplicateDescriptions: audit.exactDuplicateDescriptions.length,
      },
      note: "Review decisions only. Nothing in this file has been applied to the catalog, Supabase, or the public site.",
    };
    downloadText(`${JSON.stringify(payload, null, 2)}\n`, filename);
    setNotice("Review JSON exported. No catalog data was changed.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Editorial review desk</p>
          <h1>Topics &amp; descriptions</h1>
          <p>See the whole mess, make one decision at a time, and keep every overlapping Topic that genuinely belongs. This desk records decisions; it never guesses or silently rewrites the catalog.</p>
        </div>
        <div className={styles.heroActions}>
          <button type="button" className={styles.exportButton} onClick={() => exportDraft()}>Export review JSON</button>
          <GuardedAdminLink className={styles.quietLink} href="/admin/organize">Collections Organizer</GuardedAdminLink>
        </div>
      </header>

      <section className={styles.safetyStrip} aria-label="Review safety">
        <strong>Review draft only.</strong>
        <span>Browser autosave + JSON export. No Topic, description, public book, or Supabase row can be changed here.</span>
        <span className={saveState === "failed" ? styles.saveFailed : styles.saveStatus}>
          {saveState === "saving" ? "Saving in this browser…" : saveState === "saved" ? `Browser draft saved${draft.updatedAt ? ` ${formatDate(draft.updatedAt)}` : ""}` : saveState === "failed" ? "Export required" : sourceLabel(source)}
        </span>
      </section>

      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {olderDrafts.length > 0 && (
        <details className={styles.olderDrafts}>
          <summary>{olderDrafts.length} older catalog draft{olderDrafts.length === 1 ? "" : "s"} preserved in this browser</summary>
          <div>
            {olderDrafts.map((older, index) => (
              <button
                key={older.key}
                type="button"
                onClick={() => downloadText(older.payload, `jju-topics-descriptions-older-${index + 1}.json`)}
              >
                Download {older.decisions} decisions · {formatDate(older.updatedAt)}
              </button>
            ))}
          </div>
        </details>
      )}

      <section className={styles.auditSummary} aria-label="Current audit findings">
        <p><strong>{audit.stats.topicCount} Topics:</strong> {audit.stats.emptyTopics} empty · {audit.stats.singleBookTopics} with one book · {audit.stats.tinyTopics} with 2–4 · {audit.stats.broadTopics} overbroad · {audit.exactDuplicateTopicLabels.length} exact duplicates · {audit.similarTopicPairs.length} similar-looking pairs.</p>
        <p><strong>{audit.stats.bookCount} descriptions:</strong> {audit.stats.fromToDescriptions} use “from…to…” · {audit.stats.cannedOpeningDescriptions} use a repeated/“How” opening · {audit.stats.grammarDescriptions} obvious A/An errors · {audit.stats.flaggedDescriptions} flagged in total · {audit.exactDuplicateDescriptions.length} exact duplicates.</p>
        <p className={styles.overlapStatement}><strong>Overlap is preserved:</strong> every current book has 2–6 Topics. A multi-Topic book is not treated as a problem.</p>
      </section>

      <nav className={styles.viewTabs} aria-label="Review mode">
        <button type="button" className={view === "topics" ? styles.activeTab : ""} onClick={() => setView("topics")} aria-pressed={view === "topics"}>
          <span>Topics</span><strong>{reviewedTopicCount}/{audit.stats.topicCount}</strong>
        </button>
        <button type="button" className={view === "books" ? styles.activeTab : ""} onClick={() => setView("books")} aria-pressed={view === "books"}>
          <span>Books</span><strong>{audit.stats.bookCount}</strong>
        </button>
        <button type="button" className={view === "descriptions" ? styles.activeTab : ""} onClick={() => setView("descriptions")} aria-pressed={view === "descriptions"}>
          <span>Descriptions</span><strong>{reviewedDescriptionCount}/{audit.stats.bookCount}</strong>
        </button>
      </nav>

      {view === "topics" && (
        <section className={styles.workspace} aria-label="Topics review">
          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              Search Topics or their books
              <input value={topicQuery} onChange={event => setTopicQuery(event.target.value)} placeholder="Biography, food, Tacos…" />
            </label>
            <label>
              Show
              <select value={topicHealthFilter} onChange={event => setTopicHealthFilter(event.target.value)}>
                <option value="needs">Needs a decision</option>
                <option value="all">All Topics</option>
                <option value="empty">Empty</option>
                <option value="single">One book</option>
                <option value="tiny">2–4 books</option>
                <option value="broad">Overbroad</option>
                <option value="healthy">Useful range</option>
                <option value="undecided">Undecided</option>
                <option value="decided">Decided</option>
              </select>
            </label>
            <label>
              Sort
              <select value={topicSort} onChange={event => setTopicSort(event.target.value)}>
                <option value="count-asc">Fewest books first</option>
                <option value="count-desc">Most books first</option>
                <option value="name">A–Z</option>
                <option value="decision">Decision</option>
              </select>
            </label>
          </div>
          <div className={styles.resultLine}><strong>{filteredTopics.length}</strong> Topic labels shown</div>
          <div className={styles.topicList}>
            {filteredTopics.map(topic => (
              <TopicCard
                key={topic.name}
                topic={topic}
                books={topic.bookIds.map(id => bookById.get(id)).filter((book): book is DescriptionAuditBook => Boolean(book))}
                similarPairs={audit.similarTopicPairs.filter(pair => pair.left === topic.name || pair.right === topic.name)}
                decision={draft.topicDecisions[topic.name]}
                allTopics={audit.topics}
                onOutcome={outcome => setTopicOutcome(topic.name, outcome)}
                onPatch={patch => patchTopicDecision(topic.name, patch)}
                onClear={() => clearTopicDecision(topic.name)}
              />
            ))}
          </div>
        </section>
      )}

      {view === "books" && (
        <section className={styles.workspace} aria-label="Book Topic memberships">
          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              Search every book or Topic
              <input
                value={bookQuery}
                onChange={event => { setBookQuery(event.target.value); setBookLimit(BOOK_PAGE_SIZE); }}
                placeholder="Title, ID, or Topic…"
              />
            </label>
            <label>
              Topic count
              <select value={bookMembershipFilter} onChange={event => { setBookMembershipFilter(event.target.value); setBookLimit(BOOK_PAGE_SIZE); }}>
                <option value="all">All memberships</option>
                <option value="2-4">2–4 Topics</option>
                <option value="5+">5–6 Topics</option>
                <option value="2">Exactly 2</option>
                <option value="3">Exactly 3</option>
                <option value="4">Exactly 4</option>
                <option value="5">Exactly 5</option>
                <option value="6">Exactly 6</option>
              </select>
            </label>
            <div className={styles.distribution}>
              {Object.entries(audit.stats.booksByTopicCount).map(([count, books]) => <span key={count}><strong>{books}</strong> with {count}</span>)}
            </div>
          </div>
          <div className={styles.resultLine}><strong>{filteredBooks.length}</strong> books match · showing {Math.min(bookLimit, filteredBooks.length)}</div>
          <div className={styles.bookGrid}>
            {filteredBooks.slice(0, bookLimit).map(book => (
              <article className={styles.bookCard} key={book.id}>
                <span className={styles.coverFrame}>
                  <Image src={book.coverSrc} alt="" width={64} height={96} unoptimized onError={event => swapCover(event.currentTarget, book.fallbackCoverSrc)} />
                </span>
                <div className={styles.bookCopy}>
                  <div>
                    <h2>{book.title}</h2>
                    <span>{book.topics.length} overlapping Topics</span>
                  </div>
                  <div className={styles.topicChips}>
                    {book.topics.map(topic => <button key={topic} type="button" onClick={() => openTopic(topic)}>{topic}</button>)}
                  </div>
                  <GuardedAdminLink href={`/admin/books/${book.id}`}>Open book →</GuardedAdminLink>
                </div>
              </article>
            ))}
          </div>
          {bookLimit < filteredBooks.length && <button type="button" className={styles.showMore} onClick={() => setBookLimit(limit => limit + BOOK_PAGE_SIZE)}>Show {Math.min(BOOK_PAGE_SIZE, filteredBooks.length - bookLimit)} more books</button>}
        </section>
      )}

      {view === "descriptions" && (
        <section className={styles.workspace} aria-label="Description review">
          <div className={styles.toolbar}>
            <label className={styles.searchField}>
              Search every description
              <input
                value={descriptionQuery}
                onChange={event => { setDescriptionQuery(event.target.value); setDescriptionLimit(DESCRIPTION_PAGE_SIZE); }}
                placeholder="Title, phrase, or book ID…"
              />
            </label>
            <label>
              Problem
              <select value={descriptionIssueFilter} onChange={event => { setDescriptionIssueFilter(event.target.value); setDescriptionLimit(DESCRIPTION_PAGE_SIZE); }}>
                <option value="flagged">Any formula flag</option>
                <option value="from-to">“From…to…” ({audit.stats.fromToDescriptions})</option>
                <option value="canned">Repeated / “How” opening ({audit.stats.cannedOpeningDescriptions})</option>
                <option value="grammar">A/An error ({audit.stats.grammarDescriptions})</option>
                <option value="short">Under 100 characters ({audit.stats.shortDescriptions})</option>
                <option value="clean">No automatic flag</option>
                <option value="all">All descriptions</option>
              </select>
            </label>
            <label>
              Decision
              <select value={descriptionDecisionFilter} onChange={event => { setDescriptionDecisionFilter(event.target.value); setDescriptionLimit(DESCRIPTION_PAGE_SIZE); }}>
                <option value="all">All decisions</option>
                <option value="undecided">Undecided</option>
                <option value="decided">Decided</option>
              </select>
            </label>
          </div>
          <div className={styles.resultLine}><strong>{filteredDescriptions.length}</strong> descriptions match · showing {Math.min(descriptionLimit, filteredDescriptions.length)}</div>
          <div className={styles.descriptionList}>
            {filteredDescriptions.slice(0, descriptionLimit).map(book => (
              <DescriptionCard
                key={book.id}
                book={book}
                decision={draft.descriptionDecisions[book.id]}
                onOutcome={outcome => setDescriptionOutcome(book.id, outcome)}
                onPatch={patch => patchDescriptionDecision(book.id, patch)}
                onClear={() => clearDescriptionDecision(book.id)}
              />
            ))}
          </div>
          {descriptionLimit < filteredDescriptions.length && <button type="button" className={styles.showMore} onClick={() => setDescriptionLimit(limit => limit + DESCRIPTION_PAGE_SIZE)}>Show {Math.min(DESCRIPTION_PAGE_SIZE, filteredDescriptions.length - descriptionLimit)} more descriptions</button>}
        </section>
      )}
    </main>
  );
}

function TopicCard({
  topic,
  books,
  similarPairs,
  decision,
  allTopics,
  onOutcome,
  onPatch,
  onClear,
}: {
  topic: TopicAuditItem;
  books: DescriptionAuditBook[];
  similarPairs: TopicDescriptionAudit["similarTopicPairs"];
  decision?: TopicDecision;
  allTopics: TopicAuditItem[];
  onOutcome: (outcome: TopicOutcome) => void;
  onPatch: (patch: Partial<TopicDecision>) => void;
  onClear: () => void;
}) {
  return (
    <details className={styles.topicCard}>
      <summary>
        <span>
          <strong>{topic.name}</strong>
          <small>{topic.count} book{topic.count === 1 ? "" : "s"}</small>
        </span>
        <span className={styles.badges}>
          {topic.health !== "healthy" && <em className={styles.problemBadge}>{topicHealthLabel(topic.health)}</em>}
          {similarPairs.length > 0 && <em>similar wording</em>}
          {decision && <em className={styles.decisionBadge}>{outcomeLabel(decision.outcome)}</em>}
        </span>
      </summary>
      <div className={styles.topicBody}>
        {similarPairs.length > 0 && (
          <div className={styles.lookalikeNote}>
            <strong>Wording check, not a confirmed duplicate:</strong>
            {similarPairs.map(pair => <span key={`${pair.left}-${pair.right}`}>{pair.left} ↔ {pair.right}</span>)}
          </div>
        )}
        {books.length ? (
          <div className={styles.memberLinks}>
            {books.map(book => <GuardedAdminLink key={book.id} href={`/admin/books/${book.id}`}>{book.title}</GuardedAdminLink>)}
          </div>
        ) : <p className={styles.emptyTopic}>No public ready/main book currently uses this Topic.</p>}
        <DecisionButtons options={TOPIC_OUTCOMES} selected={decision?.outcome} onSelect={onOutcome} />
        {decision?.outcome === "rename" && (
          <label className={styles.editField}>Proposed name<input value={decision.proposedName || ""} onChange={event => onPatch({ proposedName: event.target.value.slice(0, 100) })} placeholder="New Topic label" /></label>
        )}
        {decision?.outcome === "merge" && (
          <label className={styles.editField}>Merge into<select value={decision.mergeInto || ""} onChange={event => onPatch({ mergeInto: event.target.value })}><option value="">Choose a Topic</option>{allTopics.filter(item => item.name !== topic.name).map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}</select></label>
        )}
        {decision && (
          <div className={styles.decisionFields}>
            <label className={styles.editField}>Note<textarea value={decision.note || ""} onChange={event => onPatch({ note: event.target.value.slice(0, 2_000) })} placeholder="Why this decision?" /></label>
            <button type="button" className={styles.clearDecision} onClick={onClear}>Clear decision</button>
          </div>
        )}
      </div>
    </details>
  );
}

function DescriptionCard({
  book,
  decision,
  onOutcome,
  onPatch,
  onClear,
}: {
  book: DescriptionAuditBook;
  decision?: DescriptionDecision;
  onOutcome: (outcome: DescriptionOutcome) => void;
  onPatch: (patch: Partial<DescriptionDecision>) => void;
  onClear: () => void;
}) {
  return (
    <article className={styles.descriptionCard}>
      <header>
        <div>
          <GuardedAdminLink href={`/admin/books/${book.id}`}>{book.title}</GuardedAdminLink>
          <span>{book.id} · {book.descriptionLength} characters</span>
        </div>
        <div className={styles.badges}>
          {book.descriptionFlags.map(flag => <em key={flag} className={flag === "grammar" ? styles.problemBadge : ""}>{descriptionFlagLabel(flag)}</em>)}
          {decision && <em className={styles.decisionBadge}>{outcomeLabel(decision.outcome)}</em>}
        </div>
      </header>
      <p className={styles.currentDescription}>{book.description}</p>
      <DecisionButtons options={DESCRIPTION_OUTCOMES} selected={decision?.outcome} onSelect={onOutcome} />
      {decision?.outcome === "rewrite" && (
        <label className={styles.editField}>Replacement draft<textarea value={decision.rewrite || ""} onChange={event => onPatch({ rewrite: event.target.value.slice(0, 2_000) })} placeholder="Write a human replacement here. It will not be applied automatically." /></label>
      )}
      {decision && (
        <div className={styles.decisionFields}>
          <label className={styles.editField}>Note<textarea value={decision.note || ""} onChange={event => onPatch({ note: event.target.value.slice(0, 2_000) })} placeholder="Voice, factual, or source note" /></label>
          <button type="button" className={styles.clearDecision} onClick={onClear}>Clear decision</button>
        </div>
      )}
    </article>
  );
}

function DecisionButtons<T extends string>({ options, selected, onSelect }: { options: Array<{ value: T; label: string }>; selected?: T; onSelect: (value: T) => void }) {
  return (
    <div className={styles.decisionButtons} aria-label="Review decision">
      {options.map(option => (
        <button key={option.value} type="button" className={selected === option.value ? styles.selectedDecision : ""} onClick={() => onSelect(option.value)} aria-pressed={selected === option.value}>{option.label}</button>
      ))}
    </div>
  );
}

function sanitizeDraft(value: unknown, catalogFingerprint: string, topicNames: ReadonlySet<string>, bookIds: ReadonlySet<string>): ReviewDraft {
  if (!value || typeof value !== "object") throw new Error("Invalid draft");
  const candidate = value as Partial<ReviewDraft>;
  if (candidate.schemaVersion !== 1 || candidate.catalogFingerprint !== catalogFingerprint) throw new Error("Draft does not match this catalog");
  const topicDecisions: Record<string, TopicDecision> = {};
  if (candidate.topicDecisions && typeof candidate.topicDecisions === "object") {
    for (const [topic, rawDecision] of Object.entries(candidate.topicDecisions)) {
      if (!topicNames.has(topic) || !rawDecision || typeof rawDecision !== "object") continue;
      const decision = rawDecision as Partial<TopicDecision>;
      if (!isTopicOutcome(decision.outcome)) continue;
      topicDecisions[topic] = {
        outcome: decision.outcome,
        ...(cleanText(decision.proposedName, 100) ? { proposedName: cleanText(decision.proposedName, 100) } : {}),
        ...(cleanText(decision.mergeInto, 100) && topicNames.has(cleanText(decision.mergeInto, 100)) ? { mergeInto: cleanText(decision.mergeInto, 100) } : {}),
        ...(cleanText(decision.note, 2_000) ? { note: cleanText(decision.note, 2_000) } : {}),
      };
    }
  }
  const descriptionDecisions: Record<string, DescriptionDecision> = {};
  if (candidate.descriptionDecisions && typeof candidate.descriptionDecisions === "object") {
    for (const [bookId, rawDecision] of Object.entries(candidate.descriptionDecisions)) {
      if (!bookIds.has(bookId) || !rawDecision || typeof rawDecision !== "object") continue;
      const decision = rawDecision as Partial<DescriptionDecision>;
      if (!isDescriptionOutcome(decision.outcome)) continue;
      descriptionDecisions[bookId] = {
        outcome: decision.outcome,
        ...(cleanText(decision.rewrite, 2_000) ? { rewrite: cleanText(decision.rewrite, 2_000) } : {}),
        ...(cleanText(decision.note, 2_000) ? { note: cleanText(decision.note, 2_000) } : {}),
      };
    }
  }
  return {
    schemaVersion: 1,
    catalogFingerprint,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
    topicDecisions,
    descriptionDecisions,
  };
}

function hasCannedOpening(book: DescriptionAuditBook) {
  return book.descriptionFlags.includes("repeated-opening") || book.descriptionFlags.includes("how-opening");
}

function topicHealthLabel(health: TopicHealth) {
  const labels: Record<TopicHealth, string> = {
    empty: "empty",
    single: "one book",
    tiny: "2–4 books",
    broad: "overbroad",
    healthy: "useful range",
  };
  return labels[health];
}

function descriptionFlagLabel(flag: DescriptionAuditFlag) {
  const labels: Record<DescriptionAuditFlag, string> = {
    "from-to": "from…to…",
    "repeated-opening": "repeated opening",
    "how-opening": "How opening",
    grammar: "A/An error",
  };
  return labels[flag];
}

function outcomeLabel(value: TopicOutcome | DescriptionOutcome) {
  return value === "fact-check" ? "Fact-check" : value.charAt(0).toUpperCase() + value.slice(1);
}

function isTopicOutcome(value: unknown): value is TopicOutcome {
  return ["keep", "rename", "merge", "retire", "thinking"].includes(String(value));
}

function isDescriptionOutcome(value: unknown): value is DescriptionOutcome {
  return ["keep", "rewrite", "fact-check", "thinking"].includes(String(value));
}

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function objectSize(value: unknown) {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

function sourceLabel(source: Props["source"]) {
  if (source === "supabase") return "Authoritative Supabase catalog";
  if (source === "github") return "Current GitHub catalog";
  return "Local catalog snapshot";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "previously" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function swapCover(image: HTMLImageElement, fallbackSrc: string) {
  if (image.dataset.fallbackApplied === "true") return;
  image.dataset.fallbackApplied = "true";
  image.src = fallbackSrc;
}

function sortText(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}
