import type { AtlasRuntimeCountrySummary } from "./runtime";

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
  /** Outline is an invitation to inspect status, not a classification of every border segment. */
  outline: boolean;
  sourceClassification: string;
  sourceSovereignName: string;
  sourceBoundaryNote: string | null;
  sourceId: "natural-earth-admin-0-50m-5.1.2";
  /** Date Atlas reviewed this explanation; not the date a border or political status changed. */
  observedAt: "2026-09-04";
  temporal: { precision: "source_snapshot"; validFrom: null; validTo: null };
  evidence: AtlasStatusEvidence[];
  caveat: string;
};

const cartography: AtlasStatusEvidence = {
  title: "Natural Earth · disputed-boundary policy",
  publisher: "Natural Earth",
  url: "https://www.naturalearthdata.com/about/disputed-boundaries-policy/",
  supports: "The source’s de facto cartographic policy is not a statement of legal sovereignty.",
  publishedAt: "2022-02-27",
};
const sourceDataset: AtlasStatusEvidence = {
  title: "Natural Earth · 1:50m Admin 0 countries",
  publisher: "Natural Earth",
  url: "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/",
  supports: "Atlas preserves the classification, sovereign-name field and boundary note from its locked version 5.1.2 snapshot.",
  publishedAt: null,
};
const caveat = "Atlas preserves Natural Earth 5.1.2 geography. A dashed outline flags a status note for the whole map unit; it does not locate each disputed border segment or endorse a territorial claim. These are dated source records, not live control lines.";

type StatusExplanation = Pick<AtlasTerritorialStatus, "kind" | "badge" | "summary" | "outline" | "evidence">;

/** Explicit place-level interpretation; source class alone is insufficient (e.g. Taiwan vs Cuba). */
const explanations: Record<string, StatusExplanation> = {
  "country:SAH": {
    kind: "disputed", badge: "Unresolved territorial status", outline: true,
    summary: "Western Sahara remains on the UN list of Non-Self-Governing Territories. The UN settlement process concerns Morocco and Frente POLISARIO; its separate outline here does not resolve sovereignty or show current lines of control.",
    evidence: [
      { title: "Western Sahara · UN decolonization record", publisher: "United Nations", url: "https://www.un.org/dppa/decolonization/en/node/703", supports: "UN classification as a Non-Self-Governing Territory since 1963.", publishedAt: "2024-09-09" },
      { title: "MINURSO · mission background", publisher: "United Nations", url: "https://minurso.unmissions.org/en/", supports: "UN settlement proposals and ceasefire process involving Morocco and Frente POLISARIO.", publishedAt: null },
    ],
  },
  "country:KOS": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Kosovo is shown as a separate map unit. International positions on its status differ; UNMIK continues under Security Council resolution 1244. The map does not settle those positions.",
    evidence: [
      { title: "UNMIK · mandate", publisher: "United Nations", url: "https://unmik.unmissions.org/en/mandate", supports: "Resolution 1244 mandate and Kosovo’s post-2008 status context.", publishedAt: null },
    ],
  },
  "country:CYN": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Natural Earth separately maps the self-administered north of Cyprus. UN Security Council resolution 541 called its 1983 declaration legally invalid and called for non-recognition of a Cypriot state other than the Republic of Cyprus.",
    evidence: [
      { title: "Security Council resolution 541 (1983)", publisher: "United Nations Security Council · UNHCR Refworld", url: "https://www.refworld.org/legal/resolution/unsc/1983/en/8954", supports: "The Security Council’s position on the 1983 declaration; this is distinct from the source’s cartographic ‘Sovereign country’ label.", publishedAt: "1983-11-18" },
    ],
  },
  "country:SOL": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Somaliland is mapped separately under Natural Earth’s de facto policy. A UN briefing recorded Israel’s December 2025 recognition and Somalia’s rejection, while recalling Security Council support for Somalia’s territorial integrity. Recognition is not uniform.",
    evidence: [
      { title: "UN briefing on recognition of Somaliland", publisher: "UN Department of Political and Peacebuilding Affairs", url: "https://dppa.dfs.un.org/en/mtg-sc-10084-asg-khiari-29-dec-2025", supports: "Israel’s recognition, Somalia’s rejection and the Security Council position as reported on 29 December 2025.", publishedAt: "2025-12-29" },
    ],
  },
  "country:PSX": {
    kind: "disputed", badge: "Observer State · contested territory", outline: true,
    summary: "Palestine has held UN non-Member Observer State status since 2012. The map source’s ‘Indeterminate’ class and ‘Israel’ sovereign-name field are cartographic metadata, not Atlas’s legal description of Palestinian sovereignty or current administration.",
    evidence: [
      { title: "UN non-Member States", publisher: "United Nations", url: "https://www.un.org/en/about-us/non-member-states", supports: "Palestine’s non-Member Observer State status under General Assembly resolution 67/19.", publishedAt: null },
      { title: "Resolution 67/19 · status of Palestine", publisher: "United Nations General Assembly", url: "https://www.un.org/unispal/document/auto-insert-187149/", supports: "The 29 November 2012 observer-State decision and its territorial context.", publishedAt: "2012-11-29" },
    ],
  },
  "country:TWN": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Taiwan is separately administered and mapped separately by Natural Earth, whose boundary note records China’s claim. International diplomatic positions differ; separate map inclusion is not an endorsement of a sovereignty position.",
    evidence: [
      { title: "The European Union and Taiwan", publisher: "European External Action Service", url: "https://www.eeas.europa.eu/delegations/taiwan/european-union-and-taiwan_en?s=242", supports: "One explicitly stated diplomatic position: the EU’s One China policy alongside its relations with Taiwan.", publishedAt: null },
    ],
  },
  "country:KAS": {
    kind: "disputed", badge: "Disputed area · not a country", outline: true,
    summary: "Siachen Glacier is a separately drawn geographic unit in this source, not a sovereign country. Natural Earth labels it ‘Indeterminate’ and records claims by India and Pakistan. Its outline is not a live military-control line.",
    evidence: [],
  },
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

export const ATLAS_STATUS_OUTLINE_ENTITY_IDS: ReadonlySet<string> = new Set(
  Object.entries(explanations).filter(([, value]) => value.outline).map(([id]) => id),
);

/** No name matching, no blanket conversion of dependencies or ‘Sovereignty’ into disputes. */
export function getAtlasTerritorialStatus(
  country: Pick<AtlasRuntimeCountrySummary, "id" | "geography">,
): AtlasTerritorialStatus {
  const geography = country.geography;
  let entry = explanations[country.id];
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
    observedAt: "2026-09-04",
    temporal: { precision: "source_snapshot", validFrom: null, validTo: null },
    evidence: [...entry.evidence, sourceDataset, cartography],
    caveat,
  };
}
