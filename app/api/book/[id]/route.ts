import { NextResponse } from "next/server";
import { canonicalBookId } from "@/lib/bookAliases";
import { readBookContent, readFileBookContent } from "@/lib/bookContent";
import { getBookBySlugLive, isPublishedReadableBook } from "@/lib/publishing";
import { toPublicBookContent } from "@/lib/publicBookPayload";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const requestedId = canonicalBookId(id);
    const catalogBook = await getBookBySlugLive(requestedId);
    if (!catalogBook || !isPublishedReadableBook(catalogBook)) {
      return NextResponse.json({ error: "Book content unavailable." }, { status: 404 });
    }

    const canonicalId = catalogBook.id;
    const preferFile = process.env.NODE_ENV === "development"
      && new URL(request.url).searchParams.get("source") === "file";
    const { book } = await (preferFile
      ? readFileBookContent(canonicalId)
      : readBookContent(canonicalId));

    return NextResponse.json(toPublicBookContent(book));
  } catch {
    return NextResponse.json(
      { error: "Book content unavailable." },
      { status: 404 },
    );
  }
}
