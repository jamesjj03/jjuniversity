import { readBookContent, readFileBookContent, type BookContentSection } from "@/lib/bookContent";
import { PRIMARY_CATEGORIES } from "@/lib/taxonomy";
import rawBooks from "@/public/books.json";
import rawManifest from "@/public/book-content/manifest.json";
import rawPaths from "@/public/paths.json";
import rawPrintProducts from "@/public/print-products.json";
import { readBooksFromSupabase } from "@/lib/bookCatalog";
import { canonicalBookId, LEGACY_BOOK_ID_ALIASES } from "@/lib/bookAliases";

export { LEGACY_BOOK_ID_ALIASES } from "@/lib/bookAliases";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://jjuniversity.com").replace(/\/$/, "");

type RawBook = {
  id?: string;
  slug?: string;
  title?: string;
  subtitle?: string;
  creator?: string;
  author?: string;
  series?: string;
  tags?: string[];
  description?: string;
  status?: string;
  coverFile?: string;
  bookFile?: string;
  wordCount?: number;
  readingMinutes?: number;
  readingLabel?: string;
  chapterCount?: number | null;
  similar?: string[];
  visibility?: string;
  archive?: boolean;
  archiveCategory?: string;
  category?: string;
  hiddenShelves?: string[];
  primaryCategory?: string;
  slugAliases?: string[];
};

type ManifestBook = {
  id?: string;
  slug?: string;
  title?: string;
  sourceFile?: string;
  sectionCount?: number;
  wordCount?: number;
  path?: string;
};

export type PublishedBook = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  creator: string;
  series: string;
  tags: string[];
  description: string;
  status: string;
  coverFile: string;
  bookFile: string;
  wordCount: number;
  readingMinutes: number;
  readingLabel: string;
  chapterCount: number;
  similar: string[];
  visibility: string;
  archiveCategory: string;
  primaryCategory: string;
  slugAliases: string[];
};

export type PublishedSeries = {
  id: string;
  slug: string;
  slugAliases: string[];
  title: string;
  description: string;
  level: string;
  tags: string[];
  bookIds: string[];
};

export type PrintProduct = {
  slug: string;
  sku: string;
  kind: "collection" | "bundle";
  title: string;
  kicker: string;
  subtitle: string;
  description: string;
  priceHint: string;
  targetPriceCents: number | null;
  status: "coming-soon";
  printStatus: "draft" | "files-generated" | "lulu-validated" | "proof-ordered" | "proof-approved" | "live";
  salesStatus: "not-for-sale" | "notify" | "checkout-live";
  stripePriceId?: string;
  luluProjectId?: string;
  podPackageId?: string;
  publicInteriorUrl?: string;
  publicCoverUrl?: string;
  actualInteriorPages: number | null;
  generatedAt: string;
  componentProductSlugs: string[];
  format: {
    trimSize: string;
    binding: string;
    interiorColor: string;
    paperType: string;
    coverFinish: string;
  };
  coverTheme: {
    background: string;
    accent: string;
    secondary: string;
    mood: string;
  };
  includedLine: string;
  bookIds: string[];
};

export type PrintProductPageCount = {
  pages: number;
  actual: boolean;
};

type ReadingPath = {
  id?: string;
  title?: string;
  aliases?: string[];
  description?: string;
  level?: string;
  tags?: string[];
  books?: Array<{ id?: string }>;
  deleted?: boolean;
};

const manifestBooks = (rawManifest as { books?: ManifestBook[] }).books || [];
const books = (rawBooks as RawBook[]).map(normalizeBook).filter(book => book.id);
export const PRINT_PRODUCTS: PrintProduct[] = (rawPrintProducts as PrintProduct[]).map(product => ({
  ...product,
  sku: String(product.sku || product.slug).trim(),
  kind: product.kind === "bundle" ? "bundle" : "collection",
  status: "coming-soon",
  printStatus: product.printStatus || "draft",
  salesStatus: product.salesStatus || "not-for-sale",
  stripePriceId: product.stripePriceId || "",
  luluProjectId: product.luluProjectId || "",
  podPackageId: product.podPackageId || "",
  publicInteriorUrl: product.publicInteriorUrl || "",
  publicCoverUrl: product.publicCoverUrl || "",
  targetPriceCents: Number.isFinite(Number(product.targetPriceCents)) ? Number(product.targetPriceCents) : null,
  actualInteriorPages: Number.isFinite(Number(product.actualInteriorPages)) ? Number(product.actualInteriorPages) : null,
  generatedAt: product.generatedAt || "",
  componentProductSlugs: Array.isArray(product.componentProductSlugs) ? product.componentProductSlugs.map(slugify) : [],
  format: {
    trimSize: product.format?.trimSize || "6x9",
    binding: product.format?.binding || "perfect-bound paperback",
    interiorColor: product.format?.interiorColor || "black-and-white",
    paperType: product.format?.paperType || "cream",
    coverFinish: product.format?.coverFinish || "matte",
  },
  coverTheme: {
    background: product.coverTheme?.background || "#111111",
    accent: product.coverTheme?.accent || "#d7a640",
    secondary: product.coverTheme?.secondary || "#7c6df0",
    mood: product.coverTheme?.mood || "JJ University print edition",
  },
  includedLine: product.includedLine || "",
  bookIds: Array.isArray(product.bookIds) ? product.bookIds.map(bookId => String(bookId).toLowerCase()) : [],
}));

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u02bc]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function absoluteUrl(path: string) {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function bookUrl(book: PublishedBook) {
  return `/books/${book.slug}`;
}

function isExternalCover(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("data:");
}

function fileName(value: string) {
  return decodeURIComponent(value).split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop() || value;
}

function stem(value: string) {
  return fileName(value).replace(/\.[^.]+$/, "");
}

function supabaseCoverUrl(file: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "covers";
  if (!supabaseUrl) return "";
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(file)}`;
}

export function coverUrl(book: PublishedBook) {
  if (!book.coverFile) return "/branding/jju-logo.png";
  if (isExternalCover(book.coverFile)) return book.coverFile;
  const webpFile = `${stem(book.coverFile)}.webp`;
  const remoteCover = supabaseCoverUrl(webpFile);
  if (remoteCover) return remoteCover;
  return `/covers/${book.coverFile.includes(".") ? book.coverFile : `${book.coverFile}.jpg`}`;
}

export function getPublicBooks() {
  return books.filter(book => isPublicBook(book));
}

async function getBooksSource() {
  const supabaseBooks = await readBooksFromSupabase().catch(() => null);
  return (supabaseBooks || rawBooks) as RawBook[];
}

export async function getAllBooksLive() {
  const source = await getBooksSource();
  return source.map(normalizeBook).filter(book => book.id);
}

export async function getPublicBooksLive() {
  return (await getAllBooksLive()).filter(book => isPublicBook(book));
}

export function getAllTags() {
  const tags = new Set<string>();
  getPublicBooks().forEach(book => book.tags.forEach(tag => tags.add(tag)));
  return [...tags].sort();
}

export async function getAllTagsLive() {
  const tags = new Set<string>();
  (await getPublicBooksLive()).forEach(book => book.tags.forEach(tag => tags.add(tag)));
  return [...tags].sort();
}

export function getCategories() {
  return PRIMARY_CATEGORIES.map(category => ({
    ...category,
    slug: slugify(category.name),
    books: getPublicBooks().filter(book => book.primaryCategory === category.name || book.tags.some(tag => category.tags.includes(tag))),
  })).filter(category => category.books.length);
}

export async function getCategoriesLive() {
  const publicBooks = await getPublicBooksLive();
  return PRIMARY_CATEGORIES.map(category => ({
    ...category,
    slug: slugify(category.name),
    books: publicBooks.filter(book => book.primaryCategory === category.name || book.tags.some(tag => category.tags.includes(tag))),
  })).filter(category => category.books.length);
}

export function getBooksForTag(tag: string) {
  return getPublicBooks().filter(book => book.tags.includes(tag));
}

export async function getBooksForTagLive(tag: string) {
  return (await getPublicBooksLive()).filter(book => book.tags.includes(tag));
}

export function getBookBySlug(slug: string) {
  const clean = slugify(slug);
  const publicBooks = getPublicBooks();
  return publicBooks.find(book => book.slug === clean)
    || publicBooks.find(book => book.id === clean)
    || publicBooks.find(book => book.slugAliases.includes(clean));
}

export async function getBookBySlugLive(slug: string) {
  const clean = slugify(slug);
  const publicBooks = await getPublicBooksLive();
  return publicBooks.find(book => book.slug === clean)
    || publicBooks.find(book => book.id === clean)
    || publicBooks.find(book => book.slugAliases.includes(clean));
}

export function getBookById(id: string) {
  const clean = String(id || "").trim().toLowerCase();
  return books.find(book => book.id === clean);
}

export async function getBookByIdLive(id: string) {
  const clean = String(id || "").trim().toLowerCase();
  return (await getAllBooksLive()).find(book => book.id === clean);
}

export function getRelatedBooks(book: PublishedBook, limit = 6) {
  return rankRelatedBooks(book, getPublicBooks(), getCollections(), limit);
}

export async function getRelatedBooksLive(book: PublishedBook, limit = 6) {
  const [publicBooks, collections] = await Promise.all([getPublicBooksLive(), getCollectionsLive()]);
  return rankRelatedBooks(book, publicBooks, collections, limit);
}

function rankRelatedBooks(source: PublishedBook, candidates: PublishedBook[], collections: PublishedSeries[], limit: number) {
  const readyCandidates = candidates.filter(item => (
    item.id !== source.id
    && item.status === "ready"
    && isPublicBook(item)
  ));
  const explicitRank = new Map(source.similar.map((id, index) => [canonicalBookId(id), index]));
  const sourceTags = new Set(source.tags);
  const sourceCollections = new Set(collections.filter(item => item.bookIds.includes(source.id)).map(item => item.id));
  const tagFrequency = new Map<string, number>();

  for (const candidate of readyCandidates) {
    for (const tag of new Set(candidate.tags)) {
      tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
    }
  }

  return readyCandidates
    .map(item => {
      const sharedCollections = collections.filter(collection => (
        sourceCollections.has(collection.id) && collection.bookIds.includes(item.id)
      )).length;
      const sharedTagNames = item.tags.filter(tag => sourceTags.has(tag));
      const sharedTags = sharedTagNames.length;
      const tagScore = sharedTagNames.reduce((score, tag) => (
        score + 1 + Math.log((readyCandidates.length + 1) / ((tagFrequency.get(tag) || 0) + 1))
      ), 0);
      const explicitIndex = explicitRank.get(item.id);
      const explicit = explicitIndex !== undefined;
      const reciprocal = item.similar.some(id => canonicalBookId(id) === source.id);
      const readingGap = source.readingMinutes && item.readingMinutes
        ? Math.abs(source.readingMinutes - item.readingMinutes) / Math.max(source.readingMinutes, item.readingMinutes)
        : 1;
      const chapterGap = source.chapterCount && item.chapterCount
        ? Math.abs(source.chapterCount - item.chapterCount) / Math.max(source.chapterCount, item.chapterCount)
        : 1;
      const hasSemanticConnection = sharedTags > 0 || sharedCollections > 0 || explicit || reciprocal;
      const score = hasSemanticConnection
        ? tagScore * 10
          + (sharedTags / Math.max(1, source.tags.length)) * 12
          + sharedCollections * 8
          + (item.primaryCategory === source.primaryCategory ? 2 : 0)
          + (reciprocal ? 7 : 0)
          + (explicit ? 3 + (1 / (explicitIndex + 1)) : 0)
          + (readingGap <= 0.25 ? 1.5 : 0)
          + (chapterGap <= 0.25 ? 1 : 0)
        : 0;

      return {
        item,
        score,
        sharedCollections,
        sharedTags,
        tieBreak: deterministicPairRank(source.id, item.id),
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || b.sharedCollections - a.sharedCollections
      || b.sharedTags - a.sharedTags
      || a.tieBreak - b.tieBreak
      || a.item.title.localeCompare(b.item.title)
    ))
    .slice(0, Math.max(0, limit))
    .map(result => result.item);
}

function deterministicPairRank(sourceId: string, candidateId: string) {
  const value = `${sourceId}|${candidateId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getAllSeries() {
  const paths = rawPaths as { series?: ReadingPath[]; paths?: ReadingPath[]; tagPaths?: ReadingPath[]; recommendedReading?: ReadingPath[] };
  const items = [...(paths.series || []), ...(paths.paths || []), ...(paths.tagPaths || []), ...(paths.recommendedReading || [])];
  return normalizeStaticSeriesItems(items);
}

export function getEditorialSeries() {
  const paths = rawPaths as { series?: ReadingPath[] };
  return normalizeStaticSeriesItems(paths.series || []);
}

export function getReadingPaths() {
  const paths = rawPaths as { paths?: ReadingPath[]; tagPaths?: ReadingPath[]; recommendedReading?: ReadingPath[] };
  const items = [...(paths.paths || []), ...(paths.tagPaths || []), ...(paths.recommendedReading || [])];
  return normalizeStaticSeriesItems(items);
}

/**
 * The public catalog calls these Collections.  A collection can be a thematic
 * shelf or a deliberately ordered guide, but the browser should not make a
 * reader learn two different names for the same kind of discovery tool.
 * The source groups stay intact so dedicated collection pages can retain
 * their authored order and progress behavior.
 */
export function getCollections() {
  const paths = rawPaths as { series?: ReadingPath[]; paths?: ReadingPath[]; tagPaths?: ReadingPath[]; recommendedReading?: ReadingPath[] };
  const items = [...(paths.series || []), ...(paths.paths || []), ...(paths.tagPaths || []), ...(paths.recommendedReading || [])];
  return normalizeStaticSeriesItems(items);
}

function normalizeStaticSeriesItems(items: ReadingPath[]) {
  const seen = new Set<string>();
  return items
    .filter(item => !item.deleted && item.id && item.title && Array.isArray(item.books) && item.books.length)
    .map(item => normalizeSeries(item))
    .filter(series => {
      if (seen.has(series.slug)) return false;
      seen.add(series.slug);
      return series.bookIds.some(id => Boolean(getBookById(id)));
    });
}

export async function getAllSeriesLive() {
  const paths = rawPaths as { series?: ReadingPath[]; paths?: ReadingPath[]; tagPaths?: ReadingPath[]; recommendedReading?: ReadingPath[] };
  const items = [...(paths.series || []), ...(paths.paths || []), ...(paths.tagPaths || []), ...(paths.recommendedReading || [])];
  const seen = new Set<string>();
  const allBooks = await getAllBooksLive();
  const bookIds = new Set(allBooks.map(book => book.id));
  return items
    .filter(item => !item.deleted && item.id && item.title && Array.isArray(item.books) && item.books.length)
    .map(item => normalizeSeries(item))
    .filter(series => {
      if (seen.has(series.slug)) return false;
      seen.add(series.slug);
      return series.bookIds.some(id => bookIds.has(id));
    });
}

export async function getCollectionsLive() {
  const paths = rawPaths as { series?: ReadingPath[]; paths?: ReadingPath[]; tagPaths?: ReadingPath[]; recommendedReading?: ReadingPath[] };
  const items = [...(paths.series || []), ...(paths.paths || []), ...(paths.tagPaths || []), ...(paths.recommendedReading || [])];
  const seen = new Set<string>();
  const allBooks = await getAllBooksLive();
  const bookIds = new Set(allBooks.map(book => book.id));
  return items
    .filter(item => !item.deleted && item.id && item.title && Array.isArray(item.books) && item.books.length)
    .map(item => normalizeSeries(item))
    .filter(series => {
      if (seen.has(series.slug)) return false;
      seen.add(series.slug);
      return series.bookIds.some(id => bookIds.has(id));
    });
}

export function getSeriesBySlug(seriesSlug: string) {
  const clean = slugify(seriesSlug);
  return getAllSeries().find(series => {
    if (series.slug === clean || series.id === clean || series.slugAliases.includes(clean)) return true;
    if (clean === "101" && series.id.includes("101")) return true;
    return false;
  });
}

export async function getSeriesBySlugLive(seriesSlug: string) {
  const clean = slugify(seriesSlug);
  return (await getAllSeriesLive()).find(series => {
    if (series.slug === clean || series.id === clean || series.slugAliases.includes(clean)) return true;
    if (clean === "101" && series.id.includes("101")) return true;
    return false;
  });
}

export function getSeriesBooks(series: PublishedSeries) {
  return series.bookIds
    .map(id => getBookById(id))
    .filter((book): book is PublishedBook => Boolean(book && isPublicBook(book)));
}

export async function getSeriesBooksLive(series: PublishedSeries) {
  const publicBooks = await getPublicBooksLive();
  const byId = new Map(publicBooks.map(book => [book.id, book]));
  return series.bookIds
    .map(id => byId.get(id))
    .filter((book): book is PublishedBook => Boolean(book && isPublicBook(book)));
}

export function getPrintProduct(slug: string) {
  const clean = slugify(slug);
  return PRINT_PRODUCTS.find(product => product.slug === clean);
}

export function getPrintProductBooks(product: PrintProduct) {
  return product.bookIds
    .map(id => getBookById(id))
    .filter((book): book is PublishedBook => Boolean(book && isPublicBook(book)));
}

export async function getPrintProductBooksLive(product: PrintProduct) {
  const publicBooks = await getPublicBooksLive();
  const byId = new Map(publicBooks.map(book => [book.id, book]));
  return product.bookIds
    .map(id => byId.get(id))
    .filter((book): book is PublishedBook => Boolean(book && isPublicBook(book)));
}

export function getPrintProductComponents(product: PrintProduct) {
  return product.componentProductSlugs
    .map(slug => getPrintProduct(slug))
    .filter((item): item is PrintProduct => Boolean(item));
}

export function getPrintProductsForBook(bookId: string) {
  const clean = String(bookId || "").trim().toLowerCase();
  return PRINT_PRODUCTS.filter(product => product.kind === "collection" && product.bookIds.includes(clean));
}

export function estimatePrintPages(selectedBooks: PublishedBook[]) {
  const words = selectedBooks.reduce((sum, book) => sum + (book.wordCount || 0), 0);
  const bodyPages = Math.ceil(words / 155);
  const sectionPages = selectedBooks.length * 2;
  return Math.max(32, bodyPages + sectionPages + 8);
}

export function estimatePrintProductPages(product: PrintProduct): number {
  return getPrintProductPageCount(product).pages;
}

export async function estimatePrintProductPagesLive(product: PrintProduct): Promise<number> {
  return (await getPrintProductPageCountLive(product)).pages;
}

export function getPrintProductPageCount(product: PrintProduct): PrintProductPageCount {
  if (product.actualInteriorPages) {
    return { pages: product.actualInteriorPages, actual: true };
  }

  if (product.kind === "bundle") {
    const components = getPrintProductComponents(product);
    const componentCounts = components.map(component => getPrintProductPageCount(component));
    if (componentCounts.length && componentCounts.every(count => count.actual)) {
      return { pages: componentCounts.reduce((sum, count) => sum + count.pages, 0), actual: true };
    }

    return {
      pages: components
        .map(component => estimatePrintPages(getPrintProductBooks(component)))
        .reduce((sum, pages) => sum + pages, 0),
      actual: false,
    };
  }

  return { pages: estimatePrintPages(getPrintProductBooks(product)), actual: false };
}

export async function getPrintProductPageCountLive(product: PrintProduct): Promise<PrintProductPageCount> {
  if (product.actualInteriorPages) {
    return { pages: product.actualInteriorPages, actual: true };
  }

  if (product.kind === "bundle") {
    const components = getPrintProductComponents(product);
    const componentCounts = await Promise.all(components.map(component => getPrintProductPageCountLive(component)));
    if (componentCounts.length && componentCounts.every(count => count.actual)) {
      return { pages: componentCounts.reduce((sum, count) => sum + count.pages, 0), actual: true };
    }

    const componentPages = await Promise.all(components.map(async component => estimatePrintPages(await getPrintProductBooksLive(component))));
    return {
      pages: componentPages.reduce((sum, pages) => sum + pages, 0),
      actual: false,
    };
  }

  return { pages: estimatePrintPages(await getPrintProductBooksLive(product)), actual: false };
}

export function printPriceLabel(product: PrintProduct) {
  if (!product.targetPriceCents) return product.priceHint;
  return `$${(product.targetPriceCents / 100).toFixed(2)} target + shipping`;
}

export async function getBookSample(book: PublishedBook, options: { preferFile?: boolean } = {}) {
  if (book.status !== "ready") {
    return {
      toc: [],
      chapterCount: book.chapterCount,
      excerpt: cleanExcerpt(book.description),
      contentWordCount: book.wordCount,
    };
  }

  try {
    const resolved = await (options.preferFile ? readFileBookContent(book.id) : readBookContent(book.id));
    const sections = resolved.book.sections;
    const contentSections = sections.filter(isContentSection);
    const chapterSections = sections.filter(isChapterSection);
    const excerptSource = contentSections.find(section => section.text && section.text.length > 300)
      || sections.find(section => section.text && section.text.length > 300);

    return {
      toc: chapterSections.map(section => section.title).filter(Boolean),
      chapterCount: chapterSections.length || book.chapterCount,
      excerpt: cleanExcerpt(excerptSource?.text || book.description),
      contentWordCount: resolved.book.wordCount || book.wordCount,
    };
  } catch {
    return {
      toc: [],
      chapterCount: book.chapterCount,
      excerpt: cleanExcerpt(book.description),
      contentWordCount: book.wordCount,
    };
  }
}

export function metadataDescription(text: string, fallback = "Read this free JJ University book online.") {
  const clean = String(text || fallback).replace(/\s+/g, " ").trim();
  if (clean.length <= 155) return clean;
  return `${clean.slice(0, 152).replace(/\s+\S*$/, "")}...`;
}

function normalizeBook(raw: RawBook): PublishedBook {
  const id = String(raw.id || "").trim().toLowerCase();
  const manifest = manifestFor(raw, id);
  const title = String(raw.title || manifest?.title || id || "Untitled").trim();
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [];
  const primaryCategory = String(raw.primaryCategory || "").trim() || primaryCategoryFor(tags);
  const slug = slugify(String(raw.slug || title || manifest?.slug || id));
  const slugAliases = [...new Set([
    id,
    slugify(String(manifest?.slug || "")),
    slugify(String(raw.title || "")),
    ...(Array.isArray(raw.slugAliases) ? raw.slugAliases.map(alias => slugify(String(alias))) : []),
    ...Object.entries(LEGACY_BOOK_ID_ALIASES)
      .filter(([, canonicalId]) => canonicalId === id)
      .map(([legacyId]) => slugify(legacyId)),
  ].filter(alias => alias && alias !== slug))];

  const rawVisibility = String(raw.visibility || "main").trim().toLowerCase();

  return {
    id,
    slug,
    title,
    subtitle: String(raw.subtitle || "").trim(),
    creator: String(raw.creator || raw.author || "James Johnson").trim(),
    series: String(raw.series || "").trim(),
    tags,
    description: String(raw.description || "").trim(),
    status: String(raw.status || "ready").trim().toLowerCase(),
    coverFile: String(raw.coverFile || "").trim(),
    bookFile: String(raw.bookFile || manifest?.sourceFile || "").trim(),
    wordCount: Number(raw.wordCount || manifest?.wordCount || 0),
    readingMinutes: Number(raw.readingMinutes || Math.ceil(Number(raw.wordCount || manifest?.wordCount || 0) / 180) || 0),
    readingLabel: String(raw.readingLabel || "").trim(),
    chapterCount: Number(raw.chapterCount || manifest?.sectionCount || 0),
    similar: Array.isArray(raw.similar) ? raw.similar.map(item => String(item).trim().toLowerCase()).filter(Boolean) : [],
    visibility: raw.archive || rawVisibility === "archive" ? "archive" : rawVisibility,
    archiveCategory: String(raw.archiveCategory || raw.category || "").trim(),
    primaryCategory,
    slugAliases,
  };
}

function normalizeSeries(item: ReadingPath): PublishedSeries {
  const id = slugify(String(item.id || item.title || ""));
  const title = String(item.title || id).trim();
  const is101 = id.includes("101") || /\b101\b/.test(title);
  const authoredAliases = Array.isArray(item.aliases) ? item.aliases.map(alias => slugify(String(alias))).filter(Boolean) : [];
  const slug = is101 ? "101" : authoredAliases.length ? slugify(title) : id || slugify(title);
  return {
    id,
    slug,
    slugAliases: [...new Set([id, ...authoredAliases].filter(alias => alias && alias !== slug))],
    title,
    description: String(item.description || `A JJ University reading sequence around ${title}.`).trim(),
    level: String(item.level || "starter").trim(),
    tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
    bookIds: Array.isArray(item.books) ? item.books.map(book => String(book.id || "").trim().toLowerCase()).filter(Boolean) : [],
  };
}

function manifestFor(raw: RawBook, id: string) {
  const bookStem = String(raw.bookFile || "").replace(/\.(epub|json)$/i, "").toLowerCase();
  return manifestBooks.find(item => {
    const manifestId = String(item.id || "").toLowerCase();
    const sourceStem = String(item.sourceFile || "").replace(/\.(epub|json)$/i, "").toLowerCase();
    return manifestId === id || sourceStem === id || Boolean(bookStem && sourceStem === bookStem);
  });
}

function primaryCategoryFor(tags: string[]) {
  return PRIMARY_CATEGORIES.find(category => tags.some(tag => category.tags.includes(tag)))?.name || "Library";
}

function isPublicBook(book: PublishedBook) {
  return isPublicCatalogRecord(book);
}

export function isPublicCatalogRecord(book: { id?: string | null; status?: string | null; visibility?: string | null }) {
  const id = String(book.id || "").trim().toLowerCase();
  const status = String(book.status || "ready").trim().toLowerCase();
  const visibility = String(book.visibility || "main").trim().toLowerCase();
  return Boolean(id)
    && (status === "ready" || status === "coming-soon")
    && (visibility === "main" || visibility === "archive")
    && !LEGACY_BOOK_ID_ALIASES[id];
}

function isContentSection(section: BookContentSection) {
  const title = section.title.toLowerCase();
  const kind = String(section.kind || "").toLowerCase();
  if (kind === "toc" || kind === "dedication") return false;
  if (/copyright|acknowledg|about the author|contents/.test(title)) return false;
  return Boolean(section.text && section.text.length > 120);
}

function isChapterSection(section: BookContentSection) {
  return /^chapter\b/i.test(String(section.title || "").trim());
}

function cleanExcerpt(text: string) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^contents\b/i, "")
    .trim();
  if (clean.length <= 720) return clean;
  return `${clean.slice(0, 700).replace(/\s+\S*$/, "")}...`;
}
