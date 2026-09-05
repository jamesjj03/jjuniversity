import type { Metadata } from "next";
import AtlasWorldMap from "@/components/atlas-world/AtlasWorldMap";
import AtlasWorldExperience from "@/components/atlas-world/AtlasWorldExperience";
import SiteV2Shell from "@/components/site-v2/SiteV2Shell";
import {
  getAtlasClientDataset,
  getAtlasRuntimeDataset,
} from "@/lib/atlas-world/getAtlasRuntime";
import { getAtlasGeographyPack, getAtlasPatternNotes } from "@/lib/atlas-world/getAtlasGeography";
import { atlasCitySummary } from "@/lib/atlas-world/cities";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Explore the countries, governments, religions, and population patterns of the world.",
};

export default function AtlasPage() {
  const runtimeData = getAtlasRuntimeDataset();
  return (
    <SiteV2Shell immersive mobileMap>
      <AtlasWorldExperience
        data={getAtlasClientDataset(runtimeData)}
        patternNotes={getAtlasPatternNotes()}
        cities={getAtlasGeographyPack().featureCollections.majorCities.features.map(atlasCitySummary)}
        map={<AtlasWorldMap data={runtimeData} />}
      />
    </SiteV2Shell>
  );
}
