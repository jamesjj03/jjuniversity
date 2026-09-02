import { NextResponse } from "next/server";
import { canonicalBookId } from "@/lib/bookAliases";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bookId = canonicalBookId(id);
  return NextResponse.json(
    {
      error: "This legacy manuscript endpoint has been retired.",
      reader: `/reader?book=${encodeURIComponent(bookId)}`,
      detail: "JJ University now serves the published reader edition as small, versioned static sections instead of a full-book API payload.",
    },
    { status: 410, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } },
  );
}
