import { getAtlasRuntimeDataset } from "@/lib/atlas-world/getAtlasRuntime";

type AtlasCountryRouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: AtlasCountryRouteContext) {
  const { slug } = await context.params;
  const normalizedSlug = decodeURIComponent(slug).trim().toLocaleLowerCase("en-US");
  const country = getAtlasRuntimeDataset().countries.find((candidate) => candidate.slug === normalizedSlug);

  if (!country) {
    return Response.json({ error: "Country not found." }, { status: 404 });
  }

  return Response.json(country, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
