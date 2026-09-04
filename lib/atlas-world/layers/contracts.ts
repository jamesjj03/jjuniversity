import type {
  AtlasDatePrecision,
  AtlasObservationStatus,
  AtlasTemporalExtent,
} from "../types";

export const ATLAS_LAYER_SCHEMA_VERSION = "2.0.0" as const;

export type AtlasDatasetId = string;
export type AtlasLayerId = string;
export type AtlasLayerInstanceId = string;
export type AtlasViewPresetId = string;
export type AtlasResolverId = string;

export type AtlasDatasetValueType =
  | "category"
  | "number"
  | "boolean"
  | "text"
  | "image"
  | "geometry";

export type AtlasDatasetGeometryKind =
  | "polygon"
  | "multipolygon"
  | "point"
  | "multipoint"
  | "line"
  | "multiline"
  | "raster"
  | "none";

/** Geographic resolution and conceptual resolution are deliberately independent. */
export type AtlasGeographicResolution =
  | { kind: "global" }
  | { kind: "administrative"; level: number; parentLevel: number | null }
  | { kind: "place"; placeType: string }
  | { kind: "grid"; cellSize: string }
  | { kind: "continuous_surface"; nominalResolution: string }
  | { kind: "feature"; featureType: string };

export type AtlasConceptualResolution = {
  taxonomyId: string;
  /** Human-readable hierarchy path, independent of map zoom. */
  path: string[];
  depth: number;
};

export type AtlasTimeSelection =
  | { kind: "latest" }
  | { kind: "instant"; at: string }
  | { kind: "interval"; from: string; to: string };

export type AtlasTemporalPolicy = {
  kind: "timeless" | "snapshot" | "observation_series" | "validity_interval";
  defaultSelection: AtlasTimeSelection;
  selectionPolicy:
    | "snapshot"
    | "timeless"
    | "latest_observation_per_feature"
    | "valid_at"
    | "intersects_interval";
  fallback: "none" | "nearest_prior";
  heterogeneousObservationDates: boolean;
  supportsArbitraryTime: boolean;
};

export type AtlasDatasetAccess =
  | { kind: "inline" }
  | { kind: "api"; endpoint: string; cachePolicy: "snapshot_immutable" | "revalidate_daily" }
  | { kind: "bundled"; resourceId: string; selector: string }
  | { kind: "static_asset"; href: string };

export type AtlasDatasetDefinition = {
  schemaVersion: typeof ATLAS_LAYER_SCHEMA_VERSION;
  id: AtlasDatasetId;
  name: string;
  description: string;
  valueType: AtlasDatasetValueType;
  unit: string | null;
  geometryKind: AtlasDatasetGeometryKind;
  geographicResolution: AtlasGeographicResolution;
  conceptualResolution: AtlasConceptualResolution | null;
  entityKey: "atlas_entity_id" | "atlas_feature_id" | "wgs84_coordinate";
  sourceIds: string[];
  sourceField: string | null;
  access: AtlasDatasetAccess;
  temporal: AtlasTemporalPolicy;
};

export type AtlasLayerRendererType =
  | "polygon-fill"
  | "polygon-feature"
  | "polygon-pattern"
  | "polygon-boundary"
  | "line"
  | "point-symbol"
  | "label"
  | "annotation"
  | "raster-field"
  | "interaction";

export type AtlasVisualChannel =
  | "background"
  | "raster"
  | "admin0-fill"
  | "feature-fill"
  | "area-pattern"
  | "boundary"
  | "line"
  | "symbol"
  | "label"
  | "annotation"
  | "interaction";

export type AtlasLayerSlot =
  | "background"
  | "raster"
  | "base-area"
  | "thematic-area"
  | "historical-area"
  | "boundary"
  | "route"
  | "point"
  | "label"
  | "annotation"
  | "interaction";

export type AtlasCategoricalLegend = {
  kind: "categorical";
  items: Array<{ key: string; label: string; color: string }>;
};

export type AtlasBinnedLegend = {
  kind: "binned";
  items: Array<{
    key: string;
    label: string;
    color: string;
    minInclusive: number | null;
    maxExclusive: number | null;
  }>;
  unit: string;
};

export type AtlasContinuousLegend = {
  kind: "continuous";
  scale: "linear" | "log" | "log1p" | "sqrt";
  domain: [number, number];
  clamp: boolean;
  stops: Array<{ position: number; color: string }>;
  ticks: Array<{ value: number; label: string }>;
  unit: string;
};

export type AtlasLegendSpec =
  | { kind: "none" }
  | AtlasCategoricalLegend
  | AtlasBinnedLegend
  | AtlasContinuousLegend;

export type AtlasMissingDataSpec = {
  defaultStatus: Extract<AtlasObservationStatus, "unavailable">;
  styles: Partial<Record<AtlasObservationStatus, { label: string; color: string; opacity: number }>>;
};

export type AtlasLayerStyleSpec = {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  strokeDasharray?: string;
  symbolShape?: "circle" | "diamond" | "square" | "pin";
  symbolFill?: string;
  symbolStroke?: string;
  symbolRadius?: number;
  symbolMinRadius?: number;
  symbolMaxRadius?: number;
  sizeField?: string;
  blendMode?: "normal" | "multiply" | "screen" | "overlay";
  clipToSphere?: boolean;
  minimumZoom?: number;
  maximumZoom?: number;
};

export type AtlasLayerDefinition = {
  schemaVersion: typeof ATLAS_LAYER_SCHEMA_VERSION;
  id: AtlasLayerId;
  name: string;
  description: string;
  datasetId: AtlasDatasetId;
  resolverId: AtlasResolverId;
  renderer: AtlasLayerRendererType;
  channel: AtlasVisualChannel;
  slot: AtlasLayerSlot;
  zIndex: number;
  defaultOpacity: number;
  /** Executable authored defaults for non-choropleth renderers. */
  style?: AtlasLayerStyleSpec;
  interactive: {
    hover: boolean;
    select: boolean;
    pointerEvents: "visual" | "shared_admin0_hit_layer" | "none";
  };
  legend: AtlasLegendSpec;
  missingData: AtlasMissingDataSpec;
  compatibility: {
    exclusiveGroup: string | null;
    requiresLayerIds: AtlasLayerId[];
    conflictsWithLayerIds: AtlasLayerId[];
  };
  provenance: {
    sourceIds: string[];
    methodology: string;
    authoredVisualChoices: string[];
  };
  temporal: AtlasTemporalPolicy;
};

export type AtlasLayerInstance = {
  id: AtlasLayerInstanceId;
  layerId: AtlasLayerId;
  enabled: boolean;
  opacity: number;
  time: AtlasTimeSelection | null;
  /** Serializable renderer parameters only. Resolver functions stay in the registry. */
  parameters: Record<string, string | number | boolean | null>;
};

export type AtlasViewPreset = {
  schemaVersion: typeof ATLAS_LAYER_SCHEMA_VERSION;
  id: AtlasViewPresetId;
  name: string;
  description: string;
  question: string | null;
  layerInstances: AtlasLayerInstance[];
  legacyModeAliases: string[];
  shareable: boolean;
};

export type AtlasSceneFocus =
  | { kind: "entity"; id: string }
  | { kind: "feature"; id: string }
  | { kind: "coordinate"; longitude: number; latitude: number };

export type AtlasSceneState = {
  schemaVersion: typeof ATLAS_LAYER_SCHEMA_VERSION;
  viewPresetId: AtlasViewPresetId;
  layers: AtlasLayerInstance[];
  time: AtlasTimeSelection;
  focus: AtlasSceneFocus | null;
};

export type AtlasRenderPlanLayer = {
  instance: AtlasLayerInstance;
  definition: AtlasLayerDefinition;
  dataset: AtlasDatasetDefinition;
  effectiveTime: AtlasTimeSelection;
  effectiveOpacity: number;
};

export type AtlasRenderPlanIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
  layerInstanceIds: AtlasLayerInstanceId[];
};

export type AtlasRenderPlan = {
  schemaVersion: typeof ATLAS_LAYER_SCHEMA_VERSION;
  scene: AtlasSceneState;
  layers: AtlasRenderPlanLayer[];
  legends: Array<{ layerInstanceId: AtlasLayerInstanceId; spec: AtlasLegendSpec }>;
  sources: string[];
  issues: AtlasRenderPlanIssue[];
  valid: boolean;
};

export type AtlasResolvedLayerValue = {
  status: AtlasObservationStatus;
  key: string;
  label: string;
  tooltip: string;
  value: string | number | boolean | null;
  numericValue: number | null;
  formattedValue: string | null;
  color: string;
  temporal: AtlasTemporalExtent | null;
  sourceId: string | null;
  sourceField: string | null;
  notes: string[];
};

export type AtlasLayerDatum = {
  entityId: string;
  status: AtlasObservationStatus;
  value: string | number | boolean | null;
  formattedValue: string | null;
  observedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  precision: AtlasDatePrecision;
  sourceId: string | null;
  sourceField: string | null;
  notes: string[];
};

export type AtlasLayerDataResponse = {
  schemaVersion: typeof ATLAS_LAYER_SCHEMA_VERSION;
  snapshotId: string;
  generatedAt: string;
  layerId: AtlasLayerId;
  datasetId: AtlasDatasetId;
  valueType: AtlasDatasetValueType;
  unit: string | null;
  layer: {
    name: string;
    description: string;
    renderer: AtlasLayerRendererType;
    channel: AtlasVisualChannel;
    legend: AtlasLegendSpec;
    missingData: AtlasMissingDataSpec;
    provenance: AtlasLayerDefinition["provenance"];
  };
  requestedTime: AtlasTimeSelection;
  temporalPolicy: AtlasTemporalPolicy;
  coverage: Partial<Record<AtlasObservationStatus, number>> & { total: number };
  values: AtlasLayerDatum[];
  sources: Array<{
    id: string;
    title: string;
    publisher: string;
    url: string;
    licenseName: string;
    licenseUrl: string;
    retrievedAt: string;
    sourceUpdatedAt: string | null;
    checksumSha256: string;
    notes: string[];
  }>;
};
