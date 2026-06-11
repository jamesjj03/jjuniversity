"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeReviewNote, type ReviewBlock, type ReviewNote } from "@/lib/review";

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
  sections: Section[];
};

type Props = {
  book: Book;
};

const SECTION_KINDS = ["chapter", "title", "dedication", "toc", "acknowledgments", "about", "copyright", "backmatter", "default"];

const LOCAL_PATTERNS = [
  { risk: "high" as const, type: "review" as const, pattern: /\b(always|never|everyone|no one|all historians|scientists agree)\b/i, issue: "Absolute claim. Verify or soften." },
  { risk: "medium" as const, type: "source" as const, pattern: /\b(first|only|largest|smallest|oldest|youngest|most powerful|worst|best)\b/i, issue: "Superlative claim. Needs a source check." },
  { risk: "medium" as const, type: "source" as const, pattern: /\b\d{3,4}\b/, issue: "Date or number. Confirm before publishing." },
  { risk: "low" as const, type: "review" as const, pattern: /\bobviously|clearly|undeniably|without question\b/i, issue: "Tone flag. Consider making it more precise." },
];

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

function stripText(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sentenceAround(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  const nextDot = text.indexOf(".", index);
  const end = nextDot === -1 ? Math.min(text.length, index + 180) : nextDot + 1;
  return text.slice(start, end).trim();
}

function localReviewNotes(html: string, bookName: string, sectionPath: string): ReviewNote[] {
  const text = stripText(html);
  const notes: ReviewNote[] = [];

  LOCAL_PATTERNS.forEach((rule, ruleIndex) => {
    for (const match of text.matchAll(new RegExp(rule.pattern, "gi"))) {
      const index = match.index || 0;
      const line = sentenceAround(text, index);
      if (!line || notes.some(note => note.line === line)) continue;
      notes.push(normalizeReviewNote({
        id: `local-${ruleIndex}-${index}`,
        bookName,
        chapterPath: sectionPath,
        type: rule.type,
        status: "open",
        line,
        issue: rule.issue,
        risk: rule.risk,
        needsSource: rule.type === "source",
      }));
      if (notes.length >= 18) return;
    }
  });

  return notes;
}

function importNotes(value: string): ReviewNote[] {
  const parsed = JSON.parse(value) as unknown;
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record.flags)
      ? record.flags
      : Array.isArray(record.issues)
        ? record.issues
        : Array.isArray(record.notes)
          ? record.notes
          : [];
  return items.map((item, index) => normalizeReviewNote({
    id: `import-${index}`,
    ...(item && typeof item === "object" ? item as Record<string, unknown> : {}),
  })).filter(item => item.line || item.issue);
}

function noteMatches(note: ReviewNote, filter: string, search: string) {
  const filterMatch = filter === "all" || note.type === filter || note.status === filter;
  const haystack = [note.line, note.issue, note.fix, note.source, note.sourceTitle, note.chapterPath].join(" ").toLowerCase();
  return filterMatch && (!search || haystack.includes(search));
}

export default function AdminReaderEditor({ book }: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const injectedHtmlRef = useRef("");
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
  const [factLayerOpen, setFactLayerOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [blocks, setBlocks] = useState<ReviewBlock[]>([]);
  const [activeNoteId, setActiveNoteId] = useState("");
  const [noteFilter, setNoteFilter] = useState("open");
  const [noteSearch, setNoteSearch] = useState("");
  const [importText, setImportText] = useState("");
  const [modelStatus, setModelStatus] = useState("Checking models...");
  const [hasClaude, setHasClaude] = useState(false);

  const section = useMemo(() => sections.find(item => item.id === sectionId) || sections[0], [sectionId, sections]);
  const currentNotes = useMemo(() => notes.filter(note => !note.chapterPath || note.chapterPath === section?.id), [section, notes]);
  const visibleNotes = useMemo(() => currentNotes.filter(note => noteMatches(note, noteFilter, noteSearch.toLowerCase().trim())), [currentNotes, noteFilter, noteSearch]);
  const stats = useMemo(() => notes.reduce((totals, note) => {
    totals.all += 1;
    totals[note.type] = (totals[note.type] || 0) + 1;
    totals[note.status] = (totals[note.status] || 0) + 1;
    return totals;
  }, { all: 0, error: 0, source: 0, review: 0, open: 0, resolved: 0, ignored: 0 } as Record<string, number>), [notes]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBusy(true);
      setMessage("Loading JSON content editor...");
    });

    fetch(`/api/admin/review/config`)
      .then(response => response.json())
      .then(data => {
        if (!cancelled) {
          setHasClaude(Boolean(data.hasApiKey));
          setModelStatus(data.hasApiKey ? `${data.provider}: ${data.claimModel} -> ${data.factModel}` : "Claude checks need ANTHROPIC_API_KEY in this environment");
        }
      })
      .catch(() => {
        if (!cancelled) setModelStatus("Review backend unavailable");
      });

    fetch(`/api/admin/content/${encodeURIComponent(book.id)}`)
      .then(async response => {
        const data = await response.json() as ContentBook & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load book content.");
        if (cancelled) return;
        const nextSections = Array.isArray(data.sections) ? data.sections.sort((a, b) => a.index - b.index) : [];
        const first = nextSections[0];
        setSections(nextSections);
        setSectionId(first?.id || "");
        setHtml(first?.html || "");
        setSectionTitle(first?.title || "");
        setSectionKind(first?.kind || "chapter");
        setContentTitle(data.title || book.title);
        setContentCreator(data.creator || "");
        setContentDescription(data.description || "");
        setContentFile(data.contentFile || "");
        const saved = await fetch(`/api/admin/review/${encodeURIComponent(book.id)}`).then(response => response.json()).catch(() => ({ notes: [], blocks: [] }));
        setNotes(Array.isArray(saved.notes) && saved.notes.length ? saved.notes : localReviewNotes(first?.html || "", data.title || book.title, first?.id || ""));
        setBlocks(Array.isArray(saved.blocks) ? saved.blocks : []);
        setActiveNoteId("");
        setDirty(false);
        setMessage(`${nextSections.length} JSON sections ready${data.contentFile ? ` from ${data.contentFile}` : ""}.`);
      })
      .catch(error => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load book content.");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [book.id, book.title]);

  useEffect(() => {
    const node = editorRef.current;
    if (!node || injectedHtmlRef.current === html) return;
    node.innerHTML = html;
    injectedHtmlRef.current = html;
  }, [html, section?.id]);

  function chooseSection(id: string) {
    const next = sections.find(item => item.id === id);
    setSectionId(id);
    setHtml(next?.html || "");
    setSectionTitle(next?.title || "");
    setSectionKind(next?.kind || "chapter");
    setNotes(current => [
      ...current.filter(note => note.chapterPath !== id),
      ...localReviewNotes(next?.html || "", contentTitle || book.title, id),
    ]);
    setActiveNoteId("");
    setDirty(false);
  }

  function syncFromEditor() {
    const nextHtml = editorRef.current?.innerHTML || "";
    setDirty(nextHtml !== section?.html || sectionTitle !== section?.title || sectionKind !== (section?.kind || "chapter"));
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
      };
    });
  }

  function markDirty() {
    setDirty(true);
  }

  function addSection() {
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
    setActiveNoteId("");
    setDirty(true);
    setMessage("New section added. Save JSON when it looks right.");
  }

  function deleteSection() {
    if (!section || sections.length <= 1) return;
    const nextSections = sections
      .filter(item => item.id !== section.id)
      .map((item, index) => ({ ...item, index }));
    const next = nextSections[Math.min(sectionIndex(), nextSections.length - 1)] || nextSections[0];

    setSections(nextSections);
    setSectionId(next?.id || "");
    setHtml(next?.html || "");
    setSectionTitle(next?.title || "");
    setSectionKind(next?.kind || "chapter");
    setNotes(current => current.filter(note => note.chapterPath !== section.id));
    setActiveNoteId("");
    setDirty(true);
    setMessage("Section removed locally. Save JSON to commit it.");
  }

  function sectionIndex() {
    return Math.max(0, sections.findIndex(item => item.id === section?.id));
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

  async function saveReviewData(nextNotes = notes, nextBlocks = blocks) {
    await fetch(`/api/admin/review/${encodeURIComponent(book.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: nextNotes, blocks: nextBlocks }),
    }).catch(() => undefined);
  }

  function runLocalCheck() {
    if (!section) return;
    const generated = localReviewNotes(currentHtml(), contentTitle || book.title, section.id);
    const nextNotes = [...notes.filter(note => note.chapterPath !== section.id || !String(note.id).startsWith("local-")), ...generated];
    setNotes(nextNotes);
    setActiveNoteId(generated[0]?.id || "");
    void saveReviewData(nextNotes, blocks);
    setMessage("Local review flags refreshed.");
  }

  async function splitClaims() {
    if (!section) return;
    setBusy(true);
    setMessage("Splitting claims...");
    try {
      const response = await fetch("/api/admin/review/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookName: contentTitle || book.title, chapterPath: section.id, text: currentHtml() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Claim splitting failed.");
      const newNotes = Array.isArray(data.claims) ? data.claims : [];
      const nextBlocks = [...blocks.filter(block => block.chapterPath !== section.id), ...(Array.isArray(data.blocks) ? data.blocks : [])];
      const nextNotes = [...notes.filter(note => note.chapterPath !== section.id || !String(note.id).startsWith("local-")), ...newNotes];
      setBlocks(nextBlocks);
      setNotes(nextNotes);
      setActiveNoteId(newNotes[0]?.id || "");
      setFactLayerOpen(true);
      void saveReviewData(nextNotes, nextBlocks);
      setMessage(`Added ${newNotes.length} claim review items.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Claim splitting failed.");
    } finally {
      setBusy(false);
    }
  }

  async function factCheckClaims() {
    if (!section) return;
    const claims = currentNotes.filter(note => ["source", "review"].includes(note.type) && note.status === "open");
    if (!claims.length) {
      setMessage("Split claims first, then run fact-check.");
      return;
    }
    setBusy(true);
    setMessage("Fact-checking section claims...");
    try {
      const response = await fetch("/api/admin/review/fact-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookName: contentTitle || book.title, chapterPath: section.id, claims }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Fact-checking failed.");
      const issues = Array.isArray(data.issues) ? data.issues : [];
      const nextNotes = [...notes, ...issues];
      setNotes(nextNotes);
      setActiveNoteId(issues[0]?.id || "");
      void saveReviewData(nextNotes, blocks);
      setMessage(`Added ${issues.length} fact-check results.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fact-checking failed.");
    } finally {
      setBusy(false);
    }
  }

  function applyImport() {
    try {
      const imported = importNotes(importText).map(note => ({ ...note, bookName: note.bookName || contentTitle || book.title, chapterPath: note.chapterPath || section?.id || "" }));
      const nextNotes = [...notes, ...imported];
      setNotes(nextNotes);
      setActiveNoteId(imported[0]?.id || "");
      void saveReviewData(nextNotes, blocks);
      setMessage(`Imported ${imported.length} review notes.`);
    } catch {
      setMessage("That review JSON did not parse.");
    }
  }

  function updateNoteStatus(id: string | undefined, status: ReviewNote["status"]) {
    if (!id) return;
    const nextNotes = notes.map(note => note.id === id ? { ...note, status } : note);
    setNotes(nextNotes);
    void saveReviewData(nextNotes, blocks);
  }

  function jumpTo(note: ReviewNote) {
    const root = editorRef.current;
    if (!root || !note.line) return;
    root.focus();
    (root.ownerDocument.defaultView as Window & { find?: (text: string) => boolean })?.find?.(note.line);
  }

  function applyReplacement(note: ReviewNote) {
    if (!note.fix || !note.line || !editorRef.current) return;
    const next = editorRef.current.innerHTML.replace(note.line, note.fix);
    if (next === editorRef.current.innerHTML) {
      setMessage("Could not find that exact line. Try Find, then edit manually.");
      return;
    }
    editorRef.current.innerHTML = next;
    syncFromEditor();
    const nextNotes = notes.map(item => item.id === note.id ? { ...item, status: "resolved" as const } : item);
    setNotes(nextNotes);
    void saveReviewData(nextNotes, blocks);
    setMessage("Applied replacement and marked resolved.");
  }

  async function saveSection() {
    if (!section) return;
    const nextHtml = currentHtml();
    setBusy(true);
    setMessage("Saving JSON content...");

    try {
      const response = await fetch(`/api/admin/content/${encodeURIComponent(book.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: section.id,
          html: nextHtml,
          title: sectionTitle,
          kind: sectionKind,
          book: {
            title: contentTitle,
            creator: contentCreator,
            description: contentDescription,
            sections: sectionsForSave(nextHtml),
          },
          message: `Edit ${contentTitle || book.title} JSON content`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed.");
      const nextSections = Array.isArray(data.sections) ? data.sections.sort((a: Section, b: Section) => a.index - b.index) : sections;
      setSections(nextSections);
      const nextSection = nextSections.find((item: Section) => item.id === section.id);
      setHtml(nextSection?.html || nextHtml);
      setSectionTitle(nextSection?.title || sectionTitle);
      setSectionKind(nextSection?.kind || sectionKind);
      setContentTitle(data.title || contentTitle);
      setContentCreator(data.creator || contentCreator);
      setContentDescription(data.description || contentDescription);
      setContentFile(data.contentFile || contentFile);
      setDirty(false);
      setMessage(data.commit ? `Saved live through GitHub: ${data.commit}` : data.note || "Saved JSON content locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="adminPanel adminReaderPanel">
      <style>{readerStyle()}</style>
      <div className="pathBuilderTop">
        <div>
          <p className="kicker">Content Editor</p>
          <h2>Edit JSON book content</h2>
          <p>Review, fact-check, and edit the live JSON sections the reader uses.</p>
          <p className={hasClaude ? "modelStatus ready" : "modelStatus"}>{modelStatus}</p>
          {contentFile && <p className="modelStatus ready">Source: public/book-content/{contentFile}</p>}
        </div>
        <div className="adminActions">
          <button className="resetBtn" onClick={() => setEditMode(value => !value)}>{editMode ? "Preview" : "Edit"}</button>
          <button className="resetBtn" onClick={() => setFactLayerOpen(value => !value)}>{factLayerOpen ? "Hide Review" : "Show Review"}</button>
          <button className="resetBtn" disabled={busy} onClick={runLocalCheck}>Local Check</button>
          <button className="resetBtn" disabled={busy || !section || !hasClaude} onClick={splitClaims}>Split Claims</button>
          <button className="resetBtn" disabled={busy || !section || !hasClaude} onClick={factCheckClaims}>Fact Check</button>
          <button className="resetBtn" disabled={busy} onClick={addSection}>Add Section</button>
          <button className="resetBtn" disabled={busy || !section || sections.length <= 1} onClick={deleteSection}>Delete Section</button>
          <button className="resetBtn" disabled={busy} onClick={() => saveReviewData().then(() => setMessage("Review queue saved."))}>Save Review</button>
          <button className="formBtn" disabled={busy || !section || !dirty} onClick={saveSection}>{busy ? "Saving..." : dirty ? "Save JSON" : "Saved"}</button>
        </div>
      </div>

      <section className="adminReviewStats">
        <button className={noteFilter === "all" ? "active" : ""} onClick={() => setNoteFilter("all")}><strong>{stats.all}</strong><span>all</span></button>
        <button className={noteFilter === "error" ? "active" : ""} onClick={() => setNoteFilter("error")}><strong>{stats.error || 0}</strong><span>errors</span></button>
        <button className={noteFilter === "source" ? "active" : ""} onClick={() => setNoteFilter("source")}><strong>{stats.source || 0}</strong><span>sources</span></button>
        <button className={noteFilter === "open" ? "active" : ""} onClick={() => setNoteFilter("open")}><strong>{stats.open || 0}</strong><span>open</span></button>
        <button className={noteFilter === "resolved" ? "active" : ""} onClick={() => setNoteFilter("resolved")}><strong>{stats.resolved || 0}</strong><span>resolved</span></button>
      </section>

      {message && <div className="adminNotice">{message}</div>}

      <section className="contentMetaGrid">
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
      </section>

      <div className={factLayerOpen ? "adminReaderGrid" : "adminReaderGrid factLayerClosed"}>
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

          <label>
            <span>Search notes</span>
            <input className="input" value={noteSearch} onChange={event => setNoteSearch(event.target.value)} placeholder="Search line, issue, source..." />
          </label>

          <section>
            <h3>Review queue</h3>
            <div className="factFlagList">
              {visibleNotes.map(note => (
                <article className={`factFlag ${note.risk || note.confidence || "medium"} ${note.type} ${note.status} ${note.id === activeNoteId ? "active" : ""}`} key={note.id} onClick={() => setActiveNoteId(note.id || "")}>
                  <strong>{note.type} {note.confidence ? `/${note.confidence}` : ""}</strong>
                  <p>{note.line || note.issue}</p>
                  <small>{note.issue}</small>
                  {note.source && <a href={note.source} target="_blank">{note.sourceTitle || note.source}</a>}
                  <div className="adminActions miniActions">
                    <button onClick={() => jumpTo(note)}>Find</button>
                    {note.fix && <button onClick={() => applyReplacement(note)}>Apply</button>}
                    <button onClick={() => updateNoteStatus(note.id, "resolved")}>Done</button>
                    <button onClick={() => updateNoteStatus(note.id, "ignored")}>Ignore</button>
                  </div>
                </article>
              ))}
              {!visibleNotes.length && <div className="emptyPathState">No review notes match this view.</div>}
            </div>
          </section>

          <label>
            <span>Import prototype JSON</span>
            <textarea value={importText} onChange={event => setImportText(event.target.value)} placeholder='{"issues":[{"line":"...","issue":"...","fix":"...","source":"..."}]}' />
          </label>
          <button className="resetBtn" onClick={applyImport}>Import Notes</button>
        </aside>

        <div className="adminReaderSurface">
          {factLayerOpen && blocks.some(block => block.chapterPath === section?.id) && (
            <div className="reviewMap">
              {blocks.filter(block => block.chapterPath === section?.id).map(block => (
                <button className={`blockCard ${block.kind} ${block.risk}`} key={`${block.chapterPath}-${block.blockId}`} onClick={() => jumpTo({ line: block.text, issue: "", type: "review", status: "open" })}>
                  <strong>{block.kind}</strong>
                  <span>{block.risk}{block.needsSource ? " / source" : ""}</span>
                  <p>{block.text}</p>
                </button>
              ))}
            </div>
          )}

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
            contentEditable={editMode}
            suppressContentEditableWarning
            onInput={syncFromEditor}
          />
        </div>
      </div>
    </section>
  );
}
