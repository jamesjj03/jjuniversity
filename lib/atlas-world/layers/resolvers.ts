import type {
  AtlasRuntimeCountry,
  AtlasRuntimeCountrySummary,
  AtlasRuntimeFact,
  AtlasRuntimeFeatureMeta,
} from "../runtime";
import { atlasObservationStatusHasValue } from "../types";
import type { AtlasObservationStatus } from "../types";
import type {
  AtlasBinnedLegend,
  AtlasContinuousLegend,
  AtlasLayerDatum,
  AtlasLayerDefinition,
  AtlasResolvedLayerValue,
} from "./contracts";

export type AtlasLayerResolverContext = {
  country: AtlasRuntimeCountry | AtlasRuntimeCountrySummary;
  feature: AtlasRuntimeFeatureMeta;
};

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const integerNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const currentUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function temporalFromFact<T>(fact: AtlasRuntimeFact<T>) {
  return {
    observedAt: fact.observedAt,
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    precision: fact.precision,
  };
}

function resolvedFact<T>(
  fact: AtlasRuntimeFact<T>,
  key: string,
  label: string,
  tooltip: string,
  formattedValue: string,
  color = "",
): AtlasResolvedLayerValue {
  const scalarValue = typeof fact.value === "string" || typeof fact.value === "number" || typeof fact.value === "boolean"
    ? fact.value
    : key;
  return {
    status: fact.status,
    key,
    label,
    tooltip,
    value: scalarValue,
    numericValue: typeof fact.value === "number" ? fact.value : null,
    formattedValue,
    color,
    temporal: temporalFromFact(fact),
    sourceId: fact.sourceId,
    sourceField: fact.sourceField,
    notes: fact.notes,
  };
}

function observationStatusSuffix(status: AtlasObservationStatus, observedAt: string | null) {
  const date = observedAt ? ` · ${observedAt}` : "";
  if (status === "observed") return observedAt ? `${date} observation` : "";
  if (status === "estimated") return `${date} estimate`;
  if (status === "inherited") return `${date} inherited value`;
  if (status === "carried_forward") return `${date} carried-forward value`;
  if (status === "suppressed") return " · Suppressed";
  if (status === "not_applicable") return " · Not applicable";
  return " · Unavailable";
}

function observationSuffix(fact: AtlasRuntimeFact<unknown>) {
  return observationStatusSuffix(fact.status, fact.observedAt);
}

function resolvePolitical({ feature }: AtlasLayerResolverContext): AtlasResolvedLayerValue {
  const mapColor = feature.mapColor7 ?? 0;
  return {
    status: "observed",
    key: String(Math.abs(mapColor) % 7),
    label: "Country or territory",
    tooltip: "Country or territory",
    value: mapColor,
    numericValue: mapColor,
    formattedValue: null,
    color: "",
    temporal: null,
    sourceId: "natural-earth-admin-0-50m-5.1.2",
    sourceField: "MAPCOLOR7",
    notes: ["Neighbor-contrast class; it does not encode a country attribute."],
  };
}

function resolveGovernment({ country }: AtlasLayerResolverContext) {
  const fact = country.facts.government;
  if (!fact) return null;
  return resolvedFact(
    fact,
    fact.value.category,
    fact.value.raw,
    `${fact.value.raw}${observationSuffix(fact)}`,
    fact.value.raw,
  );
}

function resolveReligion({ country }: AtlasLayerResolverContext) {
  const fact = country.facts.religion;
  if (!fact || fact.value.dominantCategory === "unknown") return null;
  const dominantShare = fact.value.composition.find(
    (entry) => entry.category === fact.value.dominantCategory,
  )?.sharePercent;
  const label = fact.value.dominantCategory;
  const formatted = dominantShare == null ? label : `${label} · ${dominantShare}%`;
  return resolvedFact(
    fact,
    fact.value.dominantCategory,
    label,
    `${formatted}${observationSuffix(fact)}`,
    formatted,
  );
}

function resolvePopulation({ country }: AtlasLayerResolverContext) {
  const fact = country.facts.population;
  if (!fact) return null;
  return resolvedFact(
    fact,
    "population",
    integerNumber.format(fact.value),
    `${compactNumber.format(fact.value)} people${observationSuffix(fact)}`,
    integerNumber.format(fact.value),
  );
}

function resolveGdpPerCapita({ country }: AtlasLayerResolverContext) {
  const fact = country.facts.gdpPerCapitaCurrentUsd;
  if (!fact) return null;
  const formatted = currentUsd.format(fact.value);
  return resolvedFact(
    fact,
    "gdp-per-capita",
    formatted,
    `${formatted} per person${observationSuffix(fact)}`,
    formatted,
  );
}

function resolveGeometry({ feature }: AtlasLayerResolverContext): AtlasResolvedLayerValue {
  return {
    status: "observed",
    key: "geometry",
    label: "Geometry present",
    tooltip: "Geometry present",
    value: true,
    numericValue: null,
    formattedValue: null,
    color: "",
    temporal: null,
    sourceId: "natural-earth-admin-0-50m-5.1.2",
    sourceField: "geometry",
    notes: [`Geometry joined to ${feature.entityId}.`],
  };
}

const RESOLVERS: Record<string, (context: AtlasLayerResolverContext) => AtlasResolvedLayerValue | null> = {
  "political-neighbor-contrast-v1": resolvePolitical,
  "government-broad-form-v1": resolveGovernment,
  "religion-dominant-broad-v1": resolveReligion,
  "population-total-bins-v1": resolvePopulation,
  "gdp-per-capita-current-usd-v1": resolveGdpPerCapita,
  "geometry-presence-v1": resolveGeometry,
};

function hexChannels(hex: string) {
  const clean = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ] as const;
}

function interpolateHex(left: string, right: string, amount: number) {
  const a = hexChannels(left);
  const b = hexChannels(right);
  if (!a || !b) return left;
  const channel = (index: 0 | 1 | 2) => Math.round(a[index] + (b[index] - a[index]) * amount)
    .toString(16)
    .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

export function continuousLegendPosition(value: number, legend: AtlasContinuousLegend) {
  const [minimum, maximum] = legend.domain;
  const clamped = legend.clamp ? Math.min(maximum, Math.max(minimum, value)) : value;
  if (legend.scale === "log") {
    if (clamped <= 0 || minimum <= 0 || maximum <= 0) return 0;
    return (Math.log(clamped) - Math.log(minimum)) / (Math.log(maximum) - Math.log(minimum));
  }
  if (legend.scale === "log1p") {
    if (clamped < 0 || minimum < 0 || maximum < 0) return 0;
    return (Math.log1p(clamped) - Math.log1p(minimum)) / (Math.log1p(maximum) - Math.log1p(minimum));
  }
  if (legend.scale === "sqrt") {
    return (Math.sqrt(Math.max(0, clamped)) - Math.sqrt(Math.max(0, minimum)))
      / (Math.sqrt(Math.max(0, maximum)) - Math.sqrt(Math.max(0, minimum)));
  }
  return (clamped - minimum) / (maximum - minimum);
}

export function continuousLegendColor(value: number, legend: AtlasContinuousLegend) {
  const position = Math.min(1, Math.max(0, continuousLegendPosition(value, legend)));
  const stops = [...legend.stops].sort((a, b) => a.position - b.position);
  const rightIndex = stops.findIndex((stop) => stop.position >= position);
  if (rightIndex <= 0) return stops[0]?.color ?? "#343c40";
  if (rightIndex < 0) return stops.at(-1)?.color ?? "#343c40";
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  const width = right.position - left.position;
  const amount = width === 0 ? 0 : (position - left.position) / width;
  return interpolateHex(left.color, right.color, amount);
}

export function binnedLegendItem(value: number, legend: AtlasBinnedLegend) {
  return legend.items.find((item) =>
    (item.minInclusive == null || value >= item.minInclusive)
    && (item.maxExclusive == null || value < item.maxExclusive),
  ) ?? null;
}

export function continuousLegendKey(value: number, legend: AtlasContinuousLegend) {
  const position = Math.min(1, Math.max(0, continuousLegendPosition(value, legend)));
  const stops = [...legend.stops].sort((a, b) => a.position - b.position);
  let nearest = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (Math.abs(stops[index].position - position) < Math.abs(stops[nearest].position - position)) nearest = index;
  }
  return `continuous-${nearest}`;
}

function colorResolvedValue(definition: AtlasLayerDefinition, value: AtlasResolvedLayerValue) {
  if (!atlasObservationStatusHasValue(value.status)) {
    return definition.missingData.styles[value.status]?.color
      ?? definition.missingData.styles.unavailable?.color
      ?? "#343c40";
  }
  if (definition.legend.kind === "categorical") {
    return definition.legend.items.find((item) => item.key === value.key)?.color
      ?? definition.missingData.styles.unavailable?.color
      ?? "#343c40";
  }
  if (definition.legend.kind === "binned" && value.numericValue != null) {
    return binnedLegendItem(value.numericValue, definition.legend)?.color
      ?? definition.missingData.styles.unavailable?.color
      ?? "#343c40";
  }
  if (definition.legend.kind === "continuous" && value.numericValue != null) {
    return continuousLegendColor(value.numericValue, definition.legend);
  }
  return value.color;
}

export function resolveAtlasLayerValue(
  definition: AtlasLayerDefinition,
  context: AtlasLayerResolverContext,
): AtlasResolvedLayerValue {
  const resolver = RESOLVERS[definition.resolverId];
  if (!resolver) throw new Error(`Atlas resolver ${definition.resolverId} is not registered.`);
  const resolved = resolver(context);
  if (resolved) {
    if (!atlasObservationStatusHasValue(resolved.status)) {
      const missing = definition.missingData.styles[resolved.status]
        ?? definition.missingData.styles.unavailable
        ?? { label: "Not available", color: "#343c40", opacity: 1 };
      return {
        ...resolved,
        key: resolved.status,
        label: missing.label,
        tooltip: missing.label,
        numericValue: null,
        formattedValue: null,
        color: missing.color,
      };
    }
    if (definition.legend.kind === "binned" && resolved.numericValue != null) {
      const bucket = binnedLegendItem(resolved.numericValue, definition.legend);
      if (bucket) {
        resolved.key = bucket.key;
        resolved.label = bucket.label;
      }
    } else if (definition.legend.kind === "continuous" && resolved.numericValue != null) {
      resolved.key = continuousLegendKey(resolved.numericValue, definition.legend);
    } else if (definition.legend.kind === "categorical" && definition.resolverId !== "political-neighbor-contrast-v1") {
      const category = definition.legend.items.find((item) => item.key === resolved.key);
      if (category) {
        const numericDetail = resolved.numericValue == null ? "" : ` · ${resolved.numericValue}%`;
        const yearDetail = observationStatusSuffix(resolved.status, resolved.temporal?.observedAt ?? null);
        resolved.label = category.label;
        resolved.formattedValue = `${category.label}${numericDetail}`;
        resolved.tooltip = `${category.label}${numericDetail}${yearDetail}`;
      }
    }
    resolved.color = colorResolvedValue(definition, resolved);
    return resolved;
  }
  const missing = definition.missingData.styles.unavailable ?? {
    label: "Not available",
    color: "#343c40",
    opacity: 1,
  };
  return {
    status: "unavailable",
    key: "unavailable",
    label: missing.label,
    tooltip: missing.label,
    value: null,
    numericValue: null,
    formattedValue: null,
    color: missing.color,
    temporal: null,
    sourceId: null,
    sourceField: null,
    notes: [],
  };
}

/** Resolves a lazily fetched layer datum through the same authored legend. */
export function resolveAtlasLayerDatum(
  definition: AtlasLayerDefinition,
  datum: AtlasLayerDatum | null | undefined,
): AtlasResolvedLayerValue {
  if (!datum || !atlasObservationStatusHasValue(datum.status) || datum.value == null) {
    const status = datum?.status ?? "unavailable";
    const missing = definition.missingData.styles[status]
      ?? definition.missingData.styles.unavailable
      ?? { label: "Not available", color: "#343c40", opacity: 1 };
    return {
      status,
      key: status,
      label: missing.label,
      tooltip: missing.label,
      value: datum?.value ?? null,
      numericValue: null,
      formattedValue: datum?.formattedValue ?? null,
      color: missing.color,
      temporal: datum ? {
        observedAt: datum.observedAt,
        validFrom: datum.validFrom,
        validTo: datum.validTo,
        precision: datum.precision,
      } : null,
      sourceId: datum?.sourceId ?? null,
      sourceField: datum?.sourceField ?? null,
      notes: datum?.notes ?? [],
    };
  }

  const numericValue = typeof datum.value === "number" ? datum.value : null;
  let key = String(datum.value);
  let label = datum.formattedValue ?? String(datum.value);
  if (definition.legend.kind === "categorical") {
    const category = definition.legend.items.find((item) => item.key === String(datum.value));
    key = category?.key ?? key;
    label = category?.label ?? label;
  } else if (definition.legend.kind === "binned" && numericValue != null) {
    const bucket = binnedLegendItem(numericValue, definition.legend);
    key = bucket?.key ?? key;
    label = bucket?.label ?? label;
  } else if (definition.legend.kind === "continuous" && numericValue != null) {
    key = continuousLegendKey(numericValue, definition.legend);
  }
  const yearDetail = observationStatusSuffix(datum.status, datum.observedAt);
  const resolved: AtlasResolvedLayerValue = {
    status: datum.status,
    key,
    label,
    tooltip: `${datum.formattedValue ?? label}${yearDetail}`,
    value: datum.value,
    numericValue,
    formattedValue: datum.formattedValue,
    color: "",
    temporal: {
      observedAt: datum.observedAt,
      validFrom: datum.validFrom,
      validTo: datum.validTo,
      precision: datum.precision,
    },
    sourceId: datum.sourceId,
    sourceField: datum.sourceField,
    notes: datum.notes,
  };
  resolved.color = colorResolvedValue(definition, resolved);
  return resolved;
}
