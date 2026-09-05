"use client";

import type { AtlasPlaceObservation, AtlasPlaceSummary } from "@/lib/atlas-world/places";
import type { AtlasRuntimeCountrySummary, AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import styles from "./AtlasPlaceCard.module.css";

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function observationQualifier(observation: AtlasPlaceObservation<unknown>) {
  const status = observation.status === "estimated" ? "estimate" : observation.status.replaceAll("_", " ");
  return [observation.observedAt, status === "observed" ? null : status].filter(Boolean).join(" · ");
}

function NumberFact({
  label,
  observation,
  format,
}: {
  label: string;
  observation: AtlasPlaceObservation<number>;
  format: (value: number) => string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{format(observation.value)}</dd>
      {observationQualifier(observation) && <small>{observationQualifier(observation)}</small>}
    </div>
  );
}

function TextFact({ label, observation }: {
  label: string;
  observation: AtlasPlaceObservation<string>;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{observation.value}</dd>
      {observationQualifier(observation) && <small>{observationQualifier(observation)}</small>}
    </div>
  );
}

function ListFact({ label, observation }: {
  label: string;
  observation: AtlasPlaceObservation<string[]>;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{observation.value.join(" · ")}</dd>
      {observationQualifier(observation) && <small>{observationQualifier(observation)}</small>}
    </div>
  );
}

function placeKindLabel(place: AtlasPlaceSummary) {
  if (place.kind === "city") return place.isNationalCapital ? "National capital" : "City";
  if (place.kind === "river") return "River";
  if (place.kind === "lake") return "Lake";
  if (place.kind === "watershed") return "Drainage basin";
  if (place.kind === "water") {
    return place.waterKind[0].toLocaleUpperCase("en-US") + place.waterKind.slice(1);
  }
  return "Place";
}

function coordinatesLabel([longitude, latitude]: [number, number]) {
  const latitudeLabel = `${Math.abs(latitude).toFixed(2)}° ${latitude < 0 ? "S" : "N"}`;
  const longitudeLabel = `${Math.abs(longitude).toFixed(2)}° ${longitude < 0 ? "W" : "E"}`;
  return `${latitudeLabel} · ${longitudeLabel}`;
}

export default function AtlasPlaceCard({
  place,
  countries,
  sources,
  onCountry,
  onPlace,
  onClose,
}: {
  place: AtlasPlaceSummary;
  countries: readonly AtlasRuntimeCountrySummary[];
  sources: readonly AtlasRuntimeSource[];
  onCountry: (countryId: string) => void;
  onPlace?: (placeId: string) => void;
  onClose: () => void;
}) {
  const countryById = new Map(countries.map((country) => [country.id, country]));
  const relatedCountries = place.relatedCountryIds
    .map((countryId) => countryById.get(countryId))
    .filter((country): country is AtlasRuntimeCountrySummary => Boolean(country));
  const usedSources = sources.filter((source) => place.sourceIds.includes(source.id));
  const relationHeading = place.kind === "river"
    ? "Crosses mapped countries"
    : place.kind === "lake"
      ? "Borders mapped countries"
      : place.kind === "water"
        ? "Coastline adjacency"
        : place.kind === "watershed"
          ? "Basin intersects mapped countries"
          : "Country";
  const describedBy = `${place.placeId.replace(/[^A-Za-z0-9_-]/g, "-")}-type`;

  return (
    <aside
      className={styles.card}
      aria-labelledby="atlas-place-title"
      aria-describedby={describedBy}
      data-atlas-place-card={place.kind}
      data-atlas-city-card={place.kind === "city" ? "true" : undefined}
      data-atlas-place-id={place.placeId}
      tabIndex={-1}
    >
      <button className={styles.close} type="button" onClick={onClose} aria-label={`Close ${place.name}`}>
        <span aria-hidden="true">×</span>
      </button>
      <header>
        <span id={describedBy} className={styles.eyebrow}>{placeKindLabel(place)}</span>
        <h2 id="atlas-place-title">{place.name}</h2>
        {place.aliases.length > 0 && <p className={styles.aliases}>Also known as {place.aliases.slice(0, 3).join(" · ")}</p>}
      </header>

      {place.relatedPlaces.length > 0 && (
        <section className={`${styles.relationships} ${styles.connectedPlaces}`} aria-label="Connected geography">
          <h3>Connected geography</h3>
          <div>
            {place.relatedPlaces.slice(0, 8).map((related) => (
              <button key={`${related.relationship}:${related.placeId}`} type="button"
                onClick={() => onPlace?.(related.placeId)} disabled={!onPlace}>
                <span><strong>{related.name}</strong><small>{related.wording}</small></span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          <p>Connections describe sourced or geometry-derived relationships—not causation, ownership, or complete hydrological topology.</p>
        </section>
      )}

      {relatedCountries.length > 0 && (
        <section className={styles.relationships} aria-label={relationHeading}>
          <h3>{relationHeading}</h3>
          <div>
            {relatedCountries.map((country) => (
              <button key={country.id} type="button" onClick={() => onCountry(country.id)}>
                {country.name}<span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          {(place.kind === "river" || place.kind === "lake") && (
            <p>This relationship follows the mapped feature geometry; it does not describe the entire drainage basin.</p>
          )}
          {place.kind === "water" && (
            <p>Adjacency follows the generalized mapped coastline. It is not a claim of ownership, jurisdiction, or a settled maritime boundary.</p>
          )}
          {place.kind === "watershed" && (
            <p>Intersection follows the mapped drainage-basin geometry. A basin is shared physical geography, not political ownership.</p>
          )}
        </section>
      )}

      {place.kind === "city" && (
        <dl className={styles.facts}>
          {place.administrativeRegion && <div><dt>Region</dt><dd>{place.administrativeRegion}</dd></div>}
          {place.population && (
            <NumberFact label="Urban population" observation={place.population} format={(value) => compactNumber.format(value)} />
          )}
          {place.elevationMetres && (
            <NumberFact label="Elevation" observation={place.elevationMetres} format={(value) => `${wholeNumber.format(value)} m`} />
          )}
          <div><dt>Location</dt><dd>{coordinatesLabel(place.coordinates)}</dd></div>
        </dl>
      )}

      {(place.kind === "river" || place.kind === "lake") && (
        <dl className={styles.facts}>
          {place.lengthKm && <NumberFact label="Length" observation={place.lengthKm} format={(value) => `${wholeNumber.format(value)} km`} />}
          {place.areaKm2 && <NumberFact label="Area" observation={place.areaKm2} format={(value) => `${wholeNumber.format(value)} km²`} />}
          {place.maximumDepthMetres && <NumberFact label="Maximum depth" observation={place.maximumDepthMetres} format={(value) => `${wholeNumber.format(value)} m`} />}
          {place.sourcePlace && <TextFact label="Source" observation={place.sourcePlace} />}
          {place.headwaters && <ListFact label="Headwaters" observation={place.headwaters} />}
          {place.mouthPlace && <TextFact label="Mouth" observation={place.mouthPlace} />}
          {place.basinName && <TextFact label="Basin" observation={place.basinName} />}
          {place.basinAreaKm2 && <NumberFact label="Basin area" observation={place.basinAreaKm2} format={(value) => `${wholeNumber.format(value)} km²`} />}
          {place.majorTributaries && <ListFact label="Major tributaries" observation={place.majorTributaries} />}
        </dl>
      )}

      {place.kind === "watershed" && (
        <dl className={styles.facts}>
          <div><dt>River system</dt><dd>{place.linkedRiverPlaceId.split(":").at(-1)?.replaceAll("-", " ")}</dd></div>
        </dl>
      )}

      {usedSources.length > 0 && (
        <details className={styles.sources}>
          <summary>Map source{usedSources.length === 1 ? "" : "s"}</summary>
          <ul>
            {usedSources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">{source.publisher} · {source.title}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
