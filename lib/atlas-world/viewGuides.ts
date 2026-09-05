export type AtlasViewGuide = {
  viewId: string;
  plainMeaning: string;
  whyItMatters: string;
  caution: string;
};

const guides: AtlasViewGuide[] = [
  {
    viewId: "population-density",
    plainMeaning: "Brighter areas contain more people within the same amount of land.",
    whyItMatters: "Dense settlement often traces coasts, rivers, fertile plains, transport corridors, and major cities.",
    caution: "This is a modelled 2025 grid, not a headcount at every point. Brightness does not measure wealth or quality of life.",
  },
  {
    viewId: "population",
    plainMeaning: "Color groups places by their total resident population.",
    whyItMatters: "Population size helps explain the scale of public services, markets, representation, and human impact.",
    caution: "A large total can occupy a vast area. Use Population density to see where people are concentrated within a country.",
  },
  {
    viewId: "urbanization",
    plainMeaning: "This is the share of people living in areas their country classifies as urban.",
    whyItMatters: "It changes how people reach work, housing, transport, health care, and public services.",
    caution: "Countries define “urban” differently. A high share is not automatically evidence of wealth or good living conditions.",
  },
  {
    viewId: "population-growth",
    plainMeaning: "Positive values mean the population grew during the year; negative values mean it shrank.",
    whyItMatters: "Growth changes demand for housing, schools, jobs, infrastructure, and land.",
    caution: "Births, deaths, and migration all affect this rate. One year does not establish a lasting trend.",
  },
  {
    viewId: "children-share",
    plainMeaning: "This is the share of the population from birth through age 14.",
    whyItMatters: "A high share often means heavy near-term demand for schools and a large cohort entering the workforce later.",
    caution: "It does not tell us how many children there are without the total population, or why the age structure formed.",
  },
  {
    viewId: "older-population",
    plainMeaning: "This is the share of the population age 65 and older.",
    whyItMatters: "It can reshape health care, pensions, the workforce, housing, and family care.",
    caution: "A high share is not the same as poor health, and national totals can hide large regional differences.",
  },
  {
    viewId: "fertility",
    plainMeaning: "The rate estimates how many children a woman would have if current age-specific birth rates continued through her life.",
    whyItMatters: "Fertility strongly influences future age structure and, over time, population growth.",
    caution: "It is not the number of children every woman has. Replacement level varies, and migration can make growth diverge from fertility.",
  },
  {
    viewId: "life-expectancy",
    plainMeaning: "This estimates the years a newborn would live if current age-specific death rates continued.",
    whyItMatters: "It summarizes mortality conditions across infancy, adulthood, and old age in one comparable measure.",
    caution: "It is not a forecast of when a person alive today will die, and a national average hides inequality within a country.",
  },
  {
    viewId: "gdp-per-capita",
    plainMeaning: "This divides a country’s annual economic output by its population.",
    whyItMatters: "It offers a rough view of productive scale per person and is useful for comparing broad economic patterns.",
    caution: "It is not household income, does not show distribution, and current US dollars do not adjust for local prices.",
  },
  {
    viewId: "religion",
    plainMeaning: "Color shows the broad religious tradition with the largest reported share or the source’s stated dominant tradition.",
    whyItMatters: "Regional patterns can reveal the long reach of migration, empire, trade, mission, state policy, and local tradition.",
    caution: "Broad color cannot describe every person. Source years, categories, and denominators differ among countries.",
  },
  {
    viewId: "government",
    plainMeaning: "Color groups the formal structure of national government into a small reviewable set of broad forms.",
    whyItMatters: "It shows how executive and legislative authority are constitutionally arranged across the world.",
    caution: "Formal government type does not measure democracy, liberty, capacity, ideology, or how power works in practice.",
  },
  {
    viewId: "political",
    plainMeaning: "Color separates neighboring political and geographic units so the world is easy to navigate.",
    whyItMatters: "Stable country colors help build visual memory while boundaries and territorial notes preserve geographic context.",
    caution: "Political colors do not represent alliances, ideology, legal recognition, or similarity between countries.",
  },
];

export const ATLAS_VIEW_GUIDES = guides;
export const ATLAS_VIEW_GUIDE_BY_ID = new Map(guides.map((guide) => [guide.viewId, guide]));
