"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ATLAS_GLOSSARY,
  ATLAS_GLOSSARY_GROUPS,
  type AtlasGlossaryGroup,
  type AtlasGlossaryTerm,
} from "@/lib/atlas-world/glossary";
import styles from "./AtlasIndex.module.css";

function searchableText(entry: AtlasGlossaryTerm) {
  return [
    entry.id,
    entry.label,
    entry.group,
    ...entry.aliases,
    entry.definition,
    entry.example ?? "",
    entry.inAtlas,
    entry.caveat,
  ].join(" ").toLocaleLowerCase("en");
}

function matches(entry: AtlasGlossaryTerm, query: string) {
  const words = query.trim().toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = searchableText(entry);
  return words.every((word) => haystack.includes(word));
}

const groupOrder = new Map(ATLAS_GLOSSARY_GROUPS.map((group, index) => [group.name, index]));
const termById = new Map(ATLAS_GLOSSARY.map((term) => [term.id, term]));

export default function AtlasIndex() {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<AtlasGlossaryGroup | null>(null);
  const results = useMemo(() => [...ATLAS_GLOSSARY]
    .filter((entry) => (!group || entry.group === group) && matches(entry, query))
    .sort((left, right) => {
      const byGroup = (groupOrder.get(left.group) ?? 99) - (groupOrder.get(right.group) ?? 99);
      return byGroup || left.label.localeCompare(right.label, "en");
    }), [group, query]);

  function revealRelated(termId: string) {
    setGroup(null);
    setQuery("");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(termId)?.scrollIntoView({ block: "start" });
      window.history.replaceState(null, "", `#${termId}`);
    }));
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Atlas Index</p>
          <h1>The language behind the map.</h1>
          <p className={styles.intro}>
            Plain definitions, the exact way Atlas handles each idea, and the limits you should keep in mind.
          </p>
        </div>
        <Link className={styles.mapLink} href="/atlas">Back to the map <span aria-hidden="true">→</span></Link>
      </header>

      <section className={styles.finder} aria-labelledby="atlas-index-find">
        <label className={styles.search}>
          <span id="atlas-index-find">Find a concept</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try watershed, PPP, sovereignty, or fertility"
            autoComplete="off"
          />
        </label>
        <div className={styles.groupRail} role="group" aria-label="Filter concepts by subject">
          <button type="button" aria-pressed={group === null} onClick={() => setGroup(null)}>All</button>
          {ATLAS_GLOSSARY_GROUPS.map((entry) => (
            <button
              type="button"
              key={entry.name}
              aria-pressed={group === entry.name}
              onClick={() => setGroup((current) => current === entry.name ? null : entry.name)}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </section>

      <div className={styles.resultLine} aria-live="polite" aria-atomic="true">
        <strong>{results.length}</strong> {results.length === 1 ? "concept" : "concepts"}
        {group ? ` in ${group}` : ""}{query.trim() ? ` matching “${query.trim()}”` : ""}
      </div>

      {results.length > 0 ? (
        <div className={styles.results}>
          {results.map((entry) => (
            <article className={styles.card} id={entry.id} key={entry.id}>
              <div className={styles.cardHeading}>
                <p>{entry.group}</p>
                <h2><a href={`#${entry.id}`}>{entry.label}</a></h2>
              </div>
              <p className={styles.definition}>{entry.definition}</p>
              {entry.example && <p className={styles.example}><span>For example</span>{entry.example}</p>}
              <details className={styles.method}>
                <summary>How Atlas handles this</summary>
                <div>
                  <p>{entry.inAtlas}</p>
                  <p className={styles.caveat}><strong>Keep in mind:</strong> {entry.caveat}</p>
                  {entry.relatedTerms.length > 0 && (
                    <nav className={styles.related} aria-label={`Concepts related to ${entry.label}`}>
                      <h3>Related concepts</h3>
                      <div>
                        {entry.relatedTerms.map((termId) => {
                          const related = termById.get(termId);
                          return related ? <button type="button" key={termId} onClick={() => revealRelated(termId)}>{related.label}</button> : null;
                        })}
                      </div>
                    </nav>
                  )}
                  <section className={styles.sources} aria-label={`Sources for ${entry.label}`}>
                    <h3>Sources</h3>
                    <ul>
                      {entry.sources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            <strong>{source.title}</strong>
                            <span>{source.publisher} ↗</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                    <small>Index explanation reviewed {entry.reviewedAt}. Country observations keep their own dates.</small>
                  </section>
                </div>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty} role="status">
          <h2>No exact match.</h2>
          <p>Try fewer words, or clear the subject filter.</p>
          <button type="button" onClick={() => { setQuery(""); setGroup(null); }}>Show every concept</button>
        </div>
      )}
    </div>
  );
}
