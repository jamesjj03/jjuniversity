import type { AtlasPatternNote } from "./geographyTypes";
import type { AtlasSceneState } from "./layers";
import { parseAtlasSceneSearchParams } from "./layers";
import {
  atlasPlaceSlug,
  findAtlasPlaceByShareKey,
  type AtlasPlaceKind,
  type AtlasPlaceSummary,
} from "./places";
import type { AtlasRuntimeCountrySummary } from "./runtime";

export type AtlasResolvedInitialState = {
  scene: AtlasSceneState;
  countryId: string | null;
  placeId: string | null;
  noteId: string | null;
  needsCanonicalUrl: boolean;
};

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .trim();
}

function countryFromKey(countries: readonly AtlasRuntimeCountrySummary[], raw: string | null) {
  const requested = normalized(raw ?? "");
  if (!requested) return null;
  return countries.find((country) => [
    country.codes.iso3,
    country.codes.naturalEarth,
    country.codes.iso2,
    country.slug,
  ].filter((value): value is string => Boolean(value)).some((value) => normalized(value) === requested)) ?? null;
}

function placeFromFriendlyKey(
  places: readonly AtlasPlaceSummary[],
  kind: AtlasPlaceKind,
  raw: string | null,
) {
  if (!raw) return null;
  const exact = findAtlasPlaceByShareKey(places, kind, raw);
  if (exact) return exact;
  // Short keys such as `city=cairo` remain useful when the name is globally
  // unambiguous. Ambiguous names require the generated country/digest suffix.
  const key = atlasPlaceSlug(raw.replace(new RegExp(`^${kind}:`, "i"), ""));
  const matches = places.filter((place) => place.kind === kind && (
    atlasPlaceSlug(place.name) === key || place.aliases.some((alias) => atlasPlaceSlug(alias) === key)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function physicalPlaceFromKey(places: readonly AtlasPlaceSummary[], raw: string | null) {
  if (!raw) return null;
  const match = raw.match(/^(river|lake):(.+)$/i);
  if (!match) return null;
  return placeFromFriendlyKey(places, match[1].toLocaleLowerCase("en-US") as AtlasPlaceKind, raw);
}

/**
 * Resolves both canonical scene focus and readable country/city/feature aliases.
 * This pure function is shared by the server's first frame and browser history.
 */
export function resolveAtlasInitialState(
  params: URLSearchParams,
  countries: readonly AtlasRuntimeCountrySummary[],
  places: readonly AtlasPlaceSummary[],
  notes: readonly AtlasPatternNote[],
): AtlasResolvedInitialState {
  const parsed = parseAtlasSceneSearchParams(params);
  const placeByIdentity = new Map<string, AtlasPlaceSummary>();
  for (const place of places) {
    placeByIdentity.set(place.placeId, place);
    for (const featureId of place.featureIds) placeByIdentity.set(featureId, place);
  }

  const focusedId = parsed.scene.focus?.kind === "feature" ? parsed.scene.focus.id : null;
  const focusedEntityId = parsed.scene.focus?.kind === "entity" ? parsed.scene.focus.id : null;
  const focusedPlace = focusedId ? placeByIdentity.get(focusedId) ?? null : null;
  const focusedNote = focusedId ? notes.find((note) => note.id === focusedId) ?? null : null;
  const focusedCountry = focusedEntityId
    ? countries.find((country) => country.id === focusedEntityId) ?? null
    : null;
  const friendlyCity = placeFromFriendlyKey(places, "city", params.get("city"));
  const friendlyFeature = physicalPlaceFromKey(places, params.get("feature"));
  const friendlyCountry = countryFromKey(countries, params.get("country"));

  // A valid canonical focus is authoritative across every focus kind.
  // Readable aliases only supply a focus when the canonical field is absent
  // or invalid, preserving the Phase 2 country-link contract without letting
  // a contradictory `city=`/`feature=` alias replace shared canonical state.
  const hasCanonicalCoordinate = parsed.scene.focus?.kind === "coordinate";
  const hasValidCanonicalFocus = Boolean(
    focusedPlace || focusedNote || focusedCountry || hasCanonicalCoordinate,
  );
  const place = focusedPlace
    ?? (hasValidCanonicalFocus ? null : friendlyCity ?? friendlyFeature);
  const note = focusedNote;
  const country = focusedCountry
    ?? (hasValidCanonicalFocus || place || note ? null : friendlyCountry);

  const aliasesContradictCanonical = focusedPlace
    ? params.has("country")
      || (params.has("city") && (
        focusedPlace.kind !== "city" || friendlyCity?.placeId !== focusedPlace.placeId
      ))
      || (params.has("feature") && (
        focusedPlace.kind === "city" || friendlyFeature?.placeId !== focusedPlace.placeId
      ))
    : focusedNote || hasCanonicalCoordinate
      ? params.has("country") || params.has("city") || params.has("feature")
      : focusedCountry
        ? params.has("city")
          || params.has("feature")
          || (params.has("country") && friendlyCountry?.id !== focusedCountry.id)
        : false;
  let scene = parsed.scene;
  if (place) scene = { ...scene, focus: { kind: "feature", id: place.placeId } };
  else if (note) scene = { ...scene, focus: { kind: "feature", id: note.id } };
  else if (country) scene = { ...scene, focus: { kind: "entity", id: country.id } };
  else if (scene.focus?.kind !== "coordinate") scene = { ...scene, focus: null };

  return {
    scene,
    countryId: country?.id ?? null,
    placeId: place?.placeId ?? null,
    noteId: note?.id ?? null,
    needsCanonicalUrl: parsed.usedLegacyModeAlias
      || parsed.issues.length > 0
      || aliasesContradictCanonical
      || JSON.stringify(scene.focus) !== JSON.stringify(parsed.scene.focus)
      || (params.has("country") && !country)
      || (params.has("city") && !friendlyCity)
      || (params.has("feature") && !friendlyFeature),
  };
}
