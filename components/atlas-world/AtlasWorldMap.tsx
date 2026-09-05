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
import { ATLAS_STATUS_OUTLINE_ENTITY_IDS } from "@/lib/atlas-world/territorialStatus";
import styles from "./AtlasWorld.module.css";
import AtlasRasterSurface from "./AtlasRasterSurface";

type AtlasWorldMapProps = {
  data: AtlasRuntimeDataset;
};

type AtlasGeometryFeature = AtlasPhysicalFeature | AtlasCityFeature;

function assistanceExtent(feature: AtlasRuntimeDataset["geometry"]["features"][number]) {
  // Overseas pieces and dateline wrapping must not make a tiny main polygon
  // look continent-sized to the screen-space assistance rule.
  const bounds = feature.focusBounds ?? feature.bounds;
  return Math.min(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]);
}

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

function pathLabelPoint(path: string): [number, number] {
  const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const index = Math.floor(values.length / 4) * 2;
  return [values[index] ?? 0, values[index + 1] ?? 0];
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

  if (packAsset && geographyDataset?.assetPyramid) {
    return <g key={definition.id} {...surfaceMetadata(definition, dataset)} className={rasterClass}
      style={layerSurfaceStyle(definition, context)}>
      <AtlasRasterSurface overview={packAsset} pyramid={geographyDataset.assetPyramid} />
    </g>;
  }

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
        const point = pathLabelPoint(path);
        return (
          <g key={feature.featureId} className={styles[`lod${feature.displayLod}`]}>
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
          <text data-atlas-label="physical" data-atlas-x={point[0]} data-atlas-y={point[1]} data-atlas-label-min-zoom="3.2"
            data-atlas-label-priority={40 + (feature.sourceScaleRank ?? 5)} className={styles.physicalLabel}
            transform={`translate(${point.join(" ")})`} textAnchor="middle">{feature.name}</text>
          </g>
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
        const point = pathLabelPoint(path);
        return (
          <g key={feature.featureId} className={styles[`lod${feature.displayLod}`]}>
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
          <text data-atlas-label="physical" data-atlas-x={point[0]} data-atlas-y={point[1]} data-atlas-label-min-zoom="2.4"
            data-atlas-label-priority={40 + (feature.sourceScaleRank ?? 5)} className={styles.physicalLabel}
            transform={`translate(${point.join(" ")})`} textAnchor="middle" y={-5}>{feature.name}</text>
          </g>
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
            <g data-atlas-screen-symbol="city" data-atlas-x={point[0]} data-atlas-y={point[1]} transform={`translate(${point.join(" ")})`}>
            <circle r={radius + 1} className={styles.cityHalo} />
            <circle
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
            <text
              data-atlas-label="city"
              data-atlas-x={point[0]} data-atlas-y={point[1]}
              data-atlas-label-priority={20 + (feature.sourceScaleRank ?? 5)}
              data-atlas-label-min-zoom={feature.kind === "city" && feature.isNationalCapital ? 2.6 : 4}
              transform={`translate(${point.join(" ")})`}
              x={8} y={3} className={styles.cityLabel} style={{ display: "none" }}
            >{feature.kind === "city" && feature.isNationalCapital ? "▪ " : ""}{feature.name}</text>
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
      {context.data.geometry.features
        .filter((feature) => feature.tinyRank != null)
        .map((feature) => (
          <circle
            key={`${definition.id}-marker-${feature.entityId}`}
            cx={(feature.labelPoint ?? feature.centroid)[0]}
            cy={(feature.labelPoint ?? feature.centroid)[1]}
            r={7}
            className={styles.tinyHit}
            data-atlas-country={feature.entityId}
            data-atlas-assistance="hit"
            data-atlas-extent={assistanceExtent(feature)}
          />
        ))}
      {/* Polygon hits take priority over every surrogate circle. */}
      {context.data.geometry.features.map((feature) => (
        <use
          key={`${definition.id}-${feature.entityId}`}
          href={`${context.geometryAssetHref}#${geometryAssetId(feature.entityId)}`}
          className={styles.countryHit}
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
          data-atlas-screen-symbol="note"
          data-atlas-x={note.spatial.focus.equalEarth[0]}
          data-atlas-y={note.spatial.focus.equalEarth[1]}
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
              cx={(feature.labelPoint ?? feature.centroid)[0]}
              cy={(feature.labelPoint ?? feature.centroid)[1]}
              r={2.7}
              fill={resolveAtlasLayerValue(definition, { country, feature }).color}
              className={styles.tinyMarker}
              data-atlas-visual={country.id}
              data-atlas-assistance="visual"
              data-atlas-extent={assistanceExtent(feature)}
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
          <stop offset="0%" stopColor="#21475e" />
          <stop offset="100%" stopColor="#112b41" />
        </radialGradient>
      </defs>
      <g data-atlas-map-group data-atlas-zoom-level="world" data-atlas-zoom-scale="1">
        <use href={`${geometryAssetHref}#atlas-sphere`} className={styles.ocean} fill="url(#atlas-ocean-glow)" />
        <use href={`${geometryAssetHref}#atlas-graticule`} className={styles.graticule} />
        <g data-atlas-base-geography="land" className={styles.baseLand}>
          {data.geometry.features.map((feature) => <use key={feature.entityId}
            href={`${geometryAssetHref}#${geometryAssetId(feature.entityId)}`} />)}
        </g>

        {orderedPassiveSurfaces.map((definition) =>
          definition.renderer === "polygon-fill"
            ? renderSharedAdmin0Fill(definition, data, geometryAssetHref)
            : renderCatalogLayer(definition, context),
        )}

        {interactionSurfaces.map((definition) => renderCatalogLayer(definition, context))}
        <g className={styles.boundaryLayer} data-atlas-status-outlines>
          {data.geometry.features.filter((feature) => ATLAS_STATUS_OUTLINE_ENTITY_IDS.has(feature.entityId)).map((feature) => (
            <use key={feature.entityId} href={`${geometryAssetHref}#${geometryAssetId(feature.entityId)}`}
              className={styles.disputedBoundary} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {/* Interactive visual surfaces sit above the broad country hit surface
            so specific feature interaction wins. Their relative order still
            follows catalog zIndex/slot ordering. */}
        {foregroundInteractiveSurfaces.map((definition) => renderCatalogLayer(definition, context))}
        <g className={styles.annotationHighlights}>
          {patternNotes.map((note) => {
            const features = [...geography.featureCollections.majorRivers.features, ...geography.featureCollections.majorLakes.features]
              .filter((feature) => note.spatial.featureIds.includes(feature.featureId));
            const authored = note.spatial.highlight.geometry as { derived?: { path?: string } } | undefined;
            return <g key={note.id} data-atlas-note-highlight={note.id} style={{ display: "none" }}>
              {features.map((feature) => <path key={feature.featureId} d={feature.geometry.derived.path} vectorEffect="non-scaling-stroke" />)}
              {authored?.derived?.path && <path d={authored.derived.path} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
              {features.length === 0 && !authored?.derived?.path && <ellipse cx={note.spatial.focus.equalEarth[0]} cy={note.spatial.focus.equalEarth[1]}
                rx={24} ry={9} vectorEffect="non-scaling-stroke" strokeDasharray="4 4" />}
            </g>;
          })}
        </g>
        <g className={styles.countryLabels}>
          {data.geometry.features.map((feature) => {
            const country = data.countries.find((item) => item.id === feature.entityId);
            if (!country) return null;
            const area = feature.labelArea ?? 0;
            const anchor = feature.labelPoint ?? feature.centroid;
            const minZoom = area > 2600 ? 1 : area > 600 ? 1.8 : area > 120 ? 2.8 : area > 20 ? 4 : 6;
            return <text key={country.id} data-atlas-label="country" data-atlas-label-entity={country.id}
              data-atlas-x={anchor[0]} data-atlas-y={anchor[1]}
              data-atlas-label-min-zoom={minZoom} data-atlas-label-priority={10 - Math.log(Math.max(1, area))}
              transform={`translate(${anchor.join(" ")})`} textAnchor="middle"
              className={styles.countryLabel} style={{ display: "none" }}>{country.name}</text>;
          })}
        </g>
      </g>
    </svg>
  );
}
