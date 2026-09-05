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
  sources: AtlasGlossarySource[];
  reviewedAt: "2026-09-04";
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

type TermInput = Omit<AtlasGlossaryTerm, "reviewedAt">;
function term(input: TermInput): AtlasGlossaryTerm {
  return { ...input, reviewedAt: "2026-09-04" };
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
    "A republic with an executive presidency institutionally separate from the legislature; the president commonly serves as both head of state and head of government.",
    "The archived government wording contains ‘presidential republic’, or the exact phrase ‘constitutional federal republic’. Explicit transitional, one-party and theocratic wording takes priority.",
    [presidentialSystems, factbookSnapshot]),
  government("parliamentary_republic", "Parliamentary republic",
    "A republic whose government depends on parliamentary support. The head of state and head of government are often different people.",
    "The source says ‘parliamentary republic’ or ‘parliamentary democracy’ without a higher-priority monarchy, dependency or other classification.",
    [parliamentarySystems, factbookSnapshot]),
  government("semi_presidential_republic", "Semi-presidential republic",
    "A system combining a president with substantive executive powers and a prime minister whose government is accountable to the legislature.",
    "The source uses ‘semi-presidential’ or ‘mixed presidential-parliamentary’. The balance between president and prime minister is not measured by this color.",
    [presidentialSystems, factbookSnapshot]),
  government("constitutional_monarchy", "Constitutional monarchy",
    "A monarchy operating within constitutional institutions. The monarch’s actual powers vary; in parliamentary monarchies, an accountable government exercises most executive authority.",
    "Groups source wording including ‘constitutional monarchy’, ‘Commonwealth realm’ and ‘co-principality’. This is a broader bucket than purely ceremonial monarchy.",
    [monarchies, factbookSnapshot]),
  government("absolute_monarchy", "Absolute monarchy",
    "A monarchy in which the monarch retains overriding governing authority rather than acting only as a ceremonial head of state.",
    "The source says ‘absolute monarchy’ or ‘sultanate’, after more-specific transitional, dependency, theocratic and one-party checks. The raw description remains available."),
  government("one_party_state", "One-party state",
    "A state whose political structure places governing power in a single party, rather than open competition for national executive power.",
    "The source explicitly uses one-party, single-party, communist party-led state or communist state wording. Atlas does not infer economic policy from this category."),
  government("military_or_transitional", "Military / transitional",
    "A display group for military-led government or an explicitly described transitional arrangement. Those are different situations, grouped here for an overview.",
    "The source contains military junta, military regime, military government, ‘in transition’ or ‘transitional government’. This rule takes priority over constitutional labels.",
    [factbookSnapshot], ["Military/transitional", "Military or transitional"]),
  government("theocracy", "Theocracy",
    "A political arrangement in which religious authority is directly part of the structure of supreme governing power.",
    "The source explicitly says ‘theocratic’ or ‘ecclesiastical elective monarchy’. A religious population or an official religion alone does not trigger this label."),
  government("territory_or_dependency", "Territory / dependency",
    "A place with a constitutional relationship to another state, rather than a separately represented sovereign government. Arrangements and local autonomy differ substantially.",
    "The Government lens groups explicit territorial, overseas, special-administrative-region and specified kingdom/sovereignty wording. The geographic source’s dependency classification is a separate field.",
    [factbookSnapshot, naturalEarth], ["Territory/dependency", "Territory or dependency", "Dependency", "Territory"]),
  government("government_other", "Other government form",
    "The source supplies a government description that does not fit the current broad buckets, or describes multiple arrangements.",
    "This is an unresolved classification, not evidence that the place has an unusual, weak or absent government.",
    [factbookSnapshot], ["Other / unclassified", "Other / complex", "Other system"]),
  term({ id: "government", label: "Government form", group: "Government", aliases: ["Government", "Government type", "Political system"],
    definition: "A broad description of how executive and state institutions are organized, such as a presidential republic or constitutional monarchy.",
    inAtlas: "Explicit phrases in the archived Factbook profile are mapped to a small set of readable categories. Transitional, territorial, theocratic and one-party language can take priority over a constitutional description.",
    caveat: "One color cannot measure institutional practice, electoral competition, civil liberties, state capacity or political economy. Read the original description and observation date.", sources: [factbookSnapshot, presidentialSystems] }),
  term({ id: "unknown", label: "Not available", group: "Reading the map", aliases: ["Unknown", "Unavailable", "No data", "No comparable data", "Missing data"],
    definition: "Atlas has no usable observation or cannot assign a comparable category for this place and lens.",
    inAtlas: "Missing observations have their own styling. They are not zero and are not the lowest category on a quantitative scale.",
    caveat: "A blank value can mean a coverage gap, an unresolved source, or a measure that is not applicable. It does not mean the phenomenon is absent.", sources: [worldBankPopulation, factbookSnapshot] }),
  term({ id: "gdp-per-capita", label: "GDP per capita", group: "Reading the map", aliases: ["GDP/person", "GDP per person", "GDP per capita (current US$)", "Current US$"],
    definition: "The value of production in an economy during a year, divided by its population. Atlas shows current US dollars, using exchange-rate conversion.",
    inAtlas: "The latest available World Bank NY.GDP.PCAP.CD observation for each place drives a logarithmic color scale. The year is shown because countries may have different latest years.",
    caveat: "This is not a typical person’s income, household wealth or a purchasing-power-adjusted living-standard measure. Exchange rates, cross-border production and unequal distribution matter.", sources: [worldBankGdp] }),
  term({ id: "gdp", label: "GDP", group: "Reading the map", aliases: ["Gross domestic product", "GDP (current US$)"],
    definition: "Gross domestic product measures the value generated by production within an economy over a period, usually a year.",
    inAtlas: "Country details use the World Bank’s current-US-dollar national-accounts series, with the observation year retained.",
    caveat: "GDP is a flow of production, not a stock of wealth. Current-dollar values are not adjusted for inflation or differences in local purchasing power.", sources: [worldBankGdp] }),
  term({ id: "population", label: "Population", group: "Reading the map", aliases: ["National population", "Population total"],
    definition: "The total number of people estimated to live in a country or territory, not how closely together they live.",
    inAtlas: "National totals come from the latest available World Bank observation, with GeoNames as a labeled fallback. Where People Live is a separate gridded model.",
    caveat: "The country total and the 2025 density grid can use different methods and years; they should not be treated as the same observation.", sources: [worldBankPopulation, ghsl] }),
  term({ id: "population-density", label: "Population density", group: "Reading the map", aliases: ["Density", "People/km²", "People per km²", "Gridded population density"],
    definition: "People per unit of area. A spatial density grid reveals concentrations within countries that a national average would hide.",
    inAtlas: "Where People Live uses the 2025 epoch of GHS-POP R2023A, based on a one-kilometre equal-area source grid. Display pixels aggregate source cells at world scale.",
    caveat: "It is a modeled distribution, not a census taken independently in each cell. The 2025 epoch is a projection; zooming does not create new source detail.", sources: [ghsl] }),
  term({ id: "modeled-estimate", label: "Modeled estimate", group: "Reading the map", aliases: ["Modelled estimate", "Modeled", "Modelled", "Estimated", "Projection", "2025 estimate"],
    definition: "A value estimated through a model using observations and assumptions, rather than directly measured at every displayed location.",
    inAtlas: "The population grid redistributes population inputs using built-up-area information and includes projected epochs. Its source, version and observation year remain attached to the layer.",
    caveat: "A visually precise grid does not mean equally precise knowledge. Input age, resolution and model assumptions affect local accuracy.", sources: [ghsl] }),
  term({ id: "dominant-religion", label: "Dominant religious tradition", group: "Religion", aliases: ["Dominant tradition", "Religion", "Largest religion"],
    definition: "A broad tradition used to summarize religious composition for a readable world map—not the only religion present.",
    inAtlas: "With usable percentages, a tradition above 50% supplies the color. Without them, explicit source descriptions can supply a qualitative label. Otherwise Atlas keeps mixed or unresolved values.",
    caveat: "National sources differ in year, survey method and whether identities can overlap. Inspect composition and raw wording before comparing close percentages.", sources: [factbookSnapshot] }),
  term({ id: "religious-composition", label: "Religious composition", group: "Religion", aliases: ["Composition", "Religious share", "Religion percentages"],
    definition: "The reported shares of a population associated with different religious traditions or no religion.",
    inAtlas: "Existing Factbook percentages are grouped into broad traditions without reconstructing denominations. Reported shares remain visible even when the map cannot safely assign one dominant color.",
    caveat: "Categories can overlap, notably when a source counts practice rather than exclusive identity. Bars are not automatically normalized to 100%; overlapping or partial reports are flagged.", sources: [factbookSnapshot] }),
  term({ id: "mixed_or_no_clear_majority", label: "Mixed / no clear majority", group: "Religion", aliases: ["Mixed/no clear majority", "Mixed", "No clear majority"],
    definition: "No single broad tradition exceeds half of the usable reported composition.",
    inAtlas: "Assigned when parsed top-level shares cover at least 80%, do not exceed 105%, and no known tradition exceeds 50%. Otherwise the category can remain unresolved.",
    caveat: "This does not mean ‘no religion’ or an even split, and it should not be confused with missing data.", sources: [factbookSnapshot] }),
  ...([
    ["christianity", "Christianity", "Groups source labels for Christian traditions, including Catholic, Protestant and Orthodox affiliations."],
    ["islam", "Islam", "Groups Muslim affiliations into a broad tradition. This layer does not reconstruct Sunni, Shia or other denominational shares."],
    ["hinduism", "Hinduism", "Groups the source’s Hindu affiliations. A single color does not describe the diversity of beliefs or practices within that group."],
    ["buddhism", "Buddhism", "Groups the source’s Buddhist affiliations. The displayed share depends on how the source asks about identity or practice."],
    ["judaism", "Judaism", "Represents the source’s reported Jewish religious category, not a separate estimate of ethnicity or ancestry."],
    ["folk_or_traditional", "Folk / traditional religions", "An overview grouping of source labels for indigenous, folk and traditional religious practices. These are not one unified religion."],
    ["religiously_unaffiliated", "Religiously unaffiliated", "Groups source labels such as no religion, atheist and agnostic. It does not imply that everyone in the category has identical beliefs."],
    ["religion_other", "Other religious traditions", "Collects reported religious labels not assigned to the current named broad traditions. Unknown or unparsed values are kept separate."],
  ] as const).map(([id, label, definition]) => term({ id, label, group: "Religion", aliases: id === "religiously_unaffiliated" ? ["Unaffiliated"] : id === "folk_or_traditional" ? ["Folk or traditional"] : id === "religion_other" ? ["Other tradition"] : [], definition,
    inAtlas: "This is a broad display category derived from the archived Factbook description. Inspect the country’s composition for available percentages and original labels.",
    caveat: "Categories summarize a source; they do not define every resident’s identity or imply uniform practice.", sources: [factbookSnapshot] })),
  term({ id: "disputed-territory", label: "Disputed territory", group: "Geography", aliases: ["Disputed", "Disputed status", "Contested status", "Partially recognized", "Disputed boundary"],
    definition: "A place where claims to territory, political status or recognition differ. Those disagreements need not have the same legal or practical form.",
    inAtlas: "A dashed outline asks you to inspect the place-specific status note. It follows the source feature’s outline; it is not a surveyed claim line or a statement that every edge is disputed.",
    caveat: "Map inclusion, color and the source’s ‘sovereign’ field do not establish legal sovereignty. This is a dated cartographic snapshot, not a live boundary or recognition service.", sources: [naturalEarth] }),
  term({ id: "political-geography", label: "Political geography", group: "Geography", aliases: ["Political", "Country or territory", "Country", "Sovereign country", "Sovereignty", "Indeterminate", "Status", "Natural Earth", "Neighbor contrast", "Modern borders"],
    definition: "The map’s 242 units include countries, dependencies and separately mapped territories. They are geographic units, not a list of 242 universally recognized states.",
    inAtlas: "Natural Earth 1:50m Admin 0 version 5.1.2 supplies the boundaries and original classification. Natural Earth generally represents de facto control; the source snapshot is preserved.",
    caveat: "Source terms mix cartographic and political concepts. ‘Sovereignty’ is a source class, not a dispute flag; ‘Indeterminate’ also includes Antarctica’s treaty arrangement.", sources: [naturalEarth] }),
  term({ id: "physical-relief", label: "Physical relief", group: "Geography", aliases: ["Relief", "Shaded relief", "Terrain"],
    definition: "Shading that makes broad landforms and elevation changes perceptible on a flat map.",
    inAtlas: "The physical background is a derived Natural Earth relief raster placed beneath the thematic layers. It gives geographic context; it is not an interactive three-dimensional elevation model.",
    caveat: "Shading is not a numerical altitude scale. Small terrain features depend on the resolution of the source and display asset.", sources: [{ title: "Natural Earth · shaded relief", publisher: "Natural Earth", url: "https://www.naturalearthdata.com/downloads/10m-raster-data/10m-shaded-relief/" }] }),
  term({ id: "major-cities", label: "Major cities", group: "Geography", aliases: ["Cities", "Populated places", "Capital"],
    definition: "A selected set of populated places that help locate national capitals and major urban centers.",
    inAtlas: "Cities come from Natural Earth’s ranked populated-place dataset. Visibility changes with zoom so an overview does not show every point.",
    caveat: "A visible marker is not an urban boundary. Marker rank, city population and metropolitan population are different measures; not every settlement is included.", sources: [{ title: "Natural Earth · populated places", publisher: "Natural Earth", url: "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/" }] }),
  term({ id: "income-classification", label: "Income classification", group: "Reading the map", aliases: ["Income level", "Low income", "Lower middle income", "Upper middle income", "High income"],
    definition: "The World Bank’s grouping of economies by gross national income per person using its Atlas conversion method.",
    inAtlas: "Country details retain the income group supplied by the World Bank country-metadata snapshot. It is not calculated from the displayed GDP-per-capita layer.",
    caveat: "Income thresholds and assignments are updated over time. GNI, GDP, median income and household purchasing power are not interchangeable.", sources: [{ title: "World Bank · country and lending groups", publisher: "World Bank", url: "https://datahelpdesk.worldbank.org/knowledgebase/articles/906519-world-bank-country-and-lending-groups" }] }),
  term({ id: "logarithmic-scale", label: "Logarithmic scale", group: "Reading the map", aliases: ["Log scale", "Logarithmic", "Log1p"],
    definition: "A scale that gives proportional changes more similar visual space, making small and large values readable together.",
    inAtlas: "GDP per capita uses log10 interpolation. Population density uses log1p (logarithm after adding one), which can include zero. Read the legend’s actual numbers, not just distances between colors.",
    caveat: "Equal color steps do not mean equal arithmetic increases. The authored endpoints clamp extremes instead of giving outliers unlimited contrast.", sources: [worldBankGdp, ghsl] }),
  term({ id: "inherited", label: "Inherited observation", group: "Reading the map", aliases: ["Inherited"],
    definition: "A value reused from a related place instead of measured independently for this entity.",
    inAtlas: "Observation status can distinguish inheritance from a direct observation. Where used, the source and notes should identify the parent and the reason.",
    caveat: "It must not be read as independent evidence about the smaller territory. Missing data is not automatically filled from a neighbor.", sources: [naturalEarth] }),
  term({ id: "observed", label: "Source observation", group: "Reading the map", aliases: ["Observed", "Observation year", "Source snapshot", "Snapshot"],
    definition: "A value or statement recorded by a named source at a specified time.",
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
