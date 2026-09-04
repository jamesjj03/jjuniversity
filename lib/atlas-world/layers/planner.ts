import {
  ATLAS_DATASET_BY_ID,
  ATLAS_LAYER_BY_ID,
} from "./catalog";
import type {
  AtlasLayerDefinition,
  AtlasLayerInstance,
  AtlasLayerSlot,
  AtlasRenderPlan,
  AtlasRenderPlanIssue,
  AtlasSceneState,
  AtlasTimeSelection,
} from "./contracts";
import { ATLAS_LAYER_SCHEMA_VERSION } from "./contracts";

const SLOT_ORDER: Record<AtlasLayerSlot, number> = {
  background: 0,
  raster: 100,
  "base-area": 200,
  "thematic-area": 300,
  "historical-area": 400,
  boundary: 500,
  route: 600,
  point: 700,
  label: 800,
  annotation: 900,
  interaction: 1000,
};

function issue(
  severity: AtlasRenderPlanIssue["severity"],
  code: string,
  message: string,
  instances: AtlasLayerInstance[] = [],
): AtlasRenderPlanIssue {
  return { severity, code, message, layerInstanceIds: instances.map((instance) => instance.id) };
}

function timeIsLatest(time: AtlasTimeSelection) {
  return time.kind === "latest";
}

function rendererAcceptsGeometry(definition: AtlasLayerDefinition, geometryKind: string) {
  if (definition.renderer === "polygon-fill" || definition.renderer === "polygon-feature" || definition.renderer === "polygon-pattern" || definition.renderer === "polygon-boundary") {
    return geometryKind === "polygon" || geometryKind === "multipolygon";
  }
  if (definition.renderer === "point-symbol" || definition.renderer === "label" || definition.renderer === "annotation") {
    return geometryKind === "point" || geometryKind === "multipoint" || geometryKind === "none";
  }
  if (definition.renderer === "line") return geometryKind === "line" || geometryKind === "multiline";
  if (definition.renderer === "raster-field") return geometryKind === "raster";
  return true;
}

/**
 * Converts serializable scene state into the only layer sequence renderers are
 * allowed to consume. This is where misleading/incompatible compositions are
 * rejected instead of being left to individual components.
 */
export function buildAtlasRenderPlan(scene: AtlasSceneState): AtlasRenderPlan {
  const issues: AtlasRenderPlanIssue[] = [];
  const instanceIds = new Set<string>();
  const enabled = scene.layers.filter((instance) => instance.enabled);

  for (const instance of scene.layers) {
    if (instanceIds.has(instance.id)) {
      issues.push(issue("error", "duplicate-layer-instance", `Layer instance ${instance.id} is duplicated.`, [instance]));
    }
    instanceIds.add(instance.id);
    if (!Number.isFinite(instance.opacity) || instance.opacity < 0 || instance.opacity > 1) {
      issues.push(issue("error", "invalid-layer-opacity", `Layer instance ${instance.id} has opacity outside 0–1.`, [instance]));
    }
  }

  const resolved = enabled.flatMap((instance, sourceIndex) => {
    const definition = ATLAS_LAYER_BY_ID.get(instance.layerId);
    if (!definition) {
      issues.push(issue("error", "unknown-layer", `Layer ${instance.layerId} is not registered.`, [instance]));
      return [];
    }
    const dataset = ATLAS_DATASET_BY_ID.get(definition.datasetId);
    if (!dataset) {
      issues.push(issue("error", "unknown-dataset", `Dataset ${definition.datasetId} is not registered.`, [instance]));
      return [];
    }
    if (!rendererAcceptsGeometry(definition, dataset.geometryKind)) {
      issues.push(issue(
        "error",
        "renderer-geometry-mismatch",
        `${definition.renderer} cannot render ${dataset.geometryKind} data for ${definition.id}.`,
        [instance],
      ));
    }
    const effectiveTime = instance.time ?? scene.time;
    if (!definition.temporal.supportsArbitraryTime && !timeIsLatest(effectiveTime)) {
      issues.push(issue(
        "error",
        "unsupported-time-selection",
        `${definition.name} currently supports only its latest sourced observation.`,
        [instance],
      ));
    }
    return [{
      instance,
      definition,
      dataset,
      effectiveTime,
      effectiveOpacity: Math.min(1, Math.max(0, instance.opacity)),
      sourceIndex,
    }];
  });

  const byExclusiveGroup = new Map<string, typeof resolved>();
  for (const entry of resolved) {
    const group = entry.definition.compatibility.exclusiveGroup;
    if (!group) continue;
    byExclusiveGroup.set(group, [...(byExclusiveGroup.get(group) ?? []), entry]);
  }
  for (const [group, entries] of byExclusiveGroup) {
    if (entries.length < 2) continue;
    issues.push(issue(
      "error",
      "exclusive-channel-conflict",
      `Only one enabled layer may own ${group}; received ${entries.map((entry) => entry.definition.id).join(", ")}.`,
      entries.map((entry) => entry.instance),
    ));
  }

  const enabledLayerIds = new Set(resolved.map((entry) => entry.definition.id));
  for (const entry of resolved) {
    const missingRequirements = entry.definition.compatibility.requiresLayerIds.filter((id) => !enabledLayerIds.has(id));
    if (missingRequirements.length > 0) {
      issues.push(issue(
        "error",
        "missing-required-layer",
        `${entry.definition.name} requires ${missingRequirements.join(", ")}.`,
        [entry.instance],
      ));
    }
    const conflicts = entry.definition.compatibility.conflictsWithLayerIds.filter((id) => enabledLayerIds.has(id));
    if (conflicts.length > 0) {
      issues.push(issue(
        "error",
        "explicit-layer-conflict",
        `${entry.definition.name} conflicts with ${conflicts.join(", ")}.`,
        [entry.instance],
      ));
    }
  }

  const ordered = resolved
    .sort((a, b) =>
      SLOT_ORDER[a.definition.slot] - SLOT_ORDER[b.definition.slot]
      || a.definition.zIndex - b.definition.zIndex
      || a.sourceIndex - b.sourceIndex,
    )
    .map((entry) => ({
      instance: entry.instance,
      definition: entry.definition,
      dataset: entry.dataset,
      effectiveTime: entry.effectiveTime,
      effectiveOpacity: entry.effectiveOpacity,
    }));

  return {
    schemaVersion: ATLAS_LAYER_SCHEMA_VERSION,
    scene,
    layers: ordered,
    legends: ordered
      .filter((entry) => entry.definition.legend.kind !== "none")
      .map((entry) => ({ layerInstanceId: entry.instance.id, spec: entry.definition.legend })),
    sources: [...new Set(ordered.flatMap((entry) => [
      ...entry.dataset.sourceIds,
      ...entry.definition.provenance.sourceIds,
    ]))],
    issues,
    valid: !issues.some((entry) => entry.severity === "error"),
  };
}
