/** Screen-space cartography. Geometry zooms; reading aids do not. */
export function updateAtlasCartography(svg: SVGSVGElement, zoom: number, selectedId: string | null) {
  const group = svg.querySelector<SVGGElement>("[data-atlas-map-group]");
  const matrix = group?.getScreenCTM();
  if (!group || !matrix) return;
  const scale = Math.hypot(matrix.a, matrix.b);
  if (!scale) return;
  const viewport = svg.getBoundingClientRect();
  group.querySelectorAll<SVGCircleElement>("[data-atlas-assistance]").forEach((marker) => {
    const extent = Number(marker.dataset.atlasExtent ?? 0) * scale;
    const hit = marker.dataset.atlasAssistance === "hit";
    // Assistance ends when the actual polygon is large enough. Targets lie
    // beneath country polygons, so they can never steal a neighbour's click.
    const visible = extent < 12;
    marker.style.display = visible ? "" : "none";
    marker.setAttribute("r", String((hit ? 7 : 2.6) / scale));
  });
  group.querySelectorAll<SVGGElement>("[data-atlas-screen-symbol]").forEach((symbol) => {
    const x = Number(symbol.dataset.atlasX);
    const y = Number(symbol.dataset.atlasY);
    symbol.setAttribute("transform", `translate(${x} ${y}) scale(${1 / scale})`);
  });

  type Rect = { x: number; y: number; width: number; height: number };
  const occupied: Rect[] = [];
  const labels = Array.from(group.querySelectorAll<SVGTextElement>("[data-atlas-label]"));
  labels.sort((a, b) => {
    const priority = (node: SVGTextElement) => node.dataset.atlasLabelEntity === selectedId ? -100 : Number(node.dataset.atlasLabelPriority ?? 10);
    return priority(a) - priority(b);
  });
  for (const label of labels) {
    const owner = label.closest<SVGElement>("[data-atlas-layer]");
    const selected = label.dataset.atlasLabelEntity === selectedId;
    const minimum = Number(label.dataset.atlasLabelMinZoom ?? 1);
    const x = Number(label.dataset.atlasX), y = Number(label.dataset.atlasY);
    const screenX = matrix.a * x + matrix.c * y + matrix.e;
    const screenY = matrix.b * x + matrix.d * y + matrix.f;
    const fontSize = label.dataset.atlasLabel === "country" ? (selected ? 13 : 11) : 10;
    const width = (label.textContent?.length ?? 0) * fontSize * 0.58;
    const offset = label.dataset.atlasLabel === "city" ? 8 : 0;
    const rectangle = { x: screenX + (label.dataset.atlasLabel === "city" ? offset : -width / 2), y: screenY - 7, width, height: 15 };
    const visible = (!owner || owner.dataset.atlasLayerActive === "true")
      && (selected || zoom >= minimum)
      && rectangle.x > viewport.left + 8 && rectangle.x + rectangle.width < viewport.right - 8
      && screenY > viewport.top + 12 && screenY < viewport.bottom - 12
      && !occupied.some((r) => rectangle.x < r.x + r.width + 7 && rectangle.x + rectangle.width + 7 > r.x && rectangle.y < r.y + r.height + 4 && rectangle.y + rectangle.height + 4 > r.y);
    label.style.display = visible ? "" : "none";
    label.dataset.atlasSelectedLabel = selected ? "true" : "false";
    label.setAttribute("transform", `translate(${x} ${y}) scale(${1 / scale})`);
    label.setAttribute("font-size", String(fontSize));
    if (visible) occupied.push(rectangle);
  }
  svg.dispatchEvent(new CustomEvent("atlas-camera", { detail: { zoom } }));
}
