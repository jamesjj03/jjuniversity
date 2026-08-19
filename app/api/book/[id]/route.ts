import { NextResponse } from "next/server";
import { canonicalBookId } from "@/lib/bookAliases";
import { readBookContent, readFileBookContent } from "@/lib/bookContent";
import { getBookBySlugLive } from "@/lib/publishing";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const requestedId = canonicalBookId(id);
    const catalogBook = await getBookBySlugLive(requestedId);
    if (!catalogBook || catalogBook.status !== "ready") {
      return NextResponse.json({ error: "Book content unavailable." }, { status: 404 });
    }

    const canonicalId = catalogBook.id;
    const preferFile = process.env.NODE_ENV === "development"
      && new URL(request.url).searchParams.get("source") === "file";
    const { book, fileName, publicPath } = await (preferFile
      ? readFileBookContent(canonicalId)
      : readBookContent(canonicalId));

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
