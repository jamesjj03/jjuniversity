export type WorkshopBook = Record<string, unknown> & {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  creator: string;
  author: string;
  series: string;
  tags: string[];
  description: string;
  status: string;
  visibility: "main" | "archive";
  archive: boolean;
  category: string;
  archiveCategory: string;
  primaryCategory: string;
  coverFile: string;
  bookFile: string;
  hiddenShelves: string[];
  hiddenCategories: string[];
};

export const WORKSHOP_BOOK_STATUSES = [
  "ready",
  "coming-soon",
  "hidden",
  "needs-review",
  "unavailable",
] as const;

export type WorkshopBookStatus = typeof WORKSHOP_BOOK_STATUSES[number];

function stringList(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right))
    : [];
}

export function normalizeWorkshopBook(value: unknown): WorkshopBook {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = String(source.id || "").trim().toLowerCase();
  const visibility = source.archive || String(source.visibility || "main").trim().toLowerCase() === "archive"
    ? "archive"
    : "main";
  const archiveCategory = String(source.archiveCategory || source.category || "").trim();
  const creator = String(source.creator || source.author || "James Johnson").trim();

  return {
    ...source,
    id,
    slug: String(source.slug || id).trim().toLowerCase(),
    title: String(source.title || id || "Untitled").trim(),
    subtitle: String(source.subtitle || "").trim(),
    creator,
    author: creator,
    series: String(source.series || "").trim(),
    tags: stringList(source.tags),
    description: String(source.description || "").trim(),
    status: String(source.status || "ready").trim().toLowerCase(),
    visibility,
    archive: visibility === "archive",
    category: archiveCategory,
    archiveCategory,
    primaryCategory: String(source.primaryCategory || "Library").trim() || "Library",
    coverFile: String(source.coverFile || "").trim(),
    bookFile: String(source.bookFile || "").trim(),
    hiddenShelves: stringList(source.hiddenShelves),
    hiddenCategories: stringList(source.hiddenCategories),
  };
}

export function workshopBookPublicState(book: WorkshopBook) {
  if (book.status === "ready") return book.visibility === "archive" ? "Ready for the next Archive edition" : "Ready for the next Main Library edition";
  if (book.status === "coming-soon") return book.visibility === "archive" ? "Coming soon in Archive" : "Coming soon in Main Library";
  if (book.status === "needs-review") return "Hidden pending review";
  if (book.status === "unavailable") return "Unavailable on the public site";
  return "Hidden from the public site";
}

export function workshopBookStatusLabel(status: string) {
  switch (status) {
    case "ready": return "Ready to publish";
    case "coming-soon": return "Coming soon";
    case "needs-review": return "Needs review";
    case "unavailable": return "Unavailable";
    default: return "Hidden draft";
  }
}
