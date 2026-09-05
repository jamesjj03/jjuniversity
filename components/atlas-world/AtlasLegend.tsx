"use client";

import type {
  AtlasLayerDataResponse,
  AtlasRenderPlan,
  AtlasRenderPlanLayer,
} from "@/lib/atlas-world/layers";
import { ATLAS_LAYER_BY_ID, continuousLegendPosition } from "@/lib/atlas-world/layers";
import type { AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
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
  "population-geography-annotations",
]);

function layerSources(layer: AtlasRenderPlanLayer, sources: AtlasRuntimeSource[]) {
  const ids = new Set([...layer.dataset.sourceIds, ...layer.definition.provenance.sourceIds]);
  return sources.filter((source) => ids.has(source.id));
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
    <ul className={styles.legendItems} tabIndex={0} aria-label={`${layer.definition.name} legend`}>
      {items
        .filter((item) => !count || (count.counts.get(item.key) ?? 0) > 0)
        .map((item) => (
          <li key={item.key} onPointerEnter={() => onHighlightCategory?.(item.key)} onPointerLeave={() => onHighlightCategory?.(null)}
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
        <div><span>Current view</span><h2>{viewName}</h2></div>
      </div>
      <details className={styles.sourcePopover}>
        <summary>Sources</summary>
        <div>
          {sourceRecords.map((source) => (
            <p key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.publisher}</a>
              <small>{source.title}</small>
              <small>{source.sourceUpdatedAt ? `Source updated ${source.sourceUpdatedAt.slice(0, 10)}` : `Retrieved ${source.retrievedAt.slice(0, 10)}`}</small>
            </p>
          ))}
          <span>Country facts snapshot {generatedAt.slice(0, 10)}</span>
        </div>
      </details>
      <p className={styles.legendDescription}>{viewDescription}</p>
      <div className={styles.legendLayers}>
        {informativeLayers.map((layer) => {
          const error = layerErrors[layer.instance.id];
          const loading = layer.dataset.access.kind === "api" && !layerData[layer.instance.id] && !error;
          return <section key={layer.instance.id} className={styles.legendLayer}>
            <LegendItems layer={layer} count={counts.get(layer.instance.id)} onHighlightCategory={onHighlightCategory} />
            {loading && <p className={styles.legendDataStatus}>Loading current values…</p>}
            {error && <p className={`${styles.legendDataStatus} ${styles.legendDataError}`}>Layer data unavailable</p>}
            <details className={styles.legendMethod}>
              <summary>How to read this map</summary>
              <p>{layer.definition.provenance.methodology}</p>
              {layer.definition.provenance.authoredVisualChoices.map((choice) => <p key={choice}>{choice}</p>)}
              {layerSources(layer, sources).map((source) => <small key={source.id}>{source.publisher}{source.sourceUpdatedAt ? ` · ${source.sourceUpdatedAt.slice(0, 4)}` : ""}</small>)}
            </details>
          </section>;
        })}
      </div>
      {layerControls.length > 0 && (
        <details className={styles.mapAppearance}><summary>Map detail & layers</summary><div className={styles.layerToggles} role="group" aria-label="Visible map layers">
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
        </div></details>
      )}
      <p className={styles.legendStatusKey}><i aria-hidden="true" />Dashed outline: <AtlasTerm term="disputed territory">inspect territorial status</AtlasTerm></p>
      <AtlasGlossaryIndex />
      {!plan.valid && <p className={`${styles.legendDataStatus} ${styles.legendDataError}`}>This layer combination could not be rendered safely.</p>}
    </div>
  );

  return (
    <aside
      className={styles.legend}
      aria-label={`${viewName} map legend`}
      aria-hidden={inactive || undefined}
      inert={inactive}
    >
      <div className={styles.desktopLegendBody}>
        {renderLegendBody()}
      </div>
      <details className={styles.legendDisclosure}>
        <summary>
          <span>Layers</span>
          <strong>{viewName}</strong>
          <i aria-hidden="true">⌃</i>
        </summary>
        {renderLegendBody()}
      </details>
    </aside>
  );
}
