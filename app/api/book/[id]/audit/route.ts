import { NextResponse } from "next/server";
import { readBookAudit } from "@/lib/bookAudit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json(await readBookAudit(id));
}
