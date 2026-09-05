import type { CSSProperties, ReactNode } from "react";
import {
  ATLAS_DATASET_BY_ID,
  ATLAS_LAYER_DEFINITIONS,
  buildAtlasRenderPlan,
  resolveAtlasLayerValue,
  type AtlasDatasetDefinition,
  type AtlasLayerDefinition,
  type AtlasLayerRendererType,
  type AtlasSceneState,
} from "@/lib/atlas-world/layers";
import { getAtlasGeographyPack, getAtlasPatternNotes } from "@/lib/atlas-world/getAtlasGeography";
import type {
  AtlasGeographyPack,
  AtlasPatternNote,
} from "@/lib/atlas-world/geographyTypes";
import {
  atlasInitialFeatureSurfaceRecords,
  buildAtlasFeatureSurfaceIndex,
  type AtlasFeatureSurfaceRecord,
} from "@/lib/atlas-world/featureSurface";
import type { AtlasRuntimeDataset } from "@/lib/atlas-world/runtime";
import { ATLAS_STATUS_OUTLINE_ENTITY_IDS } from "@/lib/atlas-world/territorialStatus";
import styles from "./AtlasWorld.module.css";
import { atlasLabelPlacement } from "@/lib/atlas-world/labelPlacements";
import AtlasRasterSurface from "./AtlasRasterSurface";
import AtlasFeatureSurface from "./AtlasFeatureSurface";

type AtlasWorldMapProps = {
  data: AtlasRuntimeDataset;
  initialScene: AtlasSceneState;
};

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
  initialFeatureRecords: AtlasFeatureSurfaceRecord[];
};

type AtlasSvgLayerRenderer = (
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) => ReactNode;

const GEOMETRY_ASSET_HREF = "/atlas-world/geometry-mercator.v1.svg";

function geometryAssetId(entityId: string) {
  return `atlas-${entityId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function countryLabelPlan(data: AtlasRuntimeDataset) {
  const importance = (country: AtlasRuntimeDataset["countries"][number]) => {
    const population = country.facts.population?.value ?? 0;
    const area = country.facts.areaKm2?.value ?? 0;
    return Math.log10(Math.max(1, population)) * 0.72 + Math.log10(Math.max(1, area)) * 0.28;
  };
  const ranked = data.countries.slice().sort((left, right) => importance(right) - importance(left));
  const globalRank = new Map(ranked.map((country, index) => [country.id, index]));
  const continentRank = new Map<string, number>();
  for (const continent of new Set(ranked.map((country) => country.geography.continent))) {
    ranked.filter((country) => country.geography.continent === continent)
      .forEach((country, index) => continentRank.set(country.id, index));
  }
  return new Map(data.countries.map((country) => {
    const global = globalRank.get(country.id) ?? 999;
    const regional = continentRank.get(country.id) ?? 999;
    return [country.id, {
      worldScale: global < 24 || regional < 3,
      priority: Math.min(6 + global * 0.15, 7 + regional * 0.45),
    }] as const;
  }));
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
      clipPath={definition.style?.blendMode === "multiply" ? "url(#atlas-physical-land-clip)" : undefined}
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
      clipPath={definition.style?.blendMode === "multiply" ? "url(#atlas-physical-land-clip)" : undefined}
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
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.lakeLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      <AtlasFeatureSurface kind="lake"
        initialFeatures={context.initialFeatureRecords.filter((feature) => feature.kind === "lake")}
        style={definition.style} />
    </g>
  );
}

function renderLineLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.riverLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      <AtlasFeatureSurface kind="river"
        initialFeatures={context.initialFeatureRecords.filter((feature) => feature.kind === "river")}
        style={definition.style} />
    </g>
  );
}

function renderPointSymbolLayer(
  definition: AtlasLayerDefinition,
  dataset: AtlasDatasetDefinition,
  context: AtlasSvgRendererContext,
) {
  return (
    <g
      key={definition.id}
      {...surfaceMetadata(definition, dataset)}
      className={styles.cityLayer}
      style={layerSurfaceStyle(definition, context)}
    >
      <AtlasFeatureSurface kind="city"
        initialFeatures={context.initialFeatureRecords.filter((feature) => feature.kind === "city")}
        style={definition.style} />
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
          data-atlas-x={note.spatial.focus.projected[0]}
          data-atlas-y={note.spatial.focus.projected[1]}
          data-atlas-minimum-zoom={note.triggers.minimumZoom}
          data-atlas-maximum-zoom={note.triggers.maximumZoom}
          transform={`translate(${note.spatial.focus.projected.join(" ")})`}
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

export default function AtlasWorldMap({ data, initialScene }: AtlasWorldMapProps) {
  const geography = getAtlasGeographyPack();
  const patternNotes = getAtlasPatternNotes();
  const geometryAssetHref = `${GEOMETRY_ASSET_HREF}?snapshot=${encodeURIComponent(data.snapshotId)}`;
  const defaultLayerInstances = new Map(
    initialScene.layers.map((instance) => [
      instance.layerId,
      { enabled: instance.enabled, opacity: instance.opacity },
    ]),
  );
  const geographyDatasetById = new Map(geography.datasets.map((dataset) => [dataset.id, dataset]));
  const featureSurfaceRecords = buildAtlasFeatureSurfaceIndex(geography.featureCollections);
  const focusedPlaceId = initialScene.focus?.kind === "feature" ? initialScene.focus.id : null;
  const initialFeatureRecords = atlasInitialFeatureSurfaceRecords(featureSurfaceRecords, focusedPlaceId);
  const bundledResources = new Map<string, unknown>([
    ["atlas-geography-pack.v1", geography],
    ["atlas-pattern-notes.v1", { notes: patternNotes }],
  ]);
  const labelPlan = countryLabelPlan(data);
  const context: AtlasSvgRendererContext = {
    data,
    geometryAssetHref,
    defaultLayerInstances,
    geographyDatasetById,
    bundledResources,
    initialFeatureRecords,
  };

  const defaultFillDefinition = buildAtlasRenderPlan(initialScene).layers
    .map((entry) => entry.definition)
    .find((definition) => definition.renderer === "polygon-fill");
  if (!defaultFillDefinition) throw new Error("The initial Atlas view has no polygon-fill layer.");

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
      data-atlas-initial-view={initialScene.viewPresetId}
      data-atlas-initial-focus={initialScene.focus?.kind ?? "none"}
      aria-hidden="true"
    >
      <defs>
        {/* Relief is a land surface. Do not multiply its flat ocean pixels into
            the water, where the finite raster extent would become a seam. */}
        <clipPath id="atlas-physical-land-clip" clipPathUnits="userSpaceOnUse">
          {data.geometry.features.map((feature) => <use key={feature.entityId}
            href={`${geometryAssetHref}#${geometryAssetId(feature.entityId)}`} />)}
        </clipPath>
      </defs>
      <g data-atlas-map-group data-atlas-zoom-level="world" data-atlas-zoom-scale="1">
        <use href={`${geometryAssetHref}#atlas-sphere`} className={styles.ocean} />
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
              {features.length === 0 && !authored?.derived?.path && <ellipse cx={note.spatial.focus.projected[0]} cy={note.spatial.focus.projected[1]}
                rx={24} ry={9} vectorEffect="non-scaling-stroke" strokeDasharray="4 4" />}
            </g>;
          })}
        </g>
        <g className={styles.countryLabels}>
          {data.geometry.features.map((feature) => {
            const country = data.countries.find((item) => item.id === feature.entityId);
            if (!country) return null;
            const area = feature.labelArea ?? 0;
            const placement = atlasLabelPlacement(country.id);
            const planned = labelPlan.get(country.id);
            const anchor = placement?.point ?? feature.labelPoint ?? feature.centroid;
            const minZoom = area > 2600 ? 1 : area > 600 ? 1.8 : area > 120 ? 2.8 : area > 20 ? 4 : 6;
            return <text key={country.id} data-atlas-label="country" data-atlas-label-entity={country.id}
              data-atlas-x={anchor[0]} data-atlas-y={anchor[1]}
              data-atlas-label-min-zoom={placement?.priority != null || planned?.worldScale ? 1 : minZoom}
              data-atlas-label-priority={placement?.priority ?? planned?.priority ?? 99}
              data-atlas-label-angle={placement?.angle ?? 0}
              data-atlas-label-major={placement?.priority != null ? "true" : "false"}
              transform={`translate(${anchor.join(" ")})`} textAnchor="middle"
              className={styles.countryLabel} style={{ display: "none" }}>{placement?.name ?? country.name}</text>;
          })}
        </g>
      </g>
    </svg>
  );
}
