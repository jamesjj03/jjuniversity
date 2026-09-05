/** Human-readable explanations of the classifications Atlas actually uses. */
export type AtlasGlossarySource = {
  title: string;
  publisher: string;
  url: string;
};

export type AtlasGlossaryTerm = {
  id: string;
  label: string;
  group: "Government" | "Religion" | "Reading the map" | "Geography";
  aliases: string[];
  definition: string;
  inAtlas: string;
  caveat: string;
  /** A concrete illustration, separate from the classification machinery. */
  example: string | null;
  relatedTerms: string[];
  sources: AtlasGlossarySource[];
  reviewedAt: "2026-09-05";
};

const factbook: AtlasGlossarySource = {
  title: "Government-type definitions · archived World Factbook",
  publisher: "CIA; historical copy hosted by MIT CSAIL",
  url: "https://start.csail.mit.edu/mirror/cia.gov/library/publications/the-world-factbook/fields/2128.html",
};
const factbookSnapshot: AtlasGlossarySource = {
  title: "World Factbook · preserved final source snapshot",
  publisher: "CIA; archive maintained by Paul Musser",
  url: "https://github.com/pmusser/cia-world-factbook-final",
};
const presidentialSystems: AtlasGlossarySource = {
  title: "Presidential and semi-presidential systems",
  publisher: "International IDEA",
  url: "https://www.idea.int/publications/catalogue/electing-presidents-presidential-and-semi-presidential-democracies",
};
const parliamentarySystems: AtlasGlossarySource = {
  title: "Presidents in parliamentary democracies",
  publisher: "International IDEA",
  url: "https://www.idea.int/publications/catalogue/non-executive-presidents-parliamentary-democracies",
};
const monarchies: AtlasGlossarySource = {
  title: "Constitutional monarchs in parliamentary democracies",
  publisher: "International IDEA",
  url: "https://www.idea.int/publications/catalogue/constitutional-monarchs-parliamentary-democracies",
};
const naturalEarth: AtlasGlossarySource = {
  title: "How Natural Earth represents disputed boundaries",
  publisher: "Natural Earth",
  url: "https://www.naturalearthdata.com/about/disputed-boundaries-policy/",
};
const worldBankGdp: AtlasGlossarySource = {
  title: "GDP per capita, current US dollars · NY.GDP.PCAP.CD",
  publisher: "World Bank",
  url: "https://databank.worldbank.org/metadataglossary/world-development-indicators/series/NY.GDP.PCAP.CD",
};
const worldBankPopulation: AtlasGlossarySource = {
  title: "Population, total · SP.POP.TOTL",
  publisher: "World Bank",
  url: "https://databank.worldbank.org/metadataglossary/world-development-indicators/series/SP.POP.TOTL",
};
const ghsl: AtlasGlossarySource = {
  title: "GHS-POP R2023A · population grids and methodology",
  publisher: "European Commission Joint Research Centre",
  url: "https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php",
};

// Authored teaching paths, not every possible relationship in a taxonomy.
const teaching: Record<string, { example?: string; related: string[] }> = {
  presidential_republic: { example: "A president can remain in office even when a different party controls parliament. Separation of those offices is the key idea—not the president’s title alone.", related: ["parliamentary_republic", "semi_presidential_republic", "government"] },
  parliamentary_republic: { example: "A prime minister may have to resign after losing a confidence vote in parliament. A separate president can remain as head of state.", related: ["presidential_republic", "constitutional_monarchy", "government"] },
  semi_presidential_republic: { example: "A president and a prime minister can come from different political camps. Who controls which decisions depends on the constitution and parliamentary support.", related: ["presidential_republic", "parliamentary_republic"] },
  constitutional_monarchy: { example: "A king or queen can be head of state while a prime minister runs the government. A crown does not by itself tell you who makes policy.", related: ["absolute_monarchy", "parliamentary_republic", "government"] },
  absolute_monarchy: { related: ["constitutional_monarchy", "government"] },
  one_party_state: { example: "A country may have a parliament and elections while one party still holds the leading role in the state. Institutions and political competition are separate questions.", related: ["government", "presidential_republic"] },
  military_or_transitional: { example: "Military rule and a civilian caretaker government are not the same thing. They share this overview color, so read the country’s original description.", related: ["government", "observed"] },
  theocracy: { example: "Having an official religion does not by itself make a government a theocracy. The question is whether religious authority holds governing power.", related: ["government", "dominant-religion"] },
  territory_or_dependency: { example: "A territory may run many local affairs while another state handles defence or foreign relations. The exact arrangement matters more than the label.", related: ["political-geography", "disputed-territory"] },
  government_other: { related: ["government", "unknown"] },
  government: { example: "Two countries can both be republics yet give their presidents very different powers. This map describes the broad arrangement, not how democratic either country is.", related: ["presidential_republic", "parliamentary_republic", "constitutional_monarchy"] },
  unknown: { example: "A place with no GDP figure is not an economy worth zero dollars. It is a place this dataset cannot compare.", related: ["observed", "inherited"] },
  "gdp-per-capita": { example: "If a hypothetical economy produces $100 billion in a year and has 5 million residents, its GDP per capita is $20,000. No one necessarily earns that amount.", related: ["gdp", "income-classification", "logarithmic-scale"] },
  gdp: { example: "Think of the value produced during one year, not everything a country owns. A large population can support a large economy without high output per person.", related: ["gdp-per-capita", "population"] },
  population: { example: "Two countries can have the same number of people, with one spread across a continent and the other crowded into a small area.", related: ["population-density", "modeled-estimate"] },
  "population-density": { example: "A country’s average can hide an almost empty desert beside a crowded river valley. A grid makes that contrast visible.", related: ["population", "modeled-estimate", "logarithmic-scale"] },
  "modeled-estimate": { example: "A population model can use census totals and mapped buildings to estimate where people live. A sharp-looking pixel is still an estimate.", related: ["population-density", "observed"] },
  "dominant-religion": { example: "A single color can show a Christian majority while hiding major differences between Catholic, Protestant and Orthodox communities. Open the composition to see more.", related: ["religious-composition", "mixed_or_no_clear_majority"] },
  "religious-composition": { example: "Someone may take part in more than one religious tradition. A survey of practices can therefore add up to more than 100%, unlike a question asking for one identity.", related: ["dominant-religion", "mixed_or_no_clear_majority", "religiously_unaffiliated"] },
  mixed_or_no_clear_majority: { example: "A hypothetical split of 45%, 35% and 20% has a largest group but no majority. ‘Largest’ and ‘more than half’ are different ideas.", related: ["dominant-religion", "religious-composition", "unknown"] },
  christianity: { related: ["dominant-religion", "religious-composition", "islam"] },
  islam: { related: ["dominant-religion", "religious-composition", "christianity"] },
  hinduism: { related: ["buddhism", "religious-composition"] },
  buddhism: { related: ["hinduism", "folk_or_traditional", "religious-composition"] },
  judaism: { related: ["christianity", "religious-composition"] },
  folk_or_traditional: { example: "Practices may involve ancestors, local spirits or sacred places, and can coexist with another religious identity. The traditions grouped here are not interchangeable.", related: ["buddhism", "religious-composition", "dominant-religion"] },
  religiously_unaffiliated: { example: "An atheist and someone who believes in a spiritual world but belongs to no religion may both appear in this category.", related: ["religious-composition", "mixed_or_no_clear_majority"] },
  religion_other: { related: ["religious-composition", "unknown"] },
  "disputed-territory": { example: "A government can administer a place while another claims sovereignty over it. Recognition by other states is a third, separate question.", related: ["political-geography", "territory_or_dependency", "observed"] },
  "political-geography": { example: "A separately colored territory is something you can select and explore. It is not automatically a claim that it is an independent state.", related: ["disputed-territory", "territory_or_dependency"] },
  "physical-relief": { example: "Light and shadow help you see a mountain range or plateau. They do not tell you the exact height at the point you click.", related: ["population-density", "political-geography"] },
  "major-cities": { example: "A city dot locates a place. It does not mark the edge of its buildings or everyone who lives in the wider metropolitan area.", related: ["population-density", "political-geography"] },
  "income-classification": { example: "An upper-middle-income label is a World Bank statistical grouping. It does not mean every household has a middle income.", related: ["gdp-per-capita", "gdp"] },
  "logarithmic-scale": { example: "On a logarithmic scale, 100 → 1,000 can occupy the same space as 1,000 → 10,000. Both steps multiply by ten.", related: ["gdp-per-capita", "population-density"] },
  inherited: { example: "A value borrowed from a parent country is not a fresh measurement of its territory. Atlas should say when a value has been borrowed.", related: ["observed", "unknown"] },
  observed: { example: "A profile downloaded in 2026 might report a population measured in 2025 or a survey from 2010. The download date does not make either fact new.", related: ["modeled-estimate", "unknown"] },
};

type TermInput = Omit<AtlasGlossaryTerm, "reviewedAt" | "example" | "relatedTerms">;
function term(input: TermInput): AtlasGlossaryTerm {
  return { ...input, example: teaching[input.id]?.example ?? null, relatedTerms: teaching[input.id]?.related ?? [], reviewedAt: "2026-09-05" };
}

const governmentCaveat = "A broad form-of-government label is not a rating of democracy, civil liberties, policy or how power works in practice. The source is an archived observation, not live monitoring.";
const government = (
  id: string, label: string, definition: string, inAtlas: string,
  sources: AtlasGlossarySource[] = [factbook, factbookSnapshot],
  aliases: string[] = [],
): AtlasGlossaryTerm => term({
  id, label, group: "Government", aliases, definition, inAtlas,
  caveat: governmentCaveat, sources,
});

export const ATLAS_GLOSSARY: readonly AtlasGlossaryTerm[] = [
  government("presidential_republic", "Presidential republic",
    "A country where a president leads the government separately from parliament. The president is usually both the national representative—the head of state—and the person running the government.",
    "The archived government wording contains ‘presidential republic’, or the exact phrase ‘constitutional federal republic’. Explicit transitional, one-party and theocratic wording takes priority.",
    [presidentialSystems, factbookSnapshot]),
  government("parliamentary_republic", "Parliamentary republic",
    "A country where the government needs parliament’s support to stay in office. A prime minister usually runs the government, while a separate president represents the state.",
    "The source says ‘parliamentary republic’ or ‘parliamentary democracy’ without a higher-priority monarchy, dependency or other classification.",
    [parliamentarySystems, factbookSnapshot]),
  government("semi_presidential_republic", "Semi-presidential republic",
    "A country where executive power is shared between a president and a prime minister. The president has real governing powers, while the prime minister’s government also depends on parliament.",
    "The source uses ‘semi-presidential’ or ‘mixed presidential-parliamentary’. The balance between president and prime minister is not measured by this color.",
    [presidentialSystems, factbookSnapshot]),
  government("constitutional_monarchy", "Constitutional monarchy",
    "A country with a king or queen whose role is governed by constitutional rules. In many such countries, elected politicians run the government; in others, the monarch retains substantial powers.",
    "Groups source wording including ‘constitutional monarchy’, ‘Commonwealth realm’ and ‘co-principality’. This is a broader bucket than purely ceremonial monarchy.",
    [monarchies, factbookSnapshot]),
  government("absolute_monarchy", "Absolute monarchy",
    "A country where the monarch holds supreme governing authority, rather than serving mainly as a ceremonial head of state.",
    "The source says ‘absolute monarchy’ or ‘sultanate’, after more-specific transitional, dependency, theocratic and one-party checks. The raw description remains available."),
  government("one_party_state", "One-party state",
    "A country where one political party holds the leading role in government and rival parties cannot compete for national power on equal terms.",
    "The source explicitly uses one-party, single-party, communist party-led state or communist state wording. Atlas does not infer economic policy from this category."),
  government("military_or_transitional", "Military / transitional",
    "This combines two situations: government led by the military, and a temporary arrangement during a political transition. The country description tells you which applies.",
    "The source contains military junta, military regime, military government, ‘in transition’ or ‘transitional government’. This rule takes priority over constitutional labels.",
    [factbookSnapshot], ["Military/transitional", "Military or transitional"]),
  government("theocracy", "Theocracy",
    "A system in which religious leaders or institutions hold supreme governing authority. It describes who holds power, not simply what most people believe.",
    "The source explicitly says ‘theocratic’ or ‘ecclesiastical elective monarchy’. A religious population or an official religion alone does not trigger this label."),
  government("territory_or_dependency", "Territory / dependency",
    "A place connected politically to another state rather than fully independent. Some territories govern many of their own affairs; others have less local autonomy.",
    "The Government lens groups explicit territorial, overseas, special-administrative-region and specified kingdom/sovereignty wording. The geographic source’s dependency classification is a separate field.",
    [factbookSnapshot, naturalEarth], ["Territory/dependency", "Territory or dependency", "Dependency", "Territory"]),
  government("government_other", "Other government form",
    "The country’s government does not fit neatly into the other map categories. Its original description is more useful than forcing it into the wrong group.",
    "This is an unresolved classification, not evidence that the place has an unusual, weak or absent government.",
    [factbookSnapshot], ["Other / unclassified", "Other / complex", "Other system"]),
  term({ id: "government", label: "Government form", group: "Government", aliases: ["Government", "Government type", "Political system"],
    definition: "How a country organizes political power: who represents the state, who runs the government, and how those people relate to parliament or other institutions.",
    inAtlas: "Explicit phrases in the archived Factbook profile are mapped to a small set of readable categories. Transitional, territorial, theocratic and one-party language can take priority over a constitutional description.",
    caveat: "One color cannot measure institutional practice, electoral competition, civil liberties, state capacity or political economy. Read the original description and observation date.", sources: [factbookSnapshot, presidentialSystems] }),
  term({ id: "unknown", label: "Not available", group: "Reading the map", aliases: ["Unknown", "Unavailable", "No data", "No comparable data", "Missing data"],
    definition: "There is no usable, comparable figure for this place in the selected view. Missing information is not the same as a value of zero.",
    inAtlas: "Missing observations have their own styling. They are not zero and are not the lowest category on a quantitative scale.",
    caveat: "A blank value can mean a coverage gap, an unresolved source, or a measure that is not applicable. It does not mean the phenomenon is absent.", sources: [worldBankPopulation, factbookSnapshot] }),
  term({ id: "gdp-per-capita", label: "GDP per capita", group: "Reading the map", aliases: ["GDP/person", "GDP per person", "GDP per capita (current US$)", "Current US$"],
    definition: "A country’s yearly economic output divided by the number of people living there. It helps compare the scale of economies per person, but it is not the amount a typical person earns.",
    inAtlas: "The latest available World Bank NY.GDP.PCAP.CD observation for each place drives a logarithmic color scale. The year is shown because countries may have different latest years.",
    caveat: "This is not a typical person’s income, household wealth or a purchasing-power-adjusted living-standard measure. Exchange rates, cross-border production and unequal distribution matter.", sources: [worldBankGdp] }),
  term({ id: "gdp", label: "GDP", group: "Reading the map", aliases: ["Gross domestic product", "GDP (current US$)"],
    definition: "Gross domestic product is the value of goods and services produced within an economy, usually over a year. It tells you the size of economic activity, not how evenly its benefits are shared.",
    inAtlas: "Country details use the World Bank’s current-US-dollar national-accounts series, with the observation year retained.",
    caveat: "GDP is a flow of production, not a stock of wealth. Current-dollar values are not adjusted for inflation or differences in local purchasing power.", sources: [worldBankGdp] }),
  term({ id: "population", label: "Population", group: "Reading the map", aliases: ["National population", "Population total"],
    definition: "The total number of people estimated to live in a country or territory, not how closely together they live.",
    inAtlas: "National totals come from the latest available World Bank observation, with GeoNames as a labeled fallback. Where People Live is a separate gridded model.",
    caveat: "The country total and the 2025 density grid can use different methods and years; they should not be treated as the same observation.", sources: [worldBankPopulation, ghsl] }),
  term({ id: "population-density", label: "Population density", group: "Reading the map", aliases: ["Density", "People/km²", "People per km²", "Gridded population density"],
    definition: "How many people live in a given area. Higher density means people are more concentrated; lower density means they are more spread out.",
    inAtlas: "Where People Live uses the 2025 epoch of GHS-POP R2023A, based on a one-kilometre equal-area source grid. Display pixels aggregate source cells at world scale.",
    caveat: "It is a modeled distribution, not a census taken independently in each cell. The 2025 epoch is a projection; zooming does not create new source detail.", sources: [ghsl] }),
  term({ id: "modeled-estimate", label: "Modeled estimate", group: "Reading the map", aliases: ["Modelled estimate", "Modeled", "Modelled", "Estimated", "Projection", "2025 estimate"],
    definition: "An estimate made by combining observations with assumptions about how the world works. It fills gaps where measuring every place directly is not possible.",
    inAtlas: "The population grid redistributes population inputs using built-up-area information and includes projected epochs. Its source, version and observation year remain attached to the layer.",
    caveat: "A visually precise grid does not mean equally precise knowledge. Input age, resolution and model assumptions affect local accuracy.", sources: [ghsl] }),
  term({ id: "dominant-religion", label: "Dominant religious tradition", group: "Religion", aliases: ["Dominant tradition", "Religion", "Largest religion"],
    definition: "The broad religious tradition used to give a country its map color. It is a starting point: people within that country may follow many different traditions, or none.",
    inAtlas: "With usable percentages, a tradition above 50% supplies the color. Without them, explicit source descriptions can supply a qualitative label. Otherwise Atlas keeps mixed or unresolved values.",
    caveat: "National sources differ in year, survey method and whether identities can overlap. Inspect composition and raw wording before comparing close percentages.", sources: [factbookSnapshot] }),
  term({ id: "religious-composition", label: "Religious composition", group: "Religion", aliases: ["Composition", "Religious share", "Religion percentages"],
    definition: "The mix of religious traditions people identify with or practise in a place. Percentages help you see what a single map color leaves out.",
    inAtlas: "Existing Factbook percentages are grouped into broad traditions without reconstructing denominations. Reported shares remain visible even when the map cannot safely assign one dominant color.",
    caveat: "Categories can overlap, notably when a source counts practice rather than exclusive identity. Bars are not automatically normalized to 100%; overlapping or partial reports are flagged.", sources: [factbookSnapshot] }),
  term({ id: "mixed_or_no_clear_majority", label: "Mixed / no clear majority", group: "Religion", aliases: ["Mixed/no clear majority", "Mixed", "No clear majority"],
    definition: "No single religious tradition forms a clear majority in the reported figures. A country can have a largest group without that group making up more than half the population.",
    inAtlas: "Assigned when parsed top-level shares cover at least 80%, do not exceed 105%, and no known tradition exceeds 50%. Otherwise the category can remain unresolved.",
    caveat: "This does not mean ‘no religion’ or an even split, and it should not be confused with missing data.", sources: [factbookSnapshot] }),
  ...([
    ["christianity", "Christianity", "A religion centered on Jesus Christ and his life and teachings. Its major branches include Catholic, Orthodox and Protestant traditions."],
    ["islam", "Islam", "A religion centered on belief in one God and teachings that Muslims believe were revealed to the Prophet Muhammad. Sunni and Shia Islam are its largest branches."],
    ["hinduism", "Hinduism", "A diverse family of religious traditions that developed in South Asia. Hindu traditions differ in their deities, philosophies and practices; they do not share one founder or central authority."],
    ["buddhism", "Buddhism", "Religious traditions rooted in the Buddha’s teachings about suffering and the path to liberation. Buddhist communities differ in their beliefs, practices and institutions."],
    ["judaism", "Judaism", "The religious tradition of the Jewish people, rooted in the Torah and a covenant with God. Jewish religion, ancestry and cultural identity overlap but are not the same thing."],
    ["folk_or_traditional", "Folk / traditional religions", "A broad label for local or indigenous religious traditions that do not belong to one worldwide organized religion. These traditions differ enormously from place to place."],
    ["religiously_unaffiliated", "Religiously unaffiliated", "People who do not identify with an organized religion. Some are atheist or agnostic; others hold religious or spiritual beliefs without belonging to a religion."],
    ["religion_other", "Other religious traditions", "Religions that the map does not give their own named color. This means a tradition is grouped for display—not that it is unimportant or unknown."],
  ] as const).map(([id, label, definition]) => term({ id, label, group: "Religion", aliases: id === "religiously_unaffiliated" ? ["Unaffiliated"] : id === "folk_or_traditional" ? ["Folk or traditional"] : id === "religion_other" ? ["Other tradition"] : [], definition,
    inAtlas: "This is a broad display category derived from the archived Factbook description. Inspect the country’s composition for available percentages and original labels.",
    caveat: "Categories summarize a source; they do not define every resident’s identity or imply uniform practice.", sources: [
      ...(["christianity", "islam", "hinduism", "buddhism", "judaism"].includes(id) ? [{ title: `${label} · introduction and traditions`, publisher: "Harvard University · The Pluralism Project", url: `https://pluralism.org/${id}` }] : []),
      factbookSnapshot,
    ] })),
  term({ id: "disputed-territory", label: "Disputed territory", group: "Geography", aliases: ["Disputed", "Disputed status", "Contested status", "Partially recognized", "Disputed boundary"],
    definition: "A place whose ownership, borders or political status are contested. Who actually governs it and who is internationally recognized as sovereign may be different.",
    inAtlas: "A dashed outline asks you to inspect the place-specific status note. It follows the source feature’s outline; it is not a surveyed claim line or a statement that every edge is disputed.",
    caveat: "Map inclusion, color and the source’s ‘sovereign’ field do not establish legal sovereignty. This is a dated cartographic snapshot, not a live boundary or recognition service.", sources: [naturalEarth] }),
  term({ id: "political-geography", label: "Political geography", group: "Geography", aliases: ["Political", "Country or territory", "Country", "Sovereign country", "Sovereignty", "Indeterminate", "Status", "Natural Earth", "Neighbor contrast", "Modern borders"],
    definition: "How land is divided and governed. Atlas includes countries and separately mapped territories, so its 242 selectable places are not 242 universally recognized independent states.",
    inAtlas: "Natural Earth 1:50m Admin 0 version 5.1.2 supplies the boundaries and original classification. Natural Earth generally represents de facto control; the source snapshot is preserved.",
    caveat: "Source terms mix cartographic and political concepts. ‘Sovereignty’ is a source class, not a dispute flag; ‘Indeterminate’ also includes Antarctica’s treaty arrangement.", sources: [naturalEarth] }),
  term({ id: "physical-relief", label: "Physical relief", group: "Geography", aliases: ["Relief", "Shaded relief", "Terrain"],
    definition: "Shading that helps you see the shape of the land: mountains, valleys and plateaus. It gives a flat map a sense of height and depth.",
    inAtlas: "The physical background is a derived Natural Earth relief raster placed beneath the thematic layers. It gives geographic context; it is not an interactive three-dimensional elevation model.",
    caveat: "Shading is not a numerical altitude scale. Small terrain features depend on the resolution of the source and display asset.", sources: [{ title: "Natural Earth · shaded relief", publisher: "Natural Earth", url: "https://www.naturalearthdata.com/downloads/10m-raster-data/10m-shaded-relief/" }] }),
  term({ id: "major-cities", label: "Major cities", group: "Geography", aliases: ["Cities", "Populated places", "Capital"],
    definition: "Cities and capitals help you locate where people live within a country. The map shows a selection, with more names appearing as you zoom closer.",
    inAtlas: "Cities come from Natural Earth’s ranked populated-place dataset. Visibility changes with zoom so an overview does not show every point.",
    caveat: "A visible marker is not an urban boundary. Marker rank, city population and metropolitan population are different measures; not every settlement is included.", sources: [{ title: "Natural Earth · populated places", publisher: "Natural Earth", url: "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/" }] }),
  term({ id: "income-classification", label: "Income classification", group: "Reading the map", aliases: ["Income level", "Low income", "Lower middle income", "Upper middle income", "High income"],
    definition: "The World Bank sorts economies into low-, middle- and high-income groups using national income per person. This gives a broad comparison, not a description of every resident’s circumstances.",
    inAtlas: "Country details retain the income group supplied by the World Bank country-metadata snapshot. It is not calculated from the displayed GDP-per-capita layer.",
    caveat: "Income thresholds and assignments are updated over time. GNI, GDP, median income and household purchasing power are not interchangeable.", sources: [{ title: "World Bank · country and lending groups", publisher: "World Bank", url: "https://datahelpdesk.worldbank.org/knowledgebase/articles/906519-world-bank-country-and-lending-groups" }] }),
  term({ id: "logarithmic-scale", label: "Logarithmic scale", group: "Reading the map", aliases: ["Log scale", "Logarithmic", "Log1p"],
    definition: "A scale where equal steps represent the same multiplication, not the same addition. It lets you compare very small and very large numbers on one map.",
    inAtlas: "GDP per capita uses log10 interpolation. Population density uses log1p (logarithm after adding one), which can include zero. Read the legend’s actual numbers, not just distances between colors.",
    caveat: "Equal color steps do not mean equal arithmetic increases. The authored endpoints clamp extremes instead of giving outliers unlimited contrast.", sources: [worldBankGdp, ghsl] }),
  term({ id: "inherited", label: "Inherited observation", group: "Reading the map", aliases: ["Inherited"],
    definition: "A figure borrowed from a related place, rather than measured separately for this one. It can provide context, but it is not independent evidence.",
    inAtlas: "Observation status can distinguish inheritance from a direct observation. Where used, the source and notes should identify the parent and the reason.",
    caveat: "It must not be read as independent evidence about the smaller territory. Missing data is not automatically filled from a neighbor.", sources: [naturalEarth] }),
  term({ id: "observed", label: "Source observation", group: "Reading the map", aliases: ["Observed", "Observation year", "Source snapshot", "Snapshot"],
    definition: "A fact reported by a source at a particular time. Its date tells you when it applies—not necessarily when Atlas downloaded it.",
    inAtlas: "A statistical year, profile update date, retrieval date and event date are different things. Atlas retains those distinctions instead of presenting every fact as current today.",
    caveat: "‘Observed’ means supplied by the source; a national statistical series may itself include estimates. A government profile date does not establish when a government changed.", sources: [worldBankPopulation, factbookSnapshot] }),
];

function normalizeTerm(value: string): string {
  return value.trim().toLowerCase().replace(/[–—−]/g, "-").replace(/[_\s/-]+/g, " ").replace(/[().]/g, "");
}

const termLookup = new Map<string, AtlasGlossaryTerm>();
for (const entry of ATLAS_GLOSSARY) {
  for (const key of [entry.id, entry.label, ...entry.aliases]) termLookup.set(normalizeTerm(key), entry);
}

/** Context resolves the shared ‘other’ category without conflating government and religion. */
export function getAtlasGlossaryTerm(value: string, context?: "government" | "religion"): AtlasGlossaryTerm | null {
  if (value === "other" || value.toLowerCase() === "other") {
    return termLookup.get(normalizeTerm(context === "religion" ? "religion_other" : "government_other")) ?? null;
  }
  return termLookup.get(normalizeTerm(value)) ?? null;
}
