import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { error: "Book content unavailable." },
    {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
