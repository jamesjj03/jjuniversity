"use client";

import type { AtlasCitySummary } from "@/lib/atlas-world/cities";
import type { AtlasRuntimeCountrySummary, AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import styles from "./AtlasWorld.module.css";

export default function AtlasCityCard({ city, country, sources, onCountry, onClose }: {
  city: AtlasCitySummary; country: AtlasRuntimeCountrySummary | null;
  sources: AtlasRuntimeSource[]; onCountry: () => void; onClose: () => void;
}) {
  const [longitude, latitude] = city.coordinates;
  return <aside className={styles.cityCard} aria-labelledby="atlas-city-name" data-atlas-city-card tabIndex={-1}>
    <button className={styles.cityClose} type="button" onClick={onClose} aria-label={`Close ${city.name}`}>×</button>
    <span>{city.isNationalCapital ? "National capital" : "City"}</span>
    <h2 id="atlas-city-name">{city.name}</h2>
    {country && <button type="button" onClick={onCountry} className={styles.cityCountry}>{country.name} <span aria-hidden="true">→</span></button>}
    <p>{Math.abs(latitude).toFixed(2)}° {latitude < 0 ? "S" : "N"} · {Math.abs(longitude).toFixed(2)}° {longitude < 0 ? "W" : "E"}</p>
    <details><summary>Map source</summary>{sources.filter((source) => city.sourceIds.includes(source.id)).map((source) =>
      <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.publisher} · {source.title}</a>)}
    </details>
  </aside>;
}
