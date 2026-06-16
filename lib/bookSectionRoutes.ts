import { readBookContent, type BookContentSection } from "@/lib/bookContent";
import { bookUrl, getPublicBooks, slugify, type PublishedBook } from "@/lib/publishing";

const SKIPPED_SECTION_KINDS = new Set(["toc", "title", "dedication", "copyright", "about-author", "acknowledgments"]);
const MIN_CRAWLABLE_WORDS = 80;

export type CrawlableBookSection = {
  book: PublishedBook;
  section: BookContentSection;
  sectionSlug: string;
  title: string;
  path: string;
  index: number;
  total: number;
};

export async function getBookSectionRoutes(book: PublishedBook): Promise<CrawlableBookSection[]> {
  try {
    const resolved = await readBookContent(book.id);
    const crawlable = resolved.book.sections.filter(isCrawlableSection);
    const used = new Map<string, number>();

    return crawlable.map((section, index) => {
      const baseSlug = slugify(section.title || section.id || `section-${index + 1}`) || `section-${index + 1}`;
      const count = used.get(baseSlug) || 0;
      used.set(baseSlug, count + 1);
      const sectionSlug = count ? `${baseSlug}-${count + 1}` : baseSlug;

      return {
        book,
        section,
        sectionSlug,
        title: section.title || `Section ${index + 1}`,
        path: `${bookUrl(book)}/${sectionSlug}`,
        index,
        total: crawlable.length,
      };
    });
  } catch {
    return [];
  }
}

export async function getAllBookSectionRoutes() {
  const nested = await Promise.all(getPublicBooks().map(book => getBookSectionRoutes(book)));
  return nested.flat();
}

export async function getBookSectionRoute(book: PublishedBook, sectionSlug: string) {
  const clean = slugify(sectionSlug);
  const routes = await getBookSectionRoutes(book);
  return routes.find(route => route.sectionSlug === clean);
}

export function sectionExcerpt(section: BookContentSection, maxLength = 155) {
  const text = String(section.text || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

function isCrawlableSection(section: BookContentSection) {
  const kind = String(section.kind || "").toLowerCase();
  const title = String(section.title || "").toLowerCase();
  if (SKIPPED_SECTION_KINDS.has(kind)) return false;
  if (/copyright|acknowledg|about the author|contents|dedication/.test(title)) return false;
  return Number(section.wordCount || 0) >= MIN_CRAWLABLE_WORDS || String(section.text || "").length > 420;
}
