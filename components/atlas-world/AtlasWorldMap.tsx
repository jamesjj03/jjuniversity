import type { CSSProperties, ReactNode } from "react";
import {
  ATLAS_DATASET_BY_ID,
  ATLAS_LAYER_BY_ID,
  ATLAS_LAYER_DEFINITIONS,
  ATLAS_VIEW_PRESET_BY_ID,
  DEFAULT_ATLAS_VIEW_PRESET_ID,
  resolveAtlasLayerValue,
  type AtlasDatasetDefinition,
  type AtlasLayerDefinition,
  type AtlasLayerRendererType,
  type AtlasLayerStyleSpec,
} from "@/lib/atlas-world/layers";
import { getAtlasGeographyPack, getAtlasPatternNotes } from "@/lib/atlas-world/getAtlasGeography";
import type {
  AtlasCityFeature,
  AtlasGeographyPack,
  AtlasPatternNote,
  AtlasPhysicalFeature,
} from "@/lib/atlas-world/geographyTypes";
import type { AtlasRuntimeDataset } from "@/lib/atlas-world/runtime";
import styles from "./AtlasWorld.module.css";

type AtlasWorldMapProps = {
  data: AtlasRuntimeDataset;
};

type AtlasGeometryFeature = AtlasPhysicalFeature | AtlasCityFeature;

type AtlasSvgRendererContext = {
  data: AtlasRuntimeDataset;
  geometryAssetHref: string;
  defaultLayerInstances: Map<string, { enabled: boolean; opacity: number }>;
  geographyDatasetById: Map<string, AtlasGeographyPack["datasets"][number]>;
  bundledResources: Map<string, unknown>;
};

type AtlasSvgLayerRenderer = (
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) => ReactNode;

const GEOMETRY_ASSET_HREF = "/atlas-world/geometry-equal-earth.v1.svg";

function geometryAssetId(entityId: string) {
  return `atlas-${entityId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function layerSurfaceStyle(
  definition: AtlasLayerDefinition,
  context: AtlasSvgRendererContext,
): CSSProperties {
  const initialInstance = context.defaultLayerInstances.get(definition.id);
  const minimumZoom = definition.style?.minimumZoom ?? Number.NEGATIVE_INFINITY;
  const maximumZoom = definition.style?.maximumZoom ?? Number.POSITIVE_INFINITY;
  const visibleAtInitialZoom = minimumZoom <= 1 && maximumZoom >= 1;
  return {
    display: initialInstance?.enabled && visibleAtInitialZoom ? undefined : "none",
    opacity: initialInstance?.opacity ?? definition.defaultOpacity,
  };
}

function surfaceMetadata(definition: AtlasLayerDefinition, dataset: AtlasDatasetDefinition) {
  return {
    "data-atlas-layer": definition.id,
    "data-atlas-dataset": dataset.id,
    "data-atlas-renderer": definition.renderer,
    "data-atlas-slot": definition.slot,
    "data-atlas-z-index": definition.zIndex,
    "data-atlas-minimum-zoom": definition.style?.minimumZoom,
    "data-atlas-maximum-zoom": definition.style?.maximumZoom,
  };
}

function selectResource(resource: unknown, selector: string): unknown {
  return selector.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, resource);
}

function bundledRecords(dataset: AtlasDatasetDefinition, context: AtlasSvgRendererContext): unknown[] {
  if (dataset.access.kind !== "bundled") return [];
  const selected = selectResource(
    context.bundledResources.get(dataset.access.resourceId),
    dataset.access.selector,
  );
  if (Array.isArray(selected)) return selected;
  if (selected && typeof selected === "object") {
    const features = (selected as { features?: unknown }).features;
    if (Array.isArray(features)) return features;
  }
  return [];
}

function renderRasterLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  const geographyDataset = context.geographyDatasetById.get(dataset.id);
  const packAsset = geographyDataset?.asset;
  const catalogHref = dataset.access.kind === "static_asset" ? dataset.access.href : null;
  const assetHref = packAsset?.href ?? catalogHref;
  if (!assetHref) {
    throw new Error(`Atlas raster layer ${definition.id} has no registered asset.`);
  }

  const viewBox = packAsset?.viewBox ?? context.data.geometry.viewBox;
  const initialInstance = context.defaultLayerInstances.get(definition.id);
  const rasterClass = definition.style?.blendMode === "multiply"
    ? styles.reliefLayer
    : styles.populationDensityLayer;

  return (
    <image
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      href={initialInstance?.enabled ? assetHref : undefined}
      data-atlas-asset-href={assetHref}
      x={viewBox[0]}
      y={viewBox[1]}
      width={viewBox[2]}
      height={viewBox[3]}
      preserveAspectRatio="none"
      className={rasterClass}
      style={{
        ...layerSurfaceStyle(definition, context),
        mixBlendMode: definition.style?.blendMode,
      }}
    />
  );
}

function renderPolygonFeatureLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  const records = bundledRecords(dataset, context) as AtlasGeometryFeature[];
  const style = definition.style;
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.lakeLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      {records.map((feature) => {
        const path = feature.geometry.derived.path;
        if (!path) return null;
        return (
          <path
            key={feature.featureId}
            d={path}
            className={`${styles.lakeFeature} ${styles[`lod${feature.displayLod}`]}`}
            style={{
              fill: style?.fillColor,
              fillOpacity: style?.fillOpacity,
              stroke: style?.strokeColor,
              strokeOpacity: style?.strokeOpacity,
              strokeWidth: style?.strokeWidth,
              strokeDasharray: style?.strokeDasharray,
            }}
            vectorEffect="non-scaling-stroke"
          >
            <title>{feature.name}</title>
          </path>
        );
      })}
    </g>
  );
}

function renderLineLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  const records = bundledRecords(dataset, context) as AtlasGeometryFeature[];
  const style = definition.style;
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.riverLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      {records.map((feature) => {
        const path = feature.geometry.derived.path;
        if (!path) return null;
        return (
          <path
            key={feature.featureId}
            d={path}
            className={`${styles.riverFeature} ${styles[`lod${feature.displayLod}`]}`}
            style={{
              fill: "none",
              stroke: style?.strokeColor,
              strokeOpacity: style?.strokeOpacity,
              strokeWidth: style?.strokeWidth,
              strokeDasharray: style?.strokeDasharray,
            }}
            vectorEffect="non-scaling-stroke"
          >
            <title>{feature.name}</title>
          </path>
        );
      })}
    </g>
  );
}

function pointRadius(feature: AtlasGeometryFeature, style: AtlasLayerStyleSpec | undefined) {
  const minimum = style?.symbolMinRadius ?? style?.symbolRadius ?? 1.45;
  const maximum = style?.symbolMaxRadius ?? Math.max(minimum, 2.35);
  if (feature.sourceScaleRank != null && feature.sourceScaleRank <= 1) {
    return maximum;
  }
  if (feature.kind === "city" && feature.isNationalCapital) {
    return minimum + ((maximum - minimum) / 2);
  }
  return minimum;
}

function renderPointSymbolLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  const records = bundledRecords(dataset, context) as AtlasGeometryFeature[];
  const style = definition.style;
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.cityLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      {records.map((feature) => {
        const point = feature.geometry.derived.point;
        if (!point) return null;
        const radius = pointRadius(feature, style);
        return (
          <g
            key={feature.featureId}
            className={styles[`lod${feature.displayLod}`]}
            data-atlas-map-feature={feature.featureId}
          >
            <circle cx={point[0]} cy={point[1]} r={radius + 1.25} className={styles.cityHalo} />
            <circle
              cx={point[0]}
              cy={point[1]}
              r={radius}
              className={styles.cityPoint}
              style={{
                fill: style?.symbolFill,
                stroke: style?.symbolStroke,
                strokeWidth: style?.strokeWidth,
              }}
            >
              <title>{feature.name}</title>
            </circle>
          </g>
        );
      })}
    </g>
  );
}

function renderBoundaryLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  const style = definition.style;
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.boundaryLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      {context.data.geometry.features.map((feature) => (
        <use
          key={`${definition.id}-${feature.entityId}`}
          href={`${context.geometryAssetHref}#${geometryAssetId(feature.entityId)}`}
          className={styles.modernBoundary}
          style={{
            fill: "none",
            stroke: style?.strokeColor,
            strokeOpacity: style?.strokeOpacity,
            strokeWidth: style?.strokeWidth,
            strokeDasharray: style?.strokeDasharray,
          }}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function renderInteractionLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.interactionLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      {context.data.geometry.features.map((feature) => (
        <use
          key={`${definition.id}-${feature.entityId}`}
          href={`${context.geometryAssetHref}#${geometryAssetId(feature.entityId)}`}
          className={styles.countryHit}
          data-atlas-country={feature.entityId}
        />
      ))}
      {context.data.geometry.features
        .filter((feature) => feature.tinyRank != null)
        .map((feature) => (
          <circle
            key={`${definition.id}-marker-${feature.entityId}`}
            cx={feature.centroid[0]}
            cy={feature.centroid[1]}
            r={12}
            className={styles.tinyHit}
            data-atlas-country={feature.entityId}
          />
        ))}
    </g>
  );
}

function renderAnnotationLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  const notes = bundledRecords(dataset, context) as AtlasPatternNote[];
  const symbolRadius = definition.style?.symbolRadius ?? 4;
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.noteLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      {notes.map((note, index) => (
        <g
          key={note.id}
          className={styles.noteMarker}
          data-atlas-note={note.id}
          data-atlas-minimum-zoom={note.triggers.minimumZoom}
          data-atlas-maximum-zoom={note.triggers.maximumZoom}
          transform={`translate(${note.spatial.focus.equalEarth.join(" ")})`}
        >
          <circle r={symbolRadius + 4.5} className={styles.notePulse} />
          <circle
            r={symbolRadius + 1.5}
            className={styles.noteDot}
            style={{
              fill: definition.style?.symbolFill,
              stroke: definition.style?.symbolStroke,
              strokeWidth: definition.style?.strokeWidth,
            }}
          />
          <text x={0} y={1.2} textAnchor="middle" dominantBaseline="middle">{index + 1}</text>
        </g>
      ))}
    </g>
  );
}

/**
 * SVG renderer registry. A catalog entry using one of these renderer/data
 * shapes receives a surface without another layer-ID-specific JSX branch.
 */
const SVG_LAYER_RENDERERS: Partial<Record<AtlasLayerRendererType, AtlasSvgLayerRenderer>> = {
  "raster-field": renderRasterLayer,
  "polygon-feature": renderPolygonFeatureLayer,
  "polygon-boundary": renderBoundaryLayer,
  line: renderLineLayer,
  "point-symbol": renderPointSymbolLayer,
  annotation: renderAnnotationLayer,
  interaction: renderInteractionLayer,
};

function compareLayerSurfaces(left: AtlasLayerDefinition, right: AtlasLayerDefinition) {
  return left.zIndex - right.zIndex || left.slot.localeCompare(right.slot) || left.id.localeCompare(right.id);
}

function renderCatalogLayer(definition: AtlasLayerDefinition, context: AtlasSvgRendererContext) {
  const dataset = ATLAS_DATASET_BY_ID.get(definition.datasetId);
  if (!dataset) throw new Error(`Atlas layer ${definition.id} references an unknown dataset.`);
  const renderer = SVG_LAYER_RENDERERS[definition.renderer];
  if (!renderer) throw new Error(`Atlas SVG renderer ${definition.renderer} is not registered.`);
  return renderer(definition, dataset, context);
}

function renderSharedAdmin0Fill(
  definition: AtlasLayerDefinition,
  data: AtlasRuntimeDataset,
  geometryAssetHref: string,
) {
  const countryById = new Map(data.countries.map((country) => [country.id, country]));
  return (
    <g
      key="shared-admin0-fill"
      data-atlas-shared-renderer="polygon-fill"
      data-atlas-slot={definition.slot}
      data-atlas-z-index={definition.zIndex}
      data-atlas-area-visuals
    >
      {data.geometry.features.map((feature) => {
        const country = countryById.get(feature.entityId);
        if (!country) return null;
        return (
          <use
            key={feature.entityId}
            href={`${geometryAssetHref}#${geometryAssetId(feature.entityId)}`}
            fill={resolveAtlasLayerValue(definition, { country, feature }).color}
            className={styles.countryShape}
            data-atlas-visual={country.id}
            data-map-color={feature.mapColor7 ?? 0}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {data.geometry.features
        .filter((feature) => feature.tinyRank != null)
        .map((feature) => {
          const country = countryById.get(feature.entityId);
          if (!country) return null;
          return (
            <circle
              key={`marker-${feature.entityId}`}
              cx={feature.centroid[0]}
              cy={feature.centroid[1]}
              r={2.7}
              fill={resolveAtlasLayerValue(definition, { country, feature }).color}
              className={styles.tinyMarker}
              data-atlas-visual={country.id}
              data-map-color={feature.mapColor7 ?? 0}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
    </g>
  );
}

export default function AtlasWorldMap({ data }: AtlasWorldMapProps) {
  const geography = getAtlasGeographyPack();
  const patternNotes = getAtlasPatternNotes();
  const geometryAssetHref = `${GEOMETRY_ASSET_HREF}?snapshot=${encodeURIComponent(data.snapshotId)}`;
  const defaultPreset = ATLAS_VIEW_PRESET_BY_ID.get(DEFAULT_ATLAS_VIEW_PRESET_ID);
  if (!defaultPreset) throw new Error("The default Atlas view preset is not registered.");

  const defaultLayerInstances = new Map(
    defaultPreset.layerInstances.map((instance) => [
      instance.layerId,
      { enabled: instance.enabled, opacity: instance.opacity },
    ]),
  );
  const geographyDatasetById = new Map(geography.datasets.map((dataset) => [dataset.id, dataset]));
  const bundledResources = new Map<string, unknown>([
    ["atlas-geography-pack.v1", geography],
    ["atlas-pattern-notes.v1", { notes: patternNotes }],
  ]);
  const context: AtlasSvgRendererContext = {
    data,
    geometryAssetHref,
    defaultLayerInstances,
    geographyDatasetById,
    bundledResources,
  };

  const defaultFillDefinition = defaultPreset.layerInstances
    .map((instance) => ATLAS_LAYER_BY_ID.get(instance.layerId))
    .find((definition) => definition?.renderer === "polygon-fill");
  if (!defaultFillDefinition) throw new Error("The default Atlas view has no polygon-fill layer.");

  const catalogSurfaces = ATLAS_LAYER_DEFINITIONS
    .filter((definition) => definition.renderer !== "polygon-fill")
    .sort(compareLayerSurfaces);
  const passiveSurfaces = catalogSurfaces.filter(
    (definition) => definition.renderer !== "interaction" && definition.interactive.pointerEvents !== "visual",
  );
  const interactionSurfaces = catalogSurfaces.filter((definition) => definition.renderer === "interaction");
  const foregroundInteractiveSurfaces = catalogSurfaces.filter(
    (definition) => definition.renderer !== "interaction" && definition.interactive.pointerEvents === "visual",
  );
  const fillInsertionIndex = passiveSurfaces.findIndex(
    (definition) => compareLayerSurfaces(defaultFillDefinition, definition) < 0,
  );
  const orderedPassiveSurfaces = [...passiveSurfaces];
  orderedPassiveSurfaces.splice(
    fillInsertionIndex < 0 ? orderedPassiveSurfaces.length : fillInsertionIndex,
    0,
    defaultFillDefinition,
  );

  return (
    <svg
      viewBox={data.geometry.viewBox.join(" ")}
      className={styles.worldMap}
      data-atlas-world-map
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="atlas-ocean-glow" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#152f36" />
          <stop offset="100%" stopColor="#07181d" />
        </radialGradient>
      </defs>
      <g data-atlas-map-group data-atlas-zoom-level="world" data-atlas-zoom-scale="1">
        <use href={`${geometryAssetHref}#atlas-sphere`} className={styles.ocean} fill="url(#atlas-ocean-glow)" />
        <use href={`${geometryAssetHref}#atlas-graticule`} className={styles.graticule} />

        {orderedPassiveSurfaces.map((definition) =>
          definition.renderer === "polygon-fill"
            ? renderSharedAdmin0Fill(definition, data, geometryAssetHref)
            : renderCatalogLayer(definition, context),
        )}

        {interactionSurfaces.map((definition) => renderCatalogLayer(definition, context))}

        {/* Interactive visual surfaces sit above the broad country hit surface
            so specific feature interaction wins. Their relative order still
            follows catalog zIndex/slot ordering. */}
        {foregroundInteractiveSurfaces.map((definition) => renderCatalogLayer(definition, context))}
      </g>
    </svg>
  );
}
