"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AtlasNode, AtlasStage } from "@/lib/atlas-lab/types";
import styles from "./AtlasLab.module.css";

interface AtlasSearchPaletteProps {
  nodes: AtlasNode[];
  stages: AtlasStage[];
  onClose: (restoreFocus: boolean) => void;
  onSelect: (nodeId: string) => void;
}

interface RankedNode {
  node: AtlasNode;
  rank: number;
}

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

function rankNode(node: AtlasNode, stage: AtlasStage | undefined, query: string) {
  const title = normalizeSearchValue(node.title);
  const aliases = (node.aliases ?? []).map(normalizeSearchValue);
  const tags = (node.tags ?? []).map(normalizeSearchValue);
  const stageText = normalizeSearchValue(`${stage?.title ?? ""} ${stage?.id ?? ""}`);

  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (aliases.some((alias) => alias.startsWith(query))) return 2;
  if (title.includes(query)) return 3;
  if (aliases.some((alias) => alias.includes(query))) return 4;
  if (stageText.includes(query)) return 5;
  if (tags.some((tag) => tag.includes(query))) return 6;
  return Number.POSITIVE_INFINITY;
}

export function AtlasSearchPalette({
  nodes,
  stages,
  onClose,
  onSelect,
}: AtlasSearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stageById = useMemo(
    () => new Map(stages.map((stage) => [stage.id, stage])),
    [stages],
  );

  const results = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(query);

    if (!normalizedQuery) {
      return nodes
        .filter((node) => node.kind === "stage")
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .slice(0, 8);
    }

    return nodes
      .map<RankedNode>((node) => ({
        node,
        rank: rankNode(node, stageById.get(node.stageId), normalizedQuery),
      }))
      .filter((result) => Number.isFinite(result.rank))
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          left.node.displayOrder - right.node.displayOrder ||
          left.node.title.localeCompare(right.node.title),
      )
      .slice(0, 9)
      .map((result) => result.node);
  }, [nodes, query, stageById]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function chooseResult(index: number) {
    const result = results[index];
    if (result) onSelect(result.id);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (results.length ? (current + 1) % results.length : 0));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        results.length ? (current - 1 + results.length) % results.length : 0,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      chooseResult(activeIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    }
  }

  function handlePanelKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panelRef.current) return;

    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );

    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={styles.searchScrim}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose(true);
      }}
    >
      <div
        className={styles.searchPanel}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-search-title"
        onKeyDown={handlePanelKeyDown}
      >
        <div className={styles.searchHeading}>
          <div>
            <p className={styles.interfaceEyebrow}>Find a place in formation</p>
            <h2 id="atlas-search-title">Search the Atlas</h2>
          </div>
          <button className={styles.searchClose} type="button" onClick={() => onClose(true)}>
            Close <kbd>Esc</kbd>
          </button>
        </div>

        <label className={styles.searchInputWrap}>
          <span className={styles.visuallyHidden}>Search nodes, aliases, stages, and tags</span>
          <span className={styles.searchGlyph} aria-hidden="true">
            /
          </span>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            value={query}
            placeholder="Try “plate tectonics”, “writing”, or “neurons”"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls="atlas-search-results"
            aria-describedby="atlas-search-status"
            aria-expanded="true"
            aria-activedescendant={
              results[activeIndex] ? `atlas-search-result-${results[activeIndex].id}` : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
        </label>

        <div className={styles.searchStatus} id="atlas-search-status" aria-live="polite">
          {query
            ? `${results.length} ${results.length === 1 ? "result" : "results"}`
            : "Landmark stages"}
        </div>

        <ul
          className={styles.searchResults}
          id="atlas-search-results"
          role="listbox"
          aria-label="Atlas search results"
        >
          {results.map((node, index) => {
            const stage = stageById.get(node.stageId);
            return (
              <li key={node.id}>
                <button
                  className={styles.searchResult}
                  data-highlighted={index === activeIndex}
                  id={`atlas-search-result-${node.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  type="button"
                  onClick={() => chooseResult(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className={styles.searchResultIndex}>
                    {String(stage?.order ?? 0).padStart(2, "0")}
                  </span>
                  <span className={styles.searchResultCopy}>
                    <strong>{node.title}</strong>
                    <small>{stage?.title}</small>
                  </span>
                  <span className={styles.searchResultKind}>{node.kind.replaceAll("_", " ")}</span>
                  <span className={styles.searchResultArrow} aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {!results.length && (
          <p className={styles.searchEmpty}>
            No matching node yet. Try a broader structure, process, person, or stage.
          </p>
        )}

        <div className={styles.searchFooter} aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
