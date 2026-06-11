import { NextResponse } from "next/server";
import { readBookContent } from "@/lib/bookContent";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { book, fileName, publicPath } = await readBookContent(id);

    return NextResponse.json({
      ...book,
      contentFile: fileName,
      contentPath: publicPath,
      chapters: book.sections,
      note: "Legacy endpoint served JSON content. Use /api/admin/content/[id] for edits.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load book content." },
      { status: 404 },
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { error: "This legacy endpoint no longer saves live book content. Use /api/admin/content/[id]." },
    { status: 410 },
  );
}
