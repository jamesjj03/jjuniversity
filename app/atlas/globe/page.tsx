import type { Metadata } from "next";
import AtlasGlobeExperiment from "@/components/atlas-world/AtlasGlobeExperiment";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";
import { getAtlasClientDataset, getAtlasRuntimeDataset } from "@/lib/atlas-world/getAtlasRuntime";

export const metadata: Metadata = {
  title: "Atlas Globe Experiment",
  description: "Rotate and inspect JJ University Atlas geography on an experimental orthographic globe.",
};

type AtlasGlobePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function initialCountryId(value: string | undefined, countries: ReturnType<typeof getAtlasClientDataset>["countries"]) {
  const query = value?.trim().toLocaleLowerCase("en-US").replace(/^country:/, "");
  if (!query) return null;
  return countries.find((country) => [
    country.id.replace(/^country:/, ""),
    country.slug,
    country.codes.iso2,
    country.codes.iso3,
    country.codes.naturalEarth,
  ].some((candidate) => candidate?.toLocaleLowerCase("en-US") === query))?.id ?? null;
}

export default async function AtlasGlobePage({ searchParams }: AtlasGlobePageProps) {
  const runtime = getAtlasRuntimeDataset();
  const client = getAtlasClientDataset(runtime);
  const query = await searchParams;
  const selectedId = initialCountryId(firstValue(query.country), client.countries);
  const naturalEarthSource = client.sources.find((source) => source.id === "natural-earth-admin-0-50m-5.1.2") ?? null;

  return (
    <SiteV2Shell immersive mobileMap>
      <AtlasGlobeExperiment
        countries={client.countries}
        initialCountryId={selectedId}
        naturalEarthSource={naturalEarthSource}
      />
    </SiteV2Shell>
  );
}
