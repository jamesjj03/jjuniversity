export type AtlasTerritorialAuthorityStatusKind =
  | "disputed"
  | "partial-recognition";

export type AtlasTerritorialClaimRelationship =
  | "claims-sovereignty"
  | "claims-independent-statehood"
  | "seeks-self-determination";

export type AtlasTerritorialAdministrationRelationship =
  | "administers"
  | "administers-most"
  | "administers-limited-areas"
  | "operates-separate-institutions"
  | "military-control-is-changing"
  | "supports-parallel-services";

export type AtlasTerritorialPerspectiveKind =
  | "united-nations-framework"
  | "claimant-position"
  | "administering-authority-position"
  | "recognizing-state-position"
  | "third-party-diplomatic-position"
  | "source-cartography";

export interface AtlasTerritorialAuthoritySource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  /** Date this source was inspected for this authority revision. */
  retrievedAt: string;
}
export interface AtlasTerritorialSourceReference {
  sourceId: string;
  supports: string;
}

export interface AtlasTerritorialClaimant {
  actorId: string;
  actorName: string;
  relationshipKind: AtlasTerritorialClaimRelationship;
  description: string;
  sourceIds: string[];
}

export interface AtlasTerritorialAdministrator {
  actorId: string;
  actorName: string;
  relationshipKind: AtlasTerritorialAdministrationRelationship;
  /** Deliberately textual: the authority contains no inferred control-line geometry. */
  extentDescription: string;
  sourceIds: string[];
}

export interface AtlasTerritorialPerspective {
  id: string;
  actorId: string;
  actorName: string;
  kind: AtlasTerritorialPerspectiveKind;
  statement: string;
  sourceIds: string[];
}

export interface AtlasTerritorialAuthorityRecord {
  id: string;
  revision: number;
  entityId: string;
  placeName: string;
  statusKind: AtlasTerritorialAuthorityStatusKind;
  badge: string;
  /** The stored geometry is only the selectable Natural Earth map-unit outline. */
  geometrySemantic: "map-unit-outline";
  scope: "territorial-status-case" | "specific-feature-only";
  scopeCaveat: string;
  sourceSnapshot: {
    datasetId: "natural-earth-admin-0-50m-5.1.2";
    classification: string;
    sovereignName: string;
    boundaryNote: string | null;
  };
  claimants: AtlasTerritorialClaimant[];
  administratorsOrControllers: AtlasTerritorialAdministrator[];
  internationalStatus: {
    summary: string;
    perspectives: AtlasTerritorialPerspective[];
  };
  explanation: {
    summary: string;
    claims: string;
    administration: string;
    disputeReason: string;
    mapChoice: string;
  };
  citations: AtlasTerritorialSourceReference[];
  review: {
    status: "published-reviewed";
    reviewerKind: "agent" | "human";
    reviewedBy: string;
    reviewedAt: string;
    sourceCheckedThrough: string;
    note: string;
  };
  temporal: {
    precision: "source_snapshot";
    validFrom: null;
    validTo: null;
  };
}

export interface AtlasTerritorialStatusAuthority {
  schemaVersion: "1.0.0";
  authorityId: "jju-atlas-territorial-status";
  revision: string;
  updatedAt: string;
  policy: {
    geometrySemantic: "map-unit-outline";
    controlLineGeometryIncluded: false;
    adjudicatesSovereignty: false;
    requireSourceForEveryRelationship: true;
    requireReviewMetadata: true;
  };
  sources: AtlasTerritorialAuthoritySource[];
  records: AtlasTerritorialAuthorityRecord[];
}
