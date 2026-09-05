import rawAuthority from "./data/review-authority.v1.json";
import type { AtlasPatternNote } from "../geographyTypes";
import type {
  AtlasAnnotationEditorialRecord,
  AtlasAnnotationEditorialState,
  AtlasAnnotationReviewAuthority,
} from "./types";

const STATES = new Set<AtlasAnnotationEditorialState>([
  "proposed",
  "approved",
  "rejected",
  "retired",
  "superseded",
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Atlas annotation review authority: ${message}`);
}

export function validateAtlasAnnotationReviewAuthority(value: unknown): AtlasAnnotationReviewAuthority {
  invariant(Boolean(value && typeof value === "object" && !Array.isArray(value)), "document must be an object");
  const authority = value as AtlasAnnotationReviewAuthority;
  invariant(authority.schemaVersion === "1.0.0", "unsupported schema version");
  invariant(authority.authorityId === "jju-atlas-annotation-editorial-review", "unexpected authority id");
  invariant(Number.isSafeInteger(authority.revision) && authority.revision > 0, "revision must be a positive integer");
  invariant(Number.isFinite(Date.parse(authority.updatedAt)), "updatedAt must be an ISO date-time");
  invariant(Boolean(authority.sourceSnapshotId), "source snapshot id is required");
  invariant(authority.policy?.requireHumanDecision === true, "human decisions must remain mandatory");
  invariant(authority.policy?.automatedPublication === false, "automated publication must remain disabled");
  invariant(authority.policy?.legacySourceReviewedNotesRemainVisibleWhileProposed === true, "legacy visibility policy changed unexpectedly");
  invariant(Array.isArray(authority.records), "records must be an array");

  const ids = new Set<string>();
  for (const record of authority.records) {
    invariant(Boolean(record?.noteId), "every record needs a note id");
    invariant(!ids.has(record.noteId), `duplicate note id ${record.noteId}`);
    ids.add(record.noteId);
    invariant(Number.isSafeInteger(record.noteRevision) && record.noteRevision > 0, `${record.noteId} has an invalid note revision`);
    invariant(Number.isSafeInteger(record.recordRevision) && record.recordRevision > 0, `${record.noteId} has an invalid record revision`);
    invariant(STATES.has(record.state), `${record.noteId} has an invalid state`);
    invariant(record.reviewerKind === null || record.reviewerKind === "human", `${record.noteId} has an invalid reviewer kind`);
    if (record.state === "approved" || record.state === "rejected" || record.state === "retired" || record.state === "superseded") {
      invariant(record.reviewerKind === "human", `${record.noteId} has no human decision`);
      invariant(Boolean(record.reviewedBy?.trim()), `${record.noteId} has no reviewer identity`);
      invariant(Boolean(record.reviewedAt && Number.isFinite(Date.parse(record.reviewedAt))), `${record.noteId} has no review date`);
      invariant(Boolean(record.decisionNote?.trim()), `${record.noteId} has no decision note`);
    }
    if (record.state === "superseded") {
      invariant(Boolean(record.supersededByNoteId && record.supersededByNoteId !== record.noteId), `${record.noteId} has no replacement note`);
    } else {
      invariant(record.supersededByNoteId === null, `${record.noteId} has a replacement outside the superseded state`);
    }
  }
  return authority;
}

export const ATLAS_ANNOTATION_REVIEW_AUTHORITY = validateAtlasAnnotationReviewAuthority(rawAuthority);

export function getAtlasAnnotationEditorialRecord(noteId: string): AtlasAnnotationEditorialRecord | null {
  return ATLAS_ANNOTATION_REVIEW_AUTHORITY.records.find((record) => record.noteId === noteId) ?? null;
}

export function isAtlasPatternNoteVisible(note: Pick<AtlasPatternNote, "id" | "review">) {
  const editorial = getAtlasAnnotationEditorialRecord(note.id);
  if (!editorial) return false;
  if (["rejected", "retired", "superseded"].includes(editorial?.state ?? "")) return false;
  // Approval never publishes a hidden note by itself. It only records that a
  // person reviewed the same source-reviewed material.
  return note.review.publicationStatus === "atlas-visible";
}
