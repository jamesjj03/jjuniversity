import { readAdminBookCatalog } from "@/lib/adminBookCatalog";
import { adminErrorResponse, versionedJson } from "@/lib/adminVersionedJson";
import { normalizeWorkshopBook } from "@/lib/workshopBooks";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalog = await readAdminBookCatalog();
    const books = catalog.books.map(value => {
      const book = normalizeWorkshopBook(value);
      return {
        id: book.id,
        slug: book.slug,
        title: book.title,
        subtitle: book.subtitle,
        description: book.description,
        creator: book.creator,
        series: book.series,
        tags: book.tags,
        status: book.status,
        visibility: book.visibility,
        coverFile: book.coverFile,
      };
    });
    return versionedJson({ books, source: catalog.source }, catalog.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load the Workshop book index.");
  }
}
