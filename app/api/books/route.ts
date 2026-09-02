import { NextResponse } from "next/server";
import { getPublicBooksLive } from "@/lib/publishing";
import { toPublicCatalogBook } from "@/lib/publicBookPayload";

const PUBLIC_CATALOG_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";

export async function GET() {
  try {
    const books = await getPublicBooksLive();
    return NextResponse.json(
      { books: books.map(toPublicCatalogBook), source: "publication-catalog" },
      { headers: { "Cache-Control": PUBLIC_CATALOG_CACHE, "X-Robots-Tag": "noindex, nofollow" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load books." },
      { status: 500 },
    );
  }
}
