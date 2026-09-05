import { ATLAS_WORLD_BOUNDS } from "./projection";

export type AtlasCameraTransform = {
  x: number;
  k: number;
};

export type AtlasWorldCopyPlacement = {
  slot: number;
  offset: number;
};

export function atlasWorldCopyPlacementsEqual(
  left: readonly AtlasWorldCopyPlacement[],
  right: readonly AtlasWorldCopyPlacement[],
) {
  return left.length === right.length && left.every((value, index) => (
    value.slot === right[index]?.slot && value.offset === right[index]?.offset
  ));
}

export const ATLAS_WORLD_WIDTH = ATLAS_WORLD_BOUNDS[1][0] - ATLAS_WORLD_BOUNDS[0][0];
export const ATLAS_WORLD_CENTER_X = (ATLAS_WORLD_BOUNDS[0][0] + ATLAS_WORLD_BOUNDS[1][0]) / 2;

/** Five copies cover the 1200-unit viewport even at the supported 0.55x minimum zoom. */
export const ATLAS_WORLD_WRAP_SLOTS = [-2, -1, 0, 1, 2] as const;

export function atlasWorldWrapOffsets(
  transform: AtlasCameraTransform,
  viewportWidth = 1200,
) {
  const scale = Math.max(Number.EPSILON, transform.k);
  const cameraCenterX = (viewportWidth / 2 - transform.x) / scale;
  const centerCopy = Math.round((cameraCenterX - ATLAS_WORLD_CENTER_X) / ATLAS_WORLD_WIDTH);
  return ATLAS_WORLD_WRAP_SLOTS.map((slot) => (centerCopy + slot) * ATLAS_WORLD_WIDTH);
}

/** Return the equivalent wrapped x-coordinate closest to the current camera. */
export function atlasNearestWrappedX(x: number, cameraCenterX: number) {
  return x + Math.round((cameraCenterX - x) / ATLAS_WORLD_WIDTH) * ATLAS_WORLD_WIDTH;
}

export function applyAtlasWorldWrap(
  svg: SVGSVGElement,
  transform: AtlasCameraTransform,
  viewportWidth = 1200,
) {
  const offsets = atlasWorldWrapOffsets(transform, viewportWidth);
  svg.querySelectorAll<SVGGraphicsElement>("[data-atlas-world-wrap-slot]").forEach((element) => {
    const slot = Number(element.dataset.atlasWorldWrapSlot);
    const offset = offsets[slot];
    if (offset == null) return;
    const value = String(offset);
    if (element.dataset.atlasWorldOffset !== value) element.dataset.atlasWorldOffset = value;
    const translated = `translate(${value} 0)`;
    if (element.getAttribute("transform") !== translated) element.setAttribute("transform", translated);
    const display = offset === 0 ? "none" : "";
    if (element.style.display !== display) element.style.display = display;
  });
}

/** Canonical world plus every currently positioned visual copy. */
export function atlasRenderedWorldOffsets(svg: SVGSVGElement) {
  const offsets = new Set<number>([0]);
  svg.querySelectorAll<SVGUseElement>("[data-atlas-world-copy]").forEach((element) => {
    const offset = Number(element.dataset.atlasWorldOffset);
    if (Number.isFinite(offset)) offsets.add(offset);
  });
  return [...offsets];
}

/**
 * Repeated interaction geometry is much heavier than a painted SVG use.
 * Mount it only for copies that can currently receive a pointer.
 */
export function atlasVisibleWorldCopies(
  svg: SVGSVGElement,
  overscan = 0,
): AtlasWorldCopyPlacement[] {
  const group = svg.querySelector<SVGGElement>("[data-atlas-map-group]");
  const matrix = group?.getScreenCTM();
  if (!matrix) return [];
  const viewport = svg.getBoundingClientRect();
  return Array.from(svg.querySelectorAll<SVGUseElement>("[data-atlas-world-copy]"), (copy) => ({
    slot: Number(copy.dataset.atlasWorldWrapSlot),
    offset: Number(copy.dataset.atlasWorldOffset),
  })).filter(({ slot, offset }) => {
    if (!Number.isInteger(slot) || !Number.isFinite(offset) || offset === 0) return false;
    const left = matrix.a * (ATLAS_WORLD_BOUNDS[0][0] + offset) + matrix.e;
    const right = matrix.a * (ATLAS_WORLD_BOUNDS[1][0] + offset) + matrix.e;
    return Math.max(left, right) >= viewport.left - overscan
      && Math.min(left, right) <= viewport.right + overscan;
  });
}
