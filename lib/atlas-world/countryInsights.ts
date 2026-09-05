import type {
  AtlasRuntimeCountrySummary,
  AtlasRuntimeFact,
} from "./runtime";
import { atlasObservationStatusHasValue } from "./types";

export type AtlasComparableCountryFact =
  | "population"
  | "gdpPerCapitaCurrentUsd"
  | "urbanPopulationPercent"
  | "populationGrowthAnnualPercent"
  | "populationAges0To14Percent"
  | "populationAges65PlusPercent"
  | "fertilityRateBirthsPerWoman"
  | "lifeExpectancyYears";

export type AtlasCountryRank = {
  rank: number;
  total: number;
  percentile: number;
};

export type AtlasCountryInsight = {
  fact: AtlasComparableCountryFact;
  global: AtlasCountryRank;
  regional: AtlasCountryRank | null;
  region: string | null;
  observedAt: string | null;
  comparisonNote: string;
};

type ComparableEntry = {
  country: AtlasRuntimeCountrySummary;
  fact: AtlasRuntimeFact<number>;
};

function comparableEntries(
  countries: readonly AtlasRuntimeCountrySummary[],
  fact: AtlasComparableCountryFact,
) {
  return countries.flatMap<ComparableEntry>((country) => {
    const observation = country.facts[fact] as AtlasRuntimeFact<number> | null;
    return observation
      && atlasObservationStatusHasValue(observation.status)
      && Number.isFinite(observation.value)
      ? [{ country, fact: observation }]
      : [];
  });
}

function rankEntry(entries: readonly ComparableEntry[], countryId: string): AtlasCountryRank | null {
  const selected = entries.find((entry) => entry.country.id === countryId);
  if (!selected) return null;
  const total = entries.length;
  const higher = entries.filter((entry) => entry.fact.value > selected.fact.value).length;
  const equal = entries.filter((entry) => entry.fact.value === selected.fact.value).length;
  // Competition ranking gives equal sourced values the same rank. The
  // percentile uses the middle of the tied positions so alphabetical order
  // can never manufacture a regional lead or a more extreme comparison note.
  const averageIndex = higher + (equal - 1) / 2;
  return {
    rank: higher + 1,
    total,
    // 1 means the top reported value and 0 means the bottom reported value.
    percentile: total <= 1 ? 1 : 1 - averageIndex / (total - 1),
  };
}

function comparisonNote(rank: AtlasCountryRank) {
  if (rank.total < 20) return `Ranks ${rank.rank} of ${rank.total} reported Atlas entities.`;
  if (rank.percentile >= 0.9) return `Among the highest 10% of reported Atlas entities.`;
  if (rank.percentile <= 0.1) return `Among the lowest 10% of reported Atlas entities.`;
  if (rank.percentile >= 0.75) return `In the highest quarter of reported Atlas entities.`;
  if (rank.percentile <= 0.25) return `In the lowest quarter of reported Atlas entities.`;
  return `Near the middle of reported Atlas entities.`;
}

/**
 * Ranks one sourced national value among other values currently present in the
 * same Atlas snapshot. This is descriptive only: it does not impute gaps,
 * combine unlike measures, or claim that a high rank is desirable.
 */
export function getAtlasCountryInsight(
  countries: readonly AtlasRuntimeCountrySummary[],
  countryId: string,
  fact: AtlasComparableCountryFact,
): AtlasCountryInsight | null {
  const entries = comparableEntries(countries, fact);
  const selected = entries.find((entry) => entry.country.id === countryId);
  if (!selected) return null;
  const global = rankEntry(entries, countryId);
  if (!global) return null;
  const region = selected.country.geography.region || null;
  const regionalEntries = region
    ? entries.filter((entry) => entry.country.geography.region === region)
    : [];
  const regional = regionalEntries.length >= 5
    ? rankEntry(regionalEntries, countryId)
    : null;
  return {
    fact,
    global,
    regional,
    region,
    observedAt: selected.fact.observedAt,
    comparisonNote: comparisonNote(global),
  };
}

export function getAtlasCountryInsights(
  countries: readonly AtlasRuntimeCountrySummary[],
  countryId: string,
) {
  const facts: AtlasComparableCountryFact[] = [
    "population",
    "gdpPerCapitaCurrentUsd",
    "urbanPopulationPercent",
    "populationGrowthAnnualPercent",
    "populationAges0To14Percent",
    "populationAges65PlusPercent",
    "fertilityRateBirthsPerWoman",
    "lifeExpectancyYears",
  ];
  return new Map(facts.flatMap((fact) => {
    const insight = getAtlasCountryInsight(countries, countryId, fact);
    return insight ? [[fact, insight] as const] : [];
  }));
}
