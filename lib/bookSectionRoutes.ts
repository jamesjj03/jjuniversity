import { cache } from "react";
import { readBookContent, type BookContentSection } from "@/lib/bookContent";
import {
  bookUrl,
  getPublicBooksLive,
  isPublishedReadableBook,
  slugify,
  type PublishedBook,
} from "@/lib/publishing";

const MIN_CRAWLABLE_WORDS = 80;
const readBookContentForIndex = cache(readBookContent);

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

export async function getBookSectionIndex(book: PublishedBook): Promise<BookSectionIndex> {
  if (!isPublishedReadableBook(book)) return { routes: [], extras: [], available: false };

  try {
    const resolved = await readBookContentForIndex(book.id);
    const crawlable = resolved.book.sections.filter(isCrawlableSection);
    const extras = resolved.book.sections.filter(section => (
      !isCrawlableSection(section)
      && !isStructuralDuplicate(section)
      && hasIndexableText(section)
    ));
    const usedTitles = new Map<string, number>();
    const usedIdentities = new Map<string, number>();
    const lastModified = validTimestamp(resolved.book.generatedAt);

    const routes = crawlable.map((section, index) => {
      const titleSlug = slugify(section.title || section.id || `section-${index + 1}`) || `section-${index + 1}`;
      const titleCount = usedTitles.get(titleSlug) || 0;
      usedTitles.set(titleSlug, titleCount + 1);
      const legacySectionSlug = titleCount ? `${titleSlug}-${titleCount + 1}` : titleSlug;
      const identityBase = slugify(section.id || `section-${index + 1}`) || `section-${index + 1}`;
      const identityCount = usedIdentities.get(identityBase) || 0;
      usedIdentities.set(identityBase, identityCount + 1);
      const identitySlug = identityCount ? `${identityBase}-${identityCount + 1}` : identityBase;
      const sectionSlug = `${titleSlug}--${identitySlug}`;

      return {
        book,
        section,
        sectionSlug,
        identitySlug,
        legacySectionSlug,
        title: section.title || `Section ${index + 1}`,
        path: `${bookUrl(book)}/${sectionSlug}`,
        index,
        total: crawlable.length,
        lastModified,
      };
    });

    return { routes, extras, lastModified, available: true };
  } catch {
    return { routes: [], extras: [], available: false };
  }
}

export async function getBookSectionRoutes(book: PublishedBook): Promise<CrawlableBookSection[]> {
  return (await getBookSectionIndex(book)).routes;
}

export async function getAllBookSectionRoutes(books?: PublishedBook[]) {
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

export async function getBookSectionRoute(book: PublishedBook, sectionSlug: string) {
  const clean = normalizeBookSectionSlug(sectionSlug);
  const routes = await getBookSectionRoutes(book);
  const direct = routes.find(route => route.sectionSlug === clean || route.legacySectionSlug === slugify(clean));
  if (direct) return direct;

  const identitySlug = clean.includes("--") ? clean.slice(clean.lastIndexOf("--") + 2) : "";
  return identitySlug ? routes.find(route => route.identitySlug === identitySlug) : undefined;
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

export function sectionExcerpt(section: BookContentSection, maxLength = 155) {
  const text = String(section.text || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

function isCrawlableSection(section: BookContentSection) {
  if (isStructuralDuplicate(section) || isEditionNote(section)) return false;
  return Number(section.wordCount || 0) >= MIN_CRAWLABLE_WORDS
    || String(section.text || "").trim().length > 420;
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

function isStructuralDuplicate(section: BookContentSection) {
  const kind = String(section.kind || "").trim().toLowerCase();
  const title = String(section.title || "").trim().toLowerCase();
  if (/^(table of )?contents?$/.test(title)) return true;
  return kind === "title" && Number(section.wordCount || 0) <= 40;
}

function isEditionNote(section: BookContentSection) {
  const title = String(section.title || "").trim().toLowerCase();
  return /^(?:copyright(?:\s*(?:&|and|\/)\s*disclaimers?)?|disclaimers?|acknowledg(?:e)?ments?|about (?:the )?author|dedications?)(?:$|\s|[:—–-])/.test(title);
}

function hasIndexableText(section: BookContentSection) {
  return Boolean(String(section.text || "").trim());
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
