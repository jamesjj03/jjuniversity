import "server-only";
import { geoEqualEarth } from "d3-geo";

import geographyPackJson from "./data/geography-pack.v1.json";
import patternNotesJson from "./data/pattern-notes.v1.json";
import type { AtlasGeographyPack, AtlasPatternNoteSnapshot } from "./geographyTypes";

const geographyPack = geographyPackJson as unknown as AtlasGeographyPack;
const patternNotes = patternNotesJson as unknown as AtlasPatternNoteSnapshot;
// Same 1200×650 / 14-unit padding as the country and physical derivatives.
// This is viewing metadata derived from the note's already-authored extent.
const projection = geoEqualEarth().fitExtent([[14, 14], [1186, 636]], { type: "Sphere" });
const displayNotes = patternNotes.notes.map((note) => {
  const [[west, south], [east, north]] = note.spatial.boundsWgs84;
  const points = [[west, south], [west, north], [east, south], [east, north]].map((point) => projection(point as [number, number])!);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
    [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))],
  ];
  return { ...note, spatial: { ...note.spatial, viewingBoundsEqualEarth: bounds } };
});

if (geographyPack.projection.id !== "equal-earth") {
  throw new Error("The current Atlas renderer requires Equal Earth geography derivatives.");
}

export function getAtlasGeographyPack() {
  return geographyPack;
}

export function getAtlasPatternNotes() {
  // Source review is the publication gate for Atlas explanations. Human
  // editorial review is recorded separately and must never be implied.
  return displayNotes.filter((note) => note.review.publicationStatus === "atlas-visible");
}
