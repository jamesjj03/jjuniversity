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
  ATLAS_LAYER_BY_ID,
  ATLAS_VIEW_PRESET_BY_ID,
  ATLAS_VIEW_PRESETS,
  applyAtlasSceneToSearchParams,
  buildAtlasRenderPlan,
  createAtlasSceneFromPreset,
  isAtlasViewPresetId,
  parseAtlasSceneSearchParams,
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

function writeSceneUrl(
  scene: AtlasSceneState,
  country: AtlasRuntimeCountrySummary | null,
  push: boolean,
) {
  const url = new URL(window.location.href);
  const params = applyAtlasSceneToSearchParams(scene, url.searchParams);
  if (country) params.set("country", countryUrlKey(country));
  else params.delete("country");
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
    element.dataset.atlasZoomVisible = visibleAtZoom ? "true" : "false";
    element.style.display = visibleAtZoom && layerIsActive ? "" : "none";
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

export default function AtlasWorldExperience({ data, patternNotes, map }: AtlasWorldExperienceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const suppressHoverUntilMoveRef = useRef(false);
  const focusPanelOnReadyRef = useRef(false);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const detailCacheRef = useRef(new Map<string, AtlasRuntimeCountry>());
  const layerDataCacheRef = useRef(new Map<string, AtlasLayerDataResponse>());
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const zoomScaleRef = useRef(1);
  const [scene, setScene] = useState<AtlasSceneState>(() => createAtlasSceneFromPreset());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AtlasRuntimeCountry | null>(null);
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailRetry, setDetailRetry] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [sheetDetent, setSheetDetent] = useState<AtlasSheetDetent>("peek");
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [layerData, setLayerData] = useState<Record<string, AtlasLayerDataResponse>>({});
  const [layerErrors, setLayerErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobileLayout(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

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
          setLayerErrors((current) => ({
            ...current,
            [entry.instance.id]: error instanceof Error ? error.message : "Layer data could not load.",
          }));
        });
    }
    return () => controllers.forEach((controller) => controller.abort());
  }, [apiLayerRequestKey, renderPlan.layers]);

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

  const focusProjectedPoint = useCallback((point: [number, number], scale = 2.25) => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const behavior = zoomBehaviorRef.current;
    if (!svg || !behavior) return;
    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    const targetX = isMobile ? VIEWBOX_WIDTH / 2 : 485;
    const targetY = isMobile ? 245 : VIEWBOX_HEIGHT / 2;
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
    setSheetDetent(nextSheetDetent);
    const nextScene: AtlasSceneState = {
      ...scene,
      focus: { kind: "entity", id: country.id },
    };
    setScene(nextScene);
    writeSceneUrl(nextScene, country, push);
    if (shouldFocus) {
      const feature = featureById.get(country.id);
      if (feature) window.requestAnimationFrame(() => focusFeature(feature));
    }
  }, [clearMapHover, featureById, focusFeature, scene]);

  const closeCountry = useCallback((push = true) => {
    const returnTarget = focusReturnRef.current;
    const shouldRestoreFocus = Boolean(
      rootRef.current?.querySelector("[data-atlas-sheet]")?.contains(document.activeElement),
    );
    clearMapHover();
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailStatus("idle");
    setTooltip(null);
    setQuery("");
    const nextScene: AtlasSceneState = { ...scene, focus: null };
    setScene(nextScene);
    writeSceneUrl(nextScene, null, push);
    focusPanelOnReadyRef.current = false;
    focusReturnRef.current = null;
    if (shouldRestoreFocus) {
      window.requestAnimationFrame(() => {
        const target = returnTarget?.isConnected ? returnTarget : searchInputRef.current;
        target?.focus();
      });
    }
  }, [clearMapHover, scene]);

  const chooseView = useCallback((nextViewId: string) => {
    if (!isAtlasViewPresetId(nextViewId)) return;
    const nextScene = createAtlasSceneFromPreset(nextViewId);
    nextScene.focus = selectedCountry
      ? { kind: "entity", id: selectedCountry.id }
      : nextViewId === "where-people-live" && activeNote
        ? { kind: "feature", id: activeNote.id }
        : null;
    setScene(nextScene);
    setTooltip(null);
    writeSceneUrl(nextScene, selectedCountry, false);
  }, [activeNote, selectedCountry]);

  const toggleLayer = useCallback((instanceId: string) => {
    const nextScene = sceneWithLayerToggled(scene, instanceId);
    if (!nextScene) return;
    if (!buildAtlasRenderPlan(nextScene).valid) return;
    setScene(nextScene);
    writeSceneUrl(nextScene, selectedCountry, false);
  }, [scene, selectedCountry]);

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
    writeSceneUrl(nextScene, null, push);
    window.requestAnimationFrame(() => focusProjectedPoint(note.spatial.focus.equalEarth));
  }, [clearMapHover, focusProjectedPoint, scene]);

  const closePatternNote = useCallback((push = true) => {
    if (!activeNote) return;
    const nextScene: AtlasSceneState = { ...scene, focus: null };
    setScene(nextScene);
    writeSceneUrl(nextScene, null, push);
  }, [activeNote, scene]);

  useEffect(() => {
    const svg = mapHostRef.current?.querySelector<SVGSVGElement>("[data-atlas-world-map]") ?? null;
    const group = svg?.querySelector<SVGGElement>("[data-atlas-map-group]") ?? null;
    if (!svg || !group) return;

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .translateExtent([[-220, -100], [VIEWBOX_WIDTH + 220, VIEWBOX_HEIGHT + 100]])
      .extent([[0, 0], [VIEWBOX_WIDTH, VIEWBOX_HEIGHT]])
      .on("zoom", (event) => {
        zoomScaleRef.current = event.transform.k;
        group.setAttribute("transform", event.transform.toString());
        group.setAttribute("data-atlas-zoom-scale", event.transform.k.toFixed(3));
        group.setAttribute(
          "data-atlas-zoom-level",
          event.transform.k >= 3.6 ? "country" : event.transform.k >= 1.8 ? "regional" : "world",
        );
        applyAtlasZoomVisibility(group, event.transform.k);
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
  }, [renderPlan.layers]);

  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
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
      } else {
        visual.style.fill = "rgba(72, 91, 88, 0.28)";
        visual.style.opacity = "1";
      }
      const selected = countryId === selectedId;
      const isMarker = visual.tagName.toLocaleLowerCase() === "circle";
      visual.classList.toggle(styles.selectedShape, selected && !isMarker);
      visual.classList.toggle(styles.selectedMarker, selected && isMarker);
    });
  }, [countryById, featureById, layerData, primaryFillLayer, selectedId]);

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
    const restoreFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const parsed = parseAtlasSceneSearchParams(params);
      const rawCountry = params.get("country");
      const requestedCountry = normalized(rawCountry ?? "");
      const focusedCountry = parsed.scene.focus?.kind === "entity"
        ? countryById.get(parsed.scene.focus.id) ?? null
        : null;
      const legacyCountry = requestedCountry
        ? data.countries.find((country) => {
            const keys = [country.codes.iso3, country.codes.naturalEarth, country.codes.iso2, country.slug]
              .filter((value): value is string => Boolean(value))
              .map(normalized);
            return keys.includes(requestedCountry);
          }) ?? null
        : null;
      const focusedNoteId = parsed.scene.focus?.kind === "feature" ? parsed.scene.focus.id : null;
      const focusedNote = focusedNoteId
        ? patternNotes.find((note) => note.id === focusedNoteId) ?? null
        : null;
      const hasNonCountryFocus = parsed.scene.focus?.kind === "coordinate" || Boolean(focusedNote);
      const nextCountry = hasNonCountryFocus ? null : focusedCountry ?? legacyCountry;
      const nextScene: AtlasSceneState = nextCountry
        ? { ...parsed.scene, focus: { kind: "entity", id: nextCountry.id } }
        : parsed.scene.focus?.kind === "entity" || (parsed.scene.focus?.kind === "feature" && !focusedNote)
          ? { ...parsed.scene, focus: null }
          : parsed.scene;

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
      setQuery(nextCountry?.name ?? "");
      const focusWasCanonicalized = JSON.stringify(nextScene.focus) !== JSON.stringify(parsed.scene.focus);
      const countryWasCanonicalized = nextCountry
        ? requestedCountry !== normalized(countryUrlKey(nextCountry))
        : rawCountry != null;
      if (parsed.usedLegacyModeAlias || parsed.issues.length > 0 || focusWasCanonicalized || countryWasCanonicalized) {
        writeSceneUrl(nextScene, nextCountry, false);
      }
      if (nextCountry) setSheetDetent("half");
      if (nextCountry) {
        const feature = featureById.get(nextCountry.id);
        if (feature) window.requestAnimationFrame(() => focusFeature(feature));
      } else if (focusedNote) {
        window.requestAnimationFrame(() => focusProjectedPoint(focusedNote.spatial.focus.equalEarth));
      }
    };

    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);
    return () => window.removeEventListener("popstate", restoreFromUrl);
  }, [countryById, data.countries, featureById, focusFeature, focusProjectedPoint, patternNotes]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (activeNote) closePatternNote();
      else if (selectedId) closeCountry();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeNote, closeCountry, closePatternNote, searchOpen, selectedId]);

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
      selectCountry(searchResults[activeResult] ?? searchResults[0], true, true, "half", true);
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
      ? "A modelled population surface—not a country average—shown with terrain, water and cities."
      : primaryLayerLoading
        ? "Loading the sourced country value…"
        : primaryLayerError
          ? "This layer’s country value could not be loaded."
          : selectedLayerValue?.tooltip ?? "No country-level value in this view",
    observedAt: spatialPopulationView ? "2025" : selectedLayerValue?.temporal?.observedAt ?? null,
    sourceIds: primarySourceIds,
  };
  const mapControlsInactive = isMobileLayout
    && (Boolean(activeNote) || (sheetDetent === "full" && Boolean(selectedCountry)));

  return (
    <div
      className={`${styles.atlas} ${selectedCountry ? styles.panelOpen : ""} ${selectedCountry && sheetDetent === "half" ? styles.panelHalf : ""} ${selectedCountry && sheetDetent === "full" ? styles.panelFull : ""}`}
      ref={rootRef}
    >
      <div className={styles.mapBackdrop} aria-hidden="true" />

      <header
        className={styles.atlasToolbar}
        inert={isMobileLayout && sheetDetent === "full" && Boolean(selectedCountry)}
      >
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
            ref={searchInputRef}
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
                  onClick={() => selectCountry(country, true, true, "half", true)}
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

        <div className={styles.modeSwitcher} role="group" aria-label="Atlas view">
          {ATLAS_VIEW_PRESETS.filter((candidate) => candidate.shareable).map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={candidate.id === scene.viewPresetId ? styles.activeMode : ""}
              aria-pressed={candidate.id === scene.viewPresetId}
              onClick={() => chooseView(candidate.id)}
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
        aria-label={`Interactive world map in the ${view.name} view. Use country search to explore with a keyboard.`}
        onPointerOver={handleMapPointerOver}
        onPointerMove={handleMapPointerMove}
        onPointerOut={(event) => {
          const nextCountryId = countryIdFromTarget(event.relatedTarget);
          if (nextCountryId !== hoveredIdRef.current) clearMapHover();
        }}
        onPointerLeave={clearMapHover}
        onClick={(event) => {
          const noteId = noteIdFromTarget(event.target);
          const note = noteId ? patternNotes.find((candidate) => candidate.id === noteId) : null;
          if (note) {
            selectPatternNote(note);
            return;
          }
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
        onToggleLayer={scene.viewPresetId === "where-people-live" ? toggleLayer : undefined}
        inactive={isMobileLayout && Boolean(selectedCountry)}
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

      <div className={styles.interactionHint}>Drag to move · scroll or pinch to zoom · click a country</div>

      {selectedCountry && selectedDetail?.id === selectedCountry.id && detailStatus === "ready" && (
        <AtlasCountryPanel
          key={selectedDetail.id}
          country={selectedDetail}
          sources={data.sources}
          activeLens={countryLens}
          sheetDetent={sheetDetent}
          onSheetDetentChange={setSheetDetent}
          onShowView={chooseView}
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
        {selectedCountry ? `${selectedCountry.name} selected. ` : ""}{view.name} Atlas view.
      </p>
    </div>
  );
}
