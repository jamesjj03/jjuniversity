export type AtlasAnnotationEditorialState =
  | "proposed"
  | "approved"
  | "rejected"
  | "retired"
  | "superseded";

export type AtlasAnnotationEditorialRecord = {
  noteId: string;
  /** Revision of the explanatory note that was in front of the reviewer. */
  noteRevision: number;
  recordRevision: number;
  state: AtlasAnnotationEditorialState;
  reviewerKind: "human" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
  supersededByNoteId: string | null;
};
export type AtlasAnnotationReviewAuthority = {
  schemaVersion: "1.0.0";
  authorityId: "jju-atlas-annotation-editorial-review";
  revision: number;
  updatedAt: string;
  sourceSnapshotId: string;
  policy: {
    requireHumanDecision: true;
    automatedPublication: false;
    /**
     * Phase 2 notes were already visible through a source-review gate. Human
     * approval is recorded separately; rejecting, retiring, or superseding a
     * note removes it on the next build.
     */
    legacySourceReviewedNotesRemainVisibleWhileProposed: true;
  };
  records: AtlasAnnotationEditorialRecord[];
};
