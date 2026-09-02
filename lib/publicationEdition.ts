import "server-only";

import { readFile } from "fs/promises";
import path from "path";
import { cache } from "react";
import type { BookContentSection } from "@/lib/bookContent";

const OUTPUT_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "_editions");
const EDITIONS_ROOT = path.join(/* turbopackIgnore: true */ OUTPUT_ROOT, "editions");
const CURRENT_POINTER_PATH = path.join(OUTPUT_ROOT, "current.json");
const SCHEMA_VERSION = 1;

export type PublicationCatalogRecord = Record<string, unknown>;

export type PublicationSectionSummary = {
  id: string;
  index: number;
  title: string;
  kind: string;
  wordCount: number;
  readerKind: string;
  tableOfContents: boolean;
  crawlable: boolean;
  excerpt: string;
  sectionSlug: string;
  identitySlug: string;
  legacySectionSlug: string;
  path: string;
  routeIndex: number;
  routeTotal: number;
  artifactPath: string;
  contentHash: string;
};

export type PublicationBookIndex = {
  schemaVersion: number;
  editionId: string;
  sourceHash: string;
  book: {
    id: string;
    slug: string;
    title: string;
    creator: string;
    description: string;
    language: string;
    publisher: string;
    generatedAt: string;
    sectionCount: number;
    wordCount: number;
    readerSubtitle: string;
  };
  sections: PublicationSectionSummary[];
  extras: BookContentSection[];
  crawlableSectionCount: number;
};

export type PublicationEditionBook = {
  id: string;
  sourceHash: string;
  indexPath: string;
  sectionCount: number;
  crawlableSectionCount: number;
};

export type PublicationEdition = {
  schemaVersion: number;
  editionId: string;
  sourceDigest: string;
  catalog: PublicationCatalogRecord[];
  books: PublicationEditionBook[];
  counts: {
    catalogBooks: number;
    readableBooks: number;
    sections: number;
    crawlableSections: number;
  };
};

type CurrentPointer = {
  schemaVersion?: unknown;
  editionId?: unknown;
  manifestPath?: unknown;
};

type PublicationSectionArtifact = {
  schemaVersion?: unknown;
  editionId?: unknown;
  sourceHash?: unknown;
  bookId?: unknown;
  section?: unknown;
};

function normalizeId(value: string) {
  return String(value || "").trim().toLowerCase();
}

function assertEditionId(value: string) {
  const editionId = String(value || "").trim();
  if (!/^edition-[a-f0-9]{12,}$/i.test(editionId)) {
    throw new Error("The requested publication edition is invalid.");
  }
  return editionId;
}

function assertRelativePath(value: unknown, label: string) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || normalized.startsWith("..")) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function fileInside(parent: string, relativePath: string, label: string) {
  const target = path.join(parent, ...relativePath.split("/"));
  const relative = path.relative(parent, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its publication edition.`);
  }
  return target;
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEdition(value: unknown, expectedEditionId?: string): PublicationEdition {
  if (!isRecord(value)) throw new Error("The published edition is malformed.");
  const editionId = assertEditionId(String(value.editionId || ""));
  if (expectedEditionId && editionId !== expectedEditionId) {
    throw new Error("The published edition does not match its requested identity.");
  }
  if (Number(value.schemaVersion) !== SCHEMA_VERSION) {
    throw new Error("The published edition uses an unsupported format.");
  }
  if (!Array.isArray(value.catalog) || !Array.isArray(value.books) || !isRecord(value.counts)) {
    throw new Error("The published edition is missing its catalog or book manifest.");
  }
  return value as PublicationEdition;
}

function parseBookIndex(value: unknown, expectedEditionId: string, expectedBookId: string): PublicationBookIndex {
  if (!isRecord(value)) throw new Error("The published book index is malformed.");
  if (Number(value.schemaVersion) !== SCHEMA_VERSION || String(value.editionId || "") !== expectedEditionId) {
    throw new Error("The published book index belongs to a different edition.");
  }
  if (!isRecord(value.book) || normalizeId(String(value.book.id || "")) !== expectedBookId) {
    throw new Error("The published book index belongs to a different book.");
  }
  if (!Array.isArray(value.sections) || !Array.isArray(value.extras)) {
    throw new Error("The published book index has no section manifest.");
  }
  return value as PublicationBookIndex;
}

export const readPublicationEdition = cache(async (requestedEditionId = ""): Promise<PublicationEdition> => {
  if (requestedEditionId) {
    const editionId = assertEditionId(requestedEditionId);
    const manifestPath = path.join(/* turbopackIgnore: true */ EDITIONS_ROOT, editionId, "manifest.json");
    return parseEdition(await readJson(manifestPath), editionId);
  }

  let pointer: CurrentPointer;
  try {
    pointer = await readJson(CURRENT_POINTER_PATH) as CurrentPointer;
  } catch {
    throw new Error("No public edition has been built yet. Build the publication edition before opening public book pages.");
  }
  const editionId = assertEditionId(String(pointer.editionId || ""));
  if (Number(pointer.schemaVersion) !== SCHEMA_VERSION) {
    throw new Error("The current publication pointer uses an unsupported format.");
  }
  const manifestRelativePath = assertRelativePath(pointer.manifestPath, "The current publication pointer");
  const manifestPath = fileInside(OUTPUT_ROOT, manifestRelativePath, "The current publication pointer");
  return parseEdition(await readJson(manifestPath), editionId);
});

export const readPublicationBookIndex = cache(async (
  bookId: string,
  requestedEditionId = "",
): Promise<PublicationBookIndex> => {
  const normalizedBookId = normalizeId(bookId);
  if (!normalizedBookId) throw new Error("No published book id was supplied.");
  const edition = await readPublicationEdition(requestedEditionId);
  const entry = edition.books.find(book => normalizeId(book.id) === normalizedBookId);
  if (!entry) throw new Error(`Book ${bookId} is not part of the published edition.`);
  const indexRelativePath = assertRelativePath(entry.indexPath, "The published book index path");
  const indexPath = fileInside(path.join(/* turbopackIgnore: true */ EDITIONS_ROOT, edition.editionId), indexRelativePath, "The published book index path");
  return parseBookIndex(await readJson(indexPath), edition.editionId, normalizedBookId);
});

export const readPublicationSection = cache(async (
  bookId: string,
  sectionId: string,
  requestedEditionId = "",
  expectedContentHash = "",
): Promise<{ editionId: string; summary: PublicationSectionSummary; section: BookContentSection }> => {
  const normalizedSectionId = String(sectionId || "").trim().toLowerCase();
  if (!normalizedSectionId) throw new Error("No published section id was supplied.");
  const index = await readPublicationBookIndex(bookId, requestedEditionId);
  const summary = index.sections.find(section => String(section.id || "").trim().toLowerCase() === normalizedSectionId);
  if (!summary) throw new Error(`Section ${sectionId} is not part of this published book.`);
  if (expectedContentHash && expectedContentHash !== summary.contentHash) {
    throw new Error("The requested section does not match this edition.");
  }
  const artifactRelativePath = assertRelativePath(summary.artifactPath, "The published section path");
  const artifactPath = fileInside(path.join(/* turbopackIgnore: true */ EDITIONS_ROOT, index.editionId), artifactRelativePath, "The published section path");
  const artifact = await readJson(artifactPath) as PublicationSectionArtifact;
  if (!isRecord(artifact.section)
    || Number(artifact.schemaVersion) !== SCHEMA_VERSION
    || String(artifact.editionId || "") !== index.editionId
    || normalizeId(String(artifact.bookId || "")) !== normalizeId(index.book.id)
    || String(artifact.sourceHash || "") !== summary.contentHash
    || String(artifact.section.id || "").trim().toLowerCase() !== normalizedSectionId) {
    throw new Error("The published section artifact does not match its index.");
  }
  return {
    editionId: index.editionId,
    summary,
    section: artifact.section as BookContentSection,
  };
});

export async function readPublicationCatalog() {
  return (await readPublicationEdition()).catalog;
}

export async function readPublicationStatus(bookId = "") {
  const edition = await readPublicationEdition();
  const normalizedBookId = normalizeId(bookId);
  const entry = normalizedBookId
    ? edition.books.find(book => normalizeId(book.id) === normalizedBookId)
    : undefined;
  return {
    editionId: edition.editionId,
    sourceDigest: edition.sourceDigest,
    counts: edition.counts,
    book: entry || null,
  };
}
