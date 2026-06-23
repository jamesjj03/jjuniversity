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
};

const SECTION_KINDS = ["chapter", "title", "dedication", "toc", "acknowledgments", "about", "copyright", "backmatter", "default"];

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
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");

  const section = useMemo(() => sections.find(item => item.id === sectionId) || sections[0], [sectionId, sections]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBusy(true);
      setMessage("Loading JSON content editor...");
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
        setDirty(false);
        setMessage(`${nextSections.length} sections ready${data.contentFile ? ` from ${data.contentFile}` : ""}${data.contentSource ? ` (${data.contentSource})` : ""}.`);
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
          <p>Edit the live JSON sections the reader uses.</p>
          {contentFile && <p className="modelStatus ready">Source: public/book-content/{contentFile}</p>}
        </div>
        <div className="adminActions">
          <button className="resetBtn" onClick={() => setEditMode(value => !value)}>{editMode ? "Preview" : "Edit"}</button>
          <button className="resetBtn" disabled={busy} onClick={addSection}>Add Section</button>
          <button className="resetBtn" disabled={busy || !section || sections.length <= 1} onClick={deleteSection}>Delete Section</button>
          <button className="formBtn" disabled={busy || !section || !dirty} onClick={saveSection}>{busy ? "Saving..." : dirty ? "Save JSON" : "Saved"}</button>
        </div>
      </div>

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
            contentEditable={editMode}
            suppressContentEditableWarning
            onInput={syncFromEditor}
          />
        </div>
      </div>
    </section>
  );
}
