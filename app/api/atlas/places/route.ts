import { getAtlasGeographyPack } from "@/lib/atlas-world/getAtlasGeography";
import { buildAtlasPlaceIndex } from "@/lib/atlas-world/places";

export const runtime = "nodejs";

export async function GET() {
  const geography = getAtlasGeographyPack();
  return Response.json(
    {
      schemaVersion: "1.0.0",
      snapshotId: geography.snapshotId,
      places: buildAtlasPlaceIndex(geography.featureCollections, geography.placeRelationships),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
