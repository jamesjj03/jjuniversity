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
import {
  normalizeWorkshopBook,
  WORKSHOP_BOOK_STATUSES,
  type WorkshopBook,
} from "@/lib/workshopBooks";

type BookPatchBody = {
  patch?: unknown;
  message?: string;
};

const PATCH_KEYS = new Set([
  "title",
  "subtitle",
  "creator",
  "author",
  "series",
  "tags",
  "description",
  "status",
  "visibility",
  "archiveCategory",
  "category",
  "primaryCategory",
  "coverFile",
  "bookFile",
  "hiddenShelves",
  "hiddenCategories",
]);

function cleanId(value: string) {
  return value.trim().toLowerCase();
}

function findBook(books: Array<Record<string, unknown>>, id: string) {
  return books.find(book => cleanId(String(book.id || "")) === id);
}

function cleanString(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const next = value.trim();
  if (next.length > maximum) throw new Error(`${label} is too long.`);
  return next;
}

function cleanList(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > 200) throw new Error(`${label} contains too many values.`);
  if (value.some(item => typeof item !== "string")) throw new Error(`${label} values must be text.`);
  return [...new Set(value.map(item => cleanString(item, label, 120)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function cleanPatch(value: unknown): Partial<WorkshopBook> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Book changes are missing.");
  const input = value as Record<string, unknown>;
  if (!Object.keys(input).length) throw new Error("No book changes were provided.");
  const unknownKeys = Object.keys(input).filter(key => !PATCH_KEYS.has(key));
  if (unknownKeys.length) throw new Error(`Unsupported book field: ${unknownKeys[0]}.`);
  const patch: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    if (["tags", "hiddenShelves", "hiddenCategories"].includes(key)) patch[key] = cleanList(input[key], key);
    else if (key === "status") {
      const status = cleanString(input[key], "Status", 40).toLowerCase();
      if (!WORKSHOP_BOOK_STATUSES.includes(status as typeof WORKSHOP_BOOK_STATUSES[number])) throw new Error("Unknown book status.");
      patch.status = status;
    } else if (key === "visibility") {
      const visibility = cleanString(input[key], "Placement", 20).toLowerCase();
      if (!new Set(["main", "archive"]).has(visibility)) throw new Error("Unknown book placement.");
      patch.visibility = visibility;
      patch.archive = visibility === "archive";
    } else {
      const maximum = key === "description" ? 8_000 : 500;
      patch[key] = cleanString(input[key], key, maximum);
    }
  }

  if ("title" in patch && !patch.title) throw new Error("A book title cannot be empty.");
  if ("author" in patch && !("creator" in patch)) patch.creator = patch.author;
  if ("creator" in patch) patch.author = patch.creator;
  if ("category" in patch && !("archiveCategory" in patch)) patch.archiveCategory = patch.category;
  if ("archiveCategory" in patch) patch.category = patch.archiveCategory;
  return patch as Partial<WorkshopBook>;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = cleanId(rawId);
    const catalog = await readAdminBookCatalog();
    const book = findBook(catalog.books, id);
    if (!book) return versionedJson({ error: "Book not found." }, catalog.version, { status: 404 });
    return versionedJson({ book: normalizeWorkshopBook(book), source: catalog.source }, catalog.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not load this book.");
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const expectedVersion = expectedAdminVersion(request);
    const { id: rawId } = await context.params;
    const id = cleanId(rawId);
    const body = await request.json().catch(() => ({})) as BookPatchBody;
    const patch = cleanPatch(body.patch);
    const catalog = await readAdminBookCatalog();
    const current = findBook(catalog.books, id);
    if (!current) return versionedJson({ error: "Book not found." }, catalog.version, { status: 404 });

    const nextBook = { ...current, ...patch, id };
    const nextBooks = catalog.books.map(book => cleanId(String(book.id || "")) === id ? nextBook : book);
    const saved = await saveAdminBookCatalog(
      nextBooks,
      expectedVersion,
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : `Update ${String(nextBook.title || id)} metadata`,
      { preserveRows: true },
    );
    const savedBook = findBook(saved.books, id);
    if (!savedBook) throw new Error("The catalog saved without the edited book. Reload before continuing.");
    revalidateAdminBookCatalog(id);

    return versionedJson({
      saved: true,
      target: saved.target,
      note: saved.note,
      book: normalizeWorkshopBook(savedBook),
    }, saved.version);
  } catch (error) {
    return adminErrorResponse(error, "Could not save this book.");
  }
}
