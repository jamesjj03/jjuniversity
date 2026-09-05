"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  ATLAS_GLOSSARY,
  ATLAS_GLOSSARY_GROUPS,
  getAtlasGlossaryTerm,
  type AtlasGlossaryGroup,
  type AtlasGlossaryTerm,
} from "@/lib/atlas-world/glossary";
import styles from "./AtlasTerm.module.css";

type DefinitionDialogProps = {
  initialTerm: AtlasGlossaryTerm | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
};

type GuideGroup = AtlasGlossaryGroup;
type GuideLocation = { termId: string | null; group: GuideGroup | null; query: string };
const guideHome: GuideLocation = { termId: null, group: null, query: "" };

function DefinitionDialog({ initialTerm, triggerRef, onDismiss }: DefinitionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closedRef = useRef(false);
  const [trail, setTrail] = useState<GuideLocation[]>(() => initialTerm
    ? [guideHome, { termId: initialTerm.id, group: initialTerm.group, query: "" }]
    : [guideHome]);
  const location = trail[trail.length - 1];
  const selected = location.termId ? getAtlasGlossaryTerm(location.termId) : null;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
    if (initialTerm) titleRef.current?.focus({ preventScroll: true });
    else searchRef.current?.focus({ preventScroll: true });
  }, [initialTerm]);

  function dismiss() {
    if (closedRef.current) return;
    closedRef.current = true;
    dialogRef.current?.close();
    onDismiss();
    triggerRef.current?.focus({ preventScroll: true });
  }

  function focusPage(search = false) {
    requestAnimationFrame(() => {
      dialogRef.current?.scrollTo({ top: 0 });
      if (search) searchRef.current?.focus({ preventScroll: true });
      else titleRef.current?.focus({ preventScroll: true });
    });
  }

  function navigate(next: GuideLocation, search = false) {
    setTrail((previous) => [...previous, next]);
    focusPage(search);
  }

  function back() {
    if (trail.length < 2) return;
    setTrail((previous) => previous.slice(0, -1));
    focusPage();
  }

  function select(entry: AtlasGlossaryTerm) {
    navigate({ termId: entry.id, group: entry.group, query: "" });
  }

  const searchWords = location.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matching = ATLAS_GLOSSARY.filter((entry) =>
    (!location.group || entry.group === location.group) &&
    searchWords.every((word) => [entry.label, entry.definition, entry.example ?? "", ...entry.aliases].join(" ").toLowerCase().includes(word)),
  );
  const related = selected?.relatedTerms.flatMap((id) => {
    const entry = getAtlasGlossaryTerm(id);
    return entry ? [entry] : [];
  }) ?? [];

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={selected ? descriptionId : undefined}
      onClose={dismiss}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); back(); }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0
            && getComputedStyle(element).visibility !== "hidden");
          const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
          const wraps = event.shiftKey ? activeIndex <= 0 : activeIndex < 0 || activeIndex === controls.length - 1;
          if (wraps) {
            event.preventDefault();
            event.stopPropagation();
            (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
          }
        }
      }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      data-atlas-glossary="true"
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <nav className={styles.breadcrumbs} aria-label="Field guide navigation">
            {trail.length > 1 && <button type="button" className={styles.back} onClick={back} aria-label="Back in field guide">←</button>}
            <button type="button" onClick={() => { setTrail([guideHome]); focusPage(true); }}>Field guide</button>
            {location.group && <><span aria-hidden="true">/</span><button type="button" onClick={() => navigate({ termId: null, group: location.group, query: "" })}>{location.group}</button></>}
          </nav>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close definition">×</button>
        </header>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>{selected?.label ?? location.group ?? "Understand the map"}</h2>
        {selected ? (
          <article key={selected.id}>
            <p id={descriptionId} className={styles.definition}>{selected.definition}</p>
            {selected.example && <p className={styles.example}>{selected.example}</p>}
            <details className={styles.method}>
              <summary>How Atlas classifies this</summary>
              <p>{selected.inAtlas}</p>
              <p className={styles.caveat}>{selected.caveat}</p>
              <section className={styles.sources} aria-label="Definition sources">
                <h3>Sources</h3>
                {selected.sources.map((source) => (
                  <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<span>{source.publisher} ↗</span></a>
                ))}
                <small>Explanation reviewed {selected.reviewedAt}. Country facts have their own dates.</small>
              </section>
            </details>
            {related.length > 0 && <section className={styles.related} aria-label="Related definitions"><h3>Related ideas</h3>{related.map((entry) => <button key={entry.id} type="button" onClick={() => select(entry)}>{entry.label}<span aria-hidden="true">→</span></button>)}</section>}
            <button type="button" className={styles.allTerms} onClick={() => navigate(guideHome, true)}>Search the field guide</button>
          </article>
        ) : (
          <>
            <label className={styles.search}>
              <span>Find a definition{location.group ? ` in ${location.group.toLowerCase()}` : ""}</span>
              <input ref={searchRef} type="search" value={location.query} onChange={(event) => setTrail((previous) => [...previous.slice(0, -1), { ...previous[previous.length - 1], query: event.target.value }])} placeholder="Try monarchy, density or folk religion" />
            </label>
            {!location.group && !location.query ? <><div className={styles.groups}>{ATLAS_GLOSSARY_GROUPS.map((group) => <button type="button" key={group.name} onClick={() => navigate({ termId: null, group: group.name, query: "" })}><strong>{group.name}</strong><span>{group.description}</span><span className={styles.groupArrow} aria-hidden="true">→</span></button>)}</div><a className={styles.completeIndex} href="/atlas/index">Open the complete Atlas Index <span aria-hidden="true">→</span></a></> : <div className={styles.index}>
              {matching.map((entry) => <button type="button" key={entry.id} onClick={() => select(entry)}><span>{entry.label}<small>{entry.definition.split(/(?<=\.)\s/)[0]}</small></span><span aria-hidden="true">→</span></button>)}
              {matching.length === 0 && <p role="status">No matching definition. Try a broader term.</p>}
            </div>}
          </>
        )}
      </div>
    </dialog>, document.body,
  );
}

export type AtlasTermProps = {
  term: string;
  context?: "government" | "religion";
  children?: ReactNode;
  className?: string;
};

/** Native modal semantics, keyboard activation, Escape and focus return; safe inside inline text. */
export default function AtlasTerm({ term, context, children, className }: AtlasTermProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const entry = getAtlasGlossaryTerm(term, context);
  if (!entry) return <>{children ?? term}</>;
  return <>
    <button ref={triggerRef} type="button" className={[styles.term, className].filter(Boolean).join(" ")} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Define ${entry.label}`}>
      {children ?? entry.label}
    </button>
    {open && <DefinitionDialog initialTerm={entry} triggerRef={triggerRef} onDismiss={() => setOpen(false)} />}
  </>;
}

/** One compact entry point; no separate encyclopedia route or network request. */
export function AtlasGlossaryIndex({ className, children = "Field guide" }: { className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={triggerRef} type="button" className={className ?? styles.indexButton} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>{children}</button>
    {open && <DefinitionDialog initialTerm={null} triggerRef={triggerRef} onDismiss={() => setOpen(false)} />}
  </>;
}
