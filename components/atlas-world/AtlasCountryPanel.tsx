"use client";

import type { AtlasReligionCategory } from "@/lib/atlas-world/types";
import type { AtlasRuntimeCountry, AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import styles from "./AtlasWorld.module.css";

type AtlasCountryPanelProps = {
  country: AtlasRuntimeCountry;
  sources: AtlasRuntimeSource[];
  onClose: () => void;
};

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const RELIGION_LABELS: Record<AtlasReligionCategory, string> = {
  christianity: "Christianity",
  islam: "Islam",
  hinduism: "Hinduism",
  buddhism: "Buddhism",
  judaism: "Judaism",
  folk_or_traditional: "Folk / traditional",
  religiously_unaffiliated: "Religiously unaffiliated",
  other: "Other",
  mixed_or_no_clear_majority: "Mixed / no clear majority",
  unknown: "Unknown",
};

const GOVERNMENT_LABELS = new Map([
  ["presidential_republic", "Presidential republic"],
  ["parliamentary_republic", "Parliamentary republic"],
  ["semi_presidential_republic", "Semi-presidential republic"],
  ["constitutional_monarchy", "Constitutional monarchy"],
  ["absolute_monarchy", "Absolute monarchy"],
  ["one_party_state", "One-party state"],
  ["military_or_transitional", "Military or transitional government"],
  ["theocracy", "Theocracy"],
  ["territory_or_dependency", "Territory or dependency"],
  ["other", "Other system"],
  ["unknown", "Not classified"],
]);

function yearLabel(observedAt: string | null) {
  if (!observedAt) return null;
  const year = observedAt.match(/^\d{4}/)?.[0];
  return year ?? observedAt;
}

function FactYear({ observedAt }: { observedAt: string | null }) {
  const label = yearLabel(observedAt);
  return label ? <span className={styles.factYear}>{label}</span> : null;
}

function EmptyValue() {
  return <span className={styles.missingValue}>Not available</span>;
}

function leadershipPrincipalKey(leadership: NonNullable<AtlasRuntimeCountry["facts"]["headOfState"]>) {
  const principals = leadership.value.officeholders.filter(
    (officeholder) => officeholder.relationship === "principal" || officeholder.relationship === "member",
  );
  return (principals.length ? principals : leadership.value.officeholders)
    .map((officeholder) => officeholder.nameAndTitle)
    .join("|");
}

function LeadershipRole({
  label,
  leadership,
}: {
  label: string;
  leadership: NonNullable<AtlasRuntimeCountry["facts"]["headOfState"]>;
}) {
  return (
    <div className={styles.leadershipRole}>
      <span>{label}</span>
      {leadership.value.isVacant ? (
        <strong>Vacant</strong>
      ) : leadership.value.officeholders.length > 0 ? (
        leadership.value.officeholders.map((officeholder, index) => (
          <div key={`${officeholder.nameAndTitle}-${index}`}>
            <strong>{officeholder.nameAndTitle}</strong>
            {(officeholder.relationship !== "principal" || officeholder.termStartedAt) && (
              <small>
                {officeholder.relationship !== "principal"
                  ? officeholder.relationship.replace(/_/g, " ")
                  : ""}
                {officeholder.relationship !== "principal" && officeholder.termStartedAt ? " · " : ""}
                {officeholder.termStartedAt ? `Since ${officeholder.termStartedAt}` : ""}
              </small>
            )}
          </div>
        ))
      ) : (
        <strong>{leadership.value.raw}</strong>
      )}
    </div>
  );
}

export default function AtlasCountryPanel({ country, sources, onClose }: AtlasCountryPanelProps) {
  const usedSourceIds = new Set(
    Object.values(country.facts)
      .filter((fact) => fact != null)
      .map((fact) => fact.sourceId),
  );
  const usedSources = sources.filter((source) => usedSourceIds.has(source.id));
  const government = country.facts.government;
  const headOfState = country.facts.headOfState;
  const headOfGovernment = country.facts.headOfGovernment;
  const religion = country.facts.religion;
  const population = country.facts.population;
  const area = country.facts.areaKm2;
  const currency = country.facts.currency;
  const languages = country.facts.languages;
  const gdp = country.facts.gdpCurrentUsd;
  const gdpPerCapita = country.facts.gdpPerCapitaCurrentUsd;

  return (
    <aside className={styles.countryPanel} aria-labelledby="atlas-country-title">
      <div className={styles.sheetHandle} aria-hidden="true" />
      <header className={styles.countryHeader}>
        <div className={styles.countryFlag}>
          {country.codes.iso2 && /^[A-Z]{2}$/.test(country.codes.iso2) ? (
            <span
              className={`fi fi-${country.codes.iso2.toLocaleLowerCase("en-US")} ${styles.flagArt}`}
              role="img"
              aria-label={`${country.name} flag`}
            />
          ) : (
            <span className={styles.flagFallback} aria-hidden="true">◈</span>
          )}
        </div>
        <div className={styles.countryIdentity}>
          <p>{[country.geography.region, country.geography.subregion].filter(Boolean).join(" · ")}</p>
          <h2 id="atlas-country-title">{country.name}</h2>
          {country.officialName && country.officialName !== country.name && (
            <span>{country.officialName}</span>
          )}
        </div>
        <button className={styles.panelClose} type="button" onClick={onClose} aria-label={`Close ${country.name}`}>
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {country.geography.boundaryNote && (
        <div className={styles.boundaryNote}>{country.geography.boundaryNote}</div>
      )}

      <section className={styles.panelSection} aria-labelledby="atlas-quick-facts">
        <div className={styles.sectionHeading}>
          <h3 id="atlas-quick-facts">Quick facts</h3>
        </div>
        <dl className={styles.quickFacts}>
          <div>
            <dt>Capital</dt>
            <dd>{country.facts.capital?.value ?? <EmptyValue />}</dd>
          </div>
          <div>
            <dt>Population</dt>
            <dd>
              {population ? compactFormatter.format(population.value) : <EmptyValue />}
              {population && <FactYear observedAt={population.observedAt} />}
            </dd>
          </div>
          <div>
            <dt>Area</dt>
            <dd>
              {area ? `${integerFormatter.format(area.value)} km²` : <EmptyValue />}
            </dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{currency ? `${currency.value.name} (${currency.value.code})` : <EmptyValue />}</dd>
          </div>
          <div className={styles.wideFact}>
            <dt>Languages</dt>
            <dd>
              {languages?.value.length
                ? languages.value.map((language) => language.name ?? language.code).join(", ")
                : <EmptyValue />}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.panelSection} aria-labelledby="atlas-government">
        <div className={styles.sectionHeading}>
          <h3 id="atlas-government">Government</h3>
          {government && <FactYear observedAt={government.observedAt} />}
        </div>
        {government ? (
          <>
            <strong className={styles.primaryFact}>
              {GOVERNMENT_LABELS.get(government.value.category) ?? "Other system"}
            </strong>
            <p className={styles.sourceWording}>{government.value.raw}</p>
          </>
        ) : (
          <EmptyValue />
        )}
        {(headOfState || headOfGovernment) && (
          <div className={styles.leadershipList}>
            {headOfState && headOfGovernment &&
            leadershipPrincipalKey(headOfState) === leadershipPrincipalKey(headOfGovernment) ? (
              <LeadershipRole label="Head of state & government" leadership={headOfState} />
            ) : (
              <>
                {headOfState && <LeadershipRole label="Head of state" leadership={headOfState} />}
                {headOfGovernment && <LeadershipRole label="Head of government" leadership={headOfGovernment} />}
              </>
            )}
          </div>
        )}
      </section>

      <section className={styles.panelSection} aria-labelledby="atlas-religion">
        <div className={styles.sectionHeading}>
          <h3 id="atlas-religion">Religion</h3>
          {religion && <FactYear observedAt={religion.observedAt} />}
        </div>
        {religion ? (
          <>
            <strong className={styles.primaryFact}>
              {RELIGION_LABELS[religion.value.dominantCategory]}
            </strong>
            {religion.value.composition.length > 0 && (
              <div className={styles.compositionList}>
                {religion.value.composition
                  .filter((entry) => entry.sharePercent >= 0.5)
                  .sort((a, b) => b.sharePercent - a.sharePercent)
                  .map((entry) => (
                    <div className={styles.compositionRow} key={entry.category}>
                      <div>
                        <span>{RELIGION_LABELS[entry.category]}</span>
                        <strong>{entry.shareIsApproximate ? "~" : ""}{entry.sharePercent}%</strong>
                      </div>
                      <div className={styles.compositionTrack} aria-hidden="true">
                        <span style={{ width: `${Math.min(100, entry.sharePercent)}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
            )}
            {religion.value.raw && (
              <details className={styles.sourceDetail}>
                <summary>Source wording</summary>
                <p>{religion.value.raw}</p>
              </details>
            )}
          </>
        ) : (
          <EmptyValue />
        )}
      </section>

      <section className={styles.panelSection} aria-labelledby="atlas-economy">
        <div className={styles.sectionHeading}>
          <h3 id="atlas-economy">Economy</h3>
        </div>
        <dl className={styles.economyFacts}>
          <div>
            <dt>GDP</dt>
            <dd>
              {gdp ? moneyFormatter.format(gdp.value) : <EmptyValue />}
              {gdp && <FactYear observedAt={gdp.observedAt} />}
            </dd>
          </div>
          <div>
            <dt>GDP per person</dt>
            <dd>
              {gdpPerCapita ? `$${integerFormatter.format(gdpPerCapita.value)}` : <EmptyValue />}
              {gdpPerCapita && <FactYear observedAt={gdpPerCapita.observedAt} />}
            </dd>
          </div>
          {country.geography.incomeLevel && (
            <div>
              <dt>World Bank group</dt>
              <dd>{country.geography.incomeLevel}</dd>
            </div>
          )}
        </dl>
      </section>

      {country.jjuLinks.length > 0 && (
        <section className={styles.panelSection} aria-labelledby="atlas-jju-links">
          <div className={styles.sectionHeading}>
            <h3 id="atlas-jju-links">Explore in JJ University</h3>
          </div>
          <ul className={styles.jjuLinks}>
            {country.jjuLinks.map((link) => (
              <li key={`${link.kind}-${link.href}`}>
                <a href={link.href}>{link.title}<span>{link.kind}</span></a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className={styles.sourceFooter}>
        <strong>Sources for this country</strong>
        <ul>
          {usedSources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a>
              {source.sourceUpdatedAt && <span> · {yearLabel(source.sourceUpdatedAt)}</span>}
            </li>
          ))}
        </ul>
      </footer>
    </aside>
  );
}
