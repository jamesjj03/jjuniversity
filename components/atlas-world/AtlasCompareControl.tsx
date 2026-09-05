"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { AtlasRuntimeCountrySummary } from "@/lib/atlas-world/runtime";
import type { AtlasLayerDataResponse } from "@/lib/atlas-world/layers";
import {
  ATLAS_COMPARISONS,
  ATLAS_COMPARISON_BY_ID,
  atlasComparisonDatumLabel,
  atlasComparisonEndpoint,
  atlasComparisonSideForView,
  atlasComparisonView,
  findAtlasComparisonDatum,
  summarizeAtlasComparison,
  type AtlasComparisonDefinition,
  type AtlasComparisonPoint,
  type AtlasComparisonSide,
} from "@/lib/atlas-world/compare";
import styles from "./AtlasCompareControl.module.css";

type AtlasCompareControlProps = {
  activeViewId: string;
  countries: readonly AtlasRuntimeCountrySummary[];
  selectedCountryId: string | null;
  onChooseView: (viewId: string) => void;
  onChooseCountry: (countryId: string) => void;
  onHoverCountry?: (countryId: string | null) => void;
};

const payloadCache = new Map<string, Promise<AtlasLayerDataResponse>>();

function loadLayerPayload(viewId: string) {
  const endpoint = atlasComparisonEndpoint(viewId);
  if (!endpoint) return Promise.reject(new Error(`No comparable numeric layer for ${viewId}.`));
  let request = payloadCache.get(endpoint);
  if (!request) {
    request = fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Comparison data returned ${response.status}.`);
        return response.json() as Promise<AtlasLayerDataResponse>;
      })
      .catch((error) => {
        payloadCache.delete(endpoint);
        throw error;
      });
    payloadCache.set(endpoint, request);
  }
  return request;
}

function readCompareUrl(): { id: string | null; side: AtlasComparisonSide } {
  if (typeof window === "undefined") return { id: null, side: "a" as AtlasComparisonSide };
  const params = new URLSearchParams(window.location.search);
  const id = params.get("compare");
  const side: AtlasComparisonSide = params.get("compareSide") === "b" ? "b" : "a";
  return { id: id && ATLAS_COMPARISON_BY_ID.has(id) ? id : null, side };
}

function writeCompareUrl(comparisonId: string | null, side: AtlasComparisonSide) {
  const url = new URL(window.location.href);
  if (comparisonId) {
    url.searchParams.set("compare", comparisonId);
    url.searchParams.set("compareSide", side);
  } else {
    url.searchParams.delete("compare");
    url.searchParams.delete("compareSide");
  }
  window.history.replaceState({}, "", url);
}

function observationYear(observedAt: string | null) {
  return observedAt?.slice(0, 4) ?? null;
}

function payloadYearLabel(payload: AtlasLayerDataResponse) {
  const years = [...new Set(payload.values
    .map((datum) => observationYear(datum.observedAt))
    .filter((year): year is string => Boolean(year)))]
    .sort();
  if (years.length === 0) return "Observation year unavailable";
  if (years.length === 1) return years[0];
  return `${years[0]}–${years[years.length - 1]} by country`;
}

function payloadCoverage(payload: AtlasLayerDataResponse) {
  const available = payload.values.filter((datum) => typeof datum.value === "number" && Number.isFinite(datum.value)).length;
  return `${available} of ${payload.coverage.total} Atlas entities`;
}

function SelectedValue({
  label,
  datum,
}: {
  label: string;
  datum: ReturnType<typeof findAtlasComparisonDatum>;
}) {
  return (
    <div className={styles.selectedValue}>
      <span>{label}</span>
      <strong>{atlasComparisonDatumLabel(datum)}</strong>
      {observationYear(datum?.observedAt ?? null) && <small>{observationYear(datum?.observedAt ?? null)}</small>}
    </div>
  );
}

function ScatterPlot({
  summary,
  comparison,
  selectedCountryId,
  onChooseCountry,
  onHoverCountry,
}: {
  summary: ReturnType<typeof summarizeAtlasComparison>;
  comparison: AtlasComparisonDefinition;
  selectedCountryId: string | null;
  onChooseCountry: (countryId: string) => void;
  onHoverCountry?: (countryId: string | null) => void;
}) {
  const captionId = useId();
  const [hoveredCountryId, setHoveredCountryId] = useState<string | null>(null);
  const [focusedCountryId, setFocusedCountryId] = useState<string | null>(null);
  const [rovingCountryId, setRovingCountryId] = useState<string | null>(() =>
    summary.points.some((point) => point.entityId === selectedCountryId)
      ? selectedCountryId
      : summary.points[0]?.entityId ?? null,
  );
  const activeCountryId = focusedCountryId ?? hoveredCountryId;
  const validRovingCountryId = summary.points.some((point) => point.entityId === rovingCountryId)
    ? rovingCountryId
    : summary.points.some((point) => point.entityId === selectedCountryId)
      ? selectedCountryId
      : summary.points[0]?.entityId ?? null;
  const tabbableCountryId = focusedCountryId ?? hoveredCountryId ?? validRovingCountryId;
  const activePoint = summary.points.find((point) => point.entityId === activeCountryId)
    ?? summary.points.find((point) => point.entityId === selectedCountryId)
    ?? null;
  const width = 360;
  const height = 178;
  const inset = { left: 34, right: 12, top: 12, bottom: 31 };

  useEffect(() => {
    onHoverCountry?.(activeCountryId);
    return () => onHoverCountry?.(null);
  }, [activeCountryId, onHoverCountry]);

  const datumLabel = (point: AtlasComparisonPoint, side: AtlasComparisonSide) => {
    const datum = side === "a" ? point.aDatum : point.bDatum;
    const year = observationYear(datum.observedAt);
    return `${atlasComparisonDatumLabel(datum)}${year ? ` (${year})` : ""}`;
  };
  const pointLabel = (point: AtlasComparisonPoint) => [
    point.name,
    `${comparison.a.shortLabel}: ${datumLabel(point, "a")}`,
    `${comparison.b.shortLabel}: ${datumLabel(point, "b")}`,
    "Select to focus this country on the map",
  ].join(". ");
  const axisLabel = (side: AtlasComparisonSide) => {
    const value = comparison[side];
    return value.viewId === "gdp-per-capita" ? `${value.shortLabel} · log scale` : value.shortLabel;
  };
  const moveFocus = (event: ReactKeyboardEvent<SVGGElement>, point: AtlasComparisonPoint) => {
    const currentIndex = summary.points.findIndex((candidate) => candidate.entityId === point.entityId);
    const lastIndex = summary.points.length - 1;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lastIndex;
    if (nextIndex == null) return false;
    event.preventDefault();
    const nextPoint = summary.points[nextIndex];
    if (!nextPoint) return true;
    setRovingCountryId(nextPoint.entityId);
    setFocusedCountryId(nextPoint.entityId);
    event.currentTarget.ownerSVGElement
      ?.querySelector<SVGGElement>(`[data-atlas-comparison-country="${nextPoint.entityId}"]`)
      ?.focus();
    return true;
  };

  return (
    <figure className={styles.scatter} aria-label={`${comparison.name} country scatter plot`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Interactive country scatter plot">
        <title>{summary.sentence}</title>
        <line x1={inset.left} y1={height - inset.bottom} x2={width - inset.right} y2={height - inset.bottom} />
        <line x1={inset.left} y1={inset.top} x2={inset.left} y2={height - inset.bottom} />
        {summary.points.map((point) => {
          const selected = point.entityId === selectedCountryId;
          const x = inset.left + point.x * (width - inset.left - inset.right);
          const y = inset.top + (1 - point.y) * (height - inset.top - inset.bottom);
          const active = point.entityId === activeCountryId;
          return (
            <g
              key={point.entityId}
              className={styles.scatterPoint}
              role="button"
              tabIndex={point.entityId === tabbableCountryId ? 0 : -1}
              aria-label={pointLabel(point)}
              aria-describedby={captionId}
              aria-current={selected ? "location" : undefined}
              data-selected={selected || undefined}
              data-active={active || undefined}
              data-atlas-comparison-country={point.entityId}
              onPointerEnter={() => setHoveredCountryId(point.entityId)}
              onPointerLeave={() => setHoveredCountryId((current) => current === point.entityId ? null : current)}
              onFocus={() => {
                setRovingCountryId(point.entityId);
                setFocusedCountryId(point.entityId);
              }}
              onBlur={() => setFocusedCountryId((current) => current === point.entityId ? null : current)}
              onClick={() => onChooseCountry(point.entityId)}
              onKeyDown={(event) => {
                if (moveFocus(event, point)) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onChooseCountry(point.entityId);
              }}
            >
              <circle className={styles.scatterPointHit} cx={x} cy={y} r={8} />
              <circle className={styles.scatterPointRing} cx={x} cy={y} r={selected ? 6.1 : 4.9} />
              <circle className={styles.scatterPointDot} cx={x} cy={y} r={selected ? 4.8 : 2.35} />
              <title>{pointLabel(point)}</title>
            </g>
          );
        })}
        <text x={(inset.left + width - inset.right) / 2} y={height - 6}>{axisLabel("a")}</text>
        <text className={styles.yLabel} x={-height / 2} y={11}>{axisLabel("b")}</text>
      </svg>
      <div className={styles.scatterPointReadout} aria-live="polite" aria-atomic="true">
        {activePoint ? <><strong>{activePoint.name}</strong><span>{comparison.a.shortLabel}: {datumLabel(activePoint, "a")} · {comparison.b.shortLabel}: {datumLabel(activePoint, "b")}</span></> : <span>Hover or focus a country to read both values. Select it to return to the map.</span>}
      </div>
      <figcaption id={captionId}>{summary.sentence} This describes the pattern; it does not explain its cause.</figcaption>
    </figure>
  );
}

export default function AtlasCompareControl({
  activeViewId,
  countries,
  selectedCountryId,
  onChooseView,
  onChooseCountry,
  onHoverCountry,
}: AtlasCompareControlProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [side, setSide] = useState<AtlasComparisonSide>("a");
  const [payloadState, setPayloadState] = useState<{
    comparisonId: string;
    payloads: [AtlasLayerDataResponse, AtlasLayerDataResponse] | null;
    failed: boolean;
  }>({ comparisonId: "", payloads: null, failed: false });
  const comparison = comparisonId ? ATLAS_COMPARISON_BY_ID.get(comparisonId) ?? null : null;
  const countryNames = useMemo(
    () => new Map(countries.map((country) => [country.id, country.name])),
    [countries],
  );
  const selectedCountryName = selectedCountryId ? countryNames.get(selectedCountryId) ?? null : null;

  useEffect(() => {
    const syncFromUrl = () => {
      const urlState = readCompareUrl();
      setComparisonId(urlState.id);
      setSide(urlState.side);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    if (!comparison) return;
    let active = true;
    void Promise.all([
      loadLayerPayload(comparison.a.viewId),
      loadLayerPayload(comparison.b.viewId),
    ]).then((nextPayloads) => {
      if (!active) return;
      setPayloadState({ comparisonId: comparison.id, payloads: nextPayloads, failed: false });
    }).catch(() => {
      if (active) setPayloadState({ comparisonId: comparison.id, payloads: null, failed: true });
    });
    return () => { active = false; };
  }, [comparison]);

  const payloads = comparison && payloadState.comparisonId === comparison.id
    ? payloadState.payloads
    : null;
  const status = !comparison
    ? "idle"
    : payloadState.comparisonId === comparison.id && payloadState.failed
      ? "error"
      : payloads
        ? "ready"
        : "loading";
  const effectiveSide = comparison
    ? atlasComparisonSideForView(comparison, activeViewId) ?? side
    : side;
  const summary = useMemo(() => payloads
    ? summarizeAtlasComparison(payloads[0], payloads[1], countryNames)
    : null, [countryNames, payloads]);
  const aDatum = findAtlasComparisonDatum(payloads?.[0] ?? null, selectedCountryId);
  const bDatum = findAtlasComparisonDatum(payloads?.[1] ?? null, selectedCountryId);

  const chooseComparison = (next: AtlasComparisonDefinition) => {
    const inferredSide = atlasComparisonSideForView(next, activeViewId) ?? "a";
    setComparisonId(next.id);
    setSide(inferredSide);
    writeCompareUrl(next.id, inferredSide);
    if (!atlasComparisonSideForView(next, activeViewId)) onChooseView(atlasComparisonView(next, inferredSide).viewId);
  };

  const chooseSide = useCallback((nextSide: AtlasComparisonSide) => {
    if (!comparison) return;
    setSide(nextSide);
    writeCompareUrl(comparison.id, nextSide);
    onChooseView(atlasComparisonView(comparison, nextSide).viewId);
  }, [comparison, onChooseView]);

  useEffect(() => {
    if (!comparison) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.repeat || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const openDialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (openDialog && openDialog !== dialogRef.current) return;
      const key = event.key.toLocaleLowerCase("en-US");
      const nextSide = key === "a" ? "a" : key === "b" ? "b" : key === "x"
        ? (effectiveSide === "a" ? "b" : "a")
        : null;
      if (!nextSide) return;
      event.preventDefault();
      chooseSide(nextSide);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseSide, comparison, effectiveSide]);

  const stopComparing = () => {
    setComparisonId(null);
    writeCompareUrl(null, "a");
  };

  const closeDialog = () => {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };

  return (
    <div className={styles.compare} data-atlas-compare={comparison?.id ?? undefined}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-label={comparison ? `Compare views: ${comparison.name}` : "Compare views"}
        onClick={() => dialogRef.current?.showModal()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v14H4V5zm9 0h7v14h-7V5zM7 9h1m8 6h1" /></svg>
        <span>{comparison ? "Compare" : "Compare"}</span>
      </button>

      {comparison && (
        <section className={styles.quickBar} aria-label={`${comparison.name} comparison controls`}>
          <div>
            <small>COMPARE</small>
            <strong>{comparison.name}</strong>
          </div>
          <div className={styles.sideToggle} role="group" aria-label="Choose comparison side">
            {(["a", "b"] as const).map((candidate) => (
              <button
                type="button"
                key={candidate}
                aria-pressed={effectiveSide === candidate}
                onClick={() => chooseSide(candidate)}
              >
                <b>{candidate.toUpperCase()}</b>
                <span>{atlasComparisonView(comparison, candidate).shortLabel}</span>
              </button>
            ))}
          </div>
          <button type="button" className={styles.inspect} onClick={() => dialogRef.current?.showModal()}>
            Explain
          </button>
          <button type="button" className={styles.exit} aria-label="Exit comparison" onClick={stopComparing}>×</button>
        </section>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="atlas-compare-heading"
        onCancel={() => triggerRef.current?.focus()}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}
      >
        <div className={styles.surface}>
          <header>
            <div><span>COMPARE WORLD</span><h2 id="atlas-compare-heading">Read two lenses together</h2></div>
            <button type="button" onClick={closeDialog} aria-label="Close Compare World">×</button>
          </header>

          <div className={styles.pairList} aria-label="Curated comparisons">
            {ATLAS_COMPARISONS.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                aria-pressed={candidate.id === comparison?.id}
                onClick={() => chooseComparison(candidate)}
              >
                <strong>{candidate.name}</strong>
                <span>{candidate.question}</span>
              </button>
            ))}
          </div>

          {comparison && (
            <section className={styles.readout} aria-label={`${comparison.name} explanation`}>
              <div className={styles.readoutHeading}>
                <div><small>QUESTION</small><h3>{comparison.question}</h3></div>
                <div className={styles.sideToggle} role="group" aria-label="Choose comparison map">
                  {(["a", "b"] as const).map((candidate) => (
                    <button type="button" key={candidate} aria-pressed={effectiveSide === candidate} onClick={() => chooseSide(candidate)}>
                      <b>{candidate.toUpperCase()}</b><span>{atlasComparisonView(comparison, candidate).shortLabel}</span>
                    </button>
                  ))}
                </div>
              </div>

              {selectedCountryName && (
                <div className={styles.countryReadout} aria-label={`${selectedCountryName} comparison values`}>
                  <span>{selectedCountryName}</span>
                  {status === "ready" ? <>
                    <SelectedValue label={comparison.a.shortLabel} datum={aDatum} />
                    <SelectedValue label={comparison.b.shortLabel} datum={bDatum} />
                  </> : <p>{status === "error" ? "Comparison values could not load." : "Loading sourced values…"}</p>}
                </div>
              )}

              {payloads && <div className={styles.dataNotes} aria-label="Comparison data years and sources">
                {([0, 1] as const).map((index) => {
                  const payload = payloads[index];
                  const comparisonSide = index === 0 ? comparison.a : comparison.b;
                  const source = payload.sources[0];
                  return <div key={comparisonSide.viewId}><strong>{comparisonSide.shortLabel}</strong>
                    <span>{payloadYearLabel(payload)} · {payloadCoverage(payload)}</span>
                    <small>{source ? `${source.publisher} · ${source.title}` : "Source metadata unavailable"}</small>
                  </div>;
                })}
              </div>}

              <p className={styles.interpretation}>{comparison.interpretation}</p>
              {comparison.calculationNote && <p className={styles.calculationNote} aria-label="Comparison scale and calculation"><strong>CALCULATION</strong>{comparison.calculationNote}</p>}
              {summary && <ScatterPlot
                summary={summary}
                comparison={comparison}
                selectedCountryId={selectedCountryId}
                onHoverCountry={onHoverCountry}
                onChooseCountry={(countryId) => {
                  closeDialog();
                  onChooseCountry(countryId);
                }}
              />}
              {summary?.outliers.length ? (
                <div className={styles.outliers} aria-label="Notable statistical outliers">
                  <small>COUNTRIES THAT STAND APART FROM THE OVERALL PATTERN</small>
                  <div>{summary.outliers.map((point) => <button key={point.entityId} type="button" onClick={() => {
                    closeDialog();
                    onChooseCountry(point.entityId);
                  }}>{point.name}</button>)}</div>
                  <span>These are statistical departures worth inspecting, not explanations by themselves.</span>
                </div>
              ) : null}
              <p className={styles.caveat}>{comparison.caveat}</p>
            </section>
          )}
        </div>
      </dialog>
    </div>
  );
}
