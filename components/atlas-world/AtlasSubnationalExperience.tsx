"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";

import type { AtlasAdmin1PilotFeature, AtlasAdmin1PilotSnapshot } from "@/lib/atlas-world/admin1Pilot";
import type { AtlasRuntimeFact } from "@/lib/atlas-world/runtime";
import styles from "./AtlasSubnationalExperience.module.css";

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 650;
const PILOT_CODES = ["USA", "DEU", "IND", "CHN", "CAN", "NGA"];
const number = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export type AtlasSubnationalCountry = {
  id: string;
  code: string;
  name: string;
  bounds: [[number, number], [number, number]];
  facts: {
    capital: AtlasRuntimeFact<string> | null;
    population: AtlasRuntimeFact<number> | null;
    gdpPerCapitaCurrentUsd: AtlasRuntimeFact<number> | null;
    urbanPopulationPercent: AtlasRuntimeFact<number> | null;
    lifeExpectancyYears: AtlasRuntimeFact<number> | null;
    government: AtlasRuntimeFact<{ raw: string }> | null;
  };
};

type Props = {
  snapshot: AtlasAdmin1PilotSnapshot;
  countries: AtlasSubnationalCountry[];
  allCountryIds: string[];
  initialFocusId: string | null;
  initialCountryCode: string;
};

function assetId(entityId: string) {
  return `atlas-${entityId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function isoCode(feature: AtlasAdmin1PilotFeature) {
  return feature.entity.codes.find((code) => code.scheme === "iso-3166-2")?.value ?? "Code unavailable";
}

function matches(feature: AtlasAdmin1PilotFeature, query: string) {
  const haystack = [feature.name, ...feature.aliases, ...feature.entity.codes.map((code) => code.value)]
    .join(" ").toLocaleLowerCase("en-US");
  return haystack.includes(query.trim().toLocaleLowerCase("en-US"));
}

function factLine(label: string, fact: AtlasRuntimeFact<unknown> | null, value: string) {
  return { label, value: fact ? value : "Not available", year: fact?.observedAt, sourceId: fact?.sourceId };
}

export default function AtlasSubnationalExperience({
  snapshot,
  countries,
  allCountryIds,
  initialFocusId,
  initialCountryCode,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [focusId, setFocusId] = useState(initialFocusId);
  const [countryCode, setCountryCode] = useState(initialCountryCode);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const searchListboxId = useId();
  const searchInstructionsId = useId();
  const searchStatusId = useId();

  const countryById = useMemo(() => new Map(countries.map((country) => [country.id, country])), [countries]);
  const featureById = useMemo(() => new Map(snapshot.features.map((feature) => [feature.entity.entityId, feature])), [snapshot.features]);
  const selected = focusId ? featureById.get(focusId) ?? null : null;
  const results = useMemo(() => {
    if (!query.trim()) return [];
    return snapshot.features.filter((feature) => matches(feature, query));
  }, [query, snapshot.features]);
  const activeResultIndex = activeResultId
    ? results.findIndex((feature) => feature.entity.entityId === activeResultId)
    : -1;
  const activeResult = activeResultIndex >= 0 ? results[activeResultIndex] : null;
  const showResults = searchOpen && Boolean(query.trim());
  const resultDomId = (feature: AtlasAdmin1PilotFeature) =>
    `${searchListboxId}-${feature.entity.entityId.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  const focusBounds = useCallback((bounds: [[number, number], [number, number]], minimumScale = 1.7) => {
    const svg = svgRef.current;
    const behavior = zoomRef.current;
    if (!svg || !behavior) return;
    const [[x0, y0], [x1, y1]] = bounds;
    const width = Math.max(4, x1 - x0);
    const height = Math.max(4, y1 - y0);
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const targetX = mobile ? VIEWBOX_WIDTH / 2 : 470;
    const targetY = mobile ? 235 : VIEWBOX_HEIGHT / 2;
    const scale = Math.min(64, Math.max(minimumScale, Math.min(780 / width, 500 / height) * 0.78));
    select(svg).call(
      behavior.transform,
      zoomIdentity.translate(targetX - scale * (x0 + x1) / 2, targetY - scale * (y0 + y1) / 2).scale(scale),
    );
  }, []);

  const writeUrl = useCallback((nextFocus: string | null, nextCountry: string, push = true) => {
    const url = new URL(window.location.href);
    if (nextFocus) url.searchParams.set("focus", nextFocus);
    else url.searchParams.delete("focus");
    url.searchParams.set("country", nextCountry.toLocaleLowerCase("en-US"));
    window.history[push ? "pushState" : "replaceState"]({}, "", url);
  }, []);

  const selectFeature = useCallback((feature: AtlasAdmin1PilotFeature, push = true) => {
    const nextCountry = feature.entity.countryId.slice("country:".length);
    setFocusId(feature.entity.entityId);
    setCountryCode(nextCountry);
    setQuery(feature.name);
    setSearchOpen(false);
    setActiveResultId(null);
    writeUrl(feature.entity.entityId, nextCountry, push);
    focusBounds(feature.geometry.derived.bounds, 8);
  }, [focusBounds, writeUrl]);

  const selectCountry = useCallback((code: string, push = true) => {
    const country = countryById.get(`country:${code}`);
    if (!country) return;
    setCountryCode(code);
    setFocusId(null);
    setQuery("");
    setSearchOpen(false);
    setActiveResultId(null);
    writeUrl(null, code, push);
    focusBounds(country.bounds, 2.1);
  }, [countryById, focusBounds, writeUrl]);

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!results.length) return;
      event.preventDefault();
      setSearchOpen(true);
      const currentIndex = activeResultId
        ? results.findIndex((feature) => feature.entity.entityId === activeResultId)
        : -1;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? (direction > 0 ? 0 : results.length - 1)
        : (currentIndex + direction + results.length) % results.length;
      setActiveResultId(results[nextIndex].entity.entityId);
      return;
    }
    if (event.key === "Enter" && showResults && activeResult) {
      event.preventDefault();
      selectFeature(activeResult);
      return;
    }
    if (event.key === "Escape" && searchOpen) {
      event.preventDefault();
      setSearchOpen(false);
      setActiveResultId(null);
    }
  }, [activeResult, activeResultId, results, searchOpen, selectFeature, showResults]);

  const updateLabels = useCallback((scale: number) => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const matrix = group.getScreenCTM();
    if (!matrix) return;
    const viewport = svg.getBoundingClientRect();
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    const labels = [...svg.querySelectorAll<SVGTextElement>("[data-admin1-label]")].sort((left, right) => {
      const a = left.dataset.admin1Entity === focusId ? -1 : Number(left.dataset.admin1Priority);
      const b = right.dataset.admin1Entity === focusId ? -1 : Number(right.dataset.admin1Priority);
      return a - b;
    });
    labels.forEach((label) => {
      const minimum = Number(label.dataset.admin1Minimum ?? 8);
      const parent = label.dataset.admin1Country;
      const x = Number(label.dataset.admin1X);
      const y = Number(label.dataset.admin1Y);
      const isSelected = label.dataset.admin1Entity === focusId;
      const screenX = matrix.a * x + matrix.c * y + matrix.e;
      const screenY = matrix.b * x + matrix.d * y + matrix.f;
      const width = (label.textContent?.length ?? 0) * 6.4;
      const rectangle = { x: screenX - width / 2, y: screenY - 8, width, height: 16 };
      const overlaps = occupied.some((rect) => rectangle.x < rect.x + rect.width + 5
        && rectangle.x + rectangle.width + 5 > rect.x && rectangle.y < rect.y + rect.height + 3
        && rectangle.y + rectangle.height + 3 > rect.y);
      const visible = parent === `country:${countryCode}` && (isSelected || scale >= minimum)
        && screenX > viewport.left && screenX < viewport.right
        && screenY > viewport.top && screenY < viewport.bottom && (isSelected || !overlaps);
      label.style.display = visible ? "" : "none";
      if (visible) {
        label.setAttribute("transform", `translate(${x} ${y}) scale(${1 / scale})`);
        occupied.push(rectangle);
      }
    });
  }, [countryCode, focusId]);

  useEffect(() => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    let frame = 0;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.65, 64])
      .translateExtent([[120, -100], [1080, 760]])
      .extent([[0, 0], [VIEWBOX_WIDTH, VIEWBOX_HEIGHT]])
      .on("zoom", (event) => {
        group.setAttribute("transform", event.transform.toString());
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => updateLabels(event.transform.k));
      });
    select(svg).call(behavior).on("dblclick.zoom", null);
    zoomRef.current = behavior;
    const initial = selected?.geometry.derived.bounds
      ?? countryById.get(`country:${countryCode}`)?.bounds;
    if (initial) focusBounds(initial, selected ? 8 : 2.1);
    return () => { if (frame) cancelAnimationFrame(frame); select(svg).on(".zoom", null); zoomRef.current = null; };
  }, [countryById, countryCode, focusBounds, selected, updateLabels]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextFocus = params.get("focus");
      const feature = nextFocus ? featureById.get(nextFocus) : null;
      const requested = params.get("country")?.toLocaleUpperCase("en-US");
      const nextCountry = feature?.entity.countryId.slice("country:".length)
        ?? (requested && PILOT_CODES.includes(requested) ? requested : "USA");
      setFocusId(feature?.entity.entityId ?? null);
      setCountryCode(nextCountry);
      setQuery(feature?.name ?? "");
      setSearchOpen(false);
      setActiveResultId(null);
      const nextBounds = feature?.geometry.derived.bounds ?? countryById.get(`country:${nextCountry}`)?.bounds;
      if (nextBounds) focusBounds(nextBounds, feature ? 8 : 2.1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [countryById, featureById, focusBounds]);

  const selectedCountry = selected ? countryById.get(selected.entity.countryId) ?? null : null;
  const inheritedFacts = selectedCountry ? [
    factLine("Population", selectedCountry.facts.population, number.format(selectedCountry.facts.population?.value ?? 0)),
    factLine("GDP per person", selectedCountry.facts.gdpPerCapitaCurrentUsd, money.format(selectedCountry.facts.gdpPerCapitaCurrentUsd?.value ?? 0)),
    factLine("Urban population", selectedCountry.facts.urbanPopulationPercent, `${selectedCountry.facts.urbanPopulationPercent?.value.toFixed(1)}%`),
    factLine("Life expectancy", selectedCountry.facts.lifeExpectancyYears, `${selectedCountry.facts.lifeExpectancyYears?.value.toFixed(1)} years`),
  ] : [];

  return <div ref={rootRef} className={styles.root} data-atlas-subnational>
    <header className={styles.toolbar}>
      <Link href="/atlas" className={styles.back}>← Atlas</Link>
      <div className={styles.title}><strong>Subnational Atlas</strong><span>Bounded pilot · 6 countries</span></div>
      <div className={styles.search}>
        <span id={searchInstructionsId} className={styles.srOnly}>
          All {snapshot.features.length} pilot subdivisions can be found by name, alias, or code. Use the up and down arrow keys to review matches, Enter to select, and Escape to close the results.
        </span>
        <label className={styles.searchBox}>
          <span className={styles.srOnly}>Search subdivisions</span>
          <input value={query} placeholder="Search states, provinces, regions…" role="combobox"
            aria-autocomplete="list" aria-expanded={showResults} aria-controls={searchListboxId}
            aria-activedescendant={showResults && activeResult ? resultDomId(activeResult) : undefined}
            aria-describedby={`${searchInstructionsId} ${searchStatusId}`}
            onFocus={() => setSearchOpen(true)} onKeyDown={handleSearchKeyDown}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setActiveResultId(null); }} />
        </label>
        <div id={searchListboxId} className={styles.results} role="listbox" aria-label="Subdivision matches"
          hidden={!showResults}>
          {results.map((feature) => <button id={resultDomId(feature)} key={feature.entity.entityId}
            type="button" role="option" tabIndex={-1}
            aria-selected={feature.entity.entityId === activeResult?.entity.entityId}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveResultId(feature.entity.entityId)}
            onClick={() => selectFeature(feature)}>
            <strong>{feature.name}</strong>
            <span>{feature.administrativeType ?? "Admin-1 unit"} · {countryById.get(feature.entity.countryId)?.name}</span>
          </button>)}
          {!results.length && <p>No pilot subdivision matches “{query}”.</p>}
        </div>
        <span id={searchStatusId} className={styles.srOnly} role="status">
          {showResults ? `${results.length} ${results.length === 1 ? "match" : "matches"}.` : ""}
        </span>
      </div>
    </header>

    <nav className={styles.countryTabs} aria-label="Pilot countries">
      {countries.map((country) => <button type="button" key={country.code}
        aria-pressed={country.code === countryCode} onClick={() => selectCountry(country.code)}>{country.name}</button>)}
    </nav>

    <section className={styles.mapStage} aria-label="Interactive subdivision map">
      <svg ref={svgRef} viewBox="0 0 1200 650" className={styles.map} role="img"
        aria-label="Map of first-order administrative subdivisions in six pilot countries">
        <defs><clipPath id="admin1-land"><g>{allCountryIds.map((id) => <use key={id}
          href={`/atlas-world/geometry-mercator.v1.svg#${assetId(id)}`} />)}</g></clipPath></defs>
        <g ref={groupRef} data-admin1-map-group>
          <use href="/atlas-world/geometry-mercator.v1.svg#atlas-sphere" className={styles.ocean} />
          <use href="/atlas-world/geometry-mercator.v1.svg#atlas-graticule" className={styles.graticule} />
          <g className={styles.worldCountries}>{allCountryIds.map((id) => <use key={id}
            href={`/atlas-world/geometry-mercator.v1.svg#${assetId(id)}`} data-pilot-country={PILOT_CODES.includes(id.slice(8)) || undefined} />)}</g>
          <image href="/atlas-world/layers/physical-relief.mercator.webp" x="0" y="0" width="1200" height="650"
            clipPath="url(#admin1-land)" className={styles.relief} />
          <g className={styles.adminBoundaries}>{snapshot.features.map((feature) => <use key={feature.featureId}
            href={`${feature.geometry.derived.assetHref}#${feature.geometry.derived.assetId}`} />)}</g>
          <g className={styles.adminHits}>{snapshot.features.map((feature) => <use key={feature.featureId}
            href={`${feature.geometry.derived.assetHref}#${feature.geometry.derived.assetId}`}
            data-admin1-entity={feature.entity.entityId} aria-label={`Select ${feature.name}`}
            className={feature.entity.entityId === focusId ? styles.selected : undefined}
            onClick={(event) => { event.stopPropagation(); selectFeature(feature); }} />)}</g>
          <g className={styles.labels}>{snapshot.features.map((feature) => {
            const [[x0, y0], [x1, y1]] = feature.geometry.derived.bounds;
            return <text key={feature.entity.entityId} data-admin1-label data-admin1-entity={feature.entity.entityId}
              data-admin1-country={feature.entity.countryId} data-admin1-x={feature.label.projected[0]}
              data-admin1-y={feature.label.projected[1]} data-admin1-minimum={feature.labelMinimumZoom}
              data-admin1-priority={-(x1 - x0) * (y1 - y0)} textAnchor="middle" style={{ display: "none" }}>
              {feature.name}
            </text>;
          })}</g>
        </g>
      </svg>
      <div className={styles.zoomControls} aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => svgRef.current && zoomRef.current
          && select(svgRef.current).call(zoomRef.current.scaleBy, 1.65)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => svgRef.current && zoomRef.current
          && select(svgRef.current).call(zoomRef.current.scaleBy, 1 / 1.65)}>−</button>
        <button type="button" aria-label="Fit pilot country" onClick={() => selectCountry(countryCode, false)}>⌂</button>
      </div>
      <p className={styles.mapHint}>Drag to move · scroll or pinch to zoom · select a subdivision</p>
    </section>

    <aside className={styles.panel} aria-label="Subdivision details">
      {selected && selectedCountry ? <>
        <div className={styles.panelIdentity}>
          <span>{selectedCountry.name} / Admin 1</span>
          <button type="button" aria-label="Close subdivision details" onClick={() => selectCountry(countryCode)}>×</button>
          <h1>{selected.name}</h1>
          <p>{selected.administrativeType ?? "First-order administrative unit"} · {isoCode(selected)}</p>
        </div>
        <section className={styles.context}>
          <div><span>Parent place</span><strong>{selectedCountry.name}</strong></div>
          <div><span>Geometry</span><strong>{selected.geometry.geometryType === "multipolygon" ? "Multipart area" : "Area"}</strong></div>
        </section>
        <section className={styles.inherited}>
          <div className={styles.sectionHeading}>
            <div><span>National context</span><h2>Inherited from {selectedCountry.name}</h2></div>
            <b>Country-level</b>
          </div>
          <p>These values describe the parent country. They are context—not measurements of {selected.name}.</p>
          <dl>{inheritedFacts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}
            {fact.year && <small>{fact.year}</small>}</dd></div>)}</dl>
          {selectedCountry.facts.government && <div className={styles.government}><span>Government</span>
            <strong>{selectedCountry.facts.government.value.raw}</strong>
            {selectedCountry.facts.government.observedAt && <small>Parent-country observation · {selectedCountry.facts.government.observedAt}</small>}</div>}
        </section>
        <section className={styles.source}>
          <span>Boundary source</span><strong>{snapshot.source.publisher} · {snapshot.source.version}</strong>
          <p>{snapshot.source.sourcePerspective}. Administrative types are retained source wording, not a new Atlas legal classification.</p>
          <a href={snapshot.source.url} target="_blank" rel="noreferrer">Inspect source ↗</a>
        </section>
      </> : <div className={styles.emptyPanel}>
        <span>Geographic resolution</span><h1>Countries become containers.</h1>
        <p>Select a state, province, territory, Land, municipality, or region inside one of the six pilot countries.</p>
        <div><strong>184</strong><small>first-order units</small></div>
        <p className={styles.scope}>{snapshot.pilot.coverageStatement}</p>
      </div>}
    </aside>
  </div>;
}
