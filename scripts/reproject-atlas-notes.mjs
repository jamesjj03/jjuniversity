import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const notePath = path.join(root, "lib/atlas-world/data/pattern-notes.v1.json");
const notes = JSON.parse(fs.readFileSync(notePath, "utf8"));
const project = ([lon, lat]) => [
  600 + lon * Math.PI / 180 * 622 / (2 * Math.PI),
  325 - Math.log(Math.tan(Math.PI / 4 + Math.max(-85.0511287798066, Math.min(85.0511287798066, lat)) * Math.PI / 360)) * 622 / (2 * Math.PI),
].map((v) => Math.round(v * 100) / 100);
const linePath = (points, close = false) => points.map((point, i) => `${i ? "L" : "M"}${project(point).join(",")}`).join("") + (close ? "Z" : "");
for (const note of notes.notes) {
  const { longitude, latitude } = note.spatial.focus;
  note.spatial.focus = { longitude, latitude, projected: project([longitude, latitude]) };
  for (const ref of note.observationRefs) ref.snapshotId = "atlas-geography-2026-09-05-mercator";
  const geometry = note.spatial.highlight?.geometry;
  if (!geometry?.canonicalWgs84) continue;
  const source = geometry.canonicalWgs84;
  const lines = source.type === "LineString" ? [source.coordinates] : source.coordinates;
  const points = lines.flat().map(project);
  geometry.derived = {
    projectionId: "mercator", viewBox: [0, 0, 1200, 650],
    transformationId: "wgs84-to-mercator-svg-v1",
    path: lines.map((line) => linePath(line, source.type === "Polygon")).join(""),
    bounds: [[Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
      [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]],
  };
}
fs.writeFileSync(notePath, JSON.stringify(notes, null, 2) + "\n");
console.log(`Reprojected ${notes.notes.length} annotations from unchanged authored WGS84 geometry.`);
