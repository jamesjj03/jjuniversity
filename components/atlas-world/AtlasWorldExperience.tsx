"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import {
  ATLAS_MAP_MODE_BY_ID,
  ATLAS_MAP_MODES,
  isAtlasMapModeId,
  type AtlasMapModeId,
} from "@/lib/atlas-world/mapModes";
import type {
  AtlasClientDataset,
  AtlasRuntimeCountry,
  AtlasRuntimeCountrySummary,
  AtlasRuntimeFeatureMeta,
} from "@/lib/atlas-world/runtime";
import AtlasCountryPanel from "./AtlasCountryPanel";
import styles from "./AtlasWorld.module.css";

type AtlasWorldExperienceProps = {
  data: AtlasClientDataset;
  map: ReactNode;
};

type TooltipState = {
  countryId: string;
  x: number;
  y: number;
};

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 650;
const SEARCH_LIMIT = 8;

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .trim();
}

function searchScore(country: AtlasRuntimeCountrySummary, rawQuery: string) {
  const query = normalized(rawQuery);
  const name = normalized(country.name);
  const officialName = normalized(country.officialName ?? "");
  const aliases = country.aliases.map(normalized);
  const codes = [country.codes.iso2, country.codes.iso3, country.codes.naturalEarth]
    .filter((value): value is string => Boolean(value))
    .map(normalized);

  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (codes.includes(query)) return 2;
  if (aliases.some((alias) => alias.startsWith(query)) || officialName.startsWith(query)) return 3;
  if (name.includes(query)) return 4;
  if (aliases.some((alias) => alias.includes(query)) || officialName.includes(query)) return 5;
  return Number.POSITIVE_INFINITY;
}

function countryUrlKey(country: AtlasRuntimeCountrySummary) {
  return (country.codes.iso3 ?? country.codes.naturalEarth).toLocaleLowerCase("en-US");
}

function updateUrl(country: AtlasRuntimeCountrySummary | null, modeId: AtlasMapModeId, push: boolean) {
  const url = new URL(window.location.href);
  if (country) url.searchParams.set("country", countryUrlKey(country));
  else url.searchParams.delete("country");
  if (modeId === "political") url.searchParams.delete("mode");
  else url.searchParams.set("mode", modeId);
  window.history[push ? "pushState" : "replaceState"]({}, "", url);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function AtlasWorldExperience({ data, map }: AtlasWorldExperienceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const suppressHoverUntilMoveRef = useRef(false);
  const detailCacheRef = useRef(new Map<string, AtlasRuntimeCountry>());
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [modeId, setModeId] = useState<AtlasMapModeId>("political");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AtlasRuntimeCountry | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailRetry, setDetailRetry] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);

  const countryById = useMemo(
    () => new Map(data.countries.map((country) => [country.id, country])),
    [data.countries],
  );
  const featureById = useMemo(
    () => new Map(data.geometry.features.map((feature) => [feature.entityId, feature])),
    [data.geometry.features],
  );
  const mode = ATLAS_MAP_MODE_BY_ID.get(modeId) ?? ATLAS_MAP_MODES[0];
  const selectedCountry = selectedId ? countryById.get(selectedId) ?? null : null;
  const tooltipCountry = tooltip ? countryById.get(tooltip.countryId) ?? null : null;
  const tooltipFeature = tooltip ? featureById.get(tooltip.countryId) ?? null : null;

  const searchResults = useMemo(() => {
    if (normalized(deferredQuery).length === 0) return [];
    return data.countries
      .map((country) => ({ country, score: searchScore(country, deferredQuery) }))
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name))
      .slice(0, SEARCH_LIMIT)
      .map((result) => result.country);
  }, [data.countries, deferredQuery]);

  const legendCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let missing = 0;
    for (const feature of data.geometry.features) {
      const country = countryById.get(feature.entityId);
      if (!country) continue;
      const value = mode.resolve({ country, mapColor7: feature.mapColor7 });
      if (!value) missing += 1;
      else counts.set(value.key, (counts.get(value.key) ?? 0) + 1);
    }
    return { counts, missing };
  }, [countryById, data.geometry.features, mode]);

  const toggleHoverVisual = useCallback((countryId: string | null, active: boolean) => {
    if (!countryId) return;
    mapHostRef.current?.querySelectorAll<SVGElement>("[data-atlas-visual]").forEach((visual) => {
      if (visual.dataset.atlasVisual !== countryId) return;
      const isMarker = visual.tagName.toLocaleLowerCase() === "circle";
      visual.classList.toggle(isMarker ? styles.hoveredMarker : styles.hoveredShape, active);
    });
  }, []);

  const clearMapHover = useCallback(() => {
    toggleHoverVisual(hoveredIdRef.current, false);
    hoveredIdRef.current = null;
    setTooltip(null);
  }, [toggleHoverVisual]);

  const focusFeature = useCallback((feature: AtlasRuntimeFeatureMeta) => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const behavior = zoomBehaviorRef.current;
    if (!svg || !behavior) return;
    const [[x0, y0], [x1, y1]] = feature.bounds;
    const dx = Math.max(4, x1 - x0);
    const dy = Math.max(4, y1 - y0);
    const scale = clamp(0.38 / Math.max(dx / VIEWBOX_WIDTH, dy / VIEWBOX_HEIGHT), 1.45, 7);
    const centerX = (x0 + x1) / 2;
    const centerY = (y0 + y1) / 2;
    const isMobileSheet = window.matchMedia("(max-width: 760px)").matches;
    const targetX = isMobileSheet ? VIEWBOX_WIDTH / 2 : 445;
    let targetY = VIEWBOX_HEIGHT / 2;

    if (isMobileSheet) {
      const svgRect = svg.getBoundingClientRect();
      const toolbarRect = rootRef.current
        ?.querySelector<HTMLElement>(`.${styles.atlasToolbar}`)
        ?.getBoundingClientRect();
      const panelRect = rootRef.current
        ?.querySelector<HTMLElement>(`.${styles.countryPanel}`)
        ?.getBoundingClientRect();
      const renderedScale = Math.min(
        svgRect.width / VIEWBOX_WIDTH,
        svgRect.height / VIEWBOX_HEIGHT,
      );
      const letterboxTop = (svgRect.height - VIEWBOX_HEIGHT * renderedScale) / 2;
      const toolbarBottom = toolbarRect ? toolbarRect.bottom - svgRect.top : 112;
      const panelTop = panelRect ? panelRect.top - svgRect.top : svgRect.height * 0.44;
      const visibleMapCenter = (toolbarBottom + panelTop) / 2;
      targetY = (visibleMapCenter - letterboxTop) / renderedScale;
    }
    const transform = zoomIdentity
      .translate(targetX - scale * centerX, targetY - scale * centerY)
      .scale(scale);
    select(svg).call(behavior.transform, transform);
  }, []);

  const selectCountry = useCallback((country: AtlasRuntimeCountrySummary, shouldFocus: boolean, push = true) => {
    clearMapHover();
    suppressHoverUntilMoveRef.current = true;
    setSelectedId(country.id);
    setSelectedDetail(detailCacheRef.current.get(country.id) ?? null);
    setDetailStatus(detailCacheRef.current.has(country.id) ? "ready" : "loading");
    setTooltip(null);
    setQuery(country.name);
    setSearchOpen(false);
    updateUrl(country, modeId, push);
    if (shouldFocus) {
      const feature = featureById.get(country.id);
      if (feature) window.requestAnimationFrame(() => focusFeature(feature));
    }
  }, [clearMapHover, featureById, focusFeature, modeId]);

  const closeCountry = useCallback((push = true) => {
    clearMapHover();
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailStatus("idle");
    setTooltip(null);
    setQuery("");
    updateUrl(null, modeId, push);
  }, [clearMapHover, modeId]);

  const chooseMode = useCallback((nextModeId: AtlasMapModeId) => {
    setModeId(nextModeId);
    setTooltip(null);
    updateUrl(selectedCountry, nextModeId, false);
  }, [selectedCountry]);

  useEffect(() => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const group = svg?.querySelector<SVGGElement>("[data-atlas-map-group]") ?? null;
    if (!svg || !group) return;

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .translateExtent([[-220, -100], [VIEWBOX_WIDTH + 220, VIEWBOX_HEIGHT + 100]])
      .extent([[0, 0], [VIEWBOX_WIDTH, VIEWBOX_HEIGHT]])
      .on("zoom", (event) => {
        group.setAttribute("transform", event.transform.toString());
      });

    const selection = select(svg);
    selection.call(behavior).on("dblclick.zoom", null);
    zoomBehaviorRef.current = behavior;

    return () => {
      selection.on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    host.querySelectorAll<SVGElement>("[data-atlas-visual]").forEach((visual) => {
      const countryId = visual.dataset.atlasVisual;
      if (!countryId) return;
      const country = countryById.get(countryId);
      const feature = featureById.get(countryId);
      if (!country || !feature) return;
      visual.style.fill = mode.color({ country, mapColor7: feature.mapColor7 });
      const selected = countryId === selectedId;
      const isMarker = visual.tagName.toLocaleLowerCase() === "circle";
      visual.classList.toggle(styles.selectedShape, selected && !isMarker);
      visual.classList.toggle(styles.selectedMarker, selected && isMarker);
    });
  }, [countryById, featureById, mode, selectedId]);

  useEffect(() => {
    if (!selectedCountry) return;
    const cached = detailCacheRef.current.get(selectedCountry.id);
    if (cached) {
      setSelectedDetail(cached);
      setDetailStatus("ready");
      return;
    }

    const controller = new AbortController();
    setDetailStatus("loading");
    fetch(`/api/atlas/countries/${encodeURIComponent(selectedCountry.slug)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Country details returned ${response.status}.`);
        return response.json() as Promise<AtlasRuntimeCountry>;
      })
      .then((country) => {
        if (country.id !== selectedCountry.id) throw new Error("Country detail response did not match selection.");
        detailCacheRef.current.set(country.id, country);
        setSelectedDetail(country);
        setDetailStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDetailStatus("error");
      });

    return () => controller.abort();
  }, [detailRetry, selectedCountry]);

  useEffect(() => {
    const restoreFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedMode = params.get("mode");
      const nextMode = isAtlasMapModeId(requestedMode) ? requestedMode : "political";
      const requestedCountry = normalized(params.get("country") ?? "");
      const nextCountry = requestedCountry
        ? data.countries.find((country) => {
            const keys = [country.codes.iso3, country.codes.naturalEarth, country.codes.iso2, country.slug]
              .filter((value): value is string => Boolean(value))
              .map(normalized);
            return keys.includes(requestedCountry);
          }) ?? null
        : null;

      setModeId(nextMode);
      setSelectedId(nextCountry?.id ?? null);
      setQuery(nextCountry?.name ?? "");
      if (nextCountry) {
        const feature = featureById.get(nextCountry.id);
        if (feature) window.requestAnimationFrame(() => focusFeature(feature));
      }
    };

    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, [data.countries, featureById, focusFeature]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (selectedId) closeCountry();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCountry, searchOpen, selectedId]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!searchOpen || searchResults.length === 0) {
      if (event.key === "ArrowDown" && searchResults.length > 0) {
        event.preventDefault();
        setSearchOpen(true);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult((current) => (current + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult((current) => (current - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectCountry(searchResults[activeResult] ?? searchResults[0], true);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setSearchOpen(false);
    }
  };

  const pointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return { x: 8, y: 92 };
    const bounds = root.getBoundingClientRect();
    return {
      x: clamp(event.clientX - bounds.left + 14, 8, Math.max(8, bounds.width - 244)),
      y: clamp(event.clientY - bounds.top + 14, 92, Math.max(92, bounds.height - 150)),
    };
  };

  const countryIdFromTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    return target.closest<SVGElement>("[data-atlas-country]")?.dataset.atlasCountry ?? null;
  };

  const handleMapPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (suppressHoverUntilMoveRef.current) return;
    const countryId = countryIdFromTarget(event.target);
    if (!countryId || countryId === hoveredIdRef.current) return;
    toggleHoverVisual(hoveredIdRef.current, false);
    hoveredIdRef.current = countryId;
    toggleHoverVisual(countryId, true);
    setTooltip({ countryId, ...pointerPosition(event) });
  };

  const handleMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (suppressHoverUntilMoveRef.current) {
      suppressHoverUntilMoveRef.current = false;
      const countryId = countryIdFromTarget(event.target);
      if (countryId) {
        hoveredIdRef.current = countryId;
        toggleHoverVisual(countryId, true);
        setTooltip({ countryId, ...pointerPosition(event) });
      }
      return;
    }
    if (!hoveredIdRef.current || !tooltipRef.current) return;
    const position = pointerPosition(event);
    tooltipRef.current.style.left = `${position.x}px`;
    tooltipRef.current.style.top = `${position.y}px`;
  };

  const mapControl = (action: "in" | "out" | "reset") => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const behavior = zoomBehaviorRef.current;
    if (!svg || !behavior) return;
    const selection = select(svg);
    if (action === "reset") selection.call(behavior.transform, zoomIdentity);
    else selection.call(behavior.scaleBy, action === "in" ? 1.45 : 1 / 1.45);
  };

  const modeSources = data.sources.filter((source) => mode.sourceIds.includes(source.id));
  const tooltipModeValue = tooltipCountry && tooltipFeature
    ? mode.resolve({ country: tooltipCountry, mapColor7: tooltipFeature.mapColor7 })
    : null;

  return (
    <div className={`${styles.atlas} ${selectedCountry ? styles.panelOpen : ""}`} ref={rootRef}>
      <div className={styles.mapBackdrop} aria-hidden="true" />

      <header className={styles.atlasToolbar}>
        <div className={styles.atlasTitle}>
          <span className={styles.compassMark} aria-hidden="true">✦</span>
          <div>
            <h1>ATLAS</h1>
            <span>Explore the world</span>
          </div>
        </div>

        <div
          className={styles.search}
          ref={searchRef}
          onBlur={(event) => {
            if (!searchRef.current?.contains(event.relatedTarget)) setSearchOpen(false);
          }}
        >
          <span className={styles.searchIcon} aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            placeholder="Search countries…"
            aria-label="Search countries"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchOpen && searchResults.length > 0}
            aria-controls="atlas-country-results"
            aria-activedescendant={searchOpen && searchResults[activeResult] ? `atlas-result-${searchResults[activeResult].id}` : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
              setActiveResult(0);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={handleSearchKeyDown}
          />
          {query && (
            <button
              type="button"
              className={styles.clearSearch}
              aria-label="Clear country search"
              onClick={() => {
                setQuery("");
                setSearchOpen(true);
              }}
            >×</button>
          )}
          {searchOpen && searchResults.length > 0 && (
            <ul className={styles.searchResults} id="atlas-country-results" role="listbox">
              {searchResults.map((country, index) => (
                <li
                  key={country.id}
                  id={`atlas-result-${country.id}`}
                  role="option"
                  aria-selected={index === activeResult}
                  className={index === activeResult ? styles.activeResult : ""}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveResult(index)}
                  onClick={() => selectCountry(country, true)}
                >
                  <span>{country.name}</span>
                  <small>{country.facts.capital?.value ?? country.geography.region}</small>
                </li>
              ))}
            </ul>
          )}
          {searchOpen && normalized(query) && searchResults.length === 0 && (
            <div className={styles.noResults}>No country found</div>
          )}
        </div>

        <div className={styles.modeSwitcher} role="group" aria-label="Map mode">
          {ATLAS_MAP_MODES.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={candidate.id === modeId ? styles.activeMode : ""}
              aria-pressed={candidate.id === modeId}
              onClick={() => chooseMode(candidate.id)}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      </header>

      <div
        className={styles.mapStage}
        ref={mapHostRef}
        role="img"
        aria-label={`Interactive world map in ${mode.name} mode. Use country search to explore with a keyboard.`}
        onPointerOver={handleMapPointerOver}
        onPointerMove={handleMapPointerMove}
        onPointerOut={(event) => {
          const nextCountryId = countryIdFromTarget(event.relatedTarget);
          if (nextCountryId !== hoveredIdRef.current) clearMapHover();
        }}
        onPointerLeave={clearMapHover}
        onClick={(event) => {
          const countryId = countryIdFromTarget(event.target);
          const country = countryId ? countryById.get(countryId) : null;
          if (country) selectCountry(country, true);
        }}
      >
        {map}
      </div>

      {tooltip && tooltipCountry && (
        <div ref={tooltipRef} className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }} role="status">
          <strong>{tooltipCountry.name}</strong>
          <span>Capital: {tooltipCountry.facts.capital?.value ?? "Not available"}</span>
          <span>
            Population: {tooltipCountry.facts.population
              ? compactFormatter.format(tooltipCountry.facts.population.value)
              : "Not available"}
          </span>
          {modeId === "political" && tooltipCountry.facts.government && (
            <span>{tooltipCountry.facts.government.value.raw}</span>
          )}
          {modeId !== "political" && (
            <em>{mode.name}: {tooltipModeValue?.tooltip ?? mode.missingData.label}</em>
          )}
        </div>
      )}

      <aside className={styles.legend} aria-label={`${mode.name} map legend`}>
        <div className={styles.legendHeader}>
          <div>
            <span>Map mode</span>
            <strong>{mode.name}</strong>
          </div>
          <details className={styles.sourcePopover}>
            <summary>Sources</summary>
            <div>
              {modeSources.map((source) => (
                <p key={source.id}>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.publisher}</a>
                  <small>{source.title}</small>
                </p>
              ))}
              <span>Snapshot {data.generatedAt.slice(0, 10)}</span>
            </div>
          </details>
        </div>
        <p className={styles.legendDescription}>{mode.description}</p>
        {modeId === "political" ? (
          <div className={styles.politicalLegend}>
            {mode.legend.map((item) => <span key={item.key} style={{ backgroundColor: item.color }} />)}
            <small>Colors separate neighboring places</small>
          </div>
        ) : (
          <ul className={styles.legendItems} tabIndex={0} aria-label={`${mode.name} legend categories`}>
            {mode.legend
              .filter((item) => (legendCounts.counts.get(item.key) ?? 0) > 0)
              .map((item) => (
                <li key={item.key}>
                  <i style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                  <small>{legendCounts.counts.get(item.key)}</small>
                </li>
              ))}
            {legendCounts.missing > 0 && (
              <li>
                <i style={{ backgroundColor: mode.missingData.color }} />
                <span>{mode.missingData.label}</span>
                <small>{legendCounts.missing}</small>
              </li>
            )}
          </ul>
        )}
      </aside>

      <div className={styles.mapControls} role="group" aria-label="Map controls">
        <button type="button" onClick={() => mapControl("in")} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => mapControl("out")} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => mapControl("reset")} aria-label="Reset world view" className={styles.resetControl}>⌂</button>
      </div>

      <div className={styles.interactionHint}>Drag to move · scroll or pinch to zoom · click a country</div>

      {selectedCountry && selectedDetail?.id === selectedCountry.id && detailStatus === "ready" && (
        <AtlasCountryPanel country={selectedDetail} sources={data.sources} onClose={() => closeCountry()} />
      )}

      {selectedCountry && (detailStatus === "loading" || detailStatus === "error") && (
        <aside className={`${styles.countryPanel} ${styles.loadingPanel}`} aria-labelledby="atlas-country-loading-title">
          <div className={styles.sheetHandle} aria-hidden="true" />
          <button className={styles.panelClose} type="button" onClick={() => closeCountry()} aria-label={`Close ${selectedCountry.name}`}>
            <span aria-hidden="true">×</span>
          </button>
          <p>{selectedCountry.geography.region}</p>
          <h2 id="atlas-country-loading-title">{selectedCountry.name}</h2>
          {detailStatus === "loading" ? (
            <span className={styles.detailLoading}>Loading sourced country details…</span>
          ) : (
            <div className={styles.detailError}>
              <span>Country details could not load.</span>
              <button type="button" onClick={() => setDetailRetry((attempt) => attempt + 1)}>Try again</button>
            </div>
          )}
        </aside>
      )}

      <p className={styles.srStatus} aria-live="polite">
        {selectedCountry ? `${selectedCountry.name} selected. ` : ""}{mode.name} map mode.
      </p>
    </div>
  );
}
