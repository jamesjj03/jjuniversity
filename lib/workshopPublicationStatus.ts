import "server-only";

import { createHash } from "crypto";
import {
  sanitizeBookHtml,
  textFromHtml,
  wordCount,
  type BookContent,
  type BookContentSection,
} from "@/lib/bookContent";
import { readPublicationBookIndex } from "@/lib/publicationEdition";

type PublicationComparableSection = {
  id: string;
  index: number;
  title: string;
  kind: string;
  html: string;
  text: string;
  wordCount: number;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function safeKind(value: string | undefined) {
  return String(value || "default").toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "default";
}

function comparableSection(section: BookContentSection): PublicationComparableSection {
  const html = sanitizeBookHtml(section.html || "");
  const bodyText = String(section.text || textFromHtml(html)).trim();
  return {
    id: String(section.id || "").trim(),
    index: Number(section.index),
    title: String(section.title || "").trim(),
    kind: safeKind(section.kind),
    html,
    text: bodyText,
    wordCount: Number.isFinite(Number(section.wordCount)) ? Number(section.wordCount) : wordCount(bodyText),
  };
}

export type WorkshopPublicationStatus = {
  editionId: string;
  matchesPublishedEdition: boolean;
  currentSectionCount: number;
  publishedSectionCount: number;
  changedSectionCount: number;
  changedSectionTitles: string[];
};

export async function readWorkshopPublicationStatus(
  bookId: string,
  currentBook: BookContent,
): Promise<WorkshopPublicationStatus> {
  const published = await readPublicationBookIndex(bookId);
  const current = currentBook.sections.map(comparableSection);
  const currentById = new Map(current.map(section => [section.id.toLowerCase(), section]));
  const changed = new Set<string>();

  for (const section of published.sections) {
    const candidate = currentById.get(section.id.toLowerCase());
    if (!candidate || hash(candidate) !== section.contentHash) changed.add(section.id);
  }
  for (const section of current) {
    if (!published.sections.some(candidate => candidate.id.toLowerCase() === section.id.toLowerCase())) {
      changed.add(section.id);
    }
  }

  const currentTitles = new Map(current.map(section => [section.id, section.title]));
  const publishedTitles = new Map(published.sections.map(section => [section.id, section.title]));
  const changedSectionTitles = [...changed]
    .map(id => currentTitles.get(id) || publishedTitles.get(id) || id)
    .slice(0, 5);

  return {
    editionId: published.editionId,
    matchesPublishedEdition: changed.size === 0 && current.length === published.sections.length,
    currentSectionCount: current.length,
    publishedSectionCount: published.sections.length,
    changedSectionCount: changed.size,
    changedSectionTitles,
  };
}
