import type { Metadata } from "next";
import AtlasWorldMap from "@/components/atlas-world/AtlasWorldMap";
import AtlasWorldExperience from "@/components/atlas-world/AtlasWorldExperience";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";
import {
  getAtlasClientDataset,
  getAtlasRuntimeDataset,
} from "@/lib/atlas-world/getAtlasRuntime";
import { getAtlasGeographyPack, getAtlasPatternNotes } from "@/lib/atlas-world/getAtlasGeography";
import { resolveAtlasInitialState } from "@/lib/atlas-world/initialState";
import { buildAtlasPlaceIndex } from "@/lib/atlas-world/places";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Explore the countries, governments, religions, and population patterns of the world.",
};

type AtlasPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toUrlSearchParams(input: Record<string, string | string[] | undefined>) {
  const output = new URLSearchParams();
  for (const [key, raw] of Object.entries(input)) {
    for (const value of Array.isArray(raw) ? raw : raw == null ? [] : [raw]) output.append(key, value);
  }
  return output;
}

export default async function AtlasPage({ searchParams }: AtlasPageProps) {
  const runtimeData = getAtlasRuntimeDataset();
  const clientData = getAtlasClientDataset(runtimeData);
  const geography = getAtlasGeographyPack();
  const patternNotes = getAtlasPatternNotes();
  const places = buildAtlasPlaceIndex(geography.featureCollections);
  const resolved = resolveAtlasInitialState(
    toUrlSearchParams(await searchParams),
    clientData.countries,
    places,
    patternNotes,
  );
  const initialFeatureIds = new Set(
    [
      ...geography.featureCollections.majorRivers.features,
      ...geography.featureCollections.majorLakes.features,
      ...geography.featureCollections.majorCities.features,
    ]
      .filter((feature) => (feature.displayMinimumZoom ?? 1) <= 1)
      .map((feature) => feature.featureId),
  );
  const initialPlaces = places.filter((place) =>
    place.placeId === resolved.placeId
    || place.featureIds.some((featureId) => initialFeatureIds.has(featureId)),
  );
  const initialCountry = resolved.countryId
    ? runtimeData.countries.find((country) => country.id === resolved.countryId) ?? null
    : null;
  return (
    <SiteV2Shell immersive mobileMap>
      <AtlasWorldExperience
        data={clientData}
        patternNotes={patternNotes}
        initialPlaces={initialPlaces}
        initialScene={resolved.scene}
        initialCountry={initialCountry}
        map={<AtlasWorldMap data={runtimeData} initialScene={resolved.scene} />}
      />
    </SiteV2Shell>
  );
}
