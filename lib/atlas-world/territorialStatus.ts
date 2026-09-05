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

type StatusExplanation = Pick<AtlasTerritorialStatus, "kind" | "badge" | "summary" | "outline" | "evidence" | "claims" | "administration" | "disputeReason" | "mapChoice"> & { reviewedAt?: string };

/** Explicit place-level interpretation; source class alone is insufficient (e.g. Taiwan vs Cuba). */
const explanations: Record<string, StatusExplanation> = {
  "country:SAH": {
    kind: "disputed", badge: "Unresolved territorial status", outline: true,
    summary: "Morocco administers most of Western Sahara and claims it as Moroccan. The Polisario Front seeks an independent Sahrawi state. The territory’s final status remains unresolved.",
    claims: "Morocco claims Western Sahara as part of its territory. The Polisario Front, which proclaimed the Sahrawi Arab Democratic Republic, seeks independence for it.",
    administration: "Morocco administers most of the territory, west of the fortified sand wall known as the berm. The Polisario Front controls territory to its east. This is a broad description, not a map of today’s military positions.",
    disputeReason: "Spain’s withdrawal did not settle the territory’s future. Western Sahara remains on the UN list of Non-Self-Governing Territories, and the UN political process has not produced an agreed final settlement.",
    mapChoice: "Atlas keeps Western Sahara as one separately selectable territory. Its outline shows that territory—not the berm, either side’s control, or a decision on sovereignty.",
    reviewedAt: "2026-09-05",
    evidence: [
      { title: "Western Sahara · UN decolonization record", publisher: "United Nations", url: "https://www.un.org/dppa/decolonization/en/node/703", supports: "UN classification as a Non-Self-Governing Territory since 1963.", publishedAt: "2024-09-09" },
      { title: "MINURSO · mission background", publisher: "United Nations", url: "https://minurso.unmissions.org/en/", supports: "UN settlement proposals and ceasefire process involving Morocco and Frente POLISARIO.", publishedAt: null },
      { title: "Western Sahara · political situation", publisher: "UK Foreign, Commonwealth & Development Office", url: "https://www.gov.uk/foreign-travel-advice/western-sahara/safety-and-security", supports: "Morocco’s administration of most of the territory and the unresolved UN-mediated dispute.", publishedAt: null },
      { title: "Western Sahara · the berm and control", publisher: "UK Foreign, Commonwealth & Development Office", url: "https://www.gov.uk/foreign-travel-advice/western-sahara", supports: "Distinguishes Moroccan-controlled territory from Polisario-controlled territory east of the berm; page checked 5 September 2026.", publishedAt: "2026-06-29" },
      { title: "MINURSO · background to the dispute", publisher: "United Nations", url: "https://minurso.unmissions.org/en/background", supports: "Spanish withdrawal, competing territorial claims and the Sahrawi independence movement.", publishedAt: null },
      { title: "Sahrawi Arab Democratic Republic · member profile", publisher: "African Union Mission to the United Nations", url: "https://unmission.au.int/docroot/en/member-states/sahrawi-republic", supports: "The Polisario Front’s proclamation of the SADR. The AU is an organization that recognizes the SADR, not a neutral recognition registry.", publishedAt: null },
    ],
  },
  "country:KOS": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Kosovo has its own government and declared independence in 2008. Serbia considers it part of Serbia. Many states recognize Kosovo, but international recognition is not universal.",
    claims: "Kosovo’s authorities claim an independent state. Serbia rejects that independence and maintains its territorial claim.",
    administration: "Kosovo’s institutions run its government. Serbia-supported services also exist, particularly for the Serb community; their relationship to Kosovo’s institutions is part of the EU-facilitated dialogue.",
    disputeReason: "The 2008 independence declaration did not produce an agreed settlement with Serbia. UNMIK continues under Security Council resolution 1244 on a status-neutral basis.",
    mapChoice: "Atlas makes Kosovo separately selectable, following Natural Earth. That practical choice does not settle recognition or imply a division of control inside its boundary.",
    reviewedAt: "2026-09-05",
    evidence: [
      { title: "UNMIK · mandate", publisher: "United Nations", url: "https://unmik.unmissions.org/en/mandate", supports: "Resolution 1244 mandate and Kosovo’s post-2008 status context.", publishedAt: null },
      { title: "UNMIK · fact sheet", publisher: "United Nations", url: "https://unmik.unmissions.org/en/unmik-factsheet", supports: "The independence declaration, Kosovo’s institutions and the changed role of UNMIK.", publishedAt: "2026-07-21" },
      { title: "EU dialogue representative · remarks in Pristina", publisher: "European External Action Service", url: "https://www.eeas.europa.eu/delegations/kosovo/transcript-eusr-dialogue-s%C3%B8rensen%E2%80%99s-press-remarks_en?s=321", supports: "Kosovo institutions and Serbia-supported health and education services addressed by the dialogue.", publishedAt: "2026-03-14" },
    ],
  },
  "country:CYN": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Northern Cyprus is run by Turkish Cypriot authorities, outside the Republic of Cyprus’s effective control. The self-declared state is recognized by Türkiye, but not by the UN as a separate Cypriot state.",
    claims: "The Turkish Cypriot authorities claim a separate state. The Republic of Cyprus claims sovereignty over the island, apart from the British sovereign base areas.",
    administration: "Turkish Cypriot authorities administer the north; the Republic of Cyprus administers the south. A UN-patrolled buffer zone separates the two sides.",
    disputeReason: "Cyprus has been divided since the 1974 conflict. The north declared independence in 1983; UN Security Council resolution 541 rejected that declaration and called for non-recognition.",
    mapChoice: "Atlas draws the north separately so the island’s practical division is visible. It does not treat separate coloring as international recognition or show a detailed buffer-zone boundary.",
    reviewedAt: "2026-09-05",
    evidence: [
      { title: "Security Council resolution 541 (1983)", publisher: "United Nations Security Council · UNHCR Refworld", url: "https://www.refworld.org/legal/resolution/unsc/1983/en/8954", supports: "The Security Council’s position on the 1983 declaration; this is distinct from the source’s cartographic ‘Sovereign country’ label.", publishedAt: "1983-11-18" },
      { title: "Cyprus · political background", publisher: "UK Foreign, Commonwealth & Development Office", url: "https://www.gov.uk/government/publications/overseas-business-risk-cyprus/overseas-business-risk-cyprus", supports: "The division, effective administration, buffer zone and Türkiye’s recognition.", publishedAt: "2022-09-05" },
      { title: "Cyprus · regional status", publisher: "UK Foreign, Commonwealth & Development Office", url: "https://www.gov.uk/foreign-travel-advice/cyprus/regional-risks", supports: "Confirms that the north is outside the Republic of Cyprus’s control; checked 5 September 2026.", publishedAt: null },
    ],
  },
  "country:SOL": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Somaliland has separate governing institutions and claims independence from Somalia. Somalia rejects that claim. Israel recognized Somaliland in December 2025; recognition is not uniform.",
    claims: "Somaliland’s authorities claim independence. Somalia considers the territory part of Somalia; the Security Council has repeatedly affirmed Somalia’s territorial integrity.",
    administration: "Somaliland’s authorities operate separately from Somalia’s federal government. Its claimed eastern boundary and actual control are not identical; this map is not a current territorial-control survey.",
    disputeReason: "Somaliland declared independence in 1991, but that did not lead to an agreed separation from Somalia. Israel’s December 2025 recognition changed one diplomatic relationship, not everyone’s position.",
    mapChoice: "Atlas retains the separate Natural Earth unit. Do not read its full outline as the present reach of Somaliland’s government, or its color as universal recognition.",
    reviewedAt: "2026-09-05",
    evidence: [
      { title: "UN briefing on recognition of Somaliland", publisher: "UN Department of Political and Peacebuilding Affairs", url: "https://dppa.dfs.un.org/en/mtg-sc-10084-asg-khiari-29-dec-2025", supports: "Israel’s recognition, Somalia’s rejection and the Security Council position as reported on 29 December 2025.", publishedAt: "2025-12-29" },
      { title: "Somalia · eastern regional conditions", publisher: "UK Foreign, Commonwealth & Development Office", url: "https://www.gov.uk/foreign-travel-advice/somalia/regional-risks", supports: "Continuing conflict in the eastern regions; checked 5 September 2026.", publishedAt: null },
      { title: "Somalia Human Development Report · historical background", publisher: "United Nations Development Programme", url: "https://somalia.un.org/sites/default/files/2020-02/somalia_human%20dev%20report_2012.pdf", supports: "The 1991 independence declaration and development of separate institutions. Its old recognition description is superseded by the 2025 evidence above.", publishedAt: "2012" },
      { title: "Somalia · security and territorial-control background", publisher: "UK Home Office", url: "https://assets.publishing.service.gov.uk/media/6878d669760bf6cedaf5be02/Somalia%2BCPIN%2BMogadishu%2BAl%2BShabab%2Band%2Bthe%2Bsecurity%2Bsituation.pdf", supports: "The July 2025 country note distinguishes Somaliland administration from SSC-Khatumo control and other areas; Atlas does not reproduce these as current borders.", publishedAt: "2025-07" },
    ],
  },
  "country:PSX": {
    kind: "disputed", badge: "Observer State · contested territory", outline: true,
    summary: "Palestine comprises the West Bank, including East Jerusalem, and Gaza in the UN’s territorial framework. It has UN observer-State status, but those territories do not function as one area under a single government’s control.",
    claims: "Palestinian statehood claims concern the West Bank, including East Jerusalem, and Gaza. Israel claims East Jerusalem as part of its capital; the UN does not recognize that annexation.",
    administration: "The Palestinian Authority exercises limited administration in parts of the West Bank under Israeli occupation. Gaza’s administration and military control have been profoundly disrupted by war; the cited June 2026 UN report describes de facto authorities and Israeli military positions, not a single settled administration.",
    disputeReason: "The UN treats the West Bank, including East Jerusalem, and Gaza as occupied Palestinian territory. Observer-State status, recognition, borders and effective control are different questions; this map cannot answer them with one sovereign-name label.",
    mapChoice: "Atlas selects the West Bank and Gaza together as Palestine. It does not draw Areas A/B/C, settlements, the separation barrier or current Gaza control lines. The source’s ‘Israel’ sovereign-name field is not used as Atlas’s sovereignty judgment.",
    reviewedAt: "2026-09-05",
    evidence: [
      { title: "UN non-Member States", publisher: "United Nations", url: "https://www.un.org/en/about-us/non-member-states", supports: "Palestine’s non-Member Observer State status under General Assembly resolution 67/19.", publishedAt: null },
      { title: "Resolution 67/19 · status of Palestine", publisher: "United Nations General Assembly", url: "https://www.un.org/unispal/document/auto-insert-187149/", supports: "The 29 November 2012 observer-State decision and its territorial context.", publishedAt: "2012-11-29" },
      { title: "Occupied Palestinian Territory · situation report", publisher: "UN Office for the Coordination of Humanitarian Affairs", url: "https://www.un.org/unispal/document/ocha-sitrep-12-june-2026/", supports: "Dated evidence of fragmented administration, de facto authorities and changing military control in Gaza.", publishedAt: "2026-06-12" },
      { title: "Implementation of resolution 2334 · report", publisher: "UN Secretary-General", url: "https://www.un.org/unispal/document/sg-report-24jun26/", supports: "Occupied-territory framework, East Jerusalem and Israeli settlement activity.", publishedAt: "2026-06-24" },
      { title: "Occupied Palestinian Territory · advisory opinion summary", publisher: "International Court of Justice", url: "https://www.icj-cij.org/node/204176", supports: "The occupied-territory framework and the legal distinction between administration, annexation and sovereignty in East Jerusalem and the West Bank.", publishedAt: "2024-07-19" },
    ],
  },
  "country:TWN": {
    kind: "partial-recognition", badge: "Contested international status", outline: true,
    summary: "Taiwan is self-governed by the Republic of China’s institutions. The People’s Republic of China claims Taiwan as its territory but does not administer it. International recognition differs from this practical separation.",
    claims: "The People’s Republic of China claims Taiwan as part of China. Taiwan’s government operates as the Republic of China; political views within Taiwan differ over its long-term relationship with the mainland.",
    administration: "Taiwan elects its own president and legislature and runs its own courts and public services. These are separate from the People’s Republic of China’s institutions.",
    disputeReason: "The Republic of China and the People’s Republic of China emerged on opposing sides of China’s civil war. Their competing positions, and other states’ different diplomatic policies, make self-government and international recognition distinct questions.",
    mapChoice: "Taiwan is a separate selectable unit in Atlas. This lets its geography and available data be explored without treating the map’s color or inclusion as a sovereignty ruling.",
    reviewedAt: "2026-09-05",
    evidence: [
      { title: "The European Union and Taiwan", publisher: "European External Action Service", url: "https://www.eeas.europa.eu/delegations/taiwan/european-union-and-taiwan_en?s=242", supports: "One explicitly stated diplomatic position: the EU’s One China policy alongside its relations with Taiwan.", publishedAt: null },
      { title: "Taiwan · history, politics and UK relations", publisher: "UK Parliament · House of Commons Library", url: "https://commonslibrary.parliament.uk/research-briefings/cbp-9254/", supports: "Taiwan’s separate elected institutions, PRC claim, ROC identity and differing international recognition.", publishedAt: "2025-11-17" },
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
    observedAt: entry.reviewedAt ?? "2026-09-04",
    temporal: { precision: "source_snapshot", validFrom: null, validTo: null },
    evidence: [...entry.evidence, sourceDataset, cartography],
    caveat,
  };
}
