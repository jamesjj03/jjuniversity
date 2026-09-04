import { getAtlasRuntimeDataset } from "@/lib/atlas-world/getAtlasRuntime";
import {
  ATLAS_API_LAYER_IDS,
  buildAtlasLayerDataResponse,
  AtlasLayerNotFoundError,
  AtlasLayerTimeError,
} from "@/lib/atlas-world/layers";
import type { AtlasTimeSelection } from "@/lib/atlas-world/layers";

type AtlasLayerRouteContext = {
  params: Promise<{ layerId: string }>;
};

// Query-string time selection is part of the response contract. HTTP caching
// remains explicit below; forcing static rendering would collapse variants.
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return ATLAS_API_LAYER_IDS.map((layerId) => ({ layerId }));
}

function requestedTime(request: Request): AtlasTimeSelection {
  const at = new URL(request.url).searchParams.get("at")?.trim();
  return !at || at === "latest" ? { kind: "latest" } : { kind: "instant", at };
}

function etagTimeToken(time: AtlasTimeSelection) {
  if (time.kind === "latest") return "latest";
  if (time.kind === "instant") return `instant-${encodeURIComponent(time.at)}`;
  return `interval-${encodeURIComponent(time.from)}-${encodeURIComponent(time.to)}`;
}

export async function GET(request: Request, context: AtlasLayerRouteContext) {
  const { layerId: encodedLayerId } = await context.params;
  const layerId = decodeURIComponent(encodedLayerId).trim().toLocaleLowerCase("en-US");
  try {
    const payload = buildAtlasLayerDataResponse(
      layerId,
      getAtlasRuntimeDataset(),
      requestedTime(request),
    );
    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        ETag: `"${payload.snapshotId}:${payload.layerId}:${etagTimeToken(payload.requestedTime)}"`,
      },
    });
  } catch (error) {
    if (error instanceof AtlasLayerNotFoundError) {
      return Response.json({ error: "Atlas layer not found." }, { status: 404 });
    }
    if (error instanceof AtlasLayerTimeError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
