import { ATLAS_MAP_MODE_BY_ID } from "@/lib/atlas-world/mapModes";
import type { AtlasRuntimeDataset } from "@/lib/atlas-world/runtime";
import styles from "./AtlasWorld.module.css";

type AtlasWorldMapProps = {
  data: AtlasRuntimeDataset;
};

const GEOMETRY_ASSET_HREF = "/atlas-world/geometry-equal-earth.v1.svg";

function geometryAssetId(entityId: string) {
  return `atlas-${entityId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export default function AtlasWorldMap({ data }: AtlasWorldMapProps) {
  const countryById = new Map(data.countries.map((country) => [country.id, country]));
  const politicalMode = ATLAS_MAP_MODE_BY_ID.get("political")!;
  const geometryAssetHref = `${GEOMETRY_ASSET_HREF}?snapshot=${encodeURIComponent(data.snapshotId)}`;

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
      <g data-atlas-map-group>
        <use href={`${geometryAssetHref}#atlas-sphere`} className={styles.ocean} fill="url(#atlas-ocean-glow)" />
        <use href={`${geometryAssetHref}#atlas-graticule`} className={styles.graticule} />
        {data.geometry.features.map((feature) => {
          const country = countryById.get(feature.entityId);
          if (!country) return null;
          return (
            <use
              key={feature.entityId}
              href={`${geometryAssetHref}#${geometryAssetId(feature.entityId)}`}
              fill={politicalMode.color({ country, mapColor7: feature.mapColor7 })}
              className={styles.countryShape}
              data-atlas-country={country.id}
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
              <g key={`marker-${feature.entityId}`}>
                <circle
                  cx={feature.centroid[0]}
                  cy={feature.centroid[1]}
                  r={12}
                  className={styles.tinyHit}
                  data-atlas-country={country.id}
                />
                <circle
                  cx={feature.centroid[0]}
                  cy={feature.centroid[1]}
                  r={2.7}
                  fill={politicalMode.color({ country, mapColor7: feature.mapColor7 })}
                  className={styles.tinyMarker}
                  data-atlas-visual={country.id}
                  data-map-color={feature.mapColor7 ?? 0}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
      </g>
    </svg>
  );
}
