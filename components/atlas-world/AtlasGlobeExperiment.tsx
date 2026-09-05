"use client";

import Link from "next/link";
import {
  geoCentroid,
  geoContains,
  geoGraticule10,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import type { AtlasRuntimeCountrySummary, AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import { atlasPoliticalColor } from "@/lib/atlas-world/politicalPalette";
import styles from "./AtlasGlobeExperiment.module.css";

type AtlasGlobeFeature = {
  type: "Feature";
  id: string;
  properties: {
    entityId: string;
    labelWgs84: [number, number] | null;
    tinyRank: number | null;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  };
};

type AtlasGlobeGeometry = {
  schemaVersion: "1.0.0";
  snapshotId: string;
  generatedAt: string;
  canonicalCrs: "EPSG:4326";
  geometrySemantics: string;
  source: {
    id: string;
    title: string;
    publisher: string;
    version: string;
    url: string;
    retrievedAt: string;
    checksumSha256: string;
    license: { name: string; url: string };
  };
  features: AtlasGlobeFeature[];
};

type AtlasGlobeExperimentProps = {
  countries: AtlasRuntimeCountrySummary[];
  initialCountryId: string | null;
  naturalEarthSource: AtlasRuntimeSource | null;
};

type PointerPosition = { x: number; y: number };
type DragState = {
  pointerId: number;
  start: PointerPosition;
  previous: PointerPosition;
  moved: boolean;
};

const GEOMETRY_URL = "/atlas-world/geometry-wgs84.v1.json";
const DEFAULT_ROTATION: [number, number, number] = [-12, -12, 0];
const MIN_ZOOM = 0.82;
const MAX_ZOOM = 2.65;
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function clampLatitude(value: number) {
  return Math.max(-78, Math.min(78, value));
}

function normalizedQuery(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function countryMatches(country: AtlasRuntimeCountrySummary, query: string) {
  if (!query) return false;
  const names = [
    country.name,
    country.officialName,
    ...country.aliases,
    country.slug,
    country.codes.iso2,
    country.codes.iso3,
    country.codes.naturalEarth,
  ].filter((value): value is string => Boolean(value));
  return names.some((name) => normalizedQuery(name).includes(query));
}

function countryFromUrl(countries: AtlasRuntimeCountrySummary[], value: string | null) {
  const query = normalizedQuery(value ?? "").replace(/^country:/, "");
  if (!query) return null;
  return countries.find((country) => [
    country.id.replace(/^country:/, ""),
    country.slug,
    country.codes.iso2,
    country.codes.iso3,
    country.codes.naturalEarth,
  ].some((candidate) => normalizedQuery(candidate ?? "") === query)) ?? null;
}

function countryUrlValue(country: AtlasRuntimeCountrySummary) {
  return (country.codes.naturalEarth || country.codes.iso3 || country.slug).toLocaleLowerCase("en-US");
}

function countryContext(country: AtlasRuntimeCountrySummary) {
  return [country.geography.subregion, country.geography.region, country.geography.continent]
    .find(Boolean) ?? "Atlas map unit";
}

function capitalLabel(country: AtlasRuntimeCountrySummary) {
  return country.facts.capital?.value ?? "Not available";
}

function populationLabel(country: AtlasRuntimeCountrySummary) {
  const fact = country.facts.population;
  if (!fact) return "Not available";
  return `${compactNumber.format(fact.value)}${fact.observedAt ? ` · ${fact.observedAt.slice(0, 4)}` : ""}`;
}

function politicalSystemLabel(country: AtlasRuntimeCountrySummary) {
  return country.facts.government?.value.raw ?? "Not classified";
}

function religionLabel(country: AtlasRuntimeCountrySummary) {
  const category = country.facts.religion?.value.dominantCategory;
  if (!category || category === "unknown") return "Not classified";
  return category.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function featureGeometry(feature: AtlasGlobeFeature) {
  return feature as unknown as GeoPermissibleObjects;
}

function localPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clientX - bounds.left,
    y: clientY - bounds.top,
  };
}

function pointerDistance(left: PointerPosition, right: PointerPosition) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export default function AtlasGlobeExperiment({
  countries,
  initialCountryId,
  naturalEarthSource,
}: AtlasGlobeExperimentProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<AtlasGlobeGeometry | null>(null);
  const rotationRef = useRef<[number, number, number]>(DEFAULT_ROTATION);
  const zoomRef = useRef(1);
  const dragRef = useRef<DragState | null>(null);
  const pointersRef = useRef(new Map<number, PointerPosition>());
  const pinchDistanceRef = useRef<number | null>(null);
  const hoverFrameRef = useRef<number | null>(null);

  const [geometry, setGeometry] = useState<AtlasGlobeGeometry | null>(null);
  const [geometryError, setGeometryError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 900, height: 680 });
  const [rotation, setRotation] = useState<[number, number, number]>(DEFAULT_ROTATION);
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(initialCountryId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);

  const countryById = useMemo(() => new Map(countries.map((country) => [country.id, country])), [countries]);
  const featureById = useMemo(
    () => new Map((geometry?.features ?? []).map((feature) => [feature.properties.entityId, feature])),
    [geometry],
  );
  const selectedCountry = selectedId ? countryById.get(selectedId) ?? null : null;
  const hoveredCountry = hoveredId ? countryById.get(hoveredId) ?? null : null;
  const searchResults = useMemo(() => {
    const needle = normalizedQuery(query);
    if (!needle) return [];
    return countries
      .filter((country) => countryMatches(country, needle))
      .sort((left, right) => {
        const leftStarts = normalizedQuery(left.name).startsWith(needle) ? 0 : 1;
        const rightStarts = normalizedQuery(right.name).startsWith(needle) ? 0 : 1;
        return leftStarts - rightStarts || left.name.localeCompare(right.name);
      })
      .slice(0, 8);
  }, [countries, query]);

  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const bounds = stage.getBoundingClientRect();
      setSize({
        width: Math.max(280, Math.round(bounds.width)),
        height: Math.max(300, Math.round(bounds.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const focusFeature = useCallback((feature: AtlasGlobeFeature, nextZoom = Math.max(zoomRef.current, 1.18)) => {
    const [longitude, latitude] = geoCentroid(featureGeometry(feature));
    const nextRotation: [number, number, number] = [-longitude, -clampLatitude(latitude), 0];
    rotationRef.current = nextRotation;
    zoomRef.current = clampZoom(nextZoom);
    setRotation(nextRotation);
    setZoom(zoomRef.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(GEOMETRY_URL, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as AtlasGlobeGeometry;
        if (payload.canonicalCrs !== "EPSG:4326" || payload.features.length !== countries.length) {
          throw new Error("The globe geometry does not match the current Atlas snapshot.");
        }
        geometryRef.current = payload;
        if (initialCountryId) {
          const initialFeature = payload.features.find((feature) => feature.properties.entityId === initialCountryId);
          if (initialFeature) focusFeature(initialFeature);
        }
        setGeometry(payload);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGeometryError(error instanceof Error ? error.message : "The WGS84 geometry could not be loaded.");
      });
    return () => controller.abort();
  }, [countries.length, focusFeature, initialCountryId]);

  const projection = useMemo(() => {
    const reservedWidth = size.width >= 980 && selectedCountry ? 380 : 0;
    const availableWidth = Math.max(280, size.width - reservedWidth);
    const diameter = Math.max(250, Math.min(availableWidth * 0.86, size.height * 0.88));
    return geoOrthographic()
      .translate([availableWidth / 2, size.height / 2])
      .scale((diameter / 2) * zoom)
      .rotate(rotation)
      .clipAngle(90)
      .precision(0.35);
  }, [rotation, selectedCountry, size.height, size.width, zoom]);

  useEffect(() => {
    const onPopState = () => {
      const country = countryFromUrl(countries, new URL(window.location.href).searchParams.get("country"));
      setSelectedId(country?.id ?? null);
      if (country) {
        const feature = geometryRef.current?.features.find((entry) => entry.properties.entityId === country.id);
        if (feature) focusFeature(feature);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [countries, focusFeature]);

  useEffect(() => {
    if (!geometry) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * pixelRatio);
    canvas.height = Math.round(size.height * pixelRatio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const path = geoPath(projection, context);
    const sphere = { type: "Sphere" } as const;

    context.beginPath();
    path(sphere);
    context.fillStyle = "#597984";
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(220, 232, 226, 0.42)";
    context.stroke();

    context.save();
    context.beginPath();
    path(sphere);
    context.clip();
    context.beginPath();
    path(geoGraticule10());
    context.lineWidth = 0.6;
    context.strokeStyle = "rgba(239, 235, 217, 0.15)";
    context.stroke();

    for (const feature of geometry.features) {
      context.beginPath();
      path(featureGeometry(feature));
      context.fillStyle = atlasPoliticalColor(feature.properties.entityId);
      context.fill();
      context.lineWidth = 0.55;
      context.strokeStyle = "rgba(20, 38, 40, 0.72)";
      context.stroke();
    }

    if (hoveredId && hoveredId !== selectedId) {
      const feature = featureById.get(hoveredId);
      if (feature) {
        context.beginPath();
        path(featureGeometry(feature));
        context.lineWidth = 1.7;
        context.strokeStyle = "#ead18f";
        context.stroke();
      }
    }

    if (selectedId) {
      const feature = featureById.get(selectedId);
      if (feature) {
        context.beginPath();
        path(featureGeometry(feature));
        context.lineWidth = 3.2;
        context.strokeStyle = "rgba(20, 29, 27, 0.92)";
        context.stroke();
        context.beginPath();
        path(featureGeometry(feature));
        context.lineWidth = 1.35;
        context.strokeStyle = "#fff0bc";
        context.stroke();
      }
    }
    context.restore();
  }, [featureById, geometry, hoveredId, projection, selectedId, size.height, size.width]);

  const hitFeature = useCallback((point: PointerPosition) => {
    const payload = geometryRef.current;
    if (!payload) return null;
    const currentProjection = geoOrthographic()
      .translate([projection.translate()[0], projection.translate()[1]])
      .scale(projection.scale())
      .rotate(projection.rotate())
      .clipAngle(90)
      .precision(0.35);
    const coordinate = currentProjection.invert?.([point.x, point.y]);
    if (!coordinate) return null;
    for (const feature of payload.features) {
      if (geoContains(featureGeometry(feature), coordinate)) return feature;
    }
    let nearest: AtlasGlobeFeature | null = null;
    let nearestDistance = 14;
    for (const feature of payload.features) {
      if (feature.properties.tinyRank == null || !feature.properties.labelWgs84) continue;
      const projected = currentProjection(feature.properties.labelWgs84);
      if (!projected) continue;
      const distance = Math.hypot(projected[0] - point.x, projected[1] - point.y);
      if (distance < nearestDistance) {
        nearest = feature;
        nearestDistance = distance;
      }
    }
    return nearest;
  }, [projection]);

  const writeSelection = useCallback((country: AtlasRuntimeCountrySummary | null, replace = false) => {
    const url = new URL(window.location.href);
    if (country) url.searchParams.set("country", countryUrlValue(country));
    else url.searchParams.delete("country");
    window.history[replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const chooseCountry = useCallback((country: AtlasRuntimeCountrySummary, focus = false) => {
    setSelectedId(country.id);
    writeSelection(country);
    if (focus) {
      const feature = geometryRef.current?.features.find((entry) => entry.properties.entityId === country.id);
      if (feature) focusFeature(feature);
    }
    setQuery("");
    setSearchOpen(false);
  }, [focusFeature, writeSelection]);

  const closeSelection = useCallback(() => {
    setSelectedId(null);
    writeSelection(null);
  }, [writeSelection]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!searchResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveResult((value) => (value + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveResult((value) => (value - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseCountry(searchResults[activeResult] ?? searchResults[0], true);
    } else if (event.key === "Escape") {
      setSearchOpen(false);
    }
  };

  const updateRotationFromDrag = (point: PointerPosition) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = point.x - drag.previous.x;
    const deltaY = point.y - drag.previous.y;
    drag.previous = point;
    if (pointerDistance(point, drag.start) > 4) drag.moved = true;
    const previous = rotationRef.current;
    const next: [number, number, number] = [
      previous[0] + (deltaX * 0.34) / zoomRef.current,
      clampLatitude(previous[1] - (deltaY * 0.34) / zoomRef.current),
      0,
    ];
    rotationRef.current = next;
    setRotation(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size === 1) {
      dragRef.current = { pointerId: event.pointerId, start: point, previous: point, moved: false };
    } else if (pointersRef.current.size === 2) {
      const [left, right] = [...pointersRef.current.values()];
      pinchDistanceRef.current = pointerDistance(left, right);
      dragRef.current = null;
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size >= 2) {
      const [left, right] = [...pointersRef.current.values()];
      const distance = pointerDistance(left, right);
      if (pinchDistanceRef.current && distance > 0) {
        const next = clampZoom(zoomRef.current * (distance / pinchDistanceRef.current));
        zoomRef.current = next;
        setZoom(next);
      }
      pinchDistanceRef.current = distance;
      return;
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      updateRotationFromDrag(point);
      return;
    }
    if (event.pointerType !== "mouse") return;
    if (hoverFrameRef.current != null) cancelAnimationFrame(hoverFrameRef.current);
    hoverFrameRef.current = requestAnimationFrame(() => {
      setHoveredId(hitFeature(point)?.properties.entityId ?? null);
      hoverFrameRef.current = null;
    });
  };

  const finishPointer = (event: PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    const drag = dragRef.current;
    const wasTap = !cancelled && drag?.pointerId === event.pointerId && !drag.moved && pointersRef.current.size === 1;
    pointersRef.current.delete(event.pointerId);
    pinchDistanceRef.current = null;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (wasTap) {
      const feature = hitFeature(point);
      const country = feature ? countryById.get(feature.properties.entityId) ?? null : null;
      if (country) chooseCountry(country, false);
    }
  };

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const next = clampZoom(zoomRef.current * Math.exp(-event.deltaY * 0.0012));
    zoomRef.current = next;
    setZoom(next);
  };

  const changeZoom = (factor: number) => {
    const next = clampZoom(zoomRef.current * factor);
    zoomRef.current = next;
    setZoom(next);
  };

  const resetGlobe = () => {
    rotationRef.current = DEFAULT_ROTATION;
    zoomRef.current = 1;
    setRotation(DEFAULT_ROTATION);
    setZoom(1);
  };

  const flatCountryHref = selectedCountry ? `/atlas?country=${encodeURIComponent(countryUrlValue(selectedCountry))}` : "/atlas";

  return (
    <section className={styles.globeLab} data-atlas-globe data-atlas-globe-loaded={geometry ? "true" : "false"}
      data-atlas-globe-selected={selectedId ?? "none"} data-atlas-globe-rotation={rotation.map((value) => value.toFixed(2)).join(",")}
      data-atlas-globe-zoom={zoom.toFixed(3)}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <span className={styles.compass} aria-hidden="true">✦</span>
          <div><h1>Atlas Globe</h1><span>Experimental world view</span></div>
        </div>
        <div className={styles.search}>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            role="combobox"
            aria-label="Search countries on the globe"
            aria-expanded={searchOpen && query.length > 0}
            aria-controls="atlas-globe-search-results"
            aria-activedescendant={searchResults[activeResult] ? `atlas-globe-result-${searchResults[activeResult].id}` : undefined}
            placeholder="Find a country or territory…"
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setActiveResult(0); }}
            onKeyDown={onSearchKeyDown}
          />
          {searchOpen && query && (
            <ul id="atlas-globe-search-results" role="listbox" className={styles.searchResults}>
              {searchResults.map((country, index) => (
                <li key={country.id} id={`atlas-globe-result-${country.id}`} role="option" aria-selected={index === activeResult}>
                  <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => chooseCountry(country, true)}>
                    <strong>{country.name}</strong><span>{countryContext(country)}</span>
                  </button>
                </li>
              ))}
              {searchResults.length === 0 && <li className={styles.noResults}>No mapped place found.</li>}
            </ul>
          )}
        </div>
        <div className={styles.toolbarActions}>
          <span className={styles.experimentalBadge}>Experiment</span>
          <Link href={flatCountryHref}>Return to flat Atlas</Link>
        </div>
      </header>

      <div className={styles.stage} ref={stageRef}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label="Orthographic world globe showing 242 political map units. Use the country search to inspect a place, and use the zoom and reset buttons to adjust the view."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishPointer(event)}
          onPointerCancel={(event) => finishPointer(event, true)}
          onPointerLeave={() => { if (!dragRef.current) setHoveredId(null); }}
          onWheel={onWheel}
        />

        <p
          role="status"
          aria-label="Globe selection"
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {selectedCountry ? `${selectedCountry.name} selected on the globe.` : "No country selected on the globe."}
        </p>

        {!geometry && !geometryError && <div className={styles.loading} role="status"><span />Loading the WGS84 world…</div>}
        {geometryError && <div className={styles.error} role="alert"><strong>The globe could not load.</strong><span>{geometryError}</span><Link href="/atlas">Open the flat Atlas</Link></div>}

        {hoveredCountry && !selectedCountry && <div className={styles.hoverLabel} aria-hidden="true"><strong>{hoveredCountry.name}</strong><span>{capitalLabel(hoveredCountry)}</span></div>}

        <div className={styles.controls} role="group" aria-label="Globe controls">
          <button type="button" onClick={() => changeZoom(1.2)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => changeZoom(1 / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" onClick={resetGlobe} aria-label="Reset globe">↺</button>
        </div>

        <div className={styles.instructions}><span>Drag to rotate</span><span>Pinch or scroll to zoom</span><span>Tap a place to inspect</span></div>

        <details className={styles.limitations}>
          <summary>What this experiment can show</summary>
          <p>This is the same 242-entity political geography as Atlas, projected live from canonical longitude and latitude.</p>
          <p>Population density and relief are not shown: those assets were authored for the flat Mercator map and cannot be wrapped around a globe honestly.</p>
        </details>

        {selectedCountry && (
          <aside className={styles.countryCard} aria-labelledby="atlas-globe-country-title">
            <button type="button" className={styles.close} onClick={closeSelection} aria-label={`Close ${selectedCountry.name}`}>×</button>
            <header>
              <span className={styles.flag}>{selectedCountry.codes.iso2 && /^[A-Z]{2}$/.test(selectedCountry.codes.iso2)
                ? <span className={`fi fi-${selectedCountry.codes.iso2.toLowerCase()}`} role="img" aria-label={`${selectedCountry.name} flag`} />
                : <span aria-hidden="true">◈</span>}</span>
              <div><p>{countryContext(selectedCountry)}</p><h2 id="atlas-globe-country-title">{selectedCountry.name}</h2>{selectedCountry.officialName && selectedCountry.officialName !== selectedCountry.name && <span>{selectedCountry.officialName}</span>}</div>
            </header>
            <dl>
              <div><dt>Capital</dt><dd>{capitalLabel(selectedCountry)}</dd></div>
              <div><dt>Population</dt><dd>{populationLabel(selectedCountry)}</dd></div>
              <div><dt>Government</dt><dd>{politicalSystemLabel(selectedCountry)}</dd></div>
              <div><dt>Dominant tradition</dt><dd>{religionLabel(selectedCountry)}</dd></div>
            </dl>
            <Link className={styles.openAtlas} href={flatCountryHref}>Open full country cockpit <span aria-hidden="true">→</span></Link>
            <p className={styles.cardCaveat}>Political color identifies a map unit. It does not express recognition, alliance, or a claim.</p>
          </aside>
        )}

        <footer className={styles.sourceLine}>
          <span>{geometry?.features.length ?? countries.length} map units · Orthographic projection</span>
          <a href={geometry?.source.url ?? naturalEarthSource?.url ?? "https://www.naturalearthdata.com/"} target="_blank" rel="noreferrer">Natural Earth 1:50m · WGS84</a>
        </footer>
      </div>
    </section>
  );
}
