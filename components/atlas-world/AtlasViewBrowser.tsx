"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ATLAS_VIEW_PRESET_BY_ID } from "@/lib/atlas-world/layers";
import {
  ATLAS_VIEW_CATEGORIES,
  ATLAS_VIEW_NAVIGATION,
  atlasAdjacentViewId,
  atlasRelatedViews,
  atlasViewName,
  type AtlasViewCategoryId,
} from "@/lib/atlas-world/viewNavigation";
import styles from "./AtlasViewBrowser.module.css";

const subscribeToHydration = () => () => {};

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export default function AtlasViewBrowser({
  activeViewId,
  onChoose,
}: {
  activeViewId: string;
  onChoose: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [category, setCategory] = useState<AtlasViewCategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [recentViewIds, setRecentViewIds] = useState<string[]>([]);
  const active = ATLAS_VIEW_PRESET_BY_ID.get(activeViewId)
    ?? ATLAS_VIEW_PRESET_BY_ID.get("political")!;

  const close = () => {
    dialog.current?.close();
    setQuery("");
    trigger.current?.focus();
  };
  const open = () => {
    dialog.current?.showModal();
    window.requestAnimationFrame(() => filterInput.current?.focus());
  };
  const navigate = useCallback((id: string) => {
    if (id !== activeViewId) {
      setRecentViewIds((current) => [
        activeViewId,
        ...current.filter((recentId) => recentId !== activeViewId && recentId !== id),
      ].slice(0, 4));
    }
    onChoose(id);
  }, [activeViewId, onChoose]);
  const choose = (id: string) => {
    navigate(id);
    close();
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.key.toLocaleLowerCase("en-US") === "v" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        open();
        return;
      }
      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        navigate(atlasAdjacentViewId(activeViewId, event.key === "[" ? -1 : 1));
        return;
      }
      if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const item = ATLAS_VIEW_NAVIGATION.find((candidate) => candidate.shortcut === Number(event.key));
        if (item) {
          event.preventDefault();
          navigate(item.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeViewId, navigate]);

  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  const filteredViews = useMemo(() => ATLAS_VIEW_NAVIGATION.filter((item) => {
    if (category !== "all" && item.categoryId !== category) return false;
    if (!normalizedQuery) return true;
    const preset = ATLAS_VIEW_PRESET_BY_ID.get(item.id);
    return [preset?.name, preset?.description, preset?.question, item.summary, ...(item.searchTerms ?? [])]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("en-US").includes(normalizedQuery));
  }), [category, normalizedQuery]);
  const relatedViews = atlasRelatedViews(activeViewId);

  return (
    <div className={styles.browser}>
      <button type="button" className={styles.adjacent}
        aria-label={`Previous view: ${atlasViewName(atlasAdjacentViewId(activeViewId, -1))}`}
        title="Previous view  [" onClick={() => navigate(atlasAdjacentViewId(activeViewId, -1))}>‹</button>
      <button ref={trigger} type="button" className={styles.trigger} aria-haspopup="dialog"
        disabled={!ready} aria-label={`Choose view: ${active.name}`} onClick={open}>
        <span><small>VIEW</small><strong>{active.name}</strong></span><kbd>V</kbd>
      </button>
      <button type="button" className={styles.adjacent}
        aria-label={`Next view: ${atlasViewName(atlasAdjacentViewId(activeViewId, 1))}`}
        title="Next view  ]" onClick={() => navigate(atlasAdjacentViewId(activeViewId, 1))}>›</button>

      <dialog ref={dialog} className={styles.dialog} aria-labelledby="atlas-view-heading"
        onCancel={() => trigger.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className={styles.surface}>
          <header><div><span>CHOOSE A VIEW</span><h2 id="atlas-view-heading">Explore the map</h2></div>
            <button type="button" onClick={close} aria-label="Close map views">×</button></header>

          <div className={styles.command}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
            <input ref={filterInput} value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a view or question…" aria-label="Find an Atlas view"/>
            <kbd>1–9 quick switch</kbd>
          </div>

          <nav className={styles.categories} aria-label="View categories">
            <button type="button" aria-pressed={category === "all"} onClick={() => setCategory("all")}>All</button>
            {ATLAS_VIEW_CATEGORIES.map((item) => <button key={item.id} type="button"
              aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}
          </nav>

          {!normalizedQuery && category === "all" && recentViewIds.length > 0 && <section className={styles.recent} aria-labelledby="atlas-recent-views">
            <h3 id="atlas-recent-views">Recent</h3><div>{recentViewIds.map((id) => <button key={id} type="button" onClick={() => choose(id)}>{atlasViewName(id)}</button>)}</div>
          </section>}

          <div className={styles.choices}>
            {filteredViews.map((item) => {
              const view = ATLAS_VIEW_PRESET_BY_ID.get(item.id);
              if (!view) return null;
              const categoryName = ATLAS_VIEW_CATEGORIES.find((candidate) => candidate.id === item.categoryId)?.name;
              return <button key={item.id} type="button" aria-label={view.name}
                aria-pressed={activeViewId === item.id} onClick={() => choose(item.id)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon}/></svg>
                <span><small>{categoryName}</small><strong>{view.name}</strong><p>{item.summary}</p></span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
                {item.id === activeViewId && <i aria-hidden="true">✓</i>}
              </button>;
            })}
            {filteredViews.length === 0 && <p className={styles.empty}>No view matches “{query}”.</p>}
          </div>

          {relatedViews.length > 0 && !normalizedQuery && <footer><span>Related to {active.name}</span>
            {relatedViews.map((related) => <button key={related.id} type="button" onClick={() => choose(related.id)}>{related.name}</button>)}</footer>}
        </div>
      </dialog>
    </div>
  );
}
