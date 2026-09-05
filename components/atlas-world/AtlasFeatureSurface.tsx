"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  invalidateAtlasCartography,
  updateAtlasCartography,
} from "@/lib/atlas-world/cartography";
import type {
  AtlasFeatureSurfaceKind,
  AtlasFeatureSurfaceRecord,
} from "@/lib/atlas-world/featureSurface";
import type { AtlasLayerStyleSpec } from "@/lib/atlas-world/layers";
import { recordAtlasEvent } from "@/lib/atlas-world/telemetry";
import {
  atlasRenderedWorldOffsets,
  atlasVisibleWorldCopies,
  atlasWorldCopyPlacementsEqual,
  type AtlasWorldCopyPlacement,
} from "@/lib/atlas-world/worldWrap";
import styles from "./AtlasWorld.module.css";

type AtlasFeatureSurfaceProps = {
  kind: AtlasFeatureSurfaceKind;
  initialFeatures: AtlasFeatureSurfaceRecord[];
  style: AtlasLayerStyleSpec | undefined;
};

type AtlasCameraDetail = {
  zoom: number;
  selectedId: string | null;
};

let featureIndexRequest: Promise<AtlasFeatureSurfaceRecord[]> | null = null;

function loadFeatureIndex() {
  featureIndexRequest ??= fetch("/api/atlas/features")
    .then(async (response) => {
      if (!response.ok) throw new Error(`Feature index returned ${response.status}.`);
      const payload = await response.json() as { features?: AtlasFeatureSurfaceRecord[] };
      if (!Array.isArray(payload.features)) throw new Error("Feature index response was invalid.");
      return payload.features;
    })
    .catch((error) => {
      featureIndexRequest = null;
      throw error;
    });
  return featureIndexRequest;
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pointRadius(feature: AtlasFeatureSurfaceRecord, style: AtlasLayerStyleSpec | undefined) {
  const minimum = style?.symbolMinRadius ?? style?.symbolRadius ?? 1.45;
  const maximum = style?.symbolMaxRadius ?? Math.max(minimum, 2.35);
  if (feature.sourceScaleRank != null && feature.sourceScaleRank <= 1) return maximum;
  if (feature.isNationalCapital) return minimum + ((maximum - minimum) / 2);
  return minimum;
}

function featureHitId(feature: AtlasFeatureSurfaceRecord) {
  return `atlas-feature-hit-${feature.featureId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function PhysicalFeature({ feature, style, selected }: {
  feature: AtlasFeatureSurfaceRecord;
  style: AtlasLayerStyleSpec | undefined;
  selected: boolean;
}) {
  const [x, y] = feature.point;
  const hitId = featureHitId(feature);
  const common = {
    "data-atlas-map-feature": feature.featureId,
    "data-atlas-place": feature.placeId,
    "data-atlas-place-kind": feature.kind,
    "data-atlas-feature-bounds": feature.bounds.join(","),
    "data-atlas-minimum-zoom": feature.minimumZoom,
    "data-atlas-maximum-zoom": feature.maximumZoom ?? undefined,
    "data-atlas-place-selected": selected,
  };
  if (feature.kind === "lake") {
    return <g {...common} className={styles[`lod${feature.displayLod}`]}>
      {feature.name !== "Unnamed feature" && <g id={hitId}><use href={feature.geometryHref ?? undefined}
        data-atlas-geography-href={feature.geometryHref ?? undefined} className={styles.lakeHit}
        aria-label={`Select lake ${feature.name}`} vectorEffect="non-scaling-stroke" /></g>}
      <use href={feature.geometryHref ?? undefined} data-atlas-geography-href={feature.geometryHref ?? undefined}
        className={`${styles.lakeFeature} ${styles[`lod${feature.displayLod}`]}`}
        style={{ fill: style?.fillColor, fillOpacity: style?.fillOpacity, stroke: style?.strokeColor,
          strokeOpacity: style?.strokeOpacity, strokeWidth: style?.strokeWidth, strokeDasharray: style?.strokeDasharray }}
        vectorEffect="non-scaling-stroke"><title>{feature.name}</title></use>
      <text data-atlas-label="physical" data-atlas-label-place={feature.placeId}
        data-atlas-x={x} data-atlas-y={y} data-atlas-label-min-zoom="3.2"
        data-atlas-label-priority={40 + (feature.sourceScaleRank ?? 5)} className={styles.physicalLabel}
        transform={`translate(${x} ${y})`} style={{ display: "none" }} textAnchor="middle">
        {feature.name === "Unnamed feature" ? "" : feature.name}
      </text>
    </g>;
  }
  if (feature.kind === "water" || feature.kind === "watershed") {
    const isWater = feature.kind === "water";
    const featureClass = isWater ? styles.waterFeature : styles.watershedFeature;
    const hitClass = isWater ? styles.waterHit : styles.watershedHit;
    const labelClass = isWater ? styles.waterLabel : styles.watershedLabel;
    const kindLabel = isWater ? "water body" : "drainage basin";
    return <g {...common} className={styles[`lod${feature.displayLod}`]}>
      <g id={hitId}><use href={feature.geometryHref ?? undefined}
        data-atlas-geography-href={feature.geometryHref ?? undefined} className={hitClass}
        aria-label={`Select ${kindLabel} ${feature.name}`} vectorEffect="non-scaling-stroke" /></g>
      <use href={feature.geometryHref ?? undefined} data-atlas-geography-href={feature.geometryHref ?? undefined}
        className={featureClass}
        style={{ fill: style?.fillColor, fillOpacity: style?.fillOpacity, stroke: style?.strokeColor,
          strokeOpacity: style?.strokeOpacity, strokeWidth: style?.strokeWidth, strokeDasharray: style?.strokeDasharray }}
        vectorEffect="non-scaling-stroke"><title>{feature.name}</title></use>
      <text data-atlas-label={isWater ? "water" : "watershed"} data-atlas-label-place={feature.placeId}
        data-atlas-x={feature.label?.anchor[0] ?? x} data-atlas-y={feature.label?.anchor[1] ?? y}
        data-atlas-label-min-zoom={feature.label?.minimumZoom ?? feature.minimumZoom}
        data-atlas-label-max-zoom={feature.label?.maximumZoom ?? feature.maximumZoom ?? undefined}
        data-atlas-label-priority={feature.label?.priority ?? 55}
        className={labelClass}
        transform={`translate(${feature.label?.anchor[0] ?? x} ${feature.label?.anchor[1] ?? y})`}
        style={{ display: "none" }} textAnchor="middle">
        {feature.label?.text ?? feature.name}
      </text>
    </g>;
  }
  return <g {...common} className={styles[`lod${feature.displayLod}`]}>
    {feature.name !== "Unnamed feature" && <g id={hitId}><use href={feature.geometryHref ?? undefined}
      data-atlas-geography-href={feature.geometryHref ?? undefined} className={styles.riverHit}
      aria-label={`Select river ${feature.name}`} vectorEffect="non-scaling-stroke" /></g>}
    <use href={feature.geometryHref ?? undefined} data-atlas-geography-href={feature.geometryHref ?? undefined}
      className={`${styles.riverFeature} ${styles[`lod${feature.displayLod}`]}`}
      style={{ fill: "none", stroke: style?.strokeColor, strokeOpacity: style?.strokeOpacity,
        strokeWidth: style?.strokeWidth, strokeDasharray: style?.strokeDasharray }}
      vectorEffect="non-scaling-stroke"><title>{feature.name}</title></use>
    <text data-atlas-label="physical" data-atlas-label-place={feature.placeId}
      data-atlas-x={x} data-atlas-y={y} data-atlas-label-min-zoom="2.4"
      data-atlas-label-priority={40 + (feature.sourceScaleRank ?? 5)} className={styles.physicalLabel}
      transform={`translate(${x} ${y})`} style={{ display: "none" }} textAnchor="middle" y={-5}>
      {feature.name === "Unnamed feature" ? "" : feature.name}
    </text>
  </g>;
}

function CityFeature({ feature, style, selected }: {
  feature: AtlasFeatureSurfaceRecord;
  style: AtlasLayerStyleSpec | undefined;
  selected: boolean;
}) {
  const [x, y] = feature.point;
  const radius = pointRadius(feature, style);
  const hitId = featureHitId(feature);
  return <g className={styles[`lod${feature.displayLod}`]}
    data-atlas-map-feature={feature.featureId} data-atlas-city={feature.featureId}
    data-atlas-place={feature.placeId} data-atlas-place-kind="city"
    data-atlas-place-selected={selected}
    data-atlas-feature-bounds={feature.bounds.join(",")}
    data-atlas-minimum-zoom={feature.minimumZoom} data-atlas-maximum-zoom={feature.maximumZoom ?? undefined}>
    <g id={hitId} data-atlas-screen-symbol="city-hit" data-atlas-x={x} data-atlas-y={y}
      transform={`translate(${x} ${y})`}>
      <circle r={0} fill="transparent" data-atlas-city-hit className={styles.cityHit}
        aria-label={`Select city ${feature.name}`} />
    </g>
    <g data-atlas-screen-symbol="city" data-atlas-x={x} data-atlas-y={y} transform={`translate(${x} ${y})`}>
      <circle r={radius + 1} className={styles.cityHalo} />
      <circle r={radius} className={styles.cityPoint}
        style={{ fill: style?.symbolFill, stroke: style?.symbolStroke, strokeWidth: style?.strokeWidth }}>
        <title>{feature.name}</title>
      </circle>
    </g>
    <text data-atlas-label="city" data-atlas-label-place={feature.placeId}
      data-atlas-label-country={feature.countryId ?? undefined}
      data-atlas-x={x} data-atlas-y={y}
      data-atlas-label-priority={20 + (feature.sourceScaleRank ?? 5)}
      data-atlas-label-min-zoom={feature.isNationalCapital ? 2.6 : 4}
      transform={`translate(${x} ${y})`} x={8} y={3} className={styles.cityLabel} style={{ display: "none" }}>
      {feature.isNationalCapital ? "▪ " : ""}{feature.name}
    </text>
  </g>;
}

export default function AtlasFeatureSurface({ kind, initialFeatures, style }: AtlasFeatureSurfaceProps) {
  const surfaceRef = useRef<SVGGElement>(null);
  const cameraRef = useRef<AtlasCameraDetail>({ zoom: 1, selectedId: null });
  const frameRef = useRef(0);
  const detailLoadedRef = useRef(false);
  const detailLoadingRef = useRef(false);
  const [features, setFeatures] = useState(initialFeatures);
  const [mountedIds, setMountedIds] = useState(() => initialFeatures.map((feature) => feature.featureId));
  const [wrapPlacements, setWrapPlacements] = useState<AtlasWorldCopyPlacement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadDetail = useCallback(() => {
    if (detailLoadedRef.current || detailLoadingRef.current) return;
    detailLoadingRef.current = true;
    void loadFeatureIndex()
      .then((records) => {
        detailLoadedRef.current = true;
        setFeatures(records.filter((record) => record.kind === kind));
      })
      .catch(() => {
        detailLoadingRef.current = false;
        recordAtlasEvent("Atlas layer failure", {
          layer: "vector-index",
          kind,
        }, `atlas-layer-failure:vector-index:${kind}`);
      });
  }, [kind]);

  const recalculate = useCallback(() => {
    const svg = surfaceRef.current?.ownerSVGElement;
    const group = svg?.querySelector<SVGGElement>("[data-atlas-map-group]");
    const matrix = group?.getScreenCTM();
    if (!svg || !matrix) return;
    const viewport = svg.getBoundingClientRect();
    const worldOffsets = atlasRenderedWorldOffsets(svg);
    const nextWrapPlacements = atlasVisibleWorldCopies(svg, 80);
    setWrapPlacements((current) => atlasWorldCopyPlacementsEqual(current, nextWrapPlacements)
      ? current
      : nextWrapPlacements);
    const { zoom } = cameraRef.current;
    const atlasRoot = svg.closest<HTMLElement>("[data-atlas-root]");
    const selectedId = atlasRoot?.dataset.atlasFocus === "feature"
      ? atlasRoot.dataset.atlasFocusId ?? cameraRef.current.selectedId
      : cameraRef.current.selectedId;
    const next = features.filter((feature) => {
      if (feature.placeId === selectedId || feature.featureId === selectedId) return true;
      if (zoom < feature.minimumZoom || (feature.maximumZoom != null && zoom > feature.maximumZoom)) return false;
      const [x0, y0, x1, y1] = feature.bounds;
      return worldOffsets.some((offset) => matrix.a * (x1 + offset) + matrix.e >= viewport.left - 80
        && matrix.a * (x0 + offset) + matrix.e <= viewport.right + 80)
        && matrix.d * y1 + matrix.f >= viewport.top - 80
        && matrix.d * y0 + matrix.f <= viewport.bottom + 80;
    }).map((feature) => feature.featureId);
    setMountedIds((current) => sameIds(current, next) ? current : next);
  }, [features]);

  useEffect(() => {
    const svg = surfaceRef.current?.ownerSVGElement;
    const group = svg?.querySelector<SVGGElement>("[data-atlas-map-group]");
    if (!svg || !group) return;
    const schedule = () => {
      if (frameRef.current) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        recalculate();
      });
    };
    const onCamera = (event: Event) => {
      const detail = (event as CustomEvent<AtlasCameraDetail>).detail;
      cameraRef.current = { zoom: detail.zoom, selectedId: detail.selectedId };
      setSelectedId((current) => current === detail.selectedId ? current : detail.selectedId);
      if (detail.zoom > 1.15 || detail.selectedId) loadDetail();
      schedule();
    };
    const initialZoom = Number(group.dataset.atlasZoomScale ?? 1);
    const atlasRoot = svg.closest<HTMLElement>("[data-atlas-root]");
    const initialSelectedId = atlasRoot?.dataset.atlasFocus === "feature"
      ? atlasRoot.dataset.atlasFocusId ?? null
      : null;
    cameraRef.current = { zoom: initialZoom, selectedId: initialSelectedId };
    setSelectedId(initialSelectedId);
    svg.addEventListener("atlas-camera", onCamera);
    schedule();
    return () => {
      svg.removeEventListener("atlas-camera", onCamera);
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, [loadDetail, recalculate]);

  useEffect(() => {
    recalculate();
  }, [features, recalculate]);

  const mounted = useMemo(() => {
    const ids = new Set(mountedIds);
    return features.filter((feature) => ids.has(feature.featureId));
  }, [features, mountedIds]);

  useEffect(() => {
    const svg = surfaceRef.current?.ownerSVGElement;
    if (!svg) return;
    invalidateAtlasCartography(svg);
    const frame = window.requestAnimationFrame(() => updateAtlasCartography(
      svg,
      cameraRef.current.zoom,
      cameraRef.current.selectedId,
    ));
    return () => window.cancelAnimationFrame(frame);
  }, [mounted, wrapPlacements]);

  return <g ref={surfaceRef} data-atlas-dynamic-feature-surface={kind}>
    {mounted.map((feature) => feature.kind === "city"
      ? <CityFeature key={feature.featureId} feature={feature} style={style}
          selected={feature.placeId === selectedId} />
      : <PhysicalFeature key={feature.featureId} feature={feature} style={style}
          selected={feature.placeId === selectedId} />)}
    {wrapPlacements.map(({ slot, offset }) => {
      return <g key={`wrap-feature-hit-${slot}:${offset}`}
        data-atlas-world-wrap-slot={slot} data-atlas-world-offset={offset}
        transform={`translate(${offset} 0)`}>
        {mounted.filter((feature) => feature.name !== "Unnamed feature").map((feature) => (
          <use key={feature.featureId} href={`#${featureHitId(feature)}`}
            data-atlas-wrapped-place={feature.placeId}
            className={feature.kind === "city"
              ? styles.cityHit
              : feature.kind === "river"
                ? styles.riverHit
                : feature.kind === "water"
                  ? styles.waterHit
                  : feature.kind === "watershed"
                    ? styles.watershedHit
                    : styles.lakeHit} />
        ))}
      </g>;
    })}
  </g>;
}
