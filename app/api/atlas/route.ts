import { NextResponse } from "next/server";
import { getAtlasPayload } from "@/lib/atlas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await getAtlasPayload({ includeInventory: url.searchParams.get("inventories") === "1" }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Atlas." },
      { status: 500 },
    );
  }
}
