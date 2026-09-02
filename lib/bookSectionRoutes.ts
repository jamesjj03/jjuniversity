import type { BookContentSection } from "@/lib/bookContent";
import { readPublicationBookIndex, readPublicationSection, type PublicationSectionSummary } from "@/lib/publicationEdition";
import {
  bookUrl,
  getPublicBooksLive,
  isPublishedReadableBook,
  slugify,
  type PublishedBook,
} from "@/lib/publishing";

export type CrawlableBookSection = {
  book: PublishedBook;
  section: BookContentSection;
  sectionSlug: string;
  identitySlug: string;
  legacySectionSlug: string;
  title: string;
  path: string;
  index: number;
  total: number;
  lastModified?: string;
};

export type BookSectionIndex = {
  routes: CrawlableBookSection[];
  extras: BookContentSection[];
  lastModified?: string;
  available: boolean;
};

export async function getBookSectionIndex(
  book: PublishedBook,
): Promise<BookSectionIndex> {
  if (!isPublishedReadableBook(book)) return { routes: [], extras: [], available: false };

  try {
    const published = await readPublicationBookIndex(book.id);
    const lastModified = validTimestamp(published.book.generatedAt);
    return {
      routes: published.sections
        .filter(section => section.crawlable)
        .map(section => routeFromPublishedSummary(book, section, lastModified)),
      extras: published.extras,
      lastModified,
      available: true,
    };
  } catch {
    return { routes: [], extras: [], available: false };
  }
}

export async function getBookSectionRoutes(
  book: PublishedBook,
): Promise<CrawlableBookSection[]> {
  return (await getBookSectionIndex(book)).routes;
}

export async function getAllBookSectionRoutes(
  books?: PublishedBook[],
) {
  const availableBooks = books ?? await getPublicBooksLive();
  const readableBooks = availableBooks.filter(isPublishedReadableBook);
  const routes: CrawlableBookSection[] = [];
  const failures: string[] = [];
  const batchSize = 12;

  for (let offset = 0; offset < readableBooks.length; offset += batchSize) {
    const batch = readableBooks.slice(offset, offset + batchSize);
    const indexes = await Promise.all(batch.map(book => getBookSectionIndex(book)));
    indexes.forEach((index, itemIndex) => {
      if (!index.available) failures.push(batch[itemIndex].id);
      routes.push(...index.routes);
    });
  }

  if (failures.length) {
    throw new Error(`Refusing to publish a partial section index; ${failures.length} readable books could not be loaded.`);
  }

  return routes;
}

export async function getBookSectionRoute(
  book: PublishedBook,
  sectionSlug: string,
) {
  const clean = normalizeBookSectionSlug(sectionSlug);
  const routes = await getBookSectionRoutes(book);
  const direct = routes.find(route => route.sectionSlug === clean || route.legacySectionSlug === slugify(clean));
  const identitySlug = clean.includes("--") ? clean.slice(clean.lastIndexOf("--") + 2) : "";
  const found = direct || (identitySlug ? routes.find(route => route.identitySlug === identitySlug) : undefined);
  if (!found) return undefined;

  try {
    const published = await readPublicationSection(book.id, found.section.id);
    return {
      ...found,
      section: published.section,
    };
  } catch {
    return undefined;
  }
}

function routeFromPublishedSummary(
  book: PublishedBook,
  section: PublicationSectionSummary,
  lastModified?: string,
): CrawlableBookSection {
  return {
    book,
    section: {
      id: section.id,
      index: section.index,
      title: section.title,
      kind: section.kind,
      html: "",
      text: section.excerpt,
      wordCount: section.wordCount,
    },
    sectionSlug: section.sectionSlug,
    identitySlug: section.identitySlug,
    legacySectionSlug: section.legacySectionSlug,
    title: section.title,
    path: section.path || `${bookUrl(book)}/${section.sectionSlug}`,
    index: section.routeIndex,
    total: section.routeTotal,
    lastModified,
  };
}

export function normalizeBookSectionSlug(value: string) {
  let decoded = String(value || "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return "";
  }
  return decoded
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sectionExcerpt(section: { text?: string }, maxLength = 155) {
  const text = String(section.text || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

export function sanitizePublicSectionHtml(value: string) {
  return String(value || "").replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (heading, _level, inner: string) => {
    if (/<(?:img|svg)\b/i.test(inner)) return heading;
    const visibleText = inner
      .replace(/<br\s*\/?\s*>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/(?:&nbsp;|&#160;|&#x0*a0;)/gi, "")
      .trim();
    return visibleText ? heading : '<div class="bookSectionSpacer" aria-hidden="true"></div>';
  });
}

export function sectionHtmlHasMatchingHeading(html: string, title: string) {
  const normalizedTitle = normalizeHeadingText(title);
  if (!normalizedTitle) return false;

  const headingPattern = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  for (const match of String(html || "").matchAll(headingPattern)) {
    const heading = normalizeHeadingText(match[1]);
    if (!heading) continue;
    return heading === normalizedTitle;
  }
  return false;
}

function validTimestamp(value: string | undefined) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeHeadingText(value: string) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(nbsp|amp|quot|apos|#39);/gi, entity => ({
      "&nbsp;": " ",
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&#39;": "'",
    }[entity.toLowerCase()] || " "))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
