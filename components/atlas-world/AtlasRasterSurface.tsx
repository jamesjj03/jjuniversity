"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AtlasRasterAsset, AtlasRasterPyramid } from "@/lib/atlas-world/geographyTypes";

type Tile = AtlasRasterAsset & { id: string };
/** One source-derived detail level at a time, only for the visible viewport.
 * Masking replaces overview pixels instead of stacking translucent densities. */
export default function AtlasRasterSurface({ overview, pyramid }: { overview: AtlasRasterAsset; pyramid: AtlasRasterPyramid }) {
  const root = useRef<SVGGElement>(null);
  const id = useId().replace(/:/g, "");
  const maskId = `atlas-raster-${id}`;
  const [visible, setVisible] = useState(false);
  const [levelId, setLevelId] = useState("overview");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const mountedTiles = useRef(new Set<string>());

  useEffect(() => {
    const element = root.current;
    const svg = element?.ownerSVGElement;
    if (!element || !svg) return;
    let frame = 0;
    const reconcileTiles = (next: Tile[]) => {
      const ids = new Set(next.map((tile) => tile.id));
      mountedTiles.current = ids;
      // Readiness belongs to this mounted image, not to an earlier request
      // with the same URL. Keep the overview until replacement pixels arrive.
      const retainMounted = (current: Set<string>) => {
        const retained = new Set([...current].filter((tileId) => ids.has(tileId)));
        return retained.size === current.size ? current : retained;
      };
      setLoaded(retainMounted);
      setFailed(retainMounted);
      setTiles((current) => current.map((tile) => tile.id).join() === next.map((tile) => tile.id).join() ? current : next);
    };
    const update = () => {
      frame = 0;
      const layer = element.closest<SVGElement>("[data-atlas-layer]");
      const active = layer?.dataset.atlasLayerActive === "true";
      setVisible(active);
      if (!active) { setLevelId("overview"); reconcileTiles([]); return; }
      const group = svg.querySelector<SVGGElement>("[data-atlas-map-group]");
      const matrix = group?.getScreenCTM();
      if (!matrix) return;
      const zoom = Number(group?.dataset.atlasZoomScale ?? 1);
      const level = pyramid.levels.filter((candidate) => zoom >= candidate.minimumZoom).at(-1);
      setLevelId(level?.id ?? "overview");
      if (!level) { reconcileTiles([]); return; }
      const inverse = matrix.inverse();
      const rect = svg.getBoundingClientRect();
      const a = new DOMPoint(rect.left, rect.top).matrixTransform(inverse);
      const b = new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse);
      const next = level.tiles.filter((tile) => {
        const [x, y, width, height] = tile.viewBox;
        return x < b.x && x + width > a.x && y < b.y && y + height > a.y;
      });
      reconcileTiles(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    svg.addEventListener("atlas-camera", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(svg);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); svg.removeEventListener("atlas-camera", schedule); };
  }, [pyramid]);

  const [x, y, width, height] = overview.viewBox;
  return <g ref={root} data-atlas-raster-level={levelId} data-atlas-visible-tiles={tiles.length}
    data-atlas-raster-fallback={tiles.some((tile) => failed.has(tile.id)) ? "true" : "false"}>
    <defs><mask id={maskId} maskUnits="userSpaceOnUse" x={x} y={y} width={width} height={height}>
      <rect x={x} y={y} width={width} height={height} fill="white" />
      {tiles.filter((tile) => loaded.has(tile.id)).map((tile) => <rect key={tile.id} x={tile.viewBox[0]} y={tile.viewBox[1]} width={tile.viewBox[2]} height={tile.viewBox[3]} fill="black" />)}
    </mask></defs>
    <image href={visible ? overview.href : undefined} x={x} y={y} width={width} height={height} preserveAspectRatio="none" mask={`url(#${maskId})`} />
    {tiles.map((tile) => <image key={tile.id} data-atlas-raster-tile={tile.id} href={tile.href}
      x={tile.viewBox[0]} y={tile.viewBox[1]} width={tile.viewBox[2]} height={tile.viewBox[3]} preserveAspectRatio="none"
      visibility={loaded.has(tile.id) ? "visible" : "hidden"}
      onLoad={() => {
        if (!mountedTiles.current.has(tile.id)) return;
        setLoaded((current) => new Set(current).add(tile.id));
        setFailed((current) => { const next = new Set(current); next.delete(tile.id); return next; });
      }}
      onError={() => {
        if (!mountedTiles.current.has(tile.id)) return;
        setFailed((current) => new Set(current).add(tile.id));
        setLoaded((current) => { const next = new Set(current); next.delete(tile.id); return next; });
      }} />)}
  </g>;
}
