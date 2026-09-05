import { atlasProjectedWgs84Bounds } from "./projection";
import type { AtlasProjectedFeature } from "./types";

type Bounds = AtlasProjectedFeature["bounds"];

/** Reviewed presentation choices, not entity definitions or boundary changes.
 * A country label can belong on one island while its camera overview must show
 * several. These compact regional extents were reviewed against the bundled
 * source geometry; this is deliberately not a global island-clustering rule.
 */
const FULL_SOURCE_OVERVIEW = new Set([
  "country:JPN", // Main islands and Ryukyus.
  "country:IDN", // The archipelago, not Kalimantan alone.
  "country:PHL", // The archipelago, not Luzon alone.
  "country:MYS", // Peninsular and East Malaysia.
  "country:GBR", // Great Britain, Northern Ireland, and nearby islands.
  "country:DNK", // Jutland and the Danish islands.
  "country:GRC", // Mainland and Aegean/Ionian islands.
  "country:SLB", // The Solomon Islands, not Guadalcanal alone.
]);

// An authored overview window chooses New Zealand's North, South, and Stewart
// island region. Its camera bounds still come from actual source vertices.
// The complete feature, including remote/date-line fragments, remains rendered
// and selectable; it is not cut or redefined by this presentation window.
const NZ_PRIMARY_ISLANDS_WINDOW = atlasProjectedWgs84Bounds([[165, -48], [180, -33]]);

export function deriveAtlasCountryFocusBounds(
  feature: AtlasProjectedFeature,
  fallbackBounds: Bounds,
): Bounds {
  if (FULL_SOURCE_OVERVIEW.has(feature.entityId)) return feature.bounds;
  // Preserve the established remote-fragment policy for every other country,
  // including Kiribati, Netherlands, and Fiji. Their label logic is untouched.
  if (feature.entityId !== "country:NZL") return fallbackBounds;

  const [[left, top], [right, bottom]] = NZ_PRIMARY_ISLANDS_WINDOW;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  // The generated country resource uses absolute M/L/Z path commands only.
  for (const ring of feature.path.split(/[Mm]/).filter(Boolean)) {
    const values = ring.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    for (let index = 0; index + 1 < values.length; index += 2) {
      const x = values[index], y = values[index + 1];
      if (x < left || x > right || y < top || y > bottom) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) && x1 > x0 && y1 > y0
    ? [[x0, y0], [x1, y1]]
    : fallbackBounds;
}
