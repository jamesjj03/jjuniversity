import { ATLAS_VIEW_PRESET_BY_ID } from "./layers/catalog";

export type AtlasViewCategoryId =
  | "foundations"
  | "people"
  | "institutions"
  | "economy";

export type AtlasViewNavigationItem = {
  id: string;
  categoryId: AtlasViewCategoryId;
  summary: string;
  searchTerms?: string[];
  icon: string;
  shortcut: number | null;
  relatedViewIds: string[];
};

export const ATLAS_VIEW_CATEGORIES: ReadonlyArray<{
  id: AtlasViewCategoryId;
  name: string;
}> = [
  { id: "foundations", name: "World" },
  { id: "people", name: "People" },
  { id: "institutions", name: "Institutions" },
  { id: "economy", name: "Economy" },
];

/**
 * The browsing order is authored rather than inherited from the data catalog.
 * It is the adjacent-view order, the keyboard 1–9 order, and the compact
 * navigation hierarchy shown on phones.
 */
export const ATLAS_VIEW_NAVIGATION: readonly AtlasViewNavigationItem[] = [
  {
    id: "political",
    categoryId: "foundations",
    summary: "Countries, territories and borders",
    searchTerms: ["states", "boundaries", "sovereignty"],
    icon: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5zm6-2v16m6-14v16",
    shortcut: 1,
    relatedViewIds: ["government", "population-density"],
  },
  {
    id: "population-density",
    categoryId: "foundations",
    summary: "Settlement, cities and the geography beneath them",
    searchTerms: ["where people live", "settlement", "rivers", "cities"],
    icon: "M2 19l5-7 4 4 4-11 7 14M2 22h20M6 7h.01M10 4h.01M20 9h.01",
    shortcut: 2,
    relatedViewIds: ["population", "urbanization"],
  },
  {
    id: "population",
    categoryId: "people",
    summary: "The number of people in each country",
    searchTerms: ["total population", "people"],
    icon: "M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7 0a3 3 0 0 0 0-6M2 21v-5a7 7 0 0 1 14 0v5m4 0v-5a7 7 0 0 0-2-5",
    shortcut: 3,
    relatedViewIds: ["population-density", "population-growth", "children-share"],
  },
  {
    id: "population-growth",
    categoryId: "people",
    summary: "Annual population growth and decline",
    searchTerms: ["growing", "shrinking", "demographic change"],
    icon: "M4 18 10 12l4 4 6-9M15 7h5v5",
    shortcut: 4,
    relatedViewIds: ["fertility", "children-share", "older-population"],
  },
  {
    id: "children-share",
    categoryId: "people",
    summary: "The population share aged 0–14",
    searchTerms: ["young", "youth", "children"],
    icon: "M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 22a8 8 0 0 1 16 0",
    shortcut: 5,
    relatedViewIds: ["fertility", "population-growth", "older-population"],
  },
  {
    id: "older-population",
    categoryId: "people",
    summary: "The population share aged 65 and over",
    searchTerms: ["old", "aging", "elderly", "seniors"],
    icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 22a7 7 0 0 1 14 0M17 3l2 2 3-3",
    shortcut: 6,
    relatedViewIds: ["life-expectancy", "population-growth", "children-share"],
  },
  {
    id: "fertility",
    categoryId: "people",
    summary: "Period fertility rates, measured in births per woman",
    searchTerms: ["births", "replacement rate"],
    icon: "M12 3v5m-2.5-2.5h5M7 14a5 5 0 1 0 10 0 5 5 0 0 0-10 0z",
    shortcut: 7,
    relatedViewIds: ["population-growth", "children-share", "gdp-per-capita"],
  },
  {
    id: "life-expectancy",
    categoryId: "people",
    summary: "Expected years of life at birth",
    searchTerms: ["longevity", "lifespan", "health"],
    icon: "M3 12h4l2-5 4 10 2-5h6M4 20h16",
    shortcut: 8,
    relatedViewIds: ["gdp-per-capita", "older-population"],
  },
  {
    id: "urbanization",
    categoryId: "people",
    summary: "The share living in nationally defined urban areas",
    searchTerms: ["urban", "cities", "city population"],
    icon: "M3 21V9l6-4v16m0-10 6-4v14m0-9 6-3v12M6 12h.01M6 16h.01m6-2h.01m0 4h.01m6-3h.01m0 3h.01",
    shortcut: 9,
    relatedViewIds: ["population-density", "gdp-per-capita"],
  },
  {
    id: "government",
    categoryId: "institutions",
    summary: "How national governments are organized",
    searchTerms: ["politics", "political system", "republic", "monarchy"],
    icon: "M2 8l10-6 10 6H2zm3 3v8m7-8v8m7-8v8M2 22h20",
    shortcut: null,
    relatedViewIds: ["political", "religion"],
  },
  {
    id: "religion",
    categoryId: "institutions",
    summary: "Broad religious traditions and their composition",
    searchTerms: ["faith", "belief", "Christianity", "Islam"],
    icon: "M12 2v5m-3-2h6M3 22V12l9-5 9 5v10M8 22v-7h8v7M3 22h18",
    shortcut: null,
    relatedViewIds: ["political", "government"],
  },
  {
    id: "gdp-per-capita",
    categoryId: "economy",
    summary: "Economic output per person",
    searchTerms: ["wealth", "income", "economy", "GDP person"],
    icon: "M3 21h19M5 17v-5h3v5m4 0V7h3v10m4 0V2h3v15",
    shortcut: null,
    relatedViewIds: ["life-expectancy", "urbanization", "fertility"],
  },
];

export const ATLAS_VIEW_NAVIGATION_BY_ID = new Map(
  ATLAS_VIEW_NAVIGATION.map((item) => [item.id, item]),
);

export function atlasViewName(viewId: string) {
  return ATLAS_VIEW_PRESET_BY_ID.get(viewId)?.name ?? viewId;
}

export function atlasAdjacentViewId(viewId: string, direction: -1 | 1) {
  const index = ATLAS_VIEW_NAVIGATION.findIndex((item) => item.id === viewId);
  if (index < 0) return ATLAS_VIEW_NAVIGATION[0].id;
  return ATLAS_VIEW_NAVIGATION[
    (index + direction + ATLAS_VIEW_NAVIGATION.length) % ATLAS_VIEW_NAVIGATION.length
  ].id;
}

export function atlasRelatedViews(viewId: string) {
  return (ATLAS_VIEW_NAVIGATION_BY_ID.get(viewId)?.relatedViewIds ?? [])
    .map((id) => ATLAS_VIEW_PRESET_BY_ID.get(id))
    .filter((view): view is NonNullable<typeof view> => Boolean(view));
}
