"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { AtlasReligionCategory } from "@/lib/atlas-world/types";
import type { AtlasRuntimeCountry, AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import styles from "./AtlasWorld.module.css";

export type AtlasSheetDetent = "peek" | "half" | "full";

export type AtlasCountryLensContext = {
  name: string;
  description: string;
  valueLabel: string;
  observedAt: string | null;
  sourceIds: string[];
};

type AtlasCountryPanelProps = {
  country: AtlasRuntimeCountry;
  sources: AtlasRuntimeSource[];
  activeLens: AtlasCountryLensContext;
  sheetDetent: AtlasSheetDetent;
  onSheetDetentChange: (detent: AtlasSheetDetent) => void;
  onShowView: (viewId: string) => void;
  onClose: () => void;
};

type CockpitFacet = "overview" | "people" | "politics" | "economy" | "geography" | "jju";

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
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

const DETENT_ORDER: AtlasSheetDetent[] = ["peek", "half", "full"];

function yearLabel(observedAt: string | null) {
  if (!observedAt) return null;
  return observedAt.match(/^\d{4}/)?.[0] ?? observedAt;
}

function FactYear({ observedAt }: { observedAt: string | null }) {
  const label = yearLabel(observedAt);
  return label ? <span className={styles.factYear}>{label}</span> : null;
}

function EmptyValue() {
  return <span className={styles.missingValue}>Not available</span>;
}

function jjuLinkLabel(link: AtlasRuntimeCountry["jjuLinks"][number]) {
  if ("relationshipLabel" in link && typeof link.relationshipLabel === "string") return link.relationshipLabel;
  return link.kind;
}

function LensAction({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.showOnMap} onClick={onClick}>
      <span aria-hidden="true">◎</span>{children}
    </button>
  );
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
                {officeholder.relationship !== "principal" ? officeholder.relationship.replace(/_/g, " ") : ""}
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

export default function AtlasCountryPanel({
  country,
  sources,
  activeLens,
  sheetDetent,
  onSheetDetentChange,
  onShowView,
  onClose,
}: AtlasCountryPanelProps) {
  const [facet, setFacet] = useState<CockpitFacet>("overview");
  const dragStartRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
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
  const dominantReligionComposition = religion?.value.composition.find(
    (entry) => entry.category === religion.value.dominantCategory,
  ) ?? null;

  const facets: Array<{ id: CockpitFacet; label: string }> = [{ id: "overview", label: "Overview" }];
  if (population || religion || languages?.value.length) facets.push({ id: "people", label: "People" });
  if (government || headOfState || headOfGovernment) facets.push({ id: "politics", label: "Politics" });
  if (gdp || gdpPerCapita || country.geography.incomeLevel || currency) facets.push({ id: "economy", label: "Economy" });
  facets.push({ id: "geography", label: "Geography" });
  if (country.jjuLinks.length > 0) facets.push({ id: "jju", label: "JJU" });
  const activeFacet = facets.some((candidate) => candidate.id === facet) ? facet : "overview";

  const usedSourceIds = useMemo(() => {
    const ids = new Set(activeLens.sourceIds);
    Object.values(country.facts)
      .filter((fact) => fact != null)
      .forEach((fact) => ids.add(fact.sourceId));
    return ids;
  }, [activeLens.sourceIds, country.facts]);
  const usedSources = sources.filter((source) => usedSourceIds.has(source.id));
  const lensSources = sources.filter((source) => activeLens.sourceIds.includes(source.id));

  const stepDetent = (direction: -1 | 1) => {
    const index = DETENT_ORDER.indexOf(sheetDetent);
    onSheetDetentChange(DETENT_ORDER[Math.max(0, Math.min(DETENT_ORDER.length - 1, index + direction))]);
  };

  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragStartRef.current = event.clientY;
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragStartRef.current != null && Math.abs(event.clientY - dragStartRef.current) > 8) draggedRef.current = true;
  };

  const onHandlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragStartRef.current == null) return;
    const distance = event.clientY - dragStartRef.current;
    dragStartRef.current = null;
    if (Math.abs(distance) >= 34) stepDetent(distance < 0 ? 1 : -1);
  };

  const cycleDetent = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    stepDetent(sheetDetent === "full" ? -1 : 1);
  };

  return (
    <aside
      className={`${styles.countryPanel} ${styles[`sheet${sheetDetent[0].toUpperCase()}${sheetDetent.slice(1)}`]}`}
      aria-labelledby="atlas-country-title"
      data-atlas-sheet={sheetDetent}
      tabIndex={-1}
    >
      <button
        type="button"
        className={styles.sheetHandle}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onClick={cycleDetent}
        aria-label={`${sheetDetent === "full" ? "Collapse" : "Expand"} country details`}
      ><span /></button>

      <header className={styles.countryHeader}>
        <div className={styles.countryFlag}>
          {country.codes.iso2 && /^[A-Z]{2}$/.test(country.codes.iso2) ? (
            <span className={`fi fi-${country.codes.iso2.toLocaleLowerCase("en-US")} ${styles.flagArt}`} role="img" aria-label={`${country.name} flag`} />
          ) : (
            <span className={styles.flagFallback} aria-hidden="true">◈</span>
          )}
        </div>
        <div className={styles.countryIdentity}>
          <p>{[country.geography.region, country.geography.subregion].filter(Boolean).join(" · ")}</p>
          <h2 id="atlas-country-title">{country.name}</h2>
          {country.officialName && country.officialName !== country.name && <span>{country.officialName}</span>}
        </div>
        <button className={styles.panelClose} type="button" onClick={onClose} aria-label={`Close ${country.name}`}><span aria-hidden="true">×</span></button>
      </header>

      <div className={styles.mobileDetents} role="group" aria-label="Country detail height">
        {DETENT_ORDER.map((detent) => (
          <button key={detent} type="button" aria-pressed={sheetDetent === detent} onClick={() => onSheetDetentChange(detent)}>{detent}</button>
        ))}
      </div>

      <section className={styles.lensContext} aria-label="What the map is showing">
        <div><span>Map is showing</span><strong>{activeLens.name}</strong></div>
        <p>{activeLens.valueLabel}</p>
        <small>
          {yearLabel(activeLens.observedAt) && <span>{yearLabel(activeLens.observedAt)}</span>}
          {yearLabel(activeLens.observedAt) && lensSources.length > 0 ? " · " : ""}
          {lensSources.map((source) => source.publisher).join(" · ")}
        </small>
      </section>

      <div className={styles.cockpitBody}>
        <section className={styles.glance} aria-labelledby="atlas-at-a-glance">
          <div className={styles.sectionHeading}><h3 id="atlas-at-a-glance">At a glance</h3></div>
          <dl>
            <div><dt>Capital</dt><dd>{country.facts.capital?.value ?? <EmptyValue />}</dd></div>
            <div><dt>Population</dt><dd>{population ? compactFormatter.format(population.value) : <EmptyValue />}</dd></div>
            <div><dt>GDP / person</dt><dd>{gdpPerCapita ? `$${integerFormatter.format(gdpPerCapita.value)}` : <EmptyValue />}</dd></div>
            <div><dt>Area</dt><dd>{area ? `${compactFormatter.format(area.value)} km²` : <EmptyValue />}</dd></div>
            <div className={styles.glanceWide}><dt>Government</dt><dd>{government ? GOVERNMENT_LABELS.get(government.value.category) : <EmptyValue />}</dd></div>
            <div><dt>Currency</dt><dd>{currency ? currency.value.code : <EmptyValue />}</dd></div>
          </dl>
        </section>

        <nav className={styles.cockpitTabs} aria-label={`${country.name} information`}>
          {facets.map((candidate) => (
            <button key={candidate.id} type="button" aria-current={candidate.id === activeFacet ? "page" : undefined} onClick={() => setFacet(candidate.id)}>{candidate.label}</button>
          ))}
        </nav>

        <div className={styles.facetBody}>
          {activeFacet === "overview" && (
            <section className={styles.overviewGrid} aria-label="Country overview">
              {government && (
                <article><span>Political system</span><strong>{GOVERNMENT_LABELS.get(government.value.category) ?? "Other system"}</strong><p>{government.value.raw}</p><LensAction onClick={() => onShowView("government")}>Show governments</LensAction></article>
              )}
              {religion && (
                <article><span>Dominant tradition</span><strong>{RELIGION_LABELS[religion.value.dominantCategory]}</strong><p>{dominantReligionComposition ? `${dominantReligionComposition.shareIsApproximate ? "About " : ""}${dominantReligionComposition.sharePercent}% reported in this tradition.` : "The source does not provide a comparable percentage for this classification."}</p><LensAction onClick={() => onShowView("religion")}>Show religions</LensAction></article>
              )}
              {gdpPerCapita && (
                <article><span>Economic scale</span><strong>${integerFormatter.format(gdpPerCapita.value)} per person</strong><p>Current US dollars, {yearLabel(gdpPerCapita.observedAt) ?? "year not reported"}.</p><LensAction onClick={() => onShowView("gdp-per-capita")}>Show GDP per person</LensAction></article>
              )}
              {population && (
                <article><span>People</span><strong>{integerFormatter.format(population.value)}</strong><p>National population estimate, {yearLabel(population.observedAt) ?? "year not reported"}.</p><LensAction onClick={() => onShowView("where-people-live")}>See where people live</LensAction></article>
              )}
            </section>
          )}

          {activeFacet === "people" && (
            <section className={styles.panelSection} aria-labelledby="atlas-people">
              <div className={styles.sectionHeading}><h3 id="atlas-people">People</h3><LensAction onClick={() => onShowView("where-people-live")}>See settlement</LensAction></div>
              <dl className={styles.detailFacts}>
                <div><dt>Population</dt><dd>{population ? integerFormatter.format(population.value) : <EmptyValue />}{population && <FactYear observedAt={population.observedAt} />}</dd><LensAction onClick={() => onShowView("population")}>Compare totals</LensAction></div>
                <div className={styles.detailWide}><dt>Languages</dt><dd>{languages?.value.length ? languages.value.map((language) => language.name ?? language.code).join(", ") : <EmptyValue />}</dd></div>
              </dl>
              {religion && (
                <div className={styles.compositionBlock}>
                  <div className={styles.subsectionHeading}><span>Religious composition</span><LensAction onClick={() => onShowView("religion")}>Show map</LensAction></div>
                  <strong className={styles.primaryFact}>{RELIGION_LABELS[religion.value.dominantCategory]}</strong>
                  {religion.value.composition.length > 0 && (
                    <div className={styles.compositionList}>
                      {religion.value.composition.filter((entry) => entry.sharePercent >= 0.5).sort((a, b) => b.sharePercent - a.sharePercent).map((entry) => (
                        <div className={styles.compositionRow} key={entry.category}>
                          <div><span>{RELIGION_LABELS[entry.category]}</span><strong>{entry.shareIsApproximate ? "~" : ""}{entry.sharePercent}%</strong></div>
                          <div className={styles.compositionTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, entry.sharePercent)}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  )}
                  {religion.value.raw && <details className={styles.sourceDetail}><summary>Source wording</summary><p>{religion.value.raw}</p></details>}
                </div>
              )}
            </section>
          )}

          {activeFacet === "politics" && (
            <section className={styles.panelSection} aria-labelledby="atlas-politics">
              <div className={styles.sectionHeading}><h3 id="atlas-politics">Politics</h3><LensAction onClick={() => onShowView("government")}>Show on map</LensAction></div>
              {government ? <><strong className={styles.primaryFact}>{GOVERNMENT_LABELS.get(government.value.category) ?? "Other system"}</strong><p className={styles.sourceWording}>{government.value.raw}</p><FactYear observedAt={government.observedAt} /></> : <EmptyValue />}
              {(headOfState || headOfGovernment) && (
                <div className={styles.leadershipList}>
                  {headOfState && headOfGovernment && leadershipPrincipalKey(headOfState) === leadershipPrincipalKey(headOfGovernment)
                    ? <LeadershipRole label="Head of state & government" leadership={headOfState} />
                    : <>{headOfState && <LeadershipRole label="Head of state" leadership={headOfState} />}{headOfGovernment && <LeadershipRole label="Head of government" leadership={headOfGovernment} />}</>}
                </div>
              )}
            </section>
          )}

          {activeFacet === "economy" && (
            <section className={styles.panelSection} aria-labelledby="atlas-economy">
              <div className={styles.sectionHeading}><h3 id="atlas-economy">Economy</h3><LensAction onClick={() => onShowView("gdp-per-capita")}>Show on map</LensAction></div>
              <dl className={styles.detailFacts}>
                <div><dt>GDP</dt><dd>{gdp ? moneyFormatter.format(gdp.value) : <EmptyValue />}{gdp && <FactYear observedAt={gdp.observedAt} />}</dd></div>
                <div><dt>GDP per person</dt><dd>{gdpPerCapita ? `$${integerFormatter.format(gdpPerCapita.value)}` : <EmptyValue />}{gdpPerCapita && <FactYear observedAt={gdpPerCapita.observedAt} />}</dd></div>
                <div><dt>World Bank group</dt><dd>{country.geography.incomeLevel ?? <EmptyValue />}</dd></div>
                <div><dt>Currency</dt><dd>{currency ? `${currency.value.name} (${currency.value.code})` : <EmptyValue />}</dd></div>
              </dl>
            </section>
          )}

          {activeFacet === "geography" && (
            <section className={styles.panelSection} aria-labelledby="atlas-geography">
              <div className={styles.sectionHeading}><h3 id="atlas-geography">Geography</h3><LensAction onClick={() => onShowView("where-people-live")}>Show terrain & water</LensAction></div>
              <dl className={styles.detailFacts}>
                <div><dt>Region</dt><dd>{country.geography.region}</dd></div>
                <div><dt>Subregion</dt><dd>{country.geography.subregion}</dd></div>
                <div><dt>Capital</dt><dd>{country.facts.capital?.value ?? <EmptyValue />}</dd></div>
                <div><dt>Area</dt><dd>{area ? `${integerFormatter.format(area.value)} km²` : <EmptyValue />}</dd></div>
                <div><dt>Map-source status</dt><dd>{country.entity.politicalStatus.sourceClassification} (Natural Earth)</dd></div>
                {country.entity.politicalStatus.relationToSovereign === "associated" && (
                  <div className={styles.detailWide}><dt>Associated with</dt><dd>{country.entity.politicalStatus.sovereignName}</dd></div>
                )}
                {country.entity.politicalStatus.relationToSovereign === "contested_or_cartographic" && (
                  <div className={styles.detailWide}><dt>Natural Earth grouping</dt><dd>{country.entity.politicalStatus.sovereignName} · Cartographic metadata, not an Atlas sovereignty judgment.</dd></div>
                )}
              </dl>
              {country.geography.boundaryNote && <div className={styles.boundaryNote}>{country.geography.boundaryNote}</div>}
              <LensAction onClick={() => onShowView("political")}>Show political map</LensAction>
            </section>
          )}

          {activeFacet === "jju" && country.jjuLinks.length > 0 && (
            <section className={styles.panelSection} aria-labelledby="atlas-jju-links">
              <div className={styles.sectionHeading}><h3 id="atlas-jju-links">Explore in JJ University</h3></div>
              <ul className={styles.jjuLinks}>{country.jjuLinks.map((link) => <li key={`${link.kind}-${link.href}`}><a href={link.href}>{link.title}<span>{jjuLinkLabel(link)}</span></a></li>)}</ul>
            </section>
          )}
        </div>

        <footer className={styles.sourceFooter}>
          <strong>Sources for this country</strong>
          <ul>{usedSources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a>{source.sourceUpdatedAt && <span> · {yearLabel(source.sourceUpdatedAt)}</span>}</li>)}</ul>
        </footer>
      </div>
    </aside>
  );
}
