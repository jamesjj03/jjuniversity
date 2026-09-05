import {
  ATLAS_DATASET_BY_ID,
  ATLAS_LAYER_BY_ID,
  ATLAS_VIEW_PRESET_BY_ID,
} from "./layers/catalog";
import type {
  AtlasContinuousLegend,
  AtlasLayerDataResponse,
  AtlasLayerDatum,
  AtlasViewPreset,
} from "./layers/contracts";
import { atlasObservationStatusHasValue } from "./types";

export type AtlasComparisonSide = "a" | "b";

export type AtlasComparisonDefinition = {
  id: string;
  name: string;
  question: string;
  interpretation: string;
  caveat: string;
  calculationNote?: string;
  a: { viewId: string; shortLabel: string };
  b: { viewId: string; shortLabel: string };
};

const GDP_LOG_CALCULATION_NOTE = "Scatter position, correlation, and outlier calculations use GDP per capita on the same logarithmic scale displayed on the map. Country labels still show the original dollar values.";

/** Curated comparisons are editorial views, not claims of causation. */
export const ATLAS_COMPARISONS: readonly AtlasComparisonDefinition[] = [
  {
    id: "fertility-population-growth",
    name: "Fertility ↔ Population growth",
    question: "Where do fertility rates and annual population change move together—and where do they not?",
    interpretation: "Migration, age structure and mortality can make population growth diverge from fertility.",
    caveat: "A relationship on this chart does not show that one measure causes the other.",
    a: { viewId: "fertility", shortLabel: "Fertility" },
    b: { viewId: "population-growth", shortLabel: "Growth" },
  },
  {
    id: "young-growing",
    name: "Young ↔ Growing",
    question: "Do countries with larger shares of children also have faster-growing populations?",
    interpretation: "A young population can create demographic momentum, while migration and mortality also shape growth.",
    caveat: "The two observations may come from different years; read each selected-country date.",
    a: { viewId: "children-share", shortLabel: "Ages 0–14" },
    b: { viewId: "population-growth", shortLabel: "Growth" },
  },
  {
    id: "old-slow-growth",
    name: "Old ↔ Slow growth",
    question: "Where do older populations overlap with slow growth or population decline?",
    interpretation: "Age structure is one part of the pattern; migration and changing birth and death rates matter too.",
    caveat: "This is a comparison of national observations, not a forecast.",
    a: { viewId: "older-population", shortLabel: "Ages 65+" },
    b: { viewId: "population-growth", shortLabel: "Growth" },
  },
  {
    id: "wealth-longevity",
    name: "Wealth ↔ Longevity",
    question: "How does measured economic output per person overlap with life expectancy?",
    interpretation: "Countries with similar output can still differ substantially in longevity.",
    caveat: "GDP per capita is not household income or wellbeing, and association is not causation.",
    calculationNote: GDP_LOG_CALCULATION_NOTE,
    a: { viewId: "gdp-per-capita", shortLabel: "GDP per capita" },
    b: { viewId: "life-expectancy", shortLabel: "Life expectancy" },
  },
  {
    id: "urban-wealth",
    name: "Urban ↔ Wealth",
    question: "How does the share living in urban areas overlap with economic output per person?",
    interpretation: "National definitions of “urban” differ, so neighboring values are not perfectly comparable.",
    caveat: "Urbanization and GDP per capita are descriptive observations, not a causal sequence.",
    calculationNote: GDP_LOG_CALCULATION_NOTE,
    a: { viewId: "urbanization", shortLabel: "Urban share" },
    b: { viewId: "gdp-per-capita", shortLabel: "GDP per capita" },
  },
  {
    id: "fertility-wealth",
    name: "Fertility ↔ Wealth",
    question: "Where do fertility and economic output per person align with—and depart from—the broad world pattern?",
    interpretation: "National averages hide differences within countries and do not explain individual family decisions.",
    caveat: "GDP per capita is shown on a logarithmic scale and does not measure household income.",
    calculationNote: GDP_LOG_CALCULATION_NOTE,
    a: { viewId: "fertility", shortLabel: "Fertility" },
    b: { viewId: "gdp-per-capita", shortLabel: "GDP per capita" },
  },
];

export const ATLAS_COMPARISON_BY_ID = new Map(
  ATLAS_COMPARISONS.map((comparison) => [comparison.id, comparison]),
);

export function atlasComparisonForView(viewId: string) {
  return ATLAS_COMPARISONS.filter((comparison) =>
    comparison.a.viewId === viewId || comparison.b.viewId === viewId,
  );
}

export function atlasComparisonSideForView(
  comparison: AtlasComparisonDefinition,
  viewId: string,
): AtlasComparisonSide | null {
  if (comparison.a.viewId === viewId) return "a";
  if (comparison.b.viewId === viewId) return "b";
  return null;
}

export function atlasComparisonView(
  comparison: AtlasComparisonDefinition,
  side: AtlasComparisonSide,
) {
  return comparison[side];
}

export function atlasComparisonPrimaryLayer(viewId: string) {
  const preset = ATLAS_VIEW_PRESET_BY_ID.get(viewId);
  if (!preset) return null;
  for (const instance of preset.layerInstances) {
    const layer = ATLAS_LAYER_BY_ID.get(instance.layerId);
    const dataset = layer ? ATLAS_DATASET_BY_ID.get(layer.datasetId) : null;
    if (layer?.renderer === "polygon-fill" && dataset?.access.kind === "api") {
      return { preset, layer, dataset };
    }
  }
  return null;
}

export function atlasComparisonEndpoint(viewId: string) {
  const entry = atlasComparisonPrimaryLayer(viewId);
  return entry?.dataset.access.kind === "api" ? entry.dataset.access.endpoint : null;
}

export type AtlasComparisonPoint = {
  entityId: string;
  name: string;
  a: number;
  b: number;
  aDatum: AtlasLayerDatum;
  bDatum: AtlasLayerDatum;
  x: number;
  y: number;
  residual: number;
};

export type AtlasComparisonSummary = {
  points: AtlasComparisonPoint[];
  correlation: number | null;
  sentence: string;
  outliers: AtlasComparisonPoint[];
};

function numericDatum(datum: AtlasLayerDatum | undefined) {
  if (!datum || !atlasObservationStatusHasValue(datum.status)) return null;
  return typeof datum.value === "number" && Number.isFinite(datum.value) ? datum : null;
}

function continuousLegend(payload: AtlasLayerDataResponse): AtlasContinuousLegend | null {
  return payload.layer.legend.kind === "continuous" ? payload.layer.legend : null;
}

function transform(value: number, legend: AtlasContinuousLegend | null) {
  if (legend?.scale === "log") return value > 0 ? Math.log(value) : Number.NaN;
  if (legend?.scale === "log1p") return value >= 0 ? Math.log1p(value) : Number.NaN;
  if (legend?.scale === "sqrt") return value >= 0 ? Math.sqrt(value) : Number.NaN;
  return value;
}

function correlation(values: Array<[number, number]>) {
  if (values.length < 3) return null;
  const meanA = values.reduce((sum, entry) => sum + entry[0], 0) / values.length;
  const meanB = values.reduce((sum, entry) => sum + entry[1], 0) / values.length;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (const [a, b] of values) {
    covariance += (a - meanA) * (b - meanB);
    varianceA += (a - meanA) ** 2;
    varianceB += (b - meanB) ** 2;
  }
  if (varianceA === 0 || varianceB === 0) return null;
  return covariance / Math.sqrt(varianceA * varianceB);
}

function correlationSentence(value: number | null, count: number) {
  if (value == null) return `Only ${count} comparable country observations are available.`;
  const strength = Math.abs(value) >= 0.7
    ? "a strong"
    : Math.abs(value) >= 0.4
      ? "a moderate"
      : Math.abs(value) >= 0.2
        ? "a weak"
        : "little";
  const direction = value >= 0 ? "positive" : "negative";
  return `Across ${count} comparable country observations, this is ${strength} ${direction} association (r = ${value.toFixed(2)}).`;
}

function linearResiduals(values: Array<[number, number]>) {
  if (values.length < 3) return values.map(() => 0);
  const meanA = values.reduce((sum, entry) => sum + entry[0], 0) / values.length;
  const meanB = values.reduce((sum, entry) => sum + entry[1], 0) / values.length;
  const numerator = values.reduce((sum, [a, b]) => sum + (a - meanA) * (b - meanB), 0);
  const denominator = values.reduce((sum, [a]) => sum + (a - meanA) ** 2, 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanB - slope * meanA;
  return values.map(([a, b]) => b - (intercept + slope * a));
}

export function summarizeAtlasComparison(
  aPayload: AtlasLayerDataResponse,
  bPayload: AtlasLayerDataResponse,
  countryNames: ReadonlyMap<string, string>,
): AtlasComparisonSummary {
  const bByEntity = new Map(bPayload.values.map((datum) => [datum.entityId, datum]));
  const aLegend = continuousLegend(aPayload);
  const bLegend = continuousLegend(bPayload);
  const joined = aPayload.values.flatMap((candidate) => {
    const aDatum = numericDatum(candidate);
    const bDatum = numericDatum(bByEntity.get(candidate.entityId));
    if (!aDatum || !bDatum) return [];
    const a = transform(aDatum.value as number, aLegend);
    const b = transform(bDatum.value as number, bLegend);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
    return [{ entityId: candidate.entityId, name: countryNames.get(candidate.entityId) ?? candidate.entityId, a, b, aDatum, bDatum }];
  });
  const minA = Math.min(...joined.map((entry) => entry.a));
  const maxA = Math.max(...joined.map((entry) => entry.a));
  const minB = Math.min(...joined.map((entry) => entry.b));
  const maxB = Math.max(...joined.map((entry) => entry.b));
  const residuals = linearResiduals(joined.map((entry) => [entry.a, entry.b]));
  const points = joined.map<AtlasComparisonPoint>((entry, index) => ({
    ...entry,
    x: maxA === minA ? 0.5 : (entry.a - minA) / (maxA - minA),
    y: maxB === minB ? 0.5 : (entry.b - minB) / (maxB - minB),
    residual: residuals[index] ?? 0,
  }));
  const coefficient = correlation(joined.map((entry) => [entry.a, entry.b]));
  return {
    points,
    correlation: coefficient,
    sentence: correlationSentence(coefficient, points.length),
    outliers: points
      .slice()
      .sort((left, right) => Math.abs(right.residual) - Math.abs(left.residual) || left.name.localeCompare(right.name))
      .slice(0, 3),
  };
}

export function findAtlasComparisonDatum(
  payload: AtlasLayerDataResponse | null,
  entityId: string | null,
) {
  if (!payload || !entityId) return null;
  return payload.values.find((datum) => datum.entityId === entityId) ?? null;
}

export function atlasComparisonDatumLabel(datum: AtlasLayerDatum | null) {
  if (!datum || !atlasObservationStatusHasValue(datum.status)) return "Not available";
  return datum.formattedValue ?? String(datum.value ?? "Not available");
}

export function atlasComparisonViewPreset(
  comparison: AtlasComparisonDefinition,
  side: AtlasComparisonSide,
): AtlasViewPreset | null {
  return ATLAS_VIEW_PRESET_BY_ID.get(comparison[side].viewId) ?? null;
}
