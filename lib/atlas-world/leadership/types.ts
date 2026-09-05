import type { AtlasLeadershipValue } from "../types";

export type AtlasLeadershipRole = "headOfState" | "headOfGovernment";
export type AtlasLeadershipConfidence = "high" | "medium" | "low" | "unassessed";
export type AtlasLeadershipOccupancyState = "occupied" | "vacant" | "collective" | "uncertain";
export type AtlasLeadershipFreshnessState =
  | "recent_observation"
  | "review_due"
  | "future_dated"
  | "undated";

export interface AtlasLeadershipSourceCitation {
  publisher: string;
  title: string;
  url: string;
  publishedAt: string | null;
}

/** A person is reusable identity, never an office or a country's property. */
export interface AtlasLeadershipPersonIdentity {
  id: `person:${string}`;
  canonicalName: string;
  aliases: string[];
  identityConfidence: Exclude<AtlasLeadershipConfidence, "unassessed">;
  reviewedAt: string;
}

/**
 * Stable office identity. The polity relationship and constitutional role are
 * deliberately separate from a person's temporary occupancy of the office.
 */
export interface AtlasLeadershipOfficeIdentity {
  id: `office:${string}`;
  polityEntityId: `country:${string}`;
  role: AtlasLeadershipRole;
  label: string;
  holderModel: "individual" | "collective" | "variable" | "unspecified";
}

export interface AtlasLeadershipContextRecord {
  personId: `person:${string}`;
  entityId: `country:${string}`;
  roles: AtlasLeadershipRole[];
  officeIds: `office:${string}`[];
  exactSourceName: string;
  archivedObservedAt: string;
  sourceId: string;
  summary: string;
  sources: AtlasLeadershipSourceCitation[];
}

export interface AtlasLeadershipReviewedUpdate {
  id: `office-observation:${string}`;
  officeId: `office:${string}`;
  entityId: `country:${string}`;
  role: AtlasLeadershipRole;
  personId: `person:${string}`;
  personName: string;
  title: string;
  termStartedAt: string;
  observedAt: string;
  reviewAfter: string;
  occupancyStatus: AtlasLeadershipOccupancyState;
  confidence: Exclude<AtlasLeadershipConfidence, "unassessed">;
  status: "reviewed_source_observation";
  supersedes: {
    personId: `person:${string}`;
    exactSourceName: string;
    sourceId: string;
    observedAt: string;
    termEndedAt: string;
  };
  summary: string;
  sources: AtlasLeadershipSourceCitation[];
}

export interface AtlasLeadershipAuthority {
  schemaVersion: "2.0.0";
  authorityId: "jju-atlas-leadership";
  revision: string;
  reviewedAt: string;
  purpose: string;
  policy: {
    automaticPublication: false;
    freshnessDoesNotAssertCurrentOffice: true;
    separatePersonOfficeAndPolityIdentity: true;
    unreviewedPortraitBehavior: "no_portrait";
  };
  reviewPolicy: {
    reviewAfterDays: number;
    description: string;
  };
  people: AtlasLeadershipPersonIdentity[];
  offices: AtlasLeadershipOfficeIdentity[];
  contexts: AtlasLeadershipContextRecord[];
  officeUpdates: AtlasLeadershipReviewedUpdate[];
}

export interface AtlasPortraitPilotPerson {
  id: `person:${string}`;
  name: string;
  portraitMediaId: `media:${string}`;
}

export interface AtlasPortraitPilotMedia {
  id: `media:${string}`;
  personId: `person:${string}`;
  href: `/atlas/portraits/${string}.webp`;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  derivation: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  attributionStatement: string | null;
  changes: string;
  photoDate: string;
  sourceUrl: string;
  sourceCreditHtml: string | null;
  inputUrl: string;
  sourceSha256: string;
  outputSha256: string;
  bytes: number;
  reviewedAt: string;
}

export interface AtlasPortraitPilotBinding {
  officeId: `office:${string}`;
  entityId: `country:${string}`;
  role: AtlasLeadershipRole;
  personId: `person:${string}`;
  title: string;
  exactSourceName: string;
  sourceId: string;
  observedAt: string;
  identityConfidence: Exclude<AtlasLeadershipConfidence, "unassessed">;
  reviewedAt: string;
}

export interface AtlasPortraitPilotAuthority {
  schemaVersion: "1.2.0";
  reviewedAt: string;
  purpose: string;
  people: AtlasPortraitPilotPerson[];
  media: AtlasPortraitPilotMedia[];
  bindings: AtlasPortraitPilotBinding[];
}

export interface AtlasLeadershipFactLike {
  value: AtlasLeadershipValue;
  observedAt: string | null;
  sourceId: string;
}

/** A data-facing result; the UI remains free to choose its own composition. */
export interface AtlasResolvedLeadershipState {
  office: AtlasLeadershipOfficeIdentity;
  recordKind: "reviewed_update" | "archived_snapshot";
  personId: `person:${string}` | null;
  personName: string | null;
  title: string | null;
  termStartedAt: string | null;
  observedAt: string | null;
  occupancy: AtlasLeadershipOccupancyState;
  freshness: AtlasLeadershipFreshnessState;
  confidence: AtlasLeadershipConfidence;
  /** Prevents recent evidence from being mistaken for a live guarantee. */
  currentOfficeClaim: "occupied_on_observation_date" | "not_asserted";
}
