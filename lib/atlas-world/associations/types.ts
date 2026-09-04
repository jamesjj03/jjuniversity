import type { AtlasJjuLink, AtlasTemporalExtent } from "../types";

export type AtlasJjuSubjectKind =
  | "book"
  | "series"
  | "person"
  | "event"
  | "concept";

export type AtlasJjuBookRelationship =
  | "primary_subject"
  | "substantial_coverage"
  | "contextual_coverage";

export type AtlasJjuSeriesRelationship =
  | "primary_subject"
  | "substantial_coverage"
  | "contextual_coverage";

export type AtlasJjuPersonRelationship =
  | "born_in"
  | "died_in"
  | "lived_in"
  | "active_in"
  | "governed_in";

export type AtlasJjuEventRelationship =
  | "occurred_in"
  | "began_in"
  | "ended_in"
  | "affected";

export type AtlasJjuConceptRelationship =
  | "originated_in"
  | "institutionally_centered"
  | "historically_prominent";

export type AtlasJjuRelationship =
  | AtlasJjuBookRelationship
  | AtlasJjuSeriesRelationship
  | AtlasJjuPersonRelationship
  | AtlasJjuEventRelationship
  | AtlasJjuConceptRelationship;

export type AtlasJjuAssociationReviewState =
  | "proposed"
  | "approved"
  | "rejected"
  | "superseded";

export type AtlasJjuAssociationSalience = "primary" | "substantial" | "contextual";

export type AtlasJjuEvidenceSupport =
  | "subject_identity"
  | "place_connection"
  | "relationship_semantics";

export interface AtlasJjuAssociationSource {
  id: string;
  title: string;
  kind: "repository_json" | "repository_module" | "manuscript" | "external";
  location: string;
  revisionStrategy: "subject_record_sha256" | "file_sha256" | "external_revision";
  /** Source snapshot inspected when this authority revision was authored. */
  snapshotRevision: string;
  capturedAt: string;
  notes: string[];
}

export interface AtlasJjuAssociationSubject {
  kind: AtlasJjuSubjectKind;
  id: string;
  title: string;
  href: string;
  sourceId: string;
  /** Hash of the fields used to make the association, not of the whole catalog. */
  sourceRevision: string;
}

export interface AtlasJjuAssociationPlace {
  /** Stable Atlas entity identity. Geometry is deliberately not embedded here. */
  entityId: string;
  name: string;
  slug: string;
  /** Reserved for a point, line, or sub-entity once the association is more precise. */
  featureId: string | null;
}

export interface AtlasJjuAssociationEvidence {
  sourceId: string;
  sourceRevision: string;
  locator: string;
  exactText: string;
  exactTextSha256: string;
  supports: AtlasJjuEvidenceSupport[];
  note: string | null;
}

export interface AtlasJjuAssociationProposal {
  method: "manual_editorial" | "ai_assisted";
  proposedBy: string;
  proposedAt: string;
  confidence: number;
  rationale: string;
}

export interface AtlasJjuAssociationReview {
  state: AtlasJjuAssociationReviewState;
  reviewerKind: "human" | "agent" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
}

export interface AtlasJjuAssociationRecord {
  id: string;
  revision: number;
  pilotCollectionId: string | null;
  subject: AtlasJjuAssociationSubject;
  place: AtlasJjuAssociationPlace;
  relationship: AtlasJjuRelationship;
  salience: AtlasJjuAssociationSalience;
  /** Time described by the relationship, independent of the modern geometry snapshot. */
  temporal: AtlasTemporalExtent & { note: string | null };
  evidence: AtlasJjuAssociationEvidence[];
  proposal: AtlasJjuAssociationProposal;
  review: AtlasJjuAssociationReview;
  supersedesAssociationId: string | null;
}

export interface AtlasJjuAssociationAuthority {
  schemaVersion: "1.0.0";
  authorityId: string;
  revision: string;
  updatedAt: string;
  policy: {
    publicReviewStates: ["approved"];
    requireExactEvidence: true;
    automatedPublication: false;
    staleWhenSubjectRevisionChanges: true;
  };
  sources: AtlasJjuAssociationSource[];
  associations: AtlasJjuAssociationRecord[];
}

export interface AtlasApprovedJjuLink extends AtlasJjuLink {
  associationId: string;
  subjectKind: AtlasJjuSubjectKind;
  relationship: AtlasJjuRelationship;
  relationshipLabel: string;
  salience: AtlasJjuAssociationSalience;
  temporal: AtlasJjuAssociationRecord["temporal"];
  provenance: {
    authorityId: string;
    authorityRevision: string;
    sourceIds: string[];
    reviewedAt: string;
  };
}

export interface AtlasJjuAssociationAudit {
  total: number;
  approved: number;
  proposed: number;
  rejected: number;
  superseded: number;
  staleApproved: number;
  publicLinks: number;
  staleAssociationIds: string[];
}
