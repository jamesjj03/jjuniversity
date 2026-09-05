import type { AtlasRuntimeCountrySummary } from "./runtime";
import {
  getAtlasTerritorialStatusAuthorityOutlineEntityIds,
  getAtlasTerritorialStatusAuthorityRecord,
  getAtlasTerritorialStatusAuthoritySource,
  resolveAtlasTerritorialStatusCitations,
} from "./territorial-status/authority";
import type { AtlasTerritorialAuthorityRecord } from "./territorial-status/types";

export type AtlasStatusEvidence = {
  title: string;
  publisher: string;
  url: string;
  supports: string;
  publishedAt: string | null;
};

export type AtlasTerritorialStatus = {
  kind: "disputed" | "partial-recognition" | "special-status" | "dependency" | "standard";
  badge: string;
  summary: string;
  /** Place-specific explanations. Omitted when the evidence does not support one. */
  claims?: string;
  administration?: string;
  disputeReason?: string;
  mapChoice?: string;
  /** Outline is an invitation to inspect status, not a classification of every border segment. */
  outline: boolean;
  sourceClassification: string;
  sourceSovereignName: string;
  sourceBoundaryNote: string | null;
  sourceId: "natural-earth-admin-0-50m-5.1.2";
  /** Date Atlas reviewed this explanation; not the date a border or political status changed. */
  observedAt: string;
  temporal: { precision: "source_snapshot"; validFrom: null; validTo: null };
  evidence: AtlasStatusEvidence[];
  caveat: string;
};

const cartographySource = getAtlasTerritorialStatusAuthoritySource("natural-earth-disputed-boundary-policy");
const datasetSource = getAtlasTerritorialStatusAuthoritySource("natural-earth-admin-0-50m-5.1.2");
if (!cartographySource || !datasetSource) {
  throw new Error("Atlas territorial-status authority is missing its cartographic sources.");
}
const cartography: AtlasStatusEvidence = {
  title: cartographySource.title,
  publisher: cartographySource.publisher,
  url: cartographySource.url,
  supports: "The source’s de facto cartographic policy is not a statement of legal sovereignty.",
  publishedAt: cartographySource.publishedAt,
};
const sourceDataset: AtlasStatusEvidence = {
  title: datasetSource.title,
  publisher: datasetSource.publisher,
  url: datasetSource.url,
  supports: "Atlas preserves the classification, sovereign-name field and boundary note from its locked version 5.1.2 snapshot.",
  publishedAt: datasetSource.publishedAt,
};
const caveat = "Atlas preserves Natural Earth 5.1.2 geography. A dashed outline flags a status note for the whole map unit; it does not locate each disputed border segment or endorse a territorial claim. These are dated source records, not live control lines.";

type StatusExplanation = Pick<
  AtlasTerritorialStatus,
  "kind" | "badge" | "summary" | "outline" | "evidence" | "claims" | "administration" | "disputeReason" | "mapChoice"
> & {
  reviewedAt?: string;
  scopeCaveat?: string;
};

function projectAuthorityRecord(record: AtlasTerritorialAuthorityRecord): StatusExplanation {
  return {
    kind: record.statusKind,
    badge: record.badge,
    summary: record.explanation.summary,
    claims: record.explanation.claims,
    administration: record.explanation.administration,
    disputeReason: record.explanation.disputeReason,
    mapChoice: record.explanation.mapChoice,
    outline: true,
    evidence: resolveAtlasTerritorialStatusCitations(record),
    reviewedAt: record.review.reviewedAt,
    scopeCaveat: record.scopeCaveat,
  };
}

/**
 * Smaller legacy explanations remain here until their evidence has the same
 * relationship-level review as the bounded seven-record authority. Keeping
 * them preserves V2.5 behavior without pretending they were fully modeled.
 */
const legacyExplanations: Record<string, StatusExplanation> = {
  "country:IOT": {
    kind: "disputed", badge: "Territorial status · dated source", outline: true,
    summary: "The map retains Natural Earth’s British Indian Ocean Territory unit. The UK and Mauritius signed a Chagos agreement in May 2025 providing for a sovereignty transfer and base arrangements; this older map record does not establish when treaty provisions enter into force.",
    evidence: [
      { title: "UK–Mauritius agreement · parliamentary examination", publisher: "UK Parliament · Constitution Committee", url: "https://publications.parliament.uk/pa/ld5901/ldselect/ldconst/216/21603.htm", supports: "Terms of the 22 May 2025 agreement and the distinction between signing, scrutiny and ratification.", publishedAt: null },
    ],
  },
  "country:FLK": {
    kind: "disputed", badge: "Sovereignty dispute", outline: true,
    summary: "Natural Earth records UK administration and Argentina’s claim for the Falkland Islands (Malvinas). The UN treats the islands as a Non-Self-Governing Territory with a sovereignty dispute. Administration and sovereignty claims are distinct.",
    evidence: [
      { title: "Falkland Islands (Malvinas) · UN decolonization record", publisher: "United Nations", url: "https://www.un.org/dppa/decolonization/en/nsgt/falkland-islands-malvinas", supports: "UN territorial status and the sovereignty dispute between Argentina and the United Kingdom.", publishedAt: null },
    ],
  },
  "country:ISR": {
    kind: "disputed", badge: "Boundary status note", outline: true,
    summary: "Natural Earth marks this unit ‘Disputed’. That flags territorial and boundary questions; it does not mean Israel’s entire territory is one disputed zone. This country-scale outline does not distinguish internationally recognized borders, occupation or current lines of control.",
    evidence: [
      { title: "Briefing on the Occupied Palestinian Territory", publisher: "Food and Agriculture Organization of the UN", url: "https://www.un.org/unispal/wp-content/uploads/2024/09/cd1805en.pdf", supports: "Distinguishes the Occupied Palestinian Territory from Israel and explains the relevance of 1967.", publishedAt: "2024-09" },
    ],
  },
  "country:ATA": {
    kind: "special-status", badge: "Antarctic Treaty area", outline: false,
    summary: "Antarctica’s ‘Indeterminate’ source class reflects a special treaty setting, not an ordinary disputed state. Article IV preserves parties’ positions on claims and prevents new or enlarged claims while the treaty is in force.",
    evidence: [
      { title: "The Antarctic Treaty · Article IV", publisher: "Antarctic Treaty Secretariat", url: "https://www.ats.aq/e/antarctictreaty.html", supports: "Treatment of existing territorial positions and new claims under Article IV.", publishedAt: null },
    ],
  },
};

export const ATLAS_STATUS_OUTLINE_ENTITY_IDS: ReadonlySet<string> = new Set([
  ...getAtlasTerritorialStatusAuthorityOutlineEntityIds(),
  ...Object.entries(legacyExplanations).filter(([, value]) => value.outline).map(([id]) => id),
]);

/** No name matching, no blanket conversion of dependencies or ‘Sovereignty’ into disputes. */
export function getAtlasTerritorialStatus(
  country: Pick<AtlasRuntimeCountrySummary, "id" | "geography">,
): AtlasTerritorialStatus {
  const geography = country.geography;
  const reviewedRecord = getAtlasTerritorialStatusAuthorityRecord(country.id);
  let entry = reviewedRecord ? projectAuthorityRecord(reviewedRecord) : legacyExplanations[country.id];
  if (!entry && (geography.naturalEarthType === "Disputed" || /\bclaim|\bdisput/i.test(geography.boundaryNote ?? ""))) {
    entry = {
      kind: "disputed", badge: "Source flags a status question", outline: true,
      summary: "The geographic source flags a territorial or status question for this unit. Read its original note below; Atlas does not infer a current sovereign or administrator from that label.", evidence: [],
    };
  }
  if (!entry && geography.naturalEarthType === "Indeterminate") {
    entry = { kind: "special-status", badge: "Special geographic status", outline: false,
      summary: "Natural Earth uses an indeterminate classification for this map unit. That label alone is insufficient to infer its legal or political arrangement.", evidence: [] };
  }
  if (!entry && geography.naturalEarthType === "Dependency") {
    entry = { kind: "dependency", badge: "Territory / dependency", outline: false,
      summary: `The geographic source classifies this place as a dependency and associates it with ${geography.sovereignName}. Local autonomy and constitutional arrangements are not implied by that broad cartographic label.`, evidence: [] };
  }
  if (!entry) {
    entry = { kind: "standard", badge: geography.naturalEarthType === "Country" ? "Country / map unit" : "Country", outline: false,
      summary: "A separately mapped unit in Natural Earth’s present-day Admin 0 snapshot. The source classification is retained rather than treated as a universal recognition decision.", evidence: [] };
  }
  return {
    ...entry,
    sourceClassification: geography.naturalEarthType,
    sourceSovereignName: geography.sovereignName,
    sourceBoundaryNote: geography.boundaryNote,
    sourceId: "natural-earth-admin-0-50m-5.1.2",
    observedAt: entry.reviewedAt ?? "2026-09-04",
    temporal: { precision: "source_snapshot", validFrom: null, validTo: null },
    evidence: [...entry.evidence, sourceDataset, cartography],
    caveat: entry.scopeCaveat ? `${caveat} ${entry.scopeCaveat}` : caveat,
  };
}
