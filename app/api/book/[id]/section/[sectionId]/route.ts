import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  const { id, sectionId } = await params;
  return NextResponse.json(
    {
      error: "This legacy manuscript section endpoint has been retired.",
      bookId: id,
      sectionId,
      detail: "The Reader now loads its versioned public section asset directly from the edition CDN.",
    },
    { status: 410, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } },
  );
}
