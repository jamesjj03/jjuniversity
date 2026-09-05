"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  invalidateAtlasCartography,
  updateAtlasCartography,
} from "@/lib/atlas-world/cartography";
import {
  atlasVisibleWorldCopies,
} from "@/lib/atlas-world/worldWrap";
import styles from "./AtlasWorld.module.css";

export type AtlasWorldWrapCountryHit = {
  entityId: string;
  geometryHref: string;
  bounds: readonly [readonly [number, number], readonly [number, number]];
  assistance?: {
    point: readonly [number, number];
    extent: number;
  };
};

type AtlasWorldWrapCountryHitsProps = {
  hits: readonly AtlasWorldWrapCountryHit[];
};

type InteractivePlacement = {
  slot: number;
  offset: number;
  hits: AtlasWorldWrapCountryHit[];
  assistance: AtlasWorldWrapCountryHit[];
};

function samePlacements(left: readonly InteractivePlacement[], right: readonly InteractivePlacement[]) {
  return left.length === right.length && left.every((value, index) => {
    const next = right[index];
    return value.slot === next?.slot && value.offset === next.offset
      && value.hits.map((hit) => hit.entityId).join() === next.hits.map((hit) => hit.entityId).join()
      && value.assistance.map((hit) => hit.entityId).join() === next.assistance.map((hit) => hit.entityId).join();
  });
}

/** Lightweight painted copies stay permanently available; polygon hit trees
 * are mounted only where a repeated world is actually on screen. */
export default function AtlasWorldWrapCountryHits({ hits }: AtlasWorldWrapCountryHitsProps) {
  const rootRef = useRef<SVGGElement>(null);
  const frameRef = useRef(0);
  const [placements, setPlacements] = useState<InteractivePlacement[]>([]);

  const recalculate = useCallback(() => {
    const svg = rootRef.current?.ownerSVGElement;
    if (!svg) return;
    const mapGroup = svg.querySelector<SVGGElement>("[data-atlas-map-group]");
    const matrix = mapGroup?.getScreenCTM();
    if (!matrix) return;
    const viewport = svg.getBoundingClientRect();
    const overlapsViewport = (bounds: readonly [readonly [number, number], readonly [number, number]], offset: number) => {
      const left = matrix.a * (bounds[0][0] + offset) + matrix.e;
      const right = matrix.a * (bounds[1][0] + offset) + matrix.e;
      const top = matrix.d * bounds[0][1] + matrix.f;
      const bottom = matrix.d * bounds[1][1] + matrix.f;
      return Math.max(left, right) >= viewport.left - 24
        && Math.min(left, right) <= viewport.right + 24
        && Math.max(top, bottom) >= viewport.top - 24
        && Math.min(top, bottom) <= viewport.bottom + 24;
    };
    const pointIsVisible = (point: readonly [number, number], offset: number) => {
      const x = matrix.a * (point[0] + offset) + matrix.e;
      const y = matrix.d * point[1] + matrix.f;
      return x >= viewport.left - 12 && x <= viewport.right + 12
        && y >= viewport.top - 12 && y <= viewport.bottom + 12;
    };
    const next = atlasVisibleWorldCopies(svg, 24).map(({ slot, offset }) => ({
      slot,
      offset,
      hits: hits.filter((hit) => overlapsViewport(hit.bounds, offset)),
      assistance: hits.filter((hit) => hit.assistance && pointIsVisible(hit.assistance.point, offset)),
    }));
    setPlacements((current) => samePlacements(current, next) ? current : next);
  }, [hits]);

  useEffect(() => {
    const svg = rootRef.current?.ownerSVGElement;
    if (!svg) return;
    const schedule = () => {
      if (frameRef.current) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        recalculate();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(svg);
    svg.addEventListener("atlas-camera", schedule);
    schedule();
    return () => {
      svg.removeEventListener("atlas-camera", schedule);
      observer.disconnect();
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [recalculate]);

  useEffect(() => {
    const svg = rootRef.current?.ownerSVGElement;
    if (!svg) return;
    invalidateAtlasCartography(svg);
    const group = svg.querySelector<SVGGElement>("[data-atlas-map-group]");
    const zoom = Number(group?.dataset.atlasZoomScale ?? 1);
    const atlasRoot = svg.closest<HTMLElement>("[data-atlas-root]");
    const selectedId = atlasRoot?.dataset.atlasFocus === "entity" || atlasRoot?.dataset.atlasFocus === "feature"
      ? atlasRoot.dataset.atlasFocusId ?? null
      : null;
    const frame = window.requestAnimationFrame(() => updateAtlasCartography(svg, zoom, selectedId));
    return () => window.cancelAnimationFrame(frame);
  }, [placements]);

  return <g ref={rootRef} data-atlas-world-wrap-country-hits>
    {placements.map(({ slot, offset, hits: visibleHits, assistance }) => (
      <g key={`${slot}:${offset}`}
        data-atlas-world-wrap-slot={slot} data-atlas-world-offset={offset}
        transform={`translate(${offset} 0)`} className={styles.interactionLayer}>
        {assistance.map((hit) => hit.assistance ? (
          <circle key={`wrap-marker-${hit.entityId}`}
            cx={hit.assistance.point[0]} cy={hit.assistance.point[1]}
            r={7} className={styles.tinyHit} data-atlas-wrapped-country={hit.entityId}
            data-atlas-assistance="hit" data-atlas-extent={hit.assistance.extent} />
        ) : null)}
        {visibleHits.map((hit) => (
          <use key={`wrap-country-${hit.entityId}`} href={hit.geometryHref}
            className={styles.countryHit} data-atlas-wrapped-country={hit.entityId} />
        ))}
      </g>
    ))}
  </g>;
}
