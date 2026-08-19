import { NextResponse } from "next/server";
import { getBookBySlugLive, getRelatedBooksLive } from "@/lib/publishing";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("book")?.trim() || "";
  if (!source) {
    return NextResponse.json({ books: [] }, { status: 400 });
  }

  const book = await getBookBySlugLive(source);
  if (!book) {
    return NextResponse.json({ books: [] }, { status: 404 });
  }

  const books = await getRelatedBooksLive(book, Number.MAX_SAFE_INTEGER);
  return NextResponse.json(
    { books },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
