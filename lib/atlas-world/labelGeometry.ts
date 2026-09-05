import type { AtlasProjectedFeature } from "./types";

type Point = [number, number];
/** Derived screen geometry only: never changes identity or canonical boundaries.
 * The largest drawn ring avoids centroids between overseas fragments or across
 * the date line (e.g. a Kiribati label incorrectly landing over South America).
 */
export function deriveAtlasLabelGeometry(feature: AtlasProjectedFeature) {
  const rings = feature.path.split(/[Mm]/).filter(Boolean).map((part) => {
    const values = part.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points: Point[] = [];
    for (let index = 0; index + 1 < values.length; index += 2) points.push([values[index], values[index + 1]]);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    return { points, area: Math.abs(area / 2) };
  }).sort((a, b) => b.area - a.area);
  const ring = rings[0];
  if (!ring?.points.length) return { labelPoint: feature.centroid, labelArea: 0, focusBounds: feature.bounds };
  const xs = ring.points.map((p) => p[0]), ys = ring.points.map((p) => p[1]);
  const bounds: [Point, Point] = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  const inside = (point: Point) => {
    let yes = false;
    for (let i = 0, j = ring.points.length - 1; i < ring.points.length; j = i++) {
      const a = ring.points[i], b = ring.points[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
  };
  const center: Point = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
  let anchor = center;
  if (!inside(center)) {
    let best = Infinity;
    for (let y = 1; y < 10; y++) for (let x = 1; x < 10; x++) {
      const point: Point = [bounds[0][0] + x * (bounds[1][0] - bounds[0][0]) / 10, bounds[0][1] + y * (bounds[1][1] - bounds[0][1]) / 10];
      const distance = Math.hypot(point[0] - center[0], point[1] - center[1]);
      if (distance < best && inside(point)) { best = distance; anchor = point; }
    }
    if (!Number.isFinite(best)) anchor = ring.points[0];
  }
  return { labelPoint: anchor, labelArea: ring.area, focusBounds: bounds };
}
