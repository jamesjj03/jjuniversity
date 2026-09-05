import type { AtlasEditorialPersistence } from "../editorialReview";

export type AtlasAnnotationDraftState =
  | "draft"
  | "proposed"
  | "approved"
  | "rejected"
  | "retired";

export type AtlasAnnotationDraftEvidence = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  supports: string;
};
export type AtlasAnnotationDraftContent = {
  headline: string;
  summary: string;
  viewPresetId: string;
  layerIds: string[];
  spatial: {
    entityIds: string[];
    featureIds: string[];
    focus: { longitude: number; latitude: number } | null;
    boundsWgs84: [[number, number], [number, number]] | null;
    highlight: {
      kind: "bounds" | "feature-reference" | "point";
    };
  };
  evidence: AtlasAnnotationDraftEvidence[];
  relatedLayerIds: string[];
  action: {
    label: string;
    viewPresetId: string | null;
    layerIds: string[];
  } | null;
  caveats: string[];
};

export type AtlasAnnotationDraftRecord = {
  id: string;
  revision: number;
  state: AtlasAnnotationDraftState;
  origin: "manual_editorial" | "ai_assisted";
  createdBy: string;
  createdAt: string;
  modifiedBy: string;
  modifiedAt: string;
  referenceVersion: string;
  content: AtlasAnnotationDraftContent;
  review: {
    reviewerKind: "human" | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    decisionNote: string | null;
  };
  promotion: {
    state: "not-promoted";
    targetPatternNoteId: null;
    promotedBy: null;
    promotedAt: null;
  };
};

export type AtlasAnnotationDraftAuthority = {
  schemaVersion: "1.0.0";
  authorityId: "jju-atlas-annotation-drafts";
  revision: number;
  updatedAt: string;
  policy: {
    requireHumanApproval: true;
    automatedPublication: false;
    publicPatternNotesAreSeparate: true;
  };
  drafts: AtlasAnnotationDraftRecord[];
};

export type AtlasAnnotationDraftReferenceOptions = {
  version: string;
  views: Array<{ id: string; name: string; layerIds: string[] }>;
  layers: Array<{ id: string; name: string }>;
  entities: Array<{ id: string; name: string }>;
  features: Array<{ id: string; name: string; kind: "river" | "lake" | "city" }>;
};

export type AtlasAnnotationDraftSnapshot = {
  authorityRevision: number;
  updatedAt: string;
  drafts: Array<{ draft: AtlasAnnotationDraftRecord; stale: boolean }>;
  counts: Record<AtlasAnnotationDraftState, number>;
  references: AtlasAnnotationDraftReferenceOptions;
  persistence: AtlasEditorialPersistence;
  version: string;
};

export type AtlasAnnotationDraftMutation = {
  operation: "create" | "save" | "transition";
  draftId?: string;
  actor: string;
  origin?: AtlasAnnotationDraftRecord["origin"];
  content?: AtlasAnnotationDraftContent;
  state?: AtlasAnnotationDraftState;
  decisionNote?: string;
  sourceVersion: string;
};
