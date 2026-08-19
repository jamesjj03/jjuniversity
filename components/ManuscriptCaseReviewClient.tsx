"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import styles from "./ManuscriptCaseReview.module.css";

type ReviewDecision = {
  replacement: string;
  status: "accepted" | "skipped";
  updatedAt: string;
};

type ReviewRow = {
  acronymTokens: string[];
  bookId: string;
  bookTitle: string;
  decision: ReviewDecision | null;
  firstParagraphText: string;
  index: number;
  prefixText: string;
  proposal: string;
  properNounTokens: string[];
  referenceSuggestions: Array<{
    token: string;
    variants: Array<{ value: string; count: number }>;
  }>;
  riskFlags: string[];
  riskLevel: string;
  safeCssOnly: boolean;
  sectionId: string;
  sectionTitle: string;
  unresolvedTokens: string[];
};

type ReviewPayload = {
  bookOptions: Array<{ id: string; title: string }>;
  filteredTotal: number;
  limit: number;
  offset: number;
  rows: ReviewRow[];
  stats: { accepted: number; skipped: number; unreviewed: number };
  total: number;
};

const EMPTY_PAYLOAD: ReviewPayload = {
  bookOptions: [],
  filteredTotal: 0,
  limit: 25,
  offset: 0,
  rows: [],
  stats: { accepted: 0, skipped: 0, unreviewed: 0 },
  total: 0,
};

function contextWithProposal(row: ReviewRow, replacement: string) {
  if (!row.firstParagraphText.startsWith(row.prefixText)) return row.firstParagraphText;
  return `${replacement}${row.firstParagraphText.slice(row.prefixText.length)}`;
}

export default function ManuscriptCaseReviewClient() {
  const [payload, setPayload] = useState<ReviewPayload>(EMPTY_PAYLOAD);
  const [status, setStatus] = useState("unreviewed");
  const [book, setBook] = useState("");
  const [risk, setRisk] = useState("");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [replacementDrafts, setReplacementDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const loadSequence = useRef(0);

  const active = payload.rows[activeIndex] || null;
  const activeKey = active ? `${active.bookId}::${active.sectionId}` : "";
  const replacement = active
    ? replacementDrafts[activeKey] ?? (active.decision?.replacement || active.proposal)
    : "";

  const requestQueue = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ status, offset: String(offset), limit: "25" });
    if (book) params.set("book", book);
    if (risk) params.set("risk", risk);
    if (submittedQuery) params.set("q", submittedQuery);
    const response = await fetch(`/api/admin/manuscript-case?${params.toString()}`, {
      cache: "no-store",
      signal,
    });
    const next = await response.json() as ReviewPayload & { error?: string };
    if (!response.ok) throw new Error(next.error || "The review queue did not load.");
    return next;
  }, [book, offset, risk, status, submittedQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++loadSequence.current;
    void requestQueue(controller.signal).then(next => {
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      setPayload(next);
      setActiveIndex(0);
    }, error => {
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      setNotice(error instanceof Error ? error.message : "The review queue did not load.");
    }).finally(() => {
      if (!controller.signal.aborted && sequence === loadSequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [requestQueue]);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const next = await requestQueue();
      if (sequence !== loadSequence.current) return;
      setPayload(next);
      setActiveIndex(0);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setNotice(error instanceof Error ? error.message : "The review queue did not load.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [requestQueue]);

  const save = useCallback(async (nextStatus: "accepted" | "skipped" | "reset") => {
    if (!active || loading || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/manuscript-case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: nextStatus === "reset" ? "reset" : undefined,
          bookId: active.bookId,
          sectionId: active.sectionId,
          replacement,
          status: nextStatus === "reset" ? undefined : nextStatus,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The decision was not saved.");
      setNotice(nextStatus === "accepted" ? "Accepted. Manuscripts remain unchanged." : nextStatus === "skipped" ? "Skipped for later." : "Decision cleared.");
      setReplacementDrafts(current => {
        if (!(activeKey in current)) return current;
        const next = { ...current };
        delete next[activeKey];
        return next;
      });
      setLoading(true);
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The decision was not saved.");
    } finally {
      setSaving(false);
    }
  }, [active, activeKey, loading, reload, replacement, saving]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!active || loading) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void save("accepted");
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        setActiveIndex(index => Math.min(payload.rows.length - 1, index + 1));
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveIndex(index => Math.max(0, index - 1));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [active, loading, payload.rows.length, save]);

  const pageStart = payload.filteredTotal ? payload.offset + 1 : 0;
  const pageEnd = Math.min(payload.filteredTotal, payload.offset + payload.rows.length);
  const preview = active ? contextWithProposal(active, replacement) : "";
  const referenceText = useMemo(() => {
    if (!active) return [];
    return active.referenceSuggestions.map(reference => ({
      token: reference.token,
      values: reference.variants.slice(0, 3).map(variant => `${variant.value} (${variant.count.toLocaleString()})`).join(", "),
    }));
  }, [active]);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    setLoading(true);
    setNotice("");
    setOffset(0);
    if (nextQuery === submittedQuery && offset === 0) {
      void reload();
      return;
    }
    setSubmittedQuery(nextQuery);
  }

  function updateReplacement(value: string) {
    if (!activeKey) return;
    setReplacementDrafts(current => ({ ...current, [activeKey]: value }));
  }

  function changeFilter(setter: (value: string) => void, value: string) {
    setLoading(true);
    setNotice("");
    setter(value);
    setOffset(0);
  }

  function changePage(nextOffset: number) {
    setLoading(true);
    setNotice("");
    setOffset(nextOffset);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Protected editorial tool</p>
          <h1>Opening Case Review</h1>
          <p>Review the first words of each manuscript section. Decisions are saved locally. Nothing on this page edits a book.</p>
        </div>
        <div className={styles.headerLinks}>
          <Link href="/admin/editorial">Editorial reviews</Link>
          <a href="/api/admin/manuscript-case?download=1">Download decisions</a>
        </div>
      </header>

      <section className={styles.stats} aria-label="Review progress">
        <div><strong>{payload.stats.unreviewed.toLocaleString()}</strong><span>Unreviewed</span></div>
        <div><strong>{payload.stats.accepted.toLocaleString()}</strong><span>Accepted</span></div>
        <div><strong>{payload.stats.skipped.toLocaleString()}</strong><span>Skipped</span></div>
        <div><strong>{payload.total.toLocaleString()}</strong><span>Total</span></div>
      </section>

      <form className={styles.filters} onSubmit={submitFilters}>
        <label>Status<select value={status} onChange={event => changeFilter(setStatus, event.target.value)}><option value="unreviewed">Unreviewed</option><option value="accepted">Accepted</option><option value="skipped">Skipped</option><option value="all">All</option></select></label>
        <label>Book<select value={book} onChange={event => changeFilter(setBook, event.target.value)}><option value="">All books</option>{payload.bookOptions.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>
        <label>Risk<select value={risk} onChange={event => changeFilter(setRisk, event.target.value)}><option value="">All risks</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label className={styles.search}>Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Book, section, or opening" /></label>
        <button type="submit">Find</button>
      </form>

      <div className={styles.pager}>
        <button type="button" onClick={() => changePage(Math.max(0, offset - payload.limit))} disabled={loading || offset === 0}>Previous 25</button>
        <span>{pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of {payload.filteredTotal.toLocaleString()}</span>
        <button type="button" onClick={() => changePage(offset + payload.limit)} disabled={loading || pageEnd >= payload.filteredTotal}>Next 25</button>
      </div>

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {loading ? <p className={styles.loading}>Loading the review queue…</p> : !active ? <section className={styles.empty}><h2>No rows here</h2><p>Change the filters or move to another review state.</p></section> : (
        <section className={styles.workspace}>
          <aside className={styles.queue} aria-label="Current review page">
            {payload.rows.map((row, index) => (
              <button key={`${row.bookId}:${row.sectionId}`} type="button" className={index === activeIndex ? styles.activeQueueItem : ""} onClick={() => setActiveIndex(index)}>
                <strong>{row.bookTitle}</strong><span>{row.sectionTitle}</span><small>{row.prefixText}</small>
              </button>
            ))}
          </aside>

          <article className={styles.reviewCard}>
            <div className={styles.reviewHeading}>
              <div><p>{active.bookTitle}</p><h2>{active.sectionTitle}</h2><span>{active.bookId} · {active.sectionId} · section {active.index + 1}</span></div>
              <span className={`${styles.risk} ${styles[active.riskLevel] || ""}`}>{active.riskLevel} risk</span>
            </div>

            <div className={styles.compare}>
              <div><span>Current opening</span><p>{active.firstParagraphText}</p></div>
              <div><span>Proposed opening</span><p>{preview}</p></div>
            </div>

            <label className={styles.replacement}>Approved first words<input value={replacement} onChange={event => updateReplacement(event.target.value)} autoComplete="off" /></label>

            <div className={styles.flags}>
              {active.safeCssOnly && <span>CSS-only fix</span>}
              {active.riskFlags.map(flag => <span key={flag}>{flag.replaceAll("-", " ")}</span>)}
            </div>

            {(active.acronymTokens.length > 0 || active.properNounTokens.length > 0 || active.unresolvedTokens.length > 0) && <dl className={styles.tokens}>
              {active.acronymTokens.length > 0 && <><dt>Acronyms</dt><dd>{active.acronymTokens.join(", ")}</dd></>}
              {active.properNounTokens.length > 0 && <><dt>Possible names</dt><dd>{active.properNounTokens.join(", ")}</dd></>}
              {active.unresolvedTokens.length > 0 && <><dt>Unresolved</dt><dd>{active.unresolvedTokens.join(", ")}</dd></>}
            </dl>}

            {referenceText.length > 0 && <div className={styles.references}><h3>Corpus references</h3>{referenceText.map(reference => <p key={reference.token}><strong>{reference.token}</strong><span>{reference.values}</span></p>)}</div>}

            <div className={styles.actions}>
              <button type="button" className={styles.accept} onClick={() => void save("accepted")} disabled={saving}>Accept wording</button>
              <button type="button" onClick={() => void save("skipped")} disabled={saving}>Skip for later</button>
              {active.decision && <button type="button" onClick={() => void save("reset")} disabled={saving}>Clear decision</button>}
              <span>Ctrl + Enter accepts · Alt + arrows move</span>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
