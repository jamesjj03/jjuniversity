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
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Book content unavailable." },
      { status: 404 },
    );
  }
}
