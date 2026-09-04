import type { AtlasRuntimeDataset } from "../runtime";
import type { AtlasObservationStatus } from "../types";
import {
  ATLAS_DATASET_BY_ID,
  ATLAS_LAYER_BY_ID,
  isAtlasApiLayerId,
} from "./catalog";
import type {
  AtlasLayerDataResponse,
  AtlasLayerDatum,
  AtlasTimeSelection,
} from "./contracts";
import { ATLAS_LAYER_SCHEMA_VERSION } from "./contracts";
import { resolveAtlasLayerValue } from "./resolvers";

export class AtlasLayerNotFoundError extends Error {}
export class AtlasLayerTimeError extends Error {}

export function buildAtlasLayerDataResponse(
  layerId: string,
  runtime: AtlasRuntimeDataset,
  requestedTime: AtlasTimeSelection = { kind: "latest" },
): AtlasLayerDataResponse {
  if (!isAtlasApiLayerId(layerId)) throw new AtlasLayerNotFoundError(`Atlas API layer ${layerId} was not found.`);
  const definition = ATLAS_LAYER_BY_ID.get(layerId)!;
  const dataset = ATLAS_DATASET_BY_ID.get(definition.datasetId)!;
  if (!definition.temporal.supportsArbitraryTime && requestedTime.kind !== "latest") {
    throw new AtlasLayerTimeError(`${definition.name} currently supports only the latest available observation.`);
  }

  const featureByEntityId = new Map(runtime.geometry.features.map((feature) => [feature.entityId, feature]));
  const values = runtime.countries.map<AtlasLayerDatum>((country) => {
    const feature = featureByEntityId.get(country.id);
    if (!feature) {
      return {
        entityId: country.id,
        status: "unavailable",
        value: null,
        formattedValue: null,
        observedAt: null,
        validFrom: null,
        validTo: null,
        precision: "unknown",
        sourceId: null,
        sourceField: null,
        notes: ["No geometry joined to this Atlas entity."],
      };
    }
    const resolved = resolveAtlasLayerValue(definition, { country, feature });
    return {
      entityId: country.id,
      status: resolved.status,
      value: resolved.value,
      formattedValue: resolved.formattedValue,
      observedAt: resolved.temporal?.observedAt ?? null,
      validFrom: resolved.temporal?.validFrom ?? null,
      validTo: resolved.temporal?.validTo ?? null,
      precision: resolved.temporal?.precision ?? "source_snapshot",
      sourceId: resolved.sourceId,
      sourceField: resolved.sourceField,
      notes: resolved.notes,
    };
  }).sort((left, right) => left.entityId.localeCompare(right.entityId));

  const coverage: AtlasLayerDataResponse["coverage"] = { total: values.length };
  for (const value of values) {
    const status: AtlasObservationStatus = value.status;
    coverage[status] = (coverage[status] ?? 0) + 1;
  }

  const sourceIds = new Set([
    ...dataset.sourceIds,
    ...definition.provenance.sourceIds,
    ...values.flatMap((value) => value.sourceId ? [value.sourceId] : []),
  ]);

  return {
    schemaVersion: ATLAS_LAYER_SCHEMA_VERSION,
    snapshotId: runtime.snapshotId,
    generatedAt: runtime.generatedAt,
    layerId: definition.id,
    datasetId: dataset.id,
    valueType: dataset.valueType,
    unit: dataset.unit,
    layer: {
      name: definition.name,
      description: definition.description,
      renderer: definition.renderer,
      channel: definition.channel,
      legend: definition.legend,
      missingData: definition.missingData,
      provenance: definition.provenance,
    },
    requestedTime,
    temporalPolicy: dataset.temporal,
    coverage,
    values,
    sources: runtime.sources.filter((source) => sourceIds.has(source.id)),
  };
}
