import "server-only";

import geographyPackJson from "./data/geography-pack.v1.json";
import patternNotesJson from "./data/pattern-notes.v1.json";
import type { AtlasGeographyPack, AtlasPatternNoteSnapshot } from "./geographyTypes";

const geographyPack = geographyPackJson as unknown as AtlasGeographyPack;
const patternNotes = patternNotesJson as unknown as AtlasPatternNoteSnapshot;

if (geographyPack.projection.id !== "equal-earth") {
  throw new Error("The current Atlas renderer requires Equal Earth geography derivatives.");
}

export function getAtlasGeographyPack() {
  return geographyPack;
}

export function getAtlasPatternNotes() {
  // Source review is the publication gate for Atlas explanations. Human
  // editorial review is recorded separately and must never be implied.
  return patternNotes.notes.filter((note) => note.review.publicationStatus === "atlas-visible");
}
