/** Screen-space cartography. Source geometry zooms; reading aids do not.
 * The server-rendered geographic tree is stable: index it once, not on every drag. */
type Rect = { x: number; y: number; width: number; height: number };
const indexes = new WeakMap<SVGSVGElement, ReturnType<typeof indexMap>>();

function indexMap(svg: SVGSVGElement) {
  const group = svg.querySelector<SVGGElement>("[data-atlas-map-group]")!;
  const features = Array.from(group.querySelectorAll<SVGGElement>("[data-atlas-feature-bounds]"), (element) => ({
    element,
    bounds: element.dataset.atlasFeatureBounds!.split(",").map(Number),
    minimum: Number(element.dataset.atlasMinimumZoom ?? 0),
    maximum: Number(element.dataset.atlasMaximumZoom ?? Infinity),
    visible: false,
  }));
  const featureByElement = new Map(features.map((feature) => [feature.element, feature]));
  const symbols = Array.from(group.querySelectorAll<SVGGElement>("[data-atlas-screen-symbol]"), (element) => ({
    element,
    x: element.dataset.atlasX, y: element.dataset.atlasY,
    feature: featureByElement.get(element.closest<SVGGElement>("[data-atlas-feature-bounds]")!),
  }));
  const labels = Array.from(group.querySelectorAll<SVGTextElement>("[data-atlas-label]"), (element) => ({
    element,
    owner: element.closest<SVGElement>("[data-atlas-layer]"),
    feature: featureByElement.get(element.closest<SVGGElement>("[data-atlas-feature-bounds]")!),
    hit: element.closest("[data-atlas-city]")?.querySelector("[data-atlas-city-hit]"),
    entityId: element.dataset.atlasLabelEntity,
    kind: element.dataset.atlasLabel,
    major: element.dataset.atlasLabelMajor === "true",
    priority: Number(element.dataset.atlasLabelPriority ?? 10),
    minimum: Number(element.dataset.atlasLabelMinZoom ?? 1),
    x: Number(element.dataset.atlasX), y: Number(element.dataset.atlasY),
    angle: Number(element.dataset.atlasLabelAngle ?? 0),
    length: element.textContent?.length ?? 0,
    text: element.textContent ?? "",
  })).sort((a, b) => a.priority - b.priority);
  const assistance = Array.from(group.querySelectorAll<SVGCircleElement>("[data-atlas-assistance]"), (element) => ({
    element, extent: Number(element.dataset.atlasExtent ?? 0), radius: element.dataset.atlasAssistance === "hit" ? 7 : 2.6,
  }));
  return { group, features, symbols, labels, assistance };
}

function attribute(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
function display(element: SVGElement, visible: boolean) {
  const value = visible ? "" : "none";
  if (element.style.display !== value) element.style.display = value;
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width + 5 && a.x + a.width + 5 > b.x
  && a.y < b.y + b.height + 3 && a.y + a.height + 3 > b.y;

export function updateAtlasCartography(svg: SVGSVGElement, zoom: number, selectedId: string | null) {
  let index = indexes.get(svg);
  if (!index) { index = indexMap(svg); indexes.set(svg, index); }
  const matrix = index.group.getScreenCTM();
  if (!matrix) return;
  const scale = Math.hypot(matrix.a, matrix.b);
  if (!scale) return;

  // Finish layout reads before changing labels or assistance marks.
  const viewport = svg.getBoundingClientRect();
  const occupied: Rect[] = [];
  svg.closest("[data-atlas-root]")?.querySelectorAll<HTMLElement>(
    "header, [data-atlas-sheet], [data-atlas-city-card], aside[aria-label$='map legend']",
  ).forEach((element) => {
    if (element.closest("dialog") || element.inert || !element.getClientRects().length) return;
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) occupied.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  });
  for (const marker of index.assistance) {
    display(marker.element, marker.extent * scale < 12);
    attribute(marker.element, "r", String(marker.radius / scale));
  }
  for (const feature of index.features) {
    const [x0, y0, x1, y1] = feature.bounds;
    feature.visible = zoom >= feature.minimum && zoom <= feature.maximum
      && matrix.a * x1 + matrix.e >= viewport.left - 25 && matrix.a * x0 + matrix.e <= viewport.right + 25
      && matrix.d * y1 + matrix.f >= viewport.top - 25 && matrix.d * y0 + matrix.f <= viewport.bottom + 25;
    attribute(feature.element, "data-atlas-feature-visible", String(feature.visible));
    display(feature.element, feature.visible);
  }
  for (const symbol of index.symbols) {
    if (symbol.feature && !symbol.feature.visible) continue;
    attribute(symbol.element, "transform", `translate(${symbol.x} ${symbol.y}) scale(${1 / scale})`);
  }

  // Selected-place labels win without re-sorting thousands of static priorities.
  const labels = selectedId ? [
    ...index.labels.filter((label) => label.entityId === selectedId),
    ...index.labels.filter((label) => label.entityId !== selectedId),
  ] : index.labels;
  const namedPhysicalFeatures = new Set<string>();
  for (const label of labels) {
    const { element, kind, x, y } = label;
    const selected = label.entityId === selectedId;
    const physicalKey = `${kind}:${label.text}`;
    const physical = kind !== "country" && kind !== "city";
    const eligible = label.length > 0 && (!physical || !namedPhysicalFeatures.has(physicalKey)) && (!label.owner || label.owner.dataset.atlasLayerActive === "true")
      && (!label.feature || label.feature.visible) && (selected || zoom >= label.minimum);
    attribute(element, "data-atlas-selected-label", String(selected));
    if (!eligible) { display(element, false); if (label.hit) attribute(label.hit, "r", "0"); continue; }
    const screenX = matrix.a * x + matrix.c * y + matrix.e;
    const screenY = matrix.b * x + matrix.d * y + matrix.f;
    if (screenX < viewport.left - 100 || screenX > viewport.right + 100 || screenY < viewport.top - 100 || screenY > viewport.bottom + 100) {
      display(element, false); if (label.hit) attribute(label.hit, "r", "0"); continue;
    }
    const fontSize = kind === "country" ? (selected ? 16 : label.major ? 14 : 12) : 12;
    const angle = kind === "country" ? label.angle : 0;
    const radians = angle * Math.PI / 180;
    const textWidth = label.length * fontSize * (kind === "country" ? 0.69 : 0.57);
    const width = Math.abs(Math.cos(radians)) * textWidth + Math.abs(Math.sin(radians)) * fontSize;
    const height = Math.abs(Math.sin(radians)) * textWidth + Math.abs(Math.cos(radians)) * fontSize + 4;
    let rectangle: Rect = { x: screenX - width / 2, y: screenY - height / 2, width, height };
    let offsetX = 0, offsetY = 0;
    if (kind === "city") {
      const candidates = [{ dx: 8, dy: 0 }, { dx: -textWidth - 8, dy: 0 }, { dx: -textWidth / 2, dy: -17 }, { dx: -textWidth / 2, dy: 17 }];
      const chosen = candidates.find(({ dx, dy }) => !occupied.some((rect) => overlaps({ x: screenX + dx, y: screenY + dy - 8, width: textWidth, height: 15 }, rect))) ?? candidates[0];
      offsetX = chosen.dx; offsetY = chosen.dy;
      rectangle = { x: screenX + offsetX, y: screenY + offsetY - 8, width: textWidth, height: 15 };
    }
    const visible = rectangle.x > viewport.left + 5 && rectangle.x + rectangle.width < viewport.right - 5
      && rectangle.y > viewport.top + 5 && rectangle.y + rectangle.height < viewport.bottom - 5
      && !occupied.some((rect) => overlaps(rectangle, rect));
    display(element, visible);
    if (label.hit) attribute(label.hit, "r", visible ? "7" : "0");
    if (!visible) continue;
    if (physical) namedPhysicalFeatures.add(physicalKey);
    attribute(element, "transform", `translate(${x} ${y}) scale(${1 / scale}) rotate(${angle})`);
    attribute(element, "font-size", String(fontSize));
    if (kind === "city") { attribute(element, "x", String(offsetX)); attribute(element, "y", String(offsetY + 3)); }
    occupied.push(rectangle);
  }
  svg.dispatchEvent(new CustomEvent("atlas-camera", { detail: { zoom } }));
}
