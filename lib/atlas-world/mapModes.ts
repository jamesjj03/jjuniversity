import type {
  AtlasGovernmentCategory,
  AtlasReligionCategory,
} from "./types";
import type { AtlasRuntimeCountry, AtlasRuntimeCountrySummary } from "./runtime";

export type AtlasMapModeId = "political" | "government" | "religion" | "population";
export type AtlasMapVisualization = "categorical" | "continuous" | "percentage" | "binary" | "historical";

export type AtlasResolvedMapValue = {
  key: string;
  label: string;
  tooltip: string;
  numericValue?: number;
};

export type AtlasMapLegendItem = {
  key: string;
  label: string;
  color: string;
};

export type AtlasMapModeContext = {
  country: AtlasRuntimeCountry | AtlasRuntimeCountrySummary;
  mapColor7: number | null;
};

export type AtlasMapMode = {
  id: AtlasMapModeId;
  name: string;
  description: string;
  visualization: AtlasMapVisualization;
  sourceIds: string[];
  missingData: {
    label: string;
    color: string;
  };
  legend: AtlasMapLegendItem[];
  resolve: (context: AtlasMapModeContext) => AtlasResolvedMapValue | null;
  color: (context: AtlasMapModeContext) => string;
};

const POLITICAL_COLORS = [
  "#587d78",
  "#9a7456",
  "#6f719d",
  "#9a8d56",
  "#5b7793",
  "#976976",
  "#638367",
];

const GOVERNMENT: Record<AtlasGovernmentCategory, { label: string; color: string }> = {
  presidential_republic: { label: "Presidential republic", color: "#4f8b83" },
  parliamentary_republic: { label: "Parliamentary republic", color: "#6f88b5" },
  semi_presidential_republic: { label: "Semi-presidential republic", color: "#7c72ad" },
  constitutional_monarchy: { label: "Constitutional monarchy", color: "#b88c54" },
  absolute_monarchy: { label: "Absolute monarchy", color: "#a75f55" },
  one_party_state: { label: "One-party state", color: "#955565" },
  military_or_transitional: { label: "Military or transitional", color: "#7d5a51" },
  theocracy: { label: "Theocracy", color: "#8a6e3c" },
  territory_or_dependency: { label: "Territory or dependency", color: "#68757d" },
  other: { label: "Other system", color: "#7e7784" },
  unknown: { label: "No classification", color: "#343c40" },
};

const RELIGION: Record<AtlasReligionCategory, { label: string; color: string }> = {
  christianity: { label: "Christianity", color: "#b4834d" },
  islam: { label: "Islam", color: "#4d8a70" },
  hinduism: { label: "Hinduism", color: "#bc6f43" },
  buddhism: { label: "Buddhism", color: "#b5a34f" },
  judaism: { label: "Judaism", color: "#6888b3" },
  folk_or_traditional: { label: "Folk or traditional", color: "#836c51" },
  religiously_unaffiliated: { label: "Religiously unaffiliated", color: "#798594" },
  other: { label: "Other tradition", color: "#8b6f8d" },
  mixed_or_no_clear_majority: { label: "Mixed / no clear majority", color: "#806c78" },
  unknown: { label: "No classification", color: "#343c40" },
};

const POPULATION_BUCKETS = [
  { key: "under_1m", label: "Under 1 million", color: "#335159", max: 1_000_000 },
  { key: "1m_10m", label: "1–10 million", color: "#3e6e6c", max: 10_000_000 },
  { key: "10m_50m", label: "10–50 million", color: "#589078", max: 50_000_000 },
  { key: "50m_150m", label: "50–150 million", color: "#9b9c62", max: 150_000_000 },
  { key: "150m_plus", label: "150 million or more", color: "#c27e50", max: Number.POSITIVE_INFINITY },
];

const formatCompact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function politicalColor(mapColor7: number | null) {
  const index = mapColor7 == null ? 0 : Math.abs(mapColor7) % POLITICAL_COLORS.length;
  return POLITICAL_COLORS[index];
}

function governmentValue(country: AtlasRuntimeCountry | AtlasRuntimeCountrySummary): AtlasResolvedMapValue | null {
  const government = country.facts.government?.value;
  if (!government) return null;
  const category = GOVERNMENT[government.category];
  return {
    key: government.category,
    label: category.label,
    tooltip: category.label,
  };
}

function religionValue(country: AtlasRuntimeCountry | AtlasRuntimeCountrySummary): AtlasResolvedMapValue | null {
  const religion = country.facts.religion?.value;
  if (!religion || religion.dominantCategory === "unknown") return null;
  const category = RELIGION[religion.dominantCategory];
  const dominantShare = religion.composition.find(
    (entry) => entry.category === religion.dominantCategory,
  )?.sharePercent;
  return {
    key: religion.dominantCategory,
    label: category.label,
    tooltip: dominantShare == null ? category.label : `${category.label} · ${dominantShare}%`,
    numericValue: dominantShare,
  };
}

function populationValue(country: AtlasRuntimeCountry | AtlasRuntimeCountrySummary): AtlasResolvedMapValue | null {
  const population = country.facts.population?.value;
  if (population == null) return null;
  const bucket = POPULATION_BUCKETS.find((item) => population < item.max) ?? POPULATION_BUCKETS.at(-1)!;
  return {
    key: bucket.key,
    label: bucket.label,
    tooltip: formatCompact.format(population),
    numericValue: population,
  };
}

export const ATLAS_MAP_MODES: AtlasMapMode[] = [
  {
    id: "political",
    name: "Political",
    description: "Countries and territories, differentiated for geographic exploration.",
    visualization: "categorical",
    sourceIds: ["natural-earth-admin-0-50m-5.1.2"],
    missingData: { label: "Unclassified", color: "#485258" },
    legend: POLITICAL_COLORS.map((color, index) => ({
      key: String(index),
      label: "Neighbor contrast",
      color,
    })),
    resolve: ({ mapColor7 }) => ({
      key: String(mapColor7 ?? 0),
      label: "Country or territory",
      tooltip: "Country or territory",
    }),
    color: ({ mapColor7 }) => politicalColor(mapColor7),
  },
  {
    id: "government",
    name: "Government",
    description: "Broad current government form, with original source wording retained for each place.",
    visualization: "categorical",
    sourceIds: ["cia-world-factbook-final-capture-2026-02"],
    missingData: { label: "No current classification", color: GOVERNMENT.unknown.color },
    legend: (Object.entries(GOVERNMENT) as [AtlasGovernmentCategory, (typeof GOVERNMENT)[AtlasGovernmentCategory]][])
      .filter(([key]) => key !== "unknown")
      .map(([key, value]) => ({ key, ...value })),
    resolve: ({ country }) => governmentValue(country),
    color: ({ country }) => {
      const value = governmentValue(country);
      return value ? GOVERNMENT[value.key as AtlasGovernmentCategory].color : GOVERNMENT.unknown.color;
    },
  },
  {
    id: "religion",
    name: "Religion",
    description: "Dominant broad tradition. Country panels preserve the underlying composition and survey year.",
    visualization: "categorical",
    sourceIds: ["cia-world-factbook-final-capture-2026-02"],
    missingData: { label: "No defensible classification", color: RELIGION.unknown.color },
    legend: (Object.entries(RELIGION) as [AtlasReligionCategory, (typeof RELIGION)[AtlasReligionCategory]][])
      .filter(([key]) => key !== "unknown")
      .map(([key, value]) => ({ key, ...value })),
    resolve: ({ country }) => religionValue(country),
    color: ({ country }) => {
      const value = religionValue(country);
      return value ? RELIGION[value.key as AtlasReligionCategory].color : RELIGION.unknown.color;
    },
  },
  {
    id: "population",
    name: "Population",
    description: "Population intensity using the latest World Bank observation in this snapshot.",
    visualization: "continuous",
    sourceIds: ["world-bank-sp-pop-totl-2026-07-13"],
    missingData: { label: "No World Bank observation", color: "#343c40" },
    legend: POPULATION_BUCKETS.map(({ key, label, color }) => ({ key, label, color })),
    resolve: ({ country }) => populationValue(country),
    color: ({ country }) => {
      const value = populationValue(country);
      return POPULATION_BUCKETS.find((bucket) => bucket.key === value?.key)?.color ?? "#343c40";
    },
  },
];

export const ATLAS_MAP_MODE_BY_ID = new Map(ATLAS_MAP_MODES.map((mode) => [mode.id, mode]));

export function isAtlasMapModeId(value: string | null): value is AtlasMapModeId {
  return value != null && ATLAS_MAP_MODE_BY_ID.has(value as AtlasMapModeId);
}
