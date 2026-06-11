import { NextResponse } from "next/server";
import { readBookContent } from "@/lib/bookContent";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  try {
    const { file } = await params;
    const { book } = await readBookContent(file);
    return NextResponse.json(book);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Book content unavailable." },
      { status: 404 },
    );
  }
}
