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
import Link from "next/link";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import {
  ATLAS_LAYER_BY_ID,
  ATLAS_VIEW_PRESET_BY_ID,
  ATLAS_VIEW_PRESETS,
  applyAtlasSceneToSearchParams,
  buildAtlasRenderPlan,
  createAtlasSceneFromPreset,
  isAtlasViewPresetId,
  resolveAtlasLayerDatum,
  resolveAtlasLayerValue,
  type AtlasLayerDataResponse,
  type AtlasSceneState,
  type AtlasResolvedLayerValue,
  type AtlasRenderPlanLayer,
} from "@/lib/atlas-world/layers";
import type {
  AtlasClientDataset,
  AtlasRuntimeCountry,
  AtlasRuntimeCountrySummary,
  AtlasRuntimeFeatureMeta,
} from "@/lib/atlas-world/runtime";
import type { AtlasPatternNote } from "@/lib/atlas-world/geographyTypes";
import { atlasObservationStatusHasValue } from "@/lib/atlas-world/types";
import { updateAtlasCartography } from "@/lib/atlas-world/cartography";
import { atlasLabelInk } from "@/lib/atlas-world/labelInk";
import { resolveAtlasInitialState } from "@/lib/atlas-world/initialState";
import type { AtlasPlaceSummary } from "@/lib/atlas-world/places";
import { recordAtlasEvent } from "@/lib/atlas-world/telemetry";
import AtlasViewBrowser from "./AtlasViewBrowser";
import AtlasPlaceCard from "./AtlasPlaceCard";
import { ATLAS_INITIAL_BOUNDS, ATLAS_WORLD_BOUNDS } from "@/lib/atlas-world/projection";
import { getAtlasTerritorialStatus } from "@/lib/atlas-world/territorialStatus";
import AtlasCountryPanel, {
  type AtlasCountryLensContext,
  type AtlasSheetDetent,
} from "./AtlasCountryPanel";
import AtlasLegend from "./AtlasLegend";
import AtlasMapNotes from "./AtlasMapNotes";
import styles from "./AtlasWorld.module.css";

type AtlasWorldExperienceProps = {
  data: AtlasClientDataset;
  patternNotes: AtlasPatternNote[];
  initialPlaces: AtlasPlaceSummary[];
  initialScene: AtlasSceneState;
  initialCountry: AtlasRuntimeCountry | null;
  map: ReactNode;
};

type TooltipState = {
  countryId?: string;
  placeId?: string;
  x: number;
  y: number;
};

type AtlasSearchResult =
  | { kind: "country"; country: AtlasRuntimeCountrySummary; score: number }
  | { kind: "place"; place: AtlasPlaceSummary; score: number };

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 650;
const SEARCH_LIMIT = 8;
let placeIndexRequest: Promise<AtlasPlaceSummary[]> | null = null;

function loadAtlasPlaceIndex() {
  placeIndexRequest ??= fetch("/api/atlas/places")
    .then(async (response) => {
      if (!response.ok) throw new Error(`Place index returned ${response.status}.`);
      const payload = await response.json() as { places?: AtlasPlaceSummary[] };
      if (!Array.isArray(payload.places)) throw new Error("Place index response was invalid.");
      return payload.places;
    })
    .catch((error) => {
      placeIndexRequest = null;
      throw error;
    });
  return placeIndexRequest;
}

function initialCamera() {
  const [[x0, y0], [x1, y1]] = ATLAS_INITIAL_BOUNDS;
  const scale = Math.min(1140 / (x1 - x0), 592 / (y1 - y0));
  return zoomIdentity.translate(600 - scale * (x0 + x1) / 2, 333 - scale * (y0 + y1) / 2).scale(scale);
}

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

function countrySearchScore(country: AtlasRuntimeCountrySummary, rawQuery: string) {
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

function placeSearchScore(place: AtlasPlaceSummary, rawQuery: string) {
  const query = normalized(rawQuery);
  const name = normalized(place.name);
  const aliases = place.aliases.map(normalized);
  const identity = normalized(place.shareKey);
  let match = Number.POSITIVE_INFINITY;
  if (name === query) match = 0;
  else if (name.startsWith(query)) match = 1;
  else if (aliases.some((alias) => alias === query)) match = 2;
  else if (aliases.some((alias) => alias.startsWith(query))) match = 3;
  else if (name.includes(query)) match = 4;
  else if (aliases.some((alias) => alias.includes(query)) || identity.includes(query)) match = 5;
  if (!Number.isFinite(match)) return match;
  const kindRank = place.kind === "city" ? 0 : place.kind === "river" ? 0.08 : 0.12;
  const capitalRank = place.kind === "city" && place.isNationalCapital ? -0.04 : 0;
  const populationRank = place.kind === "city" && place.population
    ? -Math.min(0.03, Math.log10(Math.max(1, place.population.value)) / 300)
    : 0;
  return match + kindRank + capitalRank + populationRank;
}

function searchResultId(result: AtlasSearchResult) {
  const identity = result.kind === "country" ? result.country.id : result.place.placeId;
  return `atlas-result-${identity.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function countryUrlKey(country: AtlasRuntimeCountrySummary) {
  return (country.codes.iso3 ?? country.codes.naturalEarth).toLocaleLowerCase("en-US");
}

function writeSceneUrl(
  scene: AtlasSceneState,
  country: AtlasRuntimeCountrySummary | null,
  place: AtlasPlaceSummary | null,
  push: boolean,
) {
  const url = new URL(window.location.href);
  const params = applyAtlasSceneToSearchParams(scene, url.searchParams);
  params.delete("city");
  params.delete("feature");
  if (country) params.set("country", countryUrlKey(country));
  else params.delete("country");
  if (place?.kind === "city") params.set("city", place.shareKey);
  else if (place) params.set("feature", place.shareKey);
  url.search = params.toString();
  window.history[push ? "pushState" : "replaceState"]({}, "", url);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function elementIsVisibleAtZoom(element: SVGElement, zoomScale: number) {
  const minimum = Number(element.dataset.atlasMinimumZoom ?? Number.NEGATIVE_INFINITY);
  const maximum = Number(element.dataset.atlasMaximumZoom ?? Number.POSITIVE_INFINITY);
  return zoomScale >= minimum && zoomScale <= maximum;
}

function applyAtlasZoomVisibility(host: Element, zoomScale: number) {
  host.querySelectorAll<SVGElement>(
    "[data-atlas-minimum-zoom], [data-atlas-maximum-zoom]",
  ).forEach((element) => {
    const visibleAtZoom = elementIsVisibleAtZoom(element, zoomScale);
    const layerIsActive = element.hasAttribute("data-atlas-layer")
      ? element.dataset.atlasLayerActive === "true"
      : true;
    const state = visibleAtZoom ? "true" : "false";
    if (element.dataset.atlasZoomVisible !== state) element.dataset.atlasZoomVisible = state;
    const display = visibleAtZoom && layerIsActive ? "" : "none";
    if (element.style.display !== display) element.style.display = display;
  });
  host.querySelectorAll<SVGUseElement>("[data-atlas-geography-href]").forEach((element) => {
    const feature = element.closest<SVGElement>("[data-atlas-map-feature]");
    const layer = element.closest<SVGElement>("[data-atlas-layer]");
    if (feature && elementIsVisibleAtZoom(feature, zoomScale) && layer?.dataset.atlasLayerActive === "true" && !element.getAttribute("href")) {
      element.setAttribute("href", element.dataset.atlasGeographyHref!);
    }
  });
}

function resolveLayerValue(
  entry: AtlasRenderPlanLayer,
  country: AtlasRuntimeCountrySummary,
  feature: AtlasRuntimeFeatureMeta,
  payload: AtlasLayerDataResponse | undefined,
): AtlasResolvedLayerValue | null {
  if (entry.dataset.access.kind !== "api") {
    return resolveAtlasLayerValue(entry.definition, { country, feature });
  }
  if (!payload) return null;
  const datum = payload.values.find((value) => value.entityId === country.id);
  return resolveAtlasLayerDatum(entry.definition, datum);
}

function apiLayerRequest(entry: AtlasRenderPlanLayer) {
  if (entry.dataset.access.kind !== "api") return null;
  const params = new URLSearchParams();
  if (entry.effectiveTime.kind === "instant") params.set("at", entry.effectiveTime.at);
  const query = params.toString();
  const href = `${entry.dataset.access.endpoint}${query ? `?${query}` : ""}`;
  return { href, cacheKey: `${entry.definition.id}:${JSON.stringify(entry.effectiveTime)}` };
}

function sceneWithLayerToggled(scene: AtlasSceneState, instanceId: string) {
  const target = scene.layers.find((instance) => instance.id === instanceId);
  if (!target) return null;

  let layers = scene.layers.map((instance) => instance.id === instanceId
    ? { ...instance, enabled: !instance.enabled }
    : instance);

  if (target.enabled) {
    const disabledLayerIds = new Set([target.layerId]);
    let foundDependent = true;
    while (foundDependent) {
      foundDependent = false;
      layers = layers.map((instance) => {
        if (!instance.enabled) return instance;
        const definition = ATLAS_LAYER_BY_ID.get(instance.layerId);
        if (!definition?.compatibility.requiresLayerIds.some((required) => disabledLayerIds.has(required))) {
          return instance;
        }
        disabledLayerIds.add(instance.layerId);
        foundDependent = true;
        return { ...instance, enabled: false };
      });
    }
  } else {
    const requiredLayerIds = new Set<string>();
    const pending = [target.layerId];
    while (pending.length > 0) {
      const layerId = pending.pop()!;
      const definition = ATLAS_LAYER_BY_ID.get(layerId);
      for (const required of definition?.compatibility.requiresLayerIds ?? []) {
        if (requiredLayerIds.has(required)) continue;
        requiredLayerIds.add(required);
        pending.push(required);
      }
    }
    layers = layers.map((instance) => requiredLayerIds.has(instance.layerId)
      ? { ...instance, enabled: true }
      : instance);
  }

  return { ...scene, layers };
}

export default function AtlasWorldExperience({
  data,
  patternNotes,
  initialPlaces,
  initialScene,
  initialCountry,
  map,
}: AtlasWorldExperienceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const hoveredPlaceIdRef = useRef<string | null>(null);
  const suppressHoverUntilMoveRef = useRef(false);
  const focusPanelOnReadyRef = useRef(false);
  const focusPlaceOnReadyRef = useRef(false);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const detailCacheRef = useRef(new Map<string, AtlasRuntimeCountry>(
    initialCountry ? [[initialCountry.id, initialCountry]] : [],
  ));
  const layerDataCacheRef = useRef(new Map<string, AtlasLayerDataResponse>());
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomScaleRef = useRef(1);
  const selectedIdRef = useRef<string | null>(
    initialCountry?.id ?? (initialScene.focus?.kind === "feature" ? initialScene.focus.id : null),
  );
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [scene, setScene] = useState<AtlasSceneState>(initialScene);
  const [selectedId, setSelectedId] = useState<string | null>(initialCountry?.id ?? null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AtlasRuntimeCountry | null>(initialCountry);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">(
    initialCountry ? "ready" : "idle",
  );
  const [detailRetry, setDetailRetry] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [places, setPlaces] = useState<AtlasPlaceSummary[]>(initialPlaces);
  const [placeIndexStatus, setPlaceIndexStatus] = useState<"loading" | "ready" | "error">("loading");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [sheetDetent, setSheetDetent] = useState<AtlasSheetDetent>("peek");
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [layerData, setLayerData] = useState<Record<string, AtlasLayerDataResponse>>({});
  const [layerErrors, setLayerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void loadAtlasPlaceIndex()
      .then((loadedPlaces) => {
        if (!active) return;
        setPlaces(loadedPlaces);
        setPlaceIndexStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setPlaceIndexStatus("error");
        recordAtlasEvent("Atlas layer failure", {
          layer: "place-index",
          view: initialScene.viewPresetId,
        }, "atlas-layer-failure:place-index");
      });
    return () => { active = false; };
  }, [initialScene.viewPresetId]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobileLayout(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    recordAtlasEvent("Atlas ready", {
      view: initialScene.viewPresetId,
      focus: initialScene.focus?.kind ?? "none",
      mobile: window.matchMedia("(max-width: 760px)").matches,
    }, `atlas-ready:${initialScene.viewPresetId}:${initialScene.focus?.kind ?? "none"}`);
    if (!("PerformanceObserver" in window)
      || !PerformanceObserver.supportedEntryTypes.includes("longtask")) return;
    const observer = new PerformanceObserver((list) => {
      const longest = Math.max(...list.getEntries().map((entry) => entry.duration), 0);
      if (longest >= 200) recordAtlasEvent("Atlas long task", {
        durationBand: longest >= 1000 ? "1000+" : longest >= 500 ? "500-999" : "200-499",
        view: initialScene.viewPresetId,
      }, `atlas-long-task:${initialScene.viewPresetId}`);
    });
    observer.observe({ entryTypes: ["longtask"] });
    return () => observer.disconnect();
  }, [initialScene.focus?.kind, initialScene.viewPresetId]);

  useEffect(() => {
    const reportError = (kind: "runtime" | "promise") => recordAtlasEvent("Atlas client error", {
      kind,
      view: scene.viewPresetId,
      mobile: window.matchMedia("(max-width: 760px)").matches,
    });
    const onError = () => reportError("runtime");
    const onUnhandledRejection = () => reportError("promise");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const timer = window.setTimeout(() => {
      const memory = (performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }).memory;
      if (!memory?.jsHeapSizeLimit) return;
      const ratio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
      if (ratio < 0.75) return;
      recordAtlasEvent("Atlas memory pressure", {
        band: ratio >= 0.9 ? "90%+" : "75-89%",
        view: scene.viewPresetId,
        mobile: window.matchMedia("(max-width: 760px)").matches,
      }, `atlas-memory-pressure:${scene.viewPresetId}`);
    }, 5_000);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [scene.viewPresetId]);

  const countryById = useMemo(
    () => new Map(data.countries.map((country) => [country.id, country])),
    [data.countries],
  );
  const featureById = useMemo(
    () => new Map(data.geometry.features.map((feature) => [feature.entityId, feature])),
    [data.geometry.features],
  );
  const renderPlan = useMemo(() => buildAtlasRenderPlan(scene), [scene]);
  const view = ATLAS_VIEW_PRESET_BY_ID.get(scene.viewPresetId) ?? ATLAS_VIEW_PRESETS[0];
  const primaryFillLayer = renderPlan.layers.find((entry) => entry.definition.renderer === "polygon-fill") ?? null;
  const apiLayerRequestKey = renderPlan.layers
    .filter((entry) => entry.dataset.access.kind === "api")
    .map((entry) => apiLayerRequest(entry)?.cacheKey)
    .join("|");
  const selectedCountry = selectedId ? countryById.get(selectedId) ?? null : null;
  const activeNoteFocusId = scene.focus?.kind === "feature" ? scene.focus.id : null;
  const activeNote = activeNoteFocusId
    ? patternNotes.find((note) => note.id === activeNoteFocusId) ?? null
    : null;
  useEffect(() => {
    mapHostRef.current?.querySelectorAll<SVGElement>("[data-atlas-note-highlight]").forEach((element) => {
      element.style.display = element.dataset.atlasNoteHighlight === activeNote?.id ? "" : "none";
    });
  }, [activeNote]);
  const placeById = useMemo(() => {
    const index = new Map<string, AtlasPlaceSummary>();
    for (const place of places) {
      index.set(place.placeId, place);
      for (const featureId of place.featureIds) index.set(featureId, place);
    }
    return index;
  }, [places]);
  const selectedCities = useMemo(() => places
    .filter((place): place is Extract<AtlasPlaceSummary, { kind: "city" }> => place.kind === "city" && place.countryId === selectedId)
    .sort((a, b) => Number(b.isNationalCapital) - Number(a.isNationalCapital) || a.name.localeCompare(b.name)), [places, selectedId]);
  const activePlace = activeNoteFocusId && !activeNote ? placeById.get(activeNoteFocusId) ?? null : null;
  const selectedIdentity = selectedCountry?.id ?? activePlace?.placeId ?? null;
  useEffect(() => {
    if (!activePlace || !focusPlaceOnReadyRef.current) return;
    focusPlaceOnReadyRef.current = false;
    rootRef.current?.querySelector<HTMLElement>("[data-atlas-place-card]")?.focus({ preventScroll: true });
  }, [activePlace]);
  const tooltipCountry = tooltip?.countryId ? countryById.get(tooltip.countryId) ?? null : null;
  const tooltipFeature = tooltip?.countryId ? featureById.get(tooltip.countryId) ?? null : null;
  const tooltipPlace = tooltip?.placeId ? placeById.get(tooltip.placeId) ?? null : null;

  const searchResults = useMemo(() => {
    if (normalized(deferredQuery).length === 0) return [];
    const countryResults: AtlasSearchResult[] = data.countries
      .map((country) => ({ kind: "country" as const, country, score: countrySearchScore(country, deferredQuery) }));
    const placeResults: AtlasSearchResult[] = places
      .map((place) => ({ kind: "place" as const, place, score: placeSearchScore(place, deferredQuery) }));
    return [...countryResults, ...placeResults]
      .filter((result) => Number.isFinite(result.score))
      .sort((a, b) => a.score - b.score || (
        a.kind === "country" ? a.country.name : a.place.name
      ).localeCompare(b.kind === "country" ? b.country.name : b.place.name))
      .slice(0, SEARCH_LIMIT);
  }, [data.countries, deferredQuery, places]);

  const legendCounts = useMemo(() => new Map(renderPlan.layers.map((entry) => {
    const counts = new Map<string, number>();
    let missing = 0;
    for (const feature of data.geometry.features) {
      const country = countryById.get(feature.entityId);
      if (!country || entry.definition.renderer !== "polygon-fill") continue;
      const value = resolveLayerValue(entry, country, feature, layerData[entry.instance.id]);
      if (!value) continue;
      if (!atlasObservationStatusHasValue(value.status)) missing += 1;
      else counts.set(value.key, (counts.get(value.key) ?? 0) + 1);
    }
    return [entry.instance.id, { counts, missing }] as const;
  })), [countryById, data.geometry.features, layerData, renderPlan.layers]);

  useEffect(() => {
    const controllers: AbortController[] = [];
    for (const entry of renderPlan.layers) {
      const request = apiLayerRequest(entry);
      if (!request) continue;
      const cached = layerDataCacheRef.current.get(request.cacheKey);
      if (cached) {
        setLayerData((current) => current[entry.instance.id]
          ? current
          : { ...current, [entry.instance.id]: cached });
        continue;
      }
      const controller = new AbortController();
      controllers.push(controller);
      fetch(request.href, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Layer data returned ${response.status}.`);
          return response.json() as Promise<AtlasLayerDataResponse>;
        })
        .then((payload) => {
          if (payload.layerId !== entry.definition.id) throw new Error("Layer response did not match the requested layer.");
          layerDataCacheRef.current.set(request.cacheKey, payload);
          setLayerData((current) => ({ ...current, [entry.instance.id]: payload }));
          setLayerErrors((current) => {
            if (!(entry.instance.id in current)) return current;
            const next = { ...current };
            delete next[entry.instance.id];
            return next;
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          recordAtlasEvent("Atlas layer failure", {
            layer: entry.definition.id,
            view: scene.viewPresetId,
          }, `atlas-layer-failure:${entry.definition.id}`);
          setLayerErrors((current) => ({
            ...current,
            [entry.instance.id]: error instanceof Error ? error.message : "Layer data could not load.",
          }));
        });
    }
    return () => controllers.forEach((controller) => controller.abort());
  }, [apiLayerRequestKey, renderPlan.layers, scene.viewPresetId]);

  const toggleHoverVisual = useCallback((countryId: string | null, active: boolean) => {
    if (!countryId) return;
    mapHostRef.current?.querySelectorAll<SVGElement>("[data-atlas-visual]").forEach((visual) => {
      if (visual.dataset.atlasVisual !== countryId) return;
      const isMarker = visual.tagName.toLocaleLowerCase() === "circle";
      visual.classList.toggle(isMarker ? styles.hoveredMarker : styles.hoveredShape, active);
    });
  }, []);

  const togglePlaceHoverVisual = useCallback((placeId: string | null, active: boolean) => {
    if (!placeId) return;
    mapHostRef.current?.querySelectorAll<SVGElement>("[data-atlas-place]").forEach((visual) => {
      if (visual.dataset.atlasPlace === placeId) {
        visual.dataset.atlasPlaceHovered = active ? "true" : "false";
      }
    });
  }, []);

  const clearMapHover = useCallback(() => {
    toggleHoverVisual(hoveredIdRef.current, false);
    togglePlaceHoverVisual(hoveredPlaceIdRef.current, false);
    hoveredIdRef.current = null;
    hoveredPlaceIdRef.current = null;
    setTooltip(null);
  }, [toggleHoverVisual, togglePlaceHoverVisual]);

  const focusFeature = useCallback((feature: AtlasRuntimeFeatureMeta) => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const behavior = zoomBehaviorRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !behavior || !matrix) return;
    const [[x0,y0],[x1,y1]]=feature.focusBounds ?? feature.bounds;
    const rect=svg.getBoundingClientRect();
    const mobile=window.matchMedia("(max-width:760px)").matches;
    const toolbar=rootRef.current?.querySelector<HTMLElement>(`.${styles.atlasToolbar}`)?.getBoundingClientRect();
    const panel=rootRef.current?.querySelector<HTMLElement>("[data-atlas-sheet]")?.getBoundingClientRect();
    const left=rect.left+24;
    const right=mobile ? rect.right-24 : (panel?.left ?? rect.right-400)-24;
    const top=Math.max(rect.top+24,toolbar?.bottom ?? rect.top)+18;
    const bottom=mobile ? (panel?.top ?? rect.bottom-145)-18 : rect.bottom-34;
    const displayScale=Math.hypot(matrix.a,matrix.b);
    const availableWidth=Math.max(100,right-left), availableHeight=Math.max(160,bottom-top);
    const scale=clamp(Math.min(availableWidth/(displayScale*Math.max(.2,x1-x0)),availableHeight/(displayScale*Math.max(.2,y1-y0)))*.83,1.45,64);
    const center=new DOMPoint((left+right)/2,(top+bottom)/2).matrixTransform(matrix.inverse());
    select(svg).call(behavior.transform,zoomIdentity.translate(center.x-scale*(x0+x1)/2,center.y-scale*(y0+y1)/2).scale(scale));
  }, []);

  const focusPatternNote = useCallback((note: AtlasPatternNote) => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const behavior = zoomBehaviorRef.current;
    if (!svg || !behavior) return;
    const point = note.spatial.focus.projected;
    const bounds = note.spatial.viewingBoundsProjected;
    const scale = bounds ? clamp(0.55 / Math.max(
      Math.max(4, bounds[1][0] - bounds[0][0]) / VIEWBOX_WIDTH,
      Math.max(4, bounds[1][1] - bounds[0][1]) / VIEWBOX_HEIGHT,
    ), 2.5, 28) : 2.5;
    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    const targetX = isMobile ? VIEWBOX_WIDTH / 2 : 485;
    let targetY = VIEWBOX_HEIGHT / 2;
    if (isMobile) {
      const rect = svg.getBoundingClientRect();
      const toolbar = rootRef.current?.querySelector<HTMLElement>(`.${styles.atlasToolbar}`)?.getBoundingClientRect();
      const noteCard = rootRef.current?.querySelector<HTMLElement>(`.${styles.noteCard}`)?.getBoundingClientRect();
      const displayScale = Math.max(rect.width / VIEWBOX_WIDTH, rect.height / VIEWBOX_HEIGHT);
      const letterboxTop = (rect.height - VIEWBOX_HEIGHT * displayScale) / 2;
      const visibleCenter = ((toolbar?.bottom ?? rect.top) + (noteCard?.top ?? rect.top + rect.height * 0.5)) / 2 - rect.top;
      targetY = (visibleCenter - letterboxTop) / displayScale;
    }
    const transform = zoomIdentity
      .translate(targetX - scale * point[0], targetY - scale * point[1])
      .scale(scale);
    select(svg).call(behavior.transform, transform);
  }, []);

  const selectCountry = useCallback((
    country: AtlasRuntimeCountrySummary,
    shouldFocus: boolean,
    push = true,
    nextSheetDetent: AtlasSheetDetent = "peek",
    moveFocusToPanel = false,
  ) => {
    if (moveFocusToPanel) {
      const activeElement = document.activeElement;
      focusReturnRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : searchInputRef.current;
      focusPanelOnReadyRef.current = true;
    }
    clearMapHover();
    suppressHoverUntilMoveRef.current = true;
    setSelectedId(country.id);
    setSelectedDetail(detailCacheRef.current.get(country.id) ?? null);
    setDetailStatus(detailCacheRef.current.has(country.id) ? "ready" : "loading");
    setTooltip(null);
    setQuery(country.name);
    setSearchOpen(false);
    setSearchVisible(false);
    setSheetDetent(nextSheetDetent);
    const nextScene: AtlasSceneState = {
      ...scene,
      focus: { kind: "entity", id: country.id },
    };
    setScene(nextScene);
    writeSceneUrl(nextScene, country, null, push);
    if (shouldFocus) {
      const feature = featureById.get(country.id);
      if (feature) window.requestAnimationFrame(() => focusFeature(feature));
    }
  }, [clearMapHover, featureById, focusFeature, scene]);

  const closeCountry = useCallback((push = true) => {
    const returnTarget = focusReturnRef.current;
    const shouldRestoreFocus = Boolean(
      rootRef.current?.querySelector("[data-atlas-sheet], [data-atlas-place-card]")?.contains(document.activeElement),
    );
    clearMapHover();
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailStatus("idle");
    setTooltip(null);
    setQuery("");
    const nextScene: AtlasSceneState = { ...scene, focus: null };
    setScene(nextScene);
    writeSceneUrl(nextScene, null, null, push);
    focusPanelOnReadyRef.current = false;
    focusReturnRef.current = null;
    if (shouldRestoreFocus) {
      window.requestAnimationFrame(() => {
        const target = returnTarget?.isConnected && returnTarget.getClientRects().length ? returnTarget : searchButtonRef.current;
        target?.focus();
      });
    }
  }, [clearMapHover, scene]);

  const chooseView = useCallback((nextViewId: string) => {
    if (!isAtlasViewPresetId(nextViewId)) return;
    const nextScene = createAtlasSceneFromPreset(nextViewId);
    nextScene.focus = activePlace ? { kind: "feature", id: activePlace.placeId } : selectedCountry
      ? { kind: "entity", id: selectedCountry.id }
      : nextViewId === "where-people-live" && activeNote
        ? { kind: "feature", id: activeNote.id }
        : null;
    setScene(nextScene);
    setTooltip(null);
    writeSceneUrl(nextScene, selectedCountry, activePlace, false);
  }, [activePlace, activeNote, selectedCountry]);

  const toggleLayer = useCallback((instanceId: string) => {
    const nextScene = sceneWithLayerToggled(scene, instanceId);
    if (!nextScene) return;
    if (!buildAtlasRenderPlan(nextScene).valid) return;
    setScene(nextScene);
    writeSceneUrl(nextScene, selectedCountry, activePlace, false);
  }, [activePlace, scene, selectedCountry]);

  const selectPatternNote = useCallback((note: AtlasPatternNote, push = true) => {
    clearMapHover();
    const nextScene: AtlasSceneState = {
      ...scene,
      focus: { kind: "feature", id: note.id },
    };
    setScene(nextScene);
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailStatus("idle");
    setTooltip(null);
    setQuery("");
    writeSceneUrl(nextScene, null, null, push);
    window.requestAnimationFrame(() => focusPatternNote(note));
  }, [clearMapHover, focusPatternNote, scene]);

  const closePatternNote = useCallback((push = true) => {
    if (!activeNote) return;
    const nextScene: AtlasSceneState = { ...scene, focus: null };
    setScene(nextScene);
    writeSceneUrl(nextScene, null, null, push);
  }, [activeNote, scene]);

  const focusPlace = useCallback((place: AtlasPlaceSummary) => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]");
    const behavior = zoomBehaviorRef.current;
    if (!svg || !behavior) return;
    const [[x0, y0], [x1, y1]] = place.boundsProjected;
    const width = Math.max(place.kind === "city" ? 24 : 3, x1 - x0);
    const height = Math.max(place.kind === "city" ? 24 : 3, y1 - y0);
    const mobile = window.matchMedia("(max-width:760px)").matches;
    const targetX = mobile ? VIEWBOX_WIDTH / 2 : 470;
    const targetY = mobile ? VIEWBOX_HEIGHT * 0.38 : VIEWBOX_HEIGHT / 2;
    const fitted = Math.min(760 / width, 470 / height) * 0.82;
    const scale = clamp(fitted, place.kind === "city" ? 14 : 1.8, place.kind === "city" ? 28 : 64);
    select(svg).call(behavior.transform, zoomIdentity
      .translate(targetX - ((x0 + x1) / 2) * scale, targetY - ((y0 + y1) / 2) * scale)
      .scale(scale));
  }, []);

  const selectPlace = useCallback((place: AtlasPlaceSummary, focusDetails = false, push = true) => {
    focusPlaceOnReadyRef.current = focusDetails;
    clearMapHover();
    suppressHoverUntilMoveRef.current = true;
    const nextScene: AtlasSceneState = { ...scene, focus: { kind: "feature", id: place.placeId } };
    setScene(nextScene);
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailStatus("idle");
    setQuery(place.name);
    setSearchOpen(false);
    setSearchVisible(false);
    writeSceneUrl(nextScene, null, place, push);
    focusPlace(place);
  }, [clearMapHover, focusPlace, scene]);

  useEffect(() => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const group = svg?.querySelector<SVGGElement>("[data-atlas-map-group]") ?? null;
    if (!svg || !group) return;

    let frame = 0;
    let previousDetailBand = -1;
    const drawReadingAids = () => {
      frame = 0;
      const scale = zoomScaleRef.current;
      const detailBand = [1, 4, 6, 8, 10, 14, 16, 20, 24, 32].filter((threshold) => scale >= threshold).length;
      if (detailBand !== previousDetailBand) {
        applyAtlasZoomVisibility(group, scale);
        previousDetailBand = detailBand;
      }
      updateAtlasCartography(svg, scale, selectedIdRef.current);
    };
    const scheduleReadingAids = () => {
      if (!frame) frame = requestAnimationFrame(drawReadingAids);
    };
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.55, 128])
      .wheelDelta((event) => -event.deltaY * (event.deltaMode === 1 ? 0.025 : 0.0016) * (event.ctrlKey ? 4 : 1))
      .clickDistance(5)
      .translateExtent([[ATLAS_WORLD_BOUNDS[0][0] - 170, -170], [ATLAS_WORLD_BOUNDS[1][0] + 170, 820]])
      .extent([[0, 0], [VIEWBOX_WIDTH, VIEWBOX_HEIGHT]])
      .on("zoom", (event) => {
        zoomScaleRef.current = event.transform.k;
        group.setAttribute("transform", event.transform.toString());
        group.setAttribute("data-atlas-zoom-scale", event.transform.k.toFixed(3));
        group.setAttribute(
          "data-atlas-zoom-level",
          event.transform.k >= 3.6 ? "country" : event.transform.k >= 1.8 ? "regional" : "world",
        );
        scheduleReadingAids();
      });

    const selection = select(svg);
    svg.setAttribute("preserveAspectRatio", window.matchMedia("(max-width:760px)").matches ? "xMidYMid slice" : "xMidYMid meet");
    selection.call(behavior).on("dblclick.zoom", null);
    selection.call(behavior.transform, initialCamera());
    zoomBehaviorRef.current = behavior;
    const resize = new ResizeObserver(() => {
      svg.setAttribute("preserveAspectRatio", window.matchMedia("(max-width:760px)").matches ? "xMidYMid slice" : "xMidYMid meet");
      scheduleReadingAids();
    });
    resize.observe(svg);
    scheduleReadingAids();

    return () => {
      selection.on(".zoom", null);
      cancelAnimationFrame(frame);
      resize.disconnect();
      zoomBehaviorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    const active = new Map(renderPlan.layers.map((entry) => [entry.definition.id, entry]));
    host.querySelectorAll<SVGElement>("[data-atlas-layer]").forEach((element) => {
      const layerId = element.dataset.atlasLayer;
      const entry = layerId ? active.get(layerId) : null;
      const assetHref = element.dataset.atlasAssetHref;
      if (entry && assetHref && !element.getAttribute("href")) {
        element.setAttribute("href", assetHref);
      }
      element.dataset.atlasLayerActive = entry ? "true" : "false";
      element.style.display = entry && elementIsVisibleAtZoom(element, zoomScaleRef.current) ? "" : "none";
      element.style.opacity = entry ? String(entry.effectiveOpacity) : "";
    });
    applyAtlasZoomVisibility(host, zoomScaleRef.current);
    const svg = host.querySelector<SVGSVGElement>("[data-atlas-world-map]");
    if (svg) updateAtlasCartography(svg, zoomScaleRef.current, selectedIdRef.current);
  }, [renderPlan.layers]);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    selectedIdRef.current = selectedIdentity;
    const labelInks = new Map<string, ReturnType<typeof atlasLabelInk>>();
    host.querySelectorAll<SVGElement>("[data-atlas-visual]").forEach((visual) => {
      const countryId = visual.dataset.atlasVisual;
      if (!countryId) return;
      const country = countryById.get(countryId);
      const feature = featureById.get(countryId);
      if (!country || !feature) return;
      if (primaryFillLayer) {
        const resolved = resolveLayerValue(
          primaryFillLayer,
          country,
          feature,
          layerData[primaryFillLayer.instance.id],
        );
        visual.style.fill = resolved?.color ?? "#28383b";
        visual.style.opacity = String(primaryFillLayer.effectiveOpacity);
        labelInks.set(countryId, atlasLabelInk(resolved?.color ?? "#28383b", primaryFillLayer.effectiveOpacity));
      } else {
        visual.style.fill = "rgba(72, 91, 88, 0.28)";
        visual.style.opacity = "1";
      }
      const selected = countryId === selectedId;
      const isMarker = visual.tagName.toLocaleLowerCase() === "circle";
      visual.classList.toggle(styles.selectedShape, selected && !isMarker);
      visual.classList.toggle(styles.selectedMarker, selected && isMarker);
    });
    host.querySelectorAll<SVGElement>("[data-atlas-place]").forEach((visual) => {
      visual.dataset.atlasPlaceSelected = visual.dataset.atlasPlace === activePlace?.placeId ? "true" : "false";
    });
    const solidPolitical = primaryFillLayer?.definition.id === "admin0-political" && primaryFillLayer.effectiveOpacity > 0.5;
    // Resolve text contrast when the lens changes, not on every pan frame.
    host.querySelectorAll<SVGTextElement>("[data-atlas-label-entity], [data-atlas-label-country]").forEach((label) => {
      const ink = labelInks.get(label.dataset.atlasLabelEntity ?? label.dataset.atlasLabelCountry ?? "");
      label.style.fill = ink?.fill ?? "#152820";
      const needsKeyline = !solidPolitical || ink?.needsKeyline;
      label.style.stroke = needsKeyline ? ink?.keyline ?? "#f3f3e7" : "none";
      label.style.strokeWidth = needsKeyline ? "1.05" : "0";
    });
    const svg = host.querySelector<SVGSVGElement>("[data-atlas-world-map]");
    if (svg) updateAtlasCartography(svg, zoomScaleRef.current, selectedIdentity);
  }, [activePlace?.placeId, countryById, featureById, layerData, primaryFillLayer, selectedId, selectedIdentity]);

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
    if (!focusPanelOnReadyRef.current || detailStatus !== "ready" || !selectedDetail) return;
    focusPanelOnReadyRef.current = false;
    window.requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>("[data-atlas-sheet]")?.focus();
    });
  }, [detailStatus, selectedDetail]);

  useEffect(() => {
    const root=rootRef.current;
    const panel=root?.querySelector<HTMLElement>("[data-atlas-sheet], [data-atlas-place-card]");
    if(!root || !panel)return;
    const sync=() => {
      root.style.setProperty("--atlas-sheet-height",`${panel.getBoundingClientRect().height}px`);
      const svg=mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]");
      if(svg)updateAtlasCartography(svg,zoomScaleRef.current,selectedIdRef.current);
    };
    const observer=new ResizeObserver(sync);
    observer.observe(panel); sync();
    return()=>observer.disconnect();
  },[activePlace,selectedDetail]);

  useEffect(() => {
    const restoreFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const resolved = resolveAtlasInitialState(params, data.countries, places, patternNotes);
      const nextScene = resolved.scene;
      const nextCountry = resolved.countryId ? countryById.get(resolved.countryId) ?? null : null;
      const focusedPlace = resolved.placeId ? placeById.get(resolved.placeId) ?? null : null;
      const focusedNote = resolved.noteId
        ? patternNotes.find((note) => note.id === resolved.noteId) ?? null
        : null;

      setScene(nextScene);
      setSelectedId(nextCountry?.id ?? null);
      if (nextCountry) {
        const cached = detailCacheRef.current.get(nextCountry.id) ?? null;
        setSelectedDetail(cached);
        setDetailStatus(cached ? "ready" : "loading");
      } else {
        setSelectedDetail(null);
        setDetailStatus("idle");
      }
      setQuery(nextCountry?.name ?? focusedPlace?.name ?? "");
      if (resolved.needsCanonicalUrl) {
        recordAtlasEvent("Atlas scene repaired", {
          view: nextScene.viewPresetId,
          focus: nextScene.focus?.kind ?? "none",
          countryAlias: params.has("country"),
          cityAlias: params.has("city"),
          featureAlias: params.has("feature"),
        }, "atlas-scene-repaired");
        writeSceneUrl(nextScene, nextCountry, focusedPlace, false);
      }
      if (nextCountry) setSheetDetent("peek");
      if (nextCountry) {
        const feature = featureById.get(nextCountry.id);
        if (feature) window.requestAnimationFrame(() => focusFeature(feature));
      } else if (focusedNote) {
        window.requestAnimationFrame(() => focusPatternNote(focusedNote));
      } else if (focusedPlace) {
        window.requestAnimationFrame(() => focusPlace(focusedPlace));
      }
    };

    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, [countryById, data.countries, featureById, focusFeature, focusPatternNote, focusPlace, patternNotes, placeById, places]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // Native dialogs own their keyboard interaction; do not open background
      // controls or dismiss the selected country underneath a definition.
      if (document.querySelector("dialog[open]")) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if ((event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key === "k"))
        && !target?.closest("input, textarea, select") && !target?.isContentEditable
        && !searchButtonRef.current?.closest("[inert]")) {
        event.preventDefault();
        setSearchVisible(true);
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key !== "Escape") return;
      if (searchOpen || searchVisible) {
        setSearchOpen(false);
        setSearchVisible(false);
        searchButtonRef.current?.focus();
        return;
      }
      if (activeNote) closePatternNote();
      else if (selectedId || activePlace) closeCountry();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeNote, activePlace, closeCountry, closePatternNote, searchOpen, searchVisible, selectedId]);

  const chooseSearchResult = useCallback((result: AtlasSearchResult | undefined) => {
    if (!result) return;
    if (result.kind === "country") selectCountry(result.country, true, true, "half", true);
    else selectPlace(result.place, true);
  }, [selectCountry, selectPlace]);

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
      chooseSearchResult(searchResults[activeResult] ?? searchResults[0]);
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

  const noteIdFromTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    return target.closest<SVGElement>("[data-atlas-note]")?.dataset.atlasNote ?? null;
  };

  const placeIdFromTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    return target.closest<SVGElement>("[data-atlas-place]")?.dataset.atlasPlace ?? null;
  };

  const handleMapPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    if (suppressHoverUntilMoveRef.current) return;
    const placeId = placeIdFromTarget(event.target);
    const place = placeId ? placeById.get(placeId) ?? null : null;
    if (place && place.name !== "Unnamed feature") {
      if (place.placeId === hoveredPlaceIdRef.current) return;
      clearMapHover();
      hoveredPlaceIdRef.current = place.placeId;
      togglePlaceHoverVisual(place.placeId, true);
      setTooltip({ placeId: place.placeId, ...pointerPosition(event) });
      return;
    }
    const countryId = countryIdFromTarget(event.target);
    if (!countryId || countryId === hoveredIdRef.current) return;
    toggleHoverVisual(hoveredIdRef.current, false);
    hoveredIdRef.current = countryId;
    toggleHoverVisual(countryId, true);
    setTooltip({ countryId, ...pointerPosition(event) });
  };

  const handleMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    if (suppressHoverUntilMoveRef.current) {
      // Removing the search menu can place a stationary pointer over a
      // different country and cause a zero-distance pointermove. Keep that
      // layout event from opening an unrelated tooltip beside the new place.
      if (event.movementX === 0 && event.movementY === 0) return;
      suppressHoverUntilMoveRef.current = false;
      const placeId = placeIdFromTarget(event.target);
      const place = placeId ? placeById.get(placeId) ?? null : null;
      if (place && place.name !== "Unnamed feature") {
        hoveredPlaceIdRef.current = place.placeId;
        togglePlaceHoverVisual(place.placeId, true);
        setTooltip({ placeId: place.placeId, ...pointerPosition(event) });
        return;
      }
      const countryId = countryIdFromTarget(event.target);
      if (countryId) {
        hoveredIdRef.current = countryId;
        toggleHoverVisual(countryId, true);
        setTooltip({ countryId, ...pointerPosition(event) });
      }
      return;
    }
    if ((!hoveredIdRef.current && !hoveredPlaceIdRef.current) || !tooltipRef.current) return;
    const position = pointerPosition(event);
    tooltipRef.current.style.left = `${position.x}px`;
    tooltipRef.current.style.top = `${position.y}px`;
  };

  const mapControl = (action: "in" | "out" | "reset") => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const behavior = zoomBehaviorRef.current;
    if (!svg || !behavior) return;
    const selection = select(svg);
    if (action === "reset") selection.call(behavior.transform, initialCamera());
    else selection.call(behavior.scaleBy, action === "in" ? 1.45 : 1 / 1.45);
  };

  const tooltipLayerValue = tooltipCountry && tooltipFeature && primaryFillLayer
    ? resolveLayerValue(primaryFillLayer, tooltipCountry, tooltipFeature, layerData[primaryFillLayer.instance.id])
    : null;
  const selectedFeature = selectedCountry ? featureById.get(selectedCountry.id) ?? null : null;
  const selectedLayerValue = selectedCountry && selectedFeature && primaryFillLayer
    ? resolveLayerValue(primaryFillLayer, selectedCountry, selectedFeature, layerData[primaryFillLayer.instance.id])
    : null;
  const primaryLayerPayload = primaryFillLayer ? layerData[primaryFillLayer.instance.id] : undefined;
  const primaryLayerError = primaryFillLayer ? layerErrors[primaryFillLayer.instance.id] : undefined;
  const primaryLayerLoading = primaryFillLayer?.dataset.access.kind === "api"
    && !primaryLayerPayload
    && !primaryLayerError;
  const spatialPopulationView = scene.viewPresetId === "where-people-live";
  const primarySourceIds = spatialPopulationView
    ? renderPlan.sources
    : primaryFillLayer
    ? [...new Set([
        ...primaryFillLayer.dataset.sourceIds,
        ...primaryFillLayer.definition.provenance.sourceIds,
      ])]
    : [];
  const countryLens: AtlasCountryLensContext = {
    name: spatialPopulationView ? view.name : primaryFillLayer?.definition.name ?? view.name,
    description: spatialPopulationView ? view.description : primaryFillLayer?.definition.description ?? view.description,
    valueLabel: spatialPopulationView
      ? "Modelled population density · terrain, water & cities"
      : primaryLayerLoading
        ? "Loading the sourced country value…"
        : primaryLayerError
          ? "This layer’s country value could not be loaded."
          : selectedLayerValue?.tooltip ?? "No country-level value in this view",
    observedAt: spatialPopulationView ? "2025" : selectedLayerValue?.temporal?.observedAt ?? null,
    sourceIds: spatialPopulationView ? ["ghsl-ghs-pop-2025-r2023a-1km"] : primarySourceIds,
  };
  const mapControlsInactive = isMobileLayout
    && (Boolean(activeNote) || (sheetDetent === "full" && Boolean(selectedCountry)));

  const highlightCategory = (key: string | null) => {
    if (!primaryFillLayer) return;
    mapHostRef.current?.querySelectorAll<SVGElement>("[data-atlas-visual]").forEach((visual) => {
      const id = visual.dataset.atlasVisual;
      const country = id ? countryById.get(id) : null;
      const feature = id ? featureById.get(id) : null;
      if (!country || !feature) return;
      const value = resolveLayerValue(primaryFillLayer, country, feature, layerData[primaryFillLayer.instance.id]);
      visual.style.opacity = String(primaryFillLayer.effectiveOpacity * (key && value?.key !== key ? 0.18 : 1));
    });
  };

  return (
    <div
      className={`${styles.atlas} ${selectedCountry || activePlace ? styles.panelOpen : ""} ${selectedCountry && sheetDetent === "half" ? styles.panelHalf : ""} ${selectedCountry && sheetDetent === "full" ? styles.panelFull : ""}`}
      ref={rootRef}
      data-atlas-root
      data-atlas-view={scene.viewPresetId}
      data-atlas-focus={scene.focus?.kind ?? "none"}
      data-atlas-focus-id={scene.focus?.kind === "entity" || scene.focus?.kind === "feature"
        ? scene.focus.id
        : undefined}
    >
      <div className={styles.mapBackdrop} aria-hidden="true" />

      <header
        className={styles.atlasToolbar}
        inert={isMobileLayout && sheetDetent === "full" && Boolean(selectedCountry)}
      >
        <div className={styles.atlasTitle}><Link href="/" aria-label="JJ University home" className={styles.mobileHome}>JJ</Link><h1>ATLAS</h1></div>
        <AtlasViewBrowser activeViewId={scene.viewPresetId} onChoose={chooseView} />
        <button ref={searchButtonRef} type="button" className={styles.searchTrigger} aria-label="Find a place"
          aria-expanded={searchVisible} onClick={() => {
            setSearchVisible((open) => !open);
            window.requestAnimationFrame(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); });
          }}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span>Find a place</span><kbd>/</kbd></button>

        <div
          className={`${styles.search} ${searchVisible ? styles.searchVisible : ""}`}
          hidden={!searchVisible}
          ref={searchRef}
          onBlur={(event) => {
            if (!searchRef.current?.contains(event.relatedTarget)) setSearchOpen(false);
          }}
        >
          <span className={styles.searchIcon} aria-hidden="true">⌕</span>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder="Country, city, river, lake…"
            aria-label="Find a country, city, river, or lake"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchOpen && searchResults.length > 0}
            aria-controls="atlas-country-results"
            aria-activedescendant={searchOpen && searchResults[activeResult] ? searchResultId(searchResults[activeResult]) : undefined}
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
              aria-label="Clear place search"
              onClick={() => {
                setQuery("");
                setSearchOpen(true);
              }}
            >×</button>
          )}
          {searchOpen && searchResults.length > 0 && (
            <ul className={styles.searchResults} id="atlas-country-results" role="listbox">
              {searchResults.map((result, index) => {
                const name = result.kind === "country" ? result.country.name : result.place.name;
                const context = result.kind === "country"
                  ? `Country · ${result.country.facts.capital?.value ?? result.country.geography.region}`
                  : result.place.kind === "city"
                    ? `${result.place.isNationalCapital ? "National capital" : "City"}${result.place.countryId && countryById.has(result.place.countryId) ? ` · ${countryById.get(result.place.countryId)!.name}` : ""}${result.place.administrativeRegion ? ` · ${result.place.administrativeRegion}` : ""}`
                    : `${result.place.kind === "river" ? "River" : "Lake"}${result.place.relatedCountryIds.length ? ` · ${result.place.relatedCountryIds.slice(0, 3).map((id) => countryById.get(id)?.name).filter(Boolean).join(", ")}` : ""}`;
                return (
                  <li
                    key={result.kind === "country" ? result.country.id : result.place.placeId}
                    id={searchResultId(result)}
                    role="option"
                    aria-selected={index === activeResult}
                    className={index === activeResult ? styles.activeResult : ""}
                    onPointerDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveResult(index)}
                    onClick={() => chooseSearchResult(result)}
                  >
                    <span>{name}</span>
                    <small>{context}</small>
                  </li>
                );
              })}
            </ul>
          )}
          {searchOpen && normalized(query) && searchResults.length === 0 && (
            <div className={styles.noResults}>
              {placeIndexStatus === "loading" ? "Loading places…" : "No place found"}
            </div>
          )}
        </div>

      </header>

      <div
        className={styles.mapStage}
        ref={mapHostRef}
        role="group"
        aria-label={`Interactive world map in the ${view.name} view. Use place search to explore with a keyboard.`}
        onPointerOver={handleMapPointerOver}
        onPointerMove={handleMapPointerMove}
        onPointerOut={(event) => {
          const nextPlaceId = placeIdFromTarget(event.relatedTarget);
          if (nextPlaceId && placeById.get(nextPlaceId)?.placeId === hoveredPlaceIdRef.current) return;
          const nextCountryId = countryIdFromTarget(event.relatedTarget);
          if (nextCountryId !== hoveredIdRef.current) clearMapHover();
        }}
        onPointerLeave={clearMapHover}
        onClick={(event) => {
          const placeId = placeIdFromTarget(event.target);
          const place = placeId ? placeById.get(placeId) ?? null : null;
          if (place && place.name !== "Unnamed feature") { selectPlace(place); return; }
          const noteId = noteIdFromTarget(event.target);
          const note = noteId ? patternNotes.find((candidate) => candidate.id === noteId) : null;
          if (note) {
            selectPatternNote(note);
            return;
          }
          const countryId = countryIdFromTarget(event.target);
          const country = countryId ? countryById.get(countryId) : null;
          if (country) selectCountry(country, zoomScaleRef.current < 4);
        }}
      >
        {map}
      </div>

      {tooltip && tooltipPlace && <div ref={tooltipRef} className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }} role="status">
        <strong>{tooltipPlace.name}</strong>
        <span>{tooltipPlace.kind === "city"
          ? `${tooltipPlace.isNationalCapital ? "National capital" : "City"}${tooltipPlace.countryId && countryById.has(tooltipPlace.countryId) ? ` · ${countryById.get(tooltipPlace.countryId)!.name}` : ""}`
          : `${tooltipPlace.kind === "river" ? "River" : "Lake"}${tooltipPlace.relatedCountryIds.length ? ` · ${tooltipPlace.relatedCountryIds.length} mapped ${tooltipPlace.relatedCountryIds.length === 1 ? "country" : "countries"}` : ""}`}</span>
      </div>}
      {activePlace && <AtlasPlaceCard place={activePlace} countries={data.countries}
        sources={data.sources} onClose={() => closeCountry()} onCountry={(countryId) => {
          const country = countryById.get(countryId);
          if (country) selectCountry(country, false, true, "half", true);
        }} />}

      {tooltip && tooltipCountry && (
        <div ref={tooltipRef} className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }} role="status">
          <strong>{tooltipCountry.name}</strong>
          {getAtlasTerritorialStatus(tooltipCountry).kind !== "standard" && <small className={styles.statusBadge}>{getAtlasTerritorialStatus(tooltipCountry).badge}</small>}
          <span>Capital: {tooltipCountry.facts.capital?.value ?? "Not available"}</span>
          <span>
            Population: {tooltipCountry.facts.population
              ? compactFormatter.format(tooltipCountry.facts.population.value)
              : "Not available"}
          </span>
          {scene.viewPresetId === "political" && tooltipCountry.facts.government && (
            <span>{tooltipCountry.facts.government.value.raw}</span>
          )}
          {spatialPopulationView && (
            <em>Map layer: modelled 2025 population density</em>
          )}
          {primaryFillLayer && scene.viewPresetId !== "political" && !spatialPopulationView && (
            <em>
              {primaryFillLayer.definition.name}: {primaryLayerLoading
                ? "Loading sourced value…"
                : primaryLayerError
                  ? "Layer data unavailable"
                  : tooltipLayerValue?.tooltip ?? "Not available"}
            </em>
          )}
          {scene.viewPresetId === "religion" && tooltipCountry.facts.religion && (
            <div className={styles.tooltipComposition}>
              {tooltipCountry.facts.religion.value.composition.slice().sort((a, b) => b.sharePercent - a.sharePercent).slice(0, 4).map((part) => (
                <span key={part.category}>{part.category.replace(/_/g, " ")} <b>{part.shareIsApproximate ? "≈" : ""}{part.sharePercent}%</b></span>
              ))}
              <small>Available composition · select for source notes</small>
            </div>
          )}
        </div>
      )}

      <AtlasLegend
        viewName={view.name}
        viewDescription={view.description}
        plan={renderPlan}
        counts={legendCounts}
        sources={data.sources}
        generatedAt={data.generatedAt}
        layerData={layerData}
        layerErrors={layerErrors}
        onToggleLayer={toggleLayer}
        inactive={isMobileLayout && sheetDetent !== "peek" && Boolean(selectedCountry)}
        onHighlightCategory={highlightCategory}
      />

      {scene.viewPresetId === "where-people-live"
        && renderPlan.layers.some((entry) => entry.definition.id === "population-geography-annotations") && (
          <AtlasMapNotes
            notes={patternNotes}
            activeNote={activeNote}
            onSelect={selectPatternNote}
            onClose={() => closePatternNote()}
            onExploreCountry={(entityId) => {
              const country = countryById.get(entityId);
              if (country) selectCountry(country, true, true, "half", true);
            }}
            inactive={isMobileLayout && sheetDetent === "full" && Boolean(selectedCountry)}
          />
        )}

      <div
        className={styles.mapControls}
        role="group"
        aria-label="Map controls"
        aria-hidden={mapControlsInactive || undefined}
        inert={mapControlsInactive}
      >
        <button type="button" onClick={() => mapControl("in")} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => mapControl("out")} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => mapControl("reset")} aria-label="Reset world view" className={styles.resetControl}>⌂</button>
      </div>


      {selectedCountry && selectedDetail?.id === selectedCountry.id && detailStatus === "ready" && (
        <AtlasCountryPanel
          key={selectedDetail.id}
          country={selectedDetail}
          sources={data.sources}
          activeLens={countryLens}
          sheetDetent={sheetDetent}
          onSheetDetentChange={setSheetDetent}
          onShowView={chooseView}
          cities={selectedCities}
          onShowCity={(id) => { const city = placeById.get(id); if (city?.kind === "city") selectPlace(city, true); }}
          onClose={() => closeCountry()}
        />
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
        {selectedCountry
          ? `${selectedCountry.name} selected. `
          : activePlace
            ? `${activePlace.name} ${activePlace.kind} selected. `
            : ""}{view.name} Atlas view.
      </p>
    </div>
  );
}
