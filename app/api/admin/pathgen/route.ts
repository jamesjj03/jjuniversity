import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Path generation is disabled. Edit paths directly in admin." },
    { status: 410 },
  );
}
