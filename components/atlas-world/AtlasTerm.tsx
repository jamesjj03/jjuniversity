"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ATLAS_GLOSSARY, getAtlasGlossaryTerm, type AtlasGlossaryTerm } from "@/lib/atlas-world/glossary";
import styles from "./AtlasTerm.module.css";

type DefinitionDialogProps = {
  initialTerm: AtlasGlossaryTerm | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
};

function DefinitionDialog({ initialTerm, triggerRef, onDismiss }: DefinitionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState(initialTerm);
  const [query, setQuery] = useState("");
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function dismiss() {
    dialogRef.current?.close();
    onDismiss();
    triggerRef.current?.focus({ preventScroll: true });
  }

  function select(entry: AtlasGlossaryTerm | null) {
    setSelected(entry);
    requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
  }

  const matching = ATLAS_GLOSSARY.filter((entry) =>
    [entry.label, entry.definition, ...entry.aliases].join(" ").toLowerCase().includes(query.toLowerCase().trim()),
  );

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={selected ? descriptionId : undefined}
      onClose={dismiss}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      data-atlas-glossary="true"
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Atlas field guide</span>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close definition">×</button>
        </header>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>{selected?.label ?? "Reading the Atlas"}</h2>
        {selected ? (
          <>
            <p id={descriptionId} className={styles.definition}>{selected.definition}</p>
            <section className={styles.section}>
              <h3>How Atlas uses it</h3>
              <p>{selected.inAtlas}</p>
            </section>
            <p className={styles.caveat}>{selected.caveat}</p>
            <section className={styles.sources} aria-label="Definition sources">
              <h3>Sources &amp; method</h3>
              {selected.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<span>{source.publisher} ↗</span></a>
              ))}
              <small>Explanation reviewed {selected.reviewedAt}. Country facts retain their own observation dates.</small>
            </section>
            <button type="button" className={styles.allTerms} onClick={() => select(null)}>Explore all definitions →</button>
          </>
        ) : (
          <>
            <label className={styles.search}>
              <span>Find a definition</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Government, density, disputed…" />
            </label>
            <div className={styles.index}>
              {(["Government", "Religion", "Reading the map", "Geography"] as const).map((group) => {
                const entries = matching.filter((entry) => entry.group === group);
                return entries.length ? <section key={group}><h3>{group}</h3>{entries.map((entry) => <button type="button" key={entry.id} onClick={() => select(entry)}>{entry.label}<span aria-hidden="true">↗</span></button>)}</section> : null;
              })}
              {matching.length === 0 && <p>No matching definition. Try a broader term.</p>}
            </div>
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
