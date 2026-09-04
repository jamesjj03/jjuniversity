/**
 * Compatibility facade for the V1 map UI.
 *
 * Durable Phase 2 configuration lives in the serializable layer catalog. This
 * adapter keeps the existing map-mode API working while the renderer migrates
 * from one active fill to validated scene render plans.
 */
import {
  ATLAS_LAYER_BY_ID,
  ATLAS_VIEW_PRESETS,
} from "./layers/catalog";
import {
  continuousLegendKey,
  resolveAtlasLayerValue,
} from "./layers/resolvers";
import type { AtlasRuntimeCountry, AtlasRuntimeCountrySummary } from "./runtime";

export type AtlasMapModeId =
  | "political"
  | "government"
  | "religion"
  | "population"
  | "gdp-per-capita";

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

const LEGACY_MAP_MODE_IDS = new Set<AtlasMapModeId>([
  "political",
  "government",
  "religion",
  "population",
  "gdp-per-capita",
]);

function runtimeFeature(countryId: string, mapColor7: number | null) {
  return {
    entityId: countryId,
    centroid: [0, 0] as [number, number],
    bounds: [[0, 0], [0, 0]] as [[number, number], [number, number]],
    tinyRank: null,
    mapColor7,
  };
}

function compatibilityLegend(layerId: string): AtlasMapLegendItem[] {
  const definition = ATLAS_LAYER_BY_ID.get(layerId)!;
  if (definition.legend.kind === "categorical" || definition.legend.kind === "binned") {
    return definition.legend.items.map(({ key, label, color }) => ({ key, label, color }));
  }
  if (definition.legend.kind === "continuous") {
    const { stops, ticks, unit } = definition.legend;
    return stops.map((stop, index) => ({
      key: `continuous-${index}`,
      label: ticks[index]?.label ?? unit,
      color: stop.color,
    }));
  }
  return [];
}

function visualizationFor(layerId: string): AtlasMapVisualization {
  const legend = ATLAS_LAYER_BY_ID.get(layerId)!.legend;
  return legend.kind === "continuous" || legend.kind === "binned" ? "continuous" : "categorical";
}

export const ATLAS_MAP_MODES: AtlasMapMode[] = ATLAS_VIEW_PRESETS
  .filter((preset) => LEGACY_MAP_MODE_IDS.has(preset.id as AtlasMapModeId))
  .map((preset) => {
  const fillInstance = preset.layerInstances.find((instance) =>
    ATLAS_LAYER_BY_ID.get(instance.layerId)?.channel === "admin0-fill",
  );
  if (!fillInstance) throw new Error(`Atlas view ${preset.id} does not define an admin0 fill layer.`);
  const definition = ATLAS_LAYER_BY_ID.get(fillInstance.layerId)!;
  const missing = definition.missingData.styles.unavailable ?? {
    label: "Not available",
    color: "#343c40",
    opacity: 1,
  };
  return {
    id: preset.id as AtlasMapModeId,
    name: preset.name,
    description: preset.description,
    visualization: visualizationFor(definition.id),
    sourceIds: [...new Set(definition.provenance.sourceIds)],
    missingData: { label: missing.label, color: missing.color },
    legend: compatibilityLegend(definition.id),
    resolve: ({ country, mapColor7 }) => {
      const resolved = resolveAtlasLayerValue(definition, {
        country,
        feature: runtimeFeature(country.id, mapColor7),
      });
      if (resolved.status === "unavailable") return null;
      const key = definition.legend.kind === "continuous" && resolved.numericValue != null
        ? continuousLegendKey(resolved.numericValue, definition.legend)
        : resolved.key;
      return {
        key,
        label: resolved.label,
        tooltip: resolved.tooltip,
        ...(resolved.numericValue == null ? {} : { numericValue: resolved.numericValue }),
      };
    },
    color: ({ country, mapColor7 }) => resolveAtlasLayerValue(definition, {
      country,
      feature: runtimeFeature(country.id, mapColor7),
    }).color,
  };
  });

export const ATLAS_MAP_MODE_BY_ID = new Map(ATLAS_MAP_MODES.map((mode) => [mode.id, mode]));

export function isAtlasMapModeId(value: string | null): value is AtlasMapModeId {
  return value != null && ATLAS_MAP_MODE_BY_ID.has(value as AtlasMapModeId);
}
