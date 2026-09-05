"use client";

import type {
  AtlasLayerDataResponse,
  AtlasRenderPlan,
  AtlasRenderPlanLayer,
} from "@/lib/atlas-world/layers";
import { ATLAS_LAYER_BY_ID, continuousLegendPosition } from "@/lib/atlas-world/layers";
import type { AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import { ATLAS_VIEW_GUIDE_BY_ID } from "@/lib/atlas-world/viewGuides";
import AtlasTerm, { AtlasGlossaryIndex } from "./AtlasTerm";
import styles from "./AtlasWorld.module.css";

type LegendCount = {
  counts: Map<string, number>;
  missing: number;
};

type AtlasLegendProps = {
  viewName: string;
  viewDescription: string;
  plan: AtlasRenderPlan;
  counts: Map<string, LegendCount>;
  sources: AtlasRuntimeSource[];
  generatedAt: string;
  layerData: Record<string, AtlasLayerDataResponse>;
  layerErrors: Record<string, string>;
  onToggleLayer?: (instanceId: string) => void;
  inactive?: boolean;
  onHighlightCategory?: (key: string | null) => void;
};

const EXPLORABLE_LAYER_IDS = new Set([
  "physical-relief",
  "population-density-2025",
  "major-lakes",
  "major-rivers",
  "major-cities",
  "major-water-bodies",
  "watershed-pilot",
  "population-geography-annotations",
]);

function layerSources(layer: AtlasRenderPlanLayer, sources: AtlasRuntimeSource[]) {
  const ids = new Set([...layer.dataset.sourceIds, ...layer.definition.provenance.sourceIds]);
  return sources.filter((source) => ids.has(source.id));
}

function yearFromDate(value: string | null | undefined) {
  return value?.match(/^\d{4}/)?.[0] ?? null;
}

function observationPeriod(plan: AtlasRenderPlan, layerData: Record<string, AtlasLayerDataResponse>) {
  const years = new Set<string>();
  for (const layer of plan.layers) {
    const payload = layerData[layer.instance.id];
    for (const value of payload?.values ?? []) {
      const year = yearFromDate(value.observedAt);
      if (year) years.add(year);
    }
    if (layer.dataset.id === "population-density-2025") years.add("2025");
  }
  const sorted = [...years].sort();
  if (sorted.length === 1) return sorted[0];
  if (sorted.length > 1) return `${sorted[0]}–${sorted.at(-1)}`;
  if (plan.layers.every((layer) => layer.dataset.temporal.kind === "timeless")) return "Timeless geography";
  if (plan.scene.viewPresetId === "political") return "Present-day map";
  return "Latest sourced values";
}

function LegendItems({ layer, count, onHighlightCategory }: { layer: AtlasRenderPlanLayer; count: LegendCount | undefined; onHighlightCategory?: (key: string | null) => void }) {
  const legend = layer.definition.legend;
  const missing = layer.definition.missingData.styles.unavailable;
  if (legend.kind === "none") return null;

  if (legend.kind === "continuous") {
    const gradient = `linear-gradient(90deg, ${legend.stops.map((stop) => `${stop.color} ${stop.position * 100}%`).join(", ")})`;
    return (
      <div className={styles.continuousLegend}>
        <div className={styles.legendGradient} style={{ background: gradient }} aria-hidden="true" />
        <div className={styles.legendTicks}>
          {legend.ticks.map((tick) => {
            const position = Math.min(1, Math.max(0, continuousLegendPosition(tick.value, legend)));
            return (
              <span
                key={tick.value}
                data-atlas-continuous-tick={tick.value}
                style={{ left: `${position * 100}%`, transform: `translateX(-${position * 100}%)` }}
              >
                {tick.label}
              </span>
            );
          })}
        </div>
        <small>{legend.unit.replace(/_/g, " ")}</small>
        {Boolean(count?.missing) && missing && (
          <div className={styles.legendMissing}>
            <i style={{ backgroundColor: missing.color }} />
            <span>{missing.label}</span>
            <small>{count?.missing} places</small>
          </div>
        )}
      </div>
    );
  }

  const items = legend.items;
  const navigationPalette = legend.kind === "categorical"
    && new Set(items.map((item) => item.label)).size === 1;
  if (navigationPalette) {
    return (
      <div className={styles.politicalLegend}>
        {items.map((item) => <span key={item.key} style={{ backgroundColor: item.color }} />)}
        <small>Colors separate neighboring places; they do not encode similarity.</small>
      </div>
    );
  }

  return (
    <ul className={styles.legendItems} aria-label={`${layer.definition.name} legend`}>
      {items
        .filter((item) => !count || (count.counts.get(item.key) ?? 0) > 0)
        .map((item) => (
          <li key={item.key} tabIndex={0} onPointerEnter={() => onHighlightCategory?.(item.key)} onPointerLeave={() => onHighlightCategory?.(null)}
            onFocus={() => onHighlightCategory?.(item.key)} onBlur={() => onHighlightCategory?.(null)}>
            <i style={{ backgroundColor: item.color }} />
            <span><AtlasTerm term={item.key} context={layer.definition.id === "admin0-religion" ? "religion" : undefined}>{item.label}</AtlasTerm></span>
            {count && <small>{count.counts.get(item.key) ?? 0}</small>}
          </li>
        ))}
      {Boolean(count?.missing) && missing && (
        <li>
          <i style={{ backgroundColor: missing.color }} />
          <span>{missing.label}</span>
          <small>{count?.missing}</small>
        </li>
      )}
    </ul>
  );
}

export default function AtlasLegend({
  viewName,
  viewDescription,
  plan,
  counts,
  sources,
  generatedAt,
  layerData,
  layerErrors,
  onToggleLayer,
  inactive = false,
  onHighlightCategory,
}: AtlasLegendProps) {
  const informativeLayers = plan.layers.filter((layer) => layer.definition.legend.kind !== "none" && layer.instance.parameters.role !== "context");
  const sourceRecords = sources.filter((source) => plan.sources.includes(source.id));
  const viewGuide = ATLAS_VIEW_GUIDE_BY_ID.get(plan.scene.viewPresetId);
  const layerControls = onToggleLayer
    ? plan.scene.layers.flatMap((instance) => {
        const definition = ATLAS_LAYER_BY_ID.get(instance.layerId);
        return definition && EXPLORABLE_LAYER_IDS.has(instance.layerId)
          ? [{ instance, definition }]
          : [];
      })
    : [];

  const renderLegendBody = () => (
    <div className={styles.legendBody}>
      <div className={styles.legendHeader}>
        <div><span>Map key</span><h2>{viewName}</h2></div>
        <div className={styles.legendMeta}>
          <b>{observationPeriod(plan, layerData)}</b>
          {informativeLayers.some((layer) => (counts.get(layer.instance.id)?.missing ?? 0) > 0) && (
            <span>{Math.max(...informativeLayers.map((layer) => counts.get(layer.instance.id)?.missing ?? 0))} without comparable data</span>
          )}
        </div>
      </div>
      <p className={styles.legendDescription}>{viewDescription}</p>
      <div className={styles.legendLayers}>
        {informativeLayers.map((layer) => {
          const error = layerErrors[layer.instance.id];
          const loading = layer.dataset.access.kind === "api" && !layerData[layer.instance.id] && !error;
          return <section key={layer.instance.id} className={styles.legendLayer}>
            <LegendItems layer={layer} count={counts.get(layer.instance.id)} onHighlightCategory={onHighlightCategory} />
            {loading && <p className={styles.legendDataStatus}>Loading current values…</p>}
            {error && <p className={`${styles.legendDataStatus} ${styles.legendDataError}`}>Layer data unavailable</p>}
          </section>;
        })}
      </div>
      {informativeLayers.length > 0 && <p className={styles.legendInteractionHint}>
        {informativeLayers.some((layer) => layer.definition.legend.kind === "categorical")
          ? "Point at a key color to isolate it. Select a place for its sourced value."
          : "Select a place to read its value and how it compares."}
      </p>}
      {viewGuide && <details className={styles.legendMeaning}>
        <summary>What this means</summary>
        <div><p>{viewGuide.plainMeaning}</p><p>{viewGuide.whyItMatters}</p><small>{viewGuide.caution}</small></div>
      </details>}
      {layerControls.length > 0 && (
        <section className={styles.mapAppearance} aria-label="Map detail and layers"><h3>Map detail</h3><div className={styles.layerToggles} role="group" aria-label="Visible map layers">
          {layerControls.map(({ instance, definition }) => (
            <button
              key={instance.id}
              type="button"
              aria-pressed={instance.enabled}
              onClick={() => onToggleLayer?.(instance.id)}
            >
              <i aria-hidden="true" />
              <span>{definition.name}</span>
            </button>
          ))}
        </div></section>
      )}
      <p className={styles.legendStatusKey}><i aria-hidden="true" />Dashed outline: <AtlasTerm term="disputed territory">inspect territorial status</AtlasTerm></p>
      <details className={styles.sourcePopover}>
        <summary>Sources & methodology</summary>
        <div>
          {informativeLayers.map((layer) => <section key={layer.instance.id} className={styles.legendMethod}>
            <strong>{layer.definition.name}</strong>
            <p>{layer.definition.provenance.methodology}</p>
            {layer.definition.provenance.authoredVisualChoices.map((choice) => <p key={choice}>{choice}</p>)}
            {layerSources(layer, sources).map((source) => <small key={source.id}>{source.publisher}{source.sourceUpdatedAt ? ` · ${source.sourceUpdatedAt.slice(0, 4)}` : ""}</small>)}
          </section>)}
          {sourceRecords.map((source) => (
            <p key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.publisher}</a>
              <small>{source.title}</small>
              <small>{source.sourceUpdatedAt ? `Source updated ${source.sourceUpdatedAt.slice(0, 10)}` : `Retrieved ${source.retrievedAt.slice(0, 10)}`}</small>
            </p>
          ))}
          <span>Atlas snapshot {generatedAt.slice(0, 10)}</span>
          <p>Mercator keeps local directions and shapes familiar, but exaggerates land area near the poles. Use area figures to compare country size.</p>
          <AtlasGlossaryIndex />
        </div>
      </details>
      {!plan.valid && <p className={`${styles.legendDataStatus} ${styles.legendDataError}`}>This layer combination could not be rendered safely.</p>}
    </div>
  );

  return (
    <aside
      className={`${styles.legend} ${plan.scene.viewPresetId === "political" ? styles.legendMinimal : ""}`}
      aria-label={`${viewName} map legend`}
      aria-hidden={inactive || undefined}
      inert={inactive}
    >
      <div className={styles.desktopLegendBody}>
        {renderLegendBody()}
      </div>
      <details className={styles.legendDisclosure}>
        <summary>
          <span>Map key</span>
          <strong>{viewName}</strong>
          <i aria-hidden="true">⌃</i>
        </summary>
        {renderLegendBody()}
      </details>
    </aside>
  );
}
