import "server-only";
import { atlasProjectedWgs84Bounds, projectAtlasWgs84 } from "./projection";

import geographyPackJson from "./data/geography-pack.v1.json";
import patternNotesJson from "./data/pattern-notes.v1.json";
import type { AtlasGeographyPack, AtlasPatternNoteSnapshot } from "./geographyTypes";

const geographyPack = geographyPackJson as unknown as AtlasGeographyPack;
const patternNotes = patternNotesJson as unknown as AtlasPatternNoteSnapshot;
const displayNotes = patternNotes.notes.map((note) => {
  const bounds = atlasProjectedWgs84Bounds(note.spatial.boundsWgs84);
  const { longitude, latitude } = note.spatial.focus;
  return { ...note, spatial: { ...note.spatial, focus: { longitude, latitude, projected: projectAtlasWgs84([longitude, latitude]) }, viewingBoundsProjected: bounds } };
});

if (geographyPack.projection.id !== "mercator") {
  throw new Error("The Atlas geography derivatives must match the Mercator representation.");
}

export function getAtlasGeographyPack() {
  return geographyPack;
}

export function getAtlasPatternNotes() {
  // Source review is the publication gate for Atlas explanations. Human
  // editorial review is recorded separately and must never be implied.
  return displayNotes.filter((note) => note.review.publicationStatus === "atlas-visible");
}
