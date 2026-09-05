import type { AtlasPatternNote } from "./geographyTypes";
import type {
  AtlasJjuAssociationAuthority,
  AtlasJjuAssociationRecord,
  AtlasJjuAssociationReviewState,
  AtlasJjuAssociationSalience,
  AtlasJjuRelationship,
} from "./associations/types";
import type {
  AtlasAnnotationEditorialRecord,
  AtlasAnnotationEditorialState,
  AtlasAnnotationReviewAuthority,
} from "./annotations/types";

const ANNOTATION_STATES = new Set<AtlasAnnotationEditorialState>([
  "proposed",
  "approved",
  "rejected",
  "retired",
  "superseded",
]);
const ASSOCIATION_STATES = new Set<AtlasJjuAssociationReviewState>([
  "proposed",
  "approved",
  "rejected",
  "superseded",
]);
const ASSOCIATION_RELATIONSHIPS = new Set<AtlasJjuRelationship>([
  "primary_subject",
  "substantial_coverage",
  "contextual_coverage",
  "born_in",
  "died_in",
  "lived_in",
  "active_in",
  "governed_in",
  "occurred_in",
  "began_in",
  "ended_in",
  "affected",
  "originated_in",
  "institutionally_centered",
  "historically_prominent",
]);
const ASSOCIATION_SALIENCE = new Set<AtlasJjuAssociationSalience>([
  "primary",
  "substantial",
  "contextual",
]);
const RELATIONSHIPS_BY_SUBJECT = {
  book: new Set<AtlasJjuRelationship>(["primary_subject", "substantial_coverage", "contextual_coverage"]),
  series: new Set<AtlasJjuRelationship>(["primary_subject", "substantial_coverage", "contextual_coverage"]),
  person: new Set<AtlasJjuRelationship>(["born_in", "died_in", "lived_in", "active_in", "governed_in"]),
  event: new Set<AtlasJjuRelationship>(["occurred_in", "began_in", "ended_in", "affected"]),
  concept: new Set<AtlasJjuRelationship>(["originated_in", "institutionally_centered", "historically_prominent"]),
} as const;

export class AtlasEditorialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasEditorialValidationError";
  }
}

export type AtlasEditorialPersistence = {
  source: "github" | "file";
  writable: boolean;
  boundary: string;
};

export type AtlasAnnotationReviewItem = {
  note: AtlasPatternNote;
  review: AtlasAnnotationEditorialRecord;
  stale: boolean;
  visibleNow: boolean;
};

export type AtlasAnnotationReviewSnapshot = {
  authorityRevision: number;
  updatedAt: string;
  items: AtlasAnnotationReviewItem[];
  counts: Record<AtlasAnnotationEditorialState, number>;
  sourceReviewedVisible: number;
  humanApproved: number;
  stale: number;
  persistence: AtlasEditorialPersistence;
  /** Exact pattern-note source loaded into the review screen. */
  sourceVersion: string;
  version: string;
};

export type AtlasAssociationReviewItem = {
  association: AtlasJjuAssociationRecord;
  sourceCurrent: boolean;
  evidenceCurrent: boolean;
  evidenceSupportsRelationship: boolean;
  subjectReadable: boolean;
  publicEligible: boolean;
};

export type AtlasAssociationReviewSnapshot = {
  authorityRevision: string;
  updatedAt: string;
  items: AtlasAssociationReviewItem[];
  counts: Record<AtlasJjuAssociationReviewState, number>;
  publicEligible: number;
  stale: number;
  persistence: AtlasEditorialPersistence;
  /** Exact JJU subject source loaded into the review screen. */
  sourceVersion: string;
  version: string;
};

export type AtlasAnnotationDecision = {
  noteId: string;
  state: AtlasAnnotationEditorialState;
  reviewedBy: string;
  decisionNote: string;
  supersededByNoteId?: string | null;
  currentNoteRevision: number;
  sourceVersion: string;
};

export type AtlasAssociationDecision = {
  associationId: string;
  state: AtlasJjuAssociationReviewState;
  reviewedBy: string;
  decisionNote: string;
  relationship: AtlasJjuRelationship;
  salience: AtlasJjuAssociationSalience;
  sourceCurrent: boolean;
  evidenceCurrent: boolean;
  evidenceSupportsRelationship: boolean;
  sourceVersion: string;
};

function requiredText(value: string, label: string, maximum: number) {
  const clean = String(value || "").trim();
  if (!clean) throw new AtlasEditorialValidationError(`${label} is required.`);
  if (clean.length > maximum) throw new AtlasEditorialValidationError(`${label} is too long.`);
  return clean;
}

function isoNow(value: string | undefined) {
  const parsed = value ? new Date(value) : new Date();
  if (!Number.isFinite(parsed.getTime())) throw new AtlasEditorialValidationError("The review date is invalid.");
  return parsed.toISOString();
}

export function applyAtlasAnnotationDecision(
  authority: AtlasAnnotationReviewAuthority,
  decision: AtlasAnnotationDecision,
  now?: string,
): AtlasAnnotationReviewAuthority {
  if (!ANNOTATION_STATES.has(decision.state)) throw new AtlasEditorialValidationError("Choose a valid annotation decision.");
  const reviewer = requiredText(decision.reviewedBy, "Reviewer name", 120);
  const note = requiredText(decision.decisionNote, "Decision note", 1_000);
  const index = authority.records.findIndex((record) => record.noteId === decision.noteId);
  if (index < 0) throw new AtlasEditorialValidationError("That annotation is not in the review authority.");
  const current = authority.records[index];
  const replacement = decision.state === "superseded"
    ? requiredText(decision.supersededByNoteId || "", "Replacement annotation", 220)
    : null;
  if (replacement === current.noteId) throw new AtlasEditorialValidationError("An annotation cannot supersede itself.");
  if (replacement && !authority.records.some((record) => record.noteId === replacement)) {
    throw new AtlasEditorialValidationError("The replacement annotation is not in this authority.");
  }
  const reviewedAt = isoNow(now);
  const records = authority.records.map((record, recordIndex) => recordIndex === index ? {
    ...record,
    noteRevision: decision.currentNoteRevision,
    recordRevision: record.recordRevision + 1,
    state: decision.state,
    reviewerKind: "human" as const,
    reviewedBy: reviewer,
    reviewedAt,
    decisionNote: note,
    supersededByNoteId: replacement,
  } : record);
  return {
    ...authority,
    revision: authority.revision + 1,
    updatedAt: reviewedAt,
    records,
  };
}

function bumpAssociationRevision(current: string, now: string) {
  const suffix = Number(current.match(/\.(\d+)$/)?.[1] || 0) + 1;
  return `${now.slice(0, 10)}.${suffix}`;
}

export function applyAtlasAssociationDecision(
  authority: AtlasJjuAssociationAuthority,
  decision: AtlasAssociationDecision,
  now?: string,
): AtlasJjuAssociationAuthority {
  if (!ASSOCIATION_STATES.has(decision.state)) throw new AtlasEditorialValidationError("Choose a valid association decision.");
  if (!ASSOCIATION_RELATIONSHIPS.has(decision.relationship)) throw new AtlasEditorialValidationError("Choose a valid relationship.");
  if (!ASSOCIATION_SALIENCE.has(decision.salience)) throw new AtlasEditorialValidationError("Choose a valid salience.");
  if (decision.state === "approved" && (!decision.sourceCurrent || !decision.evidenceCurrent || !decision.evidenceSupportsRelationship)) {
    throw new AtlasEditorialValidationError("Approval is blocked until the subject and exact evidence are current and support the chosen relationship.");
  }
  const reviewer = requiredText(decision.reviewedBy, "Reviewer name", 120);
  const note = requiredText(decision.decisionNote, "Decision note", 1_000);
  const index = authority.associations.findIndex((association) => association.id === decision.associationId);
  if (index < 0) throw new AtlasEditorialValidationError("That association is not in the review authority.");
  if (!RELATIONSHIPS_BY_SUBJECT[authority.associations[index].subject.kind].has(decision.relationship)) {
    throw new AtlasEditorialValidationError(`The ${decision.relationship} relationship is not valid for a ${authority.associations[index].subject.kind}.`);
  }
  const reviewedAt = isoNow(now);
  const associations = authority.associations.map((association, associationIndex) => associationIndex === index ? {
    ...association,
    revision: association.revision + 1,
    relationship: decision.relationship,
    salience: decision.salience,
    review: decision.state === "proposed" ? {
      state: "proposed" as const,
      reviewerKind: null,
      reviewedBy: null,
      reviewedAt: null,
      decisionNote: null,
    } : {
      state: decision.state,
      reviewerKind: "human" as const,
      reviewedBy: reviewer,
      reviewedAt,
      decisionNote: note,
    },
  } : association);
  return {
    ...authority,
    revision: bumpAssociationRevision(authority.revision, reviewedAt),
    updatedAt: reviewedAt,
    associations,
  };
}
