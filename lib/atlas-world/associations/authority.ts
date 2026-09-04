import "server-only";

import { createHash } from "node:crypto";
import rawBookCatalog from "@/private/catalog/books.json";
import rawAuthority from "./data/authority.v1.json";
import type {
  AtlasApprovedJjuLink,
  AtlasJjuAssociationAudit,
  AtlasJjuAssociationAuthority,
  AtlasJjuAssociationRecord,
  AtlasJjuRelationship,
} from "./types";

type AssociationBookRecord = {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  tags?: unknown;
  status?: string | null;
  visibility?: string | null;
};

const authority = rawAuthority as unknown as AtlasJjuAssociationAuthority;
const books = rawBookCatalog as AssociationBookRecord[];
const bookById = new Map(books.map((book) => [String(book.id || "").trim().toLowerCase(), book]));

const relationshipLabels: Record<AtlasJjuRelationship, string> = {
  primary_subject: "About this place",
  substantial_coverage: "Substantial coverage",
  contextual_coverage: "Places in the story",
  born_in: "Born here",
  died_in: "Died here",
  lived_in: "Lived here",
  active_in: "Active here",
  governed_in: "Governed here",
  occurred_in: "Occurred here",
  began_in: "Began here",
  ended_in: "Ended here",
  affected: "Affected this place",
  originated_in: "Originated here",
  institutionally_centered: "Centered here",
  historically_prominent: "Historically prominent here",
};

const salienceRank = { primary: 0, substantial: 1, contextual: 2 } as const;

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

/**
 * Hash only the catalog fields used for geographic editorial judgment. Changes
 * to cover art, word counts, or unrelated books should not stale a reviewed
 * association.
 */
export function getAtlasBookAssociationSourceRevision(book: AssociationBookRecord) {
  const canonical = {
    id: String(book.id || ""),
    title: String(book.title || ""),
    description: String(book.description || ""),
    tags: Array.isArray(book.tags) ? book.tags.map(String) : [],
    status: String(book.status || ""),
    visibility: String(book.visibility || ""),
    slug: String(book.slug || ""),
  };
  return sha256(JSON.stringify(canonical));
}

function isCurrentBookSubject(association: AtlasJjuAssociationRecord) {
  if (association.subject.kind !== "book") return true;
  const book = bookById.get(association.subject.id);
  return Boolean(
    book
    && getAtlasBookAssociationSourceRevision(book) === association.subject.sourceRevision,
  );
}

function isReadableBookSubject(association: AtlasJjuAssociationRecord) {
  if (association.subject.kind !== "book") return true;
  const book = bookById.get(association.subject.id);
  if (!book) return false;
  return String(book.status || "ready").toLowerCase() === "ready"
    && ["main", "archive"].includes(String(book.visibility || "main").toLowerCase());
}

function isPublishable(association: AtlasJjuAssociationRecord) {
  return association.review.state === "approved"
    && association.review.reviewerKind === "human"
    && Boolean(association.review.reviewedAt && association.review.reviewedBy)
    && isCurrentBookSubject(association)
    && isReadableBookSubject(association);
}

/** Editorial/admin view. This includes proposals and must never be sent to the public client. */
export function getAtlasJjuAssociationAuthority() {
  return authority;
}

/** Full reviewed records for a server-side country/cockpit integration. */
export function getApprovedAtlasJjuAssociationsForEntity(entityId: string) {
  return authority.associations
    .filter((association) => association.place.entityId === entityId && isPublishable(association))
    .sort((left, right) => (
      salienceRank[left.salience] - salienceRank[right.salience]
      || left.subject.title.localeCompare(right.subject.title)
    ));
}

/**
 * Compatibility projection for the existing country-detail `jjuLinks` slot.
 * Extra semantic and provenance fields survive JSON serialization, while the
 * current V1 panel can continue reading title/href/kind.
 */
export function getApprovedAtlasJjuLinksForEntity(entityId: string): AtlasApprovedJjuLink[] {
  return getApprovedAtlasJjuAssociationsForEntity(entityId).map((association) => ({
    associationId: association.id,
    title: association.subject.title,
    href: association.subject.href,
    kind: association.subject.kind === "series" ? "other" : association.subject.kind,
    subjectKind: association.subject.kind,
    relationship: association.relationship,
    relationshipLabel: relationshipLabels[association.relationship],
    salience: association.salience,
    temporal: association.temporal,
    provenance: {
      authorityId: authority.authorityId,
      authorityRevision: authority.revision,
      sourceIds: [...new Set(association.evidence.map((evidence) => evidence.sourceId))],
      reviewedAt: association.review.reviewedAt as string,
    },
  }));
}

export function getAtlasJjuAssociationAudit(): AtlasJjuAssociationAudit {
  const staleAssociationIds = authority.associations
    .filter((association) => association.review.state === "approved" && !isCurrentBookSubject(association))
    .map((association) => association.id);
  const publicLinks = authority.associations.filter(isPublishable).length;

  return {
    total: authority.associations.length,
    approved: authority.associations.filter((item) => item.review.state === "approved").length,
    proposed: authority.associations.filter((item) => item.review.state === "proposed").length,
    rejected: authority.associations.filter((item) => item.review.state === "rejected").length,
    superseded: authority.associations.filter((item) => item.review.state === "superseded").length,
    staleApproved: staleAssociationIds.length,
    publicLinks,
    staleAssociationIds,
  };
}
