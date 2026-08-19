import "server-only";

import { createHash } from "node:crypto";
import { coverFallbackSrc } from "@/lib/cover";
import { getCollections, getEditorialSeries, getPublicBooks } from "@/lib/publishing";
import {
  SITE_V2_APPROVED_TOPICS,
  SITE_V2_TAXONOMY_REVIEW_IDS,
  siteV2TopicsForBook,
} from "@/lib/siteV2Taxonomy";
import { SITE_V2_SHELVES, siteV2CoverSrc, siteV2ShelvesForBook } from "@/lib/siteV2";
import {
  TAXONOMY_REVIEW_SCHEMA_VERSION,
  canonicalizeTaxonomyReviewDraft,
  type TaxonomyReviewBook,
} from "@/lib/taxonomyReviewTypes";

export function getTaxonomyReviewCatalog() {
  const sourceBooks = getPublicBooks()
    .filter(book => book.status === "ready" && book.visibility === "main")
    .sort((left, right) => left.title.localeCompare(right.title, "en", { numeric: true, sensitivity: "base" }));

  const validBookIds = new Set(sourceBooks.map(book => book.id));
  const sourceCollections = getCollections();
  const editorialSeriesIds = new Set(getEditorialSeries().map(item => item.id));
  const shelfIdsByBook = new Map(sourceBooks.map(book => [
    book.id,
    siteV2ShelvesForBook(book).map(shelf => shelf.id).sort(),
  ]));
  const topicsByBook = new Map(sourceBooks.map(book => [
    book.id,
    siteV2TopicsForBook(book).sort(),
  ]));

  const catalogFingerprint = createHash("sha256")
    .update(JSON.stringify({ books: sourceBooks.map(book => ({
      id: book.id,
      title: book.title,
      coverFile: book.coverFile,
      tags: [...book.tags].sort(),
      shelves: shelfIdsByBook.get(book.id),
      topics: topicsByBook.get(book.id),
    })), collections: sourceCollections.map(item => ({
      id: item.id,
      title: item.title,
      bookIds: item.bookIds.filter(id => validBookIds.has(id)),
    })) }))
    .digest("hex");

  const books: TaxonomyReviewBook[] = sourceBooks.map(book => ({
    id: book.id,
    title: book.title,
    subtitle: book.subtitle,
    coverSrc: siteV2CoverSrc(book),
    fallbackCoverSrc: coverFallbackSrc(book),
  }));

  const collections = sourceCollections.map(item => ({
    id: item.id,
    name: item.title,
    description: item.description,
    sourceBucket: editorialSeriesIds.has(item.id) ? "series" as const : "paths" as const,
    bookIds: item.bookIds.filter(id => validBookIds.has(id)),
  }));

  const shelves = SITE_V2_SHELVES.map(shelf => ({
    id: shelf.id,
    name: shelf.name,
    bookIds: sourceBooks.filter(book => shelfIdsByBook.get(book.id)?.includes(shelf.id)).map(book => book.id),
  }));

  const topics = SITE_V2_APPROVED_TOPICS.map(name => ({
    id: topicId(name),
    name,
    bookIds: sourceBooks.filter(book => topicsByBook.get(book.id)?.includes(name)).map(book => book.id),
  }));

  const draft = canonicalizeTaxonomyReviewDraft({
    schemaVersion: TAXONOMY_REVIEW_SCHEMA_VERSION,
    catalogFingerprint,
    collections,
    shelves,
    topics,
    reviewBookIds: SITE_V2_TAXONOMY_REVIEW_IDS.filter(id => sourceBooks.some(book => book.id === id)),
  });

  return { books, draft };
}

function topicId(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
