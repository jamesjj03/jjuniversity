import { geoDistance } from "d3-geo";

export const ATLAS_GLOBE_LIMB_PADDING_RADIANS = 0.035;

/**
 * Orthographic projections still return a screen position for coordinates on
 * the hidden hemisphere. Gate point labels and proximity hit targets by their
 * angular distance from the current center before using that position.
 */
export function atlasGlobeCoordinateIsVisible(
  center: [number, number],
  coordinates: [number, number],
  limbPadding = ATLAS_GLOBE_LIMB_PADDING_RADIANS,
) {
  return geoDistance(center, coordinates) <= (Math.PI / 2) - limbPadding;
}
