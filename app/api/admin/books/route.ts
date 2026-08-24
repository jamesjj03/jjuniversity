import {
  adminErrorResponse,
  expectedAdminVersion,
  versionedJson,
} from "@/lib/adminVersionedJson";
import {
  readAdminBookCatalog,
  revalidateAdminBookCatalog,
  saveAdminBookCatalog,
} from "@/lib/adminBookCatalog";

type SaveBody = {
  books?: unknown;
  message?: string;
};

export async function GET() {
  try {
    const catalog = await readAdminBookCatalog();
    return versionedJson({ books: catalog.books, source: catalog.source }, catalog.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load books.json.");
  }
}

export async function POST(request: Request) {
  try {
    const expectedVersion = expectedAdminVersion(request);
    const body = await request.json().catch(() => ({})) as SaveBody;
    const message = body.message || `Update JJU library metadata (${new Date().toISOString().slice(0, 10)})`;
    const saved = await saveAdminBookCatalog(body.books, expectedVersion, message);
    revalidateAdminBookCatalog();
    return versionedJson({
      saved: true,
      target: saved.target,
      books: saved.books,
      note: saved.note,
    }, saved.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not save books.json.");
  }
}
