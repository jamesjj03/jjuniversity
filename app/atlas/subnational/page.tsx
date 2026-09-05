import type { Metadata } from "next";

import AtlasSubnationalExperience, { type AtlasSubnationalCountry } from "@/components/atlas-world/AtlasSubnationalExperience";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";
import { getAtlasAdmin1Pilot, resolveAtlasAdmin1Focus } from "@/lib/atlas-world/admin1Pilot";
import { getAtlasRuntimeDataset } from "@/lib/atlas-world/getAtlasRuntime";

export const metadata: Metadata = {
  title: "Subnational Atlas Pilot",
  description: "Explore a sourced pilot of states, provinces, and other first-order administrative units.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const PILOT_CODES = ["USA", "DEU", "IND", "CHN", "CAN", "NGA"];

export default async function AtlasSubnationalPage({ searchParams }: Props) {
  const params = await searchParams;
  const rawFocus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const rawCountry = Array.isArray(params.country) ? params.country[0] : params.country;
  const snapshot = getAtlasAdmin1Pilot();
  const runtime = getAtlasRuntimeDataset();
  const initialFeature = resolveAtlasAdmin1Focus(rawFocus ?? null);
  const requestedCountry = rawCountry?.toLocaleUpperCase("en-US");
  const initialCountryCode = initialFeature?.entity.countryId.slice("country:".length)
    ?? (requestedCountry && PILOT_CODES.includes(requestedCountry) ? requestedCountry : "USA");
  const featureByCountry = new Map(runtime.geometry.features.map((feature) => [feature.entityId, feature]));
  const countryByCode = new Map(runtime.countries.map((country) => [country.codes.naturalEarth, country]));
  const countries = PILOT_CODES.map((code): AtlasSubnationalCountry => {
    const country = countryByCode.get(code);
    const geometry = country ? featureByCountry.get(country.id) : null;
    if (!country || !geometry) throw new Error(`Admin-1 pilot parent ${code} is absent from Atlas runtime.`);
    return {
      id: country.id,
      code,
      name: country.name,
      bounds: geometry.focusBounds ?? geometry.bounds,
      facts: {
        capital: country.facts.capital,
        population: country.facts.population,
        gdpPerCapitaCurrentUsd: country.facts.gdpPerCapitaCurrentUsd,
        urbanPopulationPercent: country.facts.urbanPopulationPercent,
        lifeExpectancyYears: country.facts.lifeExpectancyYears,
        government: country.facts.government,
      },
    };
  });

  return <SiteV2Shell immersive mobileMap>
    <AtlasSubnationalExperience snapshot={snapshot} countries={countries}
      allCountryIds={runtime.geometry.features.map((feature) => feature.entityId)}
      initialFocusId={initialFeature?.entity.entityId ?? null} initialCountryCode={initialCountryCode} />
  </SiteV2Shell>;
}
