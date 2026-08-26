import "server-only";

import type { BookContent, BookContentSection } from "@/lib/bookContent";

type PublicRecord = Record<string, unknown>;

export function toPublicCatalogBook(value: unknown) {
  const book = record(value);
  return {
    id: text(book.id),
    slug: optionalText(book.slug),
    title: optionalText(book.title),
    subtitle: optionalText(book.subtitle),
    creator: optionalText(book.creator),
    author: optionalText(book.author),
    series: optionalText(book.series),
    tags: textList(book.tags),
    description: optionalText(book.description),
    status: optionalText(book.status),
    visibility: optionalText(book.visibility),
    archive: Boolean(book.archive),
    category: optionalText(book.category),
    archiveCategory: optionalText(book.archiveCategory),
    primaryCategory: optionalText(book.primaryCategory),
    coverFile: optionalText(book.coverFile),
    wordCount: finiteNumber(book.wordCount),
    readingMinutes: finiteNumber(book.readingMinutes),
    readingLabel: optionalText(book.readingLabel),
    chapterCount: finiteNumber(book.chapterCount),
    slugAliases: textList(book.slugAliases),
    similar: textList(book.similar),
    hiddenShelves: textList(book.hiddenShelves),
    hiddenCategories: textList(book.hiddenCategories),
  };
}

export function toPublicBookContent(book: BookContent) {
  const sections = book.sections.map(toPublicBookSection);
  return {
    id: book.id,
    slug: book.slug,
    title: book.title,
    creator: book.creator,
    description: book.description,
    language: book.language,
    publisher: book.publisher,
    generatedAt: book.generatedAt,
    sectionCount: book.sectionCount,
    wordCount: book.wordCount,
    sections,
    chapters: sections,
  };
}

function toPublicBookSection(section: BookContentSection) {
  return {
    id: section.id,
    index: section.index,
    title: section.title,
    kind: section.kind,
    html: section.html,
    text: section.text,
    wordCount: section.wordCount,
  };
}

function record(value: unknown): PublicRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PublicRecord : {};
}

function text(value: unknown) {
  return String(value || "").trim();
}

function optionalText(value: unknown) {
  const normalized = text(value);
  return normalized || undefined;
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
