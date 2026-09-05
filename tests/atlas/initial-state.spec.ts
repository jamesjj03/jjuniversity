import { expect, test } from "@playwright/test";

import type { AtlasPatternNote } from "../../lib/atlas-world/geographyTypes";
import { resolveAtlasInitialState } from "../../lib/atlas-world/initialState";
import type { AtlasPlaceSummary } from "../../lib/atlas-world/places";
import type { AtlasRuntimeCountrySummary } from "../../lib/atlas-world/runtime";

const countries = [{
  id: "country:ZWE",
  slug: "zimbabwe",
  codes: { iso2: "ZW", iso3: "ZWE", naturalEarth: "ZWE" },
}] as unknown as AtlasRuntimeCountrySummary[];

const cairo = {
  placeId: "feature:city:natural-earth:cairo",
  kind: "city",
  name: "Cairo",
  aliases: ["Al-Qahirah"],
  shareKey: "cairo-egy",
  featureIds: ["feature:city:natural-earth:cairo"],
} as unknown as AtlasPlaceSummary;

const alexandria = {
  placeId: "feature:city:natural-earth:alexandria",
  kind: "city",
  name: "Alexandria",
  aliases: [],
  shareKey: "alexandria-egy",
  featureIds: ["feature:city:natural-earth:alexandria"],
} as unknown as AtlasPlaceSummary;

const nile = {
  placeId: "place:natural-earth:river:nile",
  kind: "river",
  name: "Nile",
  aliases: [],
  shareKey: "river:nile",
  featureIds: ["feature:river:nile:upper", "feature:river:nile:lower"],
} as unknown as AtlasPlaceSummary;

const note = {
  id: "annotation:nile-valley",
} as unknown as AtlasPatternNote;

const places = [cairo, alexandria, nile];
const notes = [note];

test("valid canonical country focus wins over a contradictory city alias", () => {
  const resolved = resolveAtlasInitialState(
    new URLSearchParams("focus=entity%3Acountry%3AZWE&country=zwe&city=cairo-egy"),
    countries,
    places,
    notes,
  );

  expect(resolved.countryId).toBe("country:ZWE");
  expect(resolved.placeId).toBeNull();
  expect(resolved.scene.focus).toEqual({ kind: "entity", id: "country:ZWE" });
  expect(resolved.needsCanonicalUrl).toBe(true);
});

test("valid canonical place focus wins over a different readable alias", () => {
  const resolved = resolveAtlasInitialState(
    new URLSearchParams(
      "focus=feature%3Aplace%3Anatural-earth%3Ariver%3Anile&city=alexandria-egy",
    ),
    countries,
    places,
    notes,
  );

  expect(resolved.placeId).toBe(nile.placeId);
  expect(resolved.countryId).toBeNull();
  expect(resolved.scene.focus).toEqual({ kind: "feature", id: nile.placeId });
  expect(resolved.needsCanonicalUrl).toBe(true);
});

test("canonical annotation and coordinate focus cannot be replaced by aliases", () => {
  const annotation = resolveAtlasInitialState(
    new URLSearchParams("focus=feature%3Aannotation%3Anile-valley&city=cairo-egy"),
    countries,
    places,
    notes,
  );
  expect(annotation.noteId).toBe(note.id);
  expect(annotation.placeId).toBeNull();
  expect(annotation.needsCanonicalUrl).toBe(true);

  const coordinate = resolveAtlasInitialState(
    new URLSearchParams("focus=coordinate%3A31.25%2C30.05&feature=river%3Anile"),
    countries,
    places,
    notes,
  );
  expect(coordinate.scene.focus?.kind).toBe("coordinate");
  expect(coordinate.placeId).toBeNull();
  expect(coordinate.needsCanonicalUrl).toBe(true);
});

test("matching readable alias remains a stable companion to canonical focus", () => {
  const resolved = resolveAtlasInitialState(
    new URLSearchParams(
      "focus=feature%3Afeature%3Acity%3Anatural-earth%3Acairo&city=cairo-egy",
    ),
    countries,
    places,
    notes,
  );

  expect(resolved.placeId).toBe(cairo.placeId);
  expect(resolved.needsCanonicalUrl).toBe(false);
});
