import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { readBooksFromSupabase } from "@/lib/bookCatalog";
import { isPublicCatalogRecord } from "@/lib/publishing";

export async function GET() {
  try {
    const supabaseBooks = await readBooksFromSupabase().catch(() => null);
    if (supabaseBooks) {
      return NextResponse.json(
        { books: supabaseBooks.filter(isPublicCatalogRecord), source: "supabase" },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
      );
    }

    const booksPath = path.join(process.cwd(), "public", "books.json");
    const books = JSON.parse(await readFile(booksPath, "utf8"));
    const publicBooks = (Array.isArray(books) ? books : books.books || []).filter(isPublicCatalogRecord);
    return NextResponse.json(
      { books: publicBooks, source: "file" },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load books." },
      { status: 500 },
    );
  }
}
