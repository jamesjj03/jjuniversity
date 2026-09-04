import catalogJson from "./catalog.v2.json";
import type {
  AtlasDatasetDefinition,
  AtlasDatasetId,
  AtlasLayerDefinition,
  AtlasLayerId,
  AtlasSceneState,
  AtlasViewPreset,
  AtlasViewPresetId,
} from "./contracts";
import { ATLAS_LAYER_SCHEMA_VERSION } from "./contracts";

type AtlasLayerCatalog = {
  schemaVersion: typeof ATLAS_LAYER_SCHEMA_VERSION;
  datasets: AtlasDatasetDefinition[];
  layers: AtlasLayerDefinition[];
  viewPresets: AtlasViewPreset[];
};

const catalog = catalogJson as unknown as AtlasLayerCatalog;

if (catalog.schemaVersion !== ATLAS_LAYER_SCHEMA_VERSION) {
  throw new Error(`Unsupported Atlas layer catalog ${String(catalog.schemaVersion)}.`);
}

export const ATLAS_DATASET_DEFINITIONS = catalog.datasets;
export const ATLAS_LAYER_DEFINITIONS = catalog.layers;
export const ATLAS_VIEW_PRESETS = catalog.viewPresets;

export const ATLAS_DATASET_BY_ID = new Map<AtlasDatasetId, AtlasDatasetDefinition>(
  ATLAS_DATASET_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const ATLAS_LAYER_BY_ID = new Map<AtlasLayerId, AtlasLayerDefinition>(
  ATLAS_LAYER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const ATLAS_VIEW_PRESET_BY_ID = new Map<AtlasViewPresetId, AtlasViewPreset>(
  ATLAS_VIEW_PRESETS.map((preset) => [preset.id, preset]),
);

export const ATLAS_VIEW_PRESET_BY_ALIAS = new Map<string, AtlasViewPreset>(
  ATLAS_VIEW_PRESETS.flatMap((preset) =>
    [preset.id, ...preset.legacyModeAliases].map((alias) => [alias.toLocaleLowerCase("en-US"), preset] as const),
  ),
);

export const DEFAULT_ATLAS_VIEW_PRESET_ID = "political";

export const ATLAS_DATA_LAYER_IDS = ATLAS_LAYER_DEFINITIONS
  .filter((layer) => layer.renderer !== "interaction" && layer.renderer !== "polygon-boundary")
  .map((layer) => layer.id);

export const ATLAS_API_LAYER_IDS = ATLAS_LAYER_DEFINITIONS
  .filter((layer) => ATLAS_DATASET_BY_ID.get(layer.datasetId)?.access.kind === "api")
  .map((layer) => layer.id);

export function isAtlasLayerId(value: string | null): value is AtlasLayerId {
  return value != null && ATLAS_LAYER_BY_ID.has(value);
}

export function isAtlasDataLayerId(value: string | null): value is AtlasLayerId {
  return value != null && ATLAS_DATA_LAYER_IDS.includes(value);
}

export function isAtlasApiLayerId(value: string | null): value is AtlasLayerId {
  return value != null && ATLAS_API_LAYER_IDS.includes(value);
}

export function isAtlasViewPresetId(value: string | null): value is AtlasViewPresetId {
  return value != null && ATLAS_VIEW_PRESET_BY_ID.has(value);
}

export function resolveAtlasViewPreset(value: string | null | undefined) {
  if (!value) return ATLAS_VIEW_PRESET_BY_ID.get(DEFAULT_ATLAS_VIEW_PRESET_ID)!;
  return ATLAS_VIEW_PRESET_BY_ALIAS.get(value.toLocaleLowerCase("en-US"))
    ?? ATLAS_VIEW_PRESET_BY_ID.get(DEFAULT_ATLAS_VIEW_PRESET_ID)!;
}

export function createAtlasSceneFromPreset(
  presetId: AtlasViewPresetId = DEFAULT_ATLAS_VIEW_PRESET_ID,
): AtlasSceneState {
  const preset = ATLAS_VIEW_PRESET_BY_ID.get(presetId)
    ?? ATLAS_VIEW_PRESET_BY_ID.get(DEFAULT_ATLAS_VIEW_PRESET_ID)!;
  return {
    schemaVersion: ATLAS_LAYER_SCHEMA_VERSION,
    viewPresetId: preset.id,
    layers: preset.layerInstances.map((instance) => ({
      ...instance,
      parameters: { ...instance.parameters },
      time: instance.time ? { ...instance.time } : null,
    })),
    time: { kind: "latest" },
    focus: null,
  };
}
