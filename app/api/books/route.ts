import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { readBooksFromSupabase } from "@/lib/bookCatalog";
import { isPublicCatalogRecord } from "@/lib/publishing";
import { toPublicCatalogBook } from "@/lib/publicBookPayload";
import { hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    if (hasSupabaseAdminConfig()) {
      const supabaseBooks = await readBooksFromSupabase();
      if (!supabaseBooks) throw new Error("The authoritative Supabase catalog is unavailable.");
      return NextResponse.json(
        { books: supabaseBooks.filter(isPublicCatalogRecord).map(toPublicCatalogBook), source: "supabase" },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
      );
    }

    const booksPath = path.join(process.cwd(), "private", "catalog", "books.json");
    const books = JSON.parse(await readFile(booksPath, "utf8"));
    const publicBooks = (Array.isArray(books) ? books : books.books || [])
      .filter(isPublicCatalogRecord)
      .map(toPublicCatalogBook);
    return NextResponse.json(
      { books: publicBooks, source: "file" },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load books." },
      { status: 500 },
    );
  }
}
