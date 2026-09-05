"use client";

import Image from "next/image";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { AtlasReligionCategory } from "@/lib/atlas-world/types";
import type { AtlasRuntimeCountry, AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import { findAtlasPortrait } from "@/lib/atlas-world/portraitPilot";
import { getAtlasTerritorialStatus } from "@/lib/atlas-world/territorialStatus";
import { ATLAS_LAYER_BY_ID } from "@/lib/atlas-world/layers";
import AtlasTerm from "./AtlasTerm";
import styles from "./AtlasCountryPanel.module.css";

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
type LeadershipFact = NonNullable<AtlasRuntimeCountry["facts"]["headOfState"]>;
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const RELIGION_LABELS: Record<AtlasReligionCategory, string> = {
  christianity: "Christianity", islam: "Islam", hinduism: "Hinduism", buddhism: "Buddhism", judaism: "Judaism",
  folk_or_traditional: "Folk / traditional", religiously_unaffiliated: "Unaffiliated", other: "Other",
  mixed_or_no_clear_majority: "Mixed / no clear majority", unknown: "Unknown",
};
const religionLegend = ATLAS_LAYER_BY_ID.get("admin0-religion")?.legend;
const RELIGION_COLORS = new Map(religionLegend?.kind === "categorical" ? religionLegend.items.map((item) => [item.key, item.color]) : []);
const GOVERNMENT_LABELS = new Map([
  ["presidential_republic", "Presidential republic"], ["parliamentary_republic", "Parliamentary republic"],
  ["semi_presidential_republic", "Semi-presidential republic"], ["constitutional_monarchy", "Constitutional monarchy"],
  ["absolute_monarchy", "Absolute monarchy"], ["one_party_state", "One-party state"],
  ["military_or_transitional", "Military / transitional"], ["theocracy", "Theocracy"],
  ["territory_or_dependency", "Territory / dependency"], ["other", "Other system"], ["unknown", "Not classified"],
]);
const DETENT_ORDER: AtlasSheetDetent[] = ["peek", "half", "full"];

function yearLabel(value: string | null) { return value?.match(/^\d{4}/)?.[0] ?? value; }
function FactYear({ observedAt }: { observedAt: string | null }) { return observedAt ? <span className={styles.factYear}>{yearLabel(observedAt)}</span> : null; }
function EmptyValue() { return <span className={styles.missingValue}>Not available</span>; }
function jjuLinkLabel(link: AtlasRuntimeCountry["jjuLinks"][number]) { return "relationshipLabel" in link && typeof link.relationshipLabel === "string" ? link.relationshipLabel : link.kind; }
function LensAction({ children, onClick }: { children: string; onClick: () => void }) { return <button type="button" className={styles.showOnMap} onClick={onClick}><span aria-hidden="true">↗</span>{children}</button>; }
function GovernmentName({ category }: { category: string }) { return <AtlasTerm term={category} context="government">{GOVERNMENT_LABELS.get(category) ?? "Other system"}</AtlasTerm>; }

function LeadershipRole({ countryId, role, label, leadership, compact = false }: {
  countryId: string; role: "headOfState" | "headOfGovernment"; label: string; leadership: LeadershipFact; compact?: boolean;
}) {
  const people = leadership.value.officeholders;
  const shown = compact ? people.filter((person) => person.relationship === "principal" || person.relationship === "member").slice(0, 2) : people;
  const visiblePeople = shown.length ? shown : people.slice(0, compact ? 1 : undefined);
  return <div className={styles.leadershipRole}>
    {leadership.value.isVacant ? <div className={styles.leaderText}><span>{label}</span><strong>Vacant in this source record</strong></div>
      : visiblePeople.length ? visiblePeople.map((officeholder, index) => {
        const portrait = findAtlasPortrait(countryId, role, leadership, officeholder);
        return <div className={styles.leader} key={`${officeholder.nameAndTitle}-${index}`} data-atlas-person={portrait?.person.id}>
          {portrait && <div className={styles.portraitWrap}>
            <Image className={styles.portrait} src={portrait.media.href} width={portrait.media.width} height={portrait.media.height} alt={portrait.person.name} sizes="76px" unoptimized />
            <details className={styles.portraitCredit}>
              <summary aria-label={`Photo credit for ${portrait.person.name}`}>ⓘ</summary>
              <div><strong>{portrait.media.author}</strong><span>Photographed {portrait.media.photoDate}</span><a href={portrait.media.sourceUrl} target="_blank" rel="noreferrer">Image source</a><a href={portrait.media.licenseUrl} target="_blank" rel="noreferrer">{portrait.media.licenseName}</a><p>{portrait.media.changes}</p>{portrait.media.attributionStatement && <p>{portrait.media.attributionStatement}</p>}</div>
            </details>
          </div>}
          <div className={styles.leaderText}><span>{label}</span><strong>{portrait?.person.name ?? officeholder.nameAndTitle}</strong>{portrait && <b>{portrait.title}</b>}<small>{officeholder.relationship !== "principal" ? `${officeholder.relationship.replace(/_/g, " ")} · ` : ""}{officeholder.termStartedAt ? `Since ${officeholder.termStartedAt}` : "Term date not recorded"}</small></div>
        </div>;
      }) : <div className={styles.leaderText}><span>{label}</span><strong>{leadership.value.raw}</strong></div>}
    {compact && people.length > visiblePeople.length && <small className={styles.additionalLeaders}>{people.length - visiblePeople.length} additional officeholder(s) in Politics</small>}
    <small className={styles.leadershipDate}>Officeholder record · {leadership.observedAt ?? "date not available"}</small>
  </div>;
}
function Leadership({ country, compact = false }: { country: AtlasRuntimeCountry; compact?: boolean }) {
  const state = country.facts.headOfState;
  const government = country.facts.headOfGovernment;
  if (!state && !government) return null;
  const same = state && government && state.value.raw === government.value.raw && state.observedAt === government.observedAt;
  return <section className={styles.leadership} aria-label="Leadership snapshot">
    {same ? <LeadershipRole countryId={country.id} role="headOfState" label="Head of state & government" leadership={state} compact={compact} /> : <>{state && <LeadershipRole countryId={country.id} role="headOfState" label="Head of state" leadership={state} compact={compact} />}{government && <LeadershipRole countryId={country.id} role="headOfGovernment" label="Head of government" leadership={government} compact={compact} />}</>}
    <p className={styles.snapshotNote}>Archived Factbook snapshot, not a live officeholder feed.</p>
  </section>;
}
function ReligionComposition({ religion, onShowView }: { religion: NonNullable<AtlasRuntimeCountry["facts"]["religion"]>; onShowView: (view: string) => void }) {
  const entries = [...religion.value.composition].sort((a, b) => b.sharePercent - a.sharePercent);
  const sum = entries.reduce((total, entry) => total + entry.sharePercent, 0);
  const sourceNote = religion.value.raw.match(/\bnote:\s*(.+)$/i)?.[1] ?? null;
  const sourcePeriod = religion.observedAt ?? religion.value.raw.match(/\((\d{4}(?:[-–]\d{2,4})?[^)]*)\)/)?.[1] ?? null;
  const dominantShareMissing = religion.value.dominantCategory !== "mixed_or_no_clear_majority" && !entries.some((entry) => entry.category === religion.value.dominantCategory);
  return <section className={styles.compositionBlock} aria-label="Religious composition" data-atlas-religion-composition>
    <div className={styles.sectionHeading}><h3>Religious composition</h3><LensAction onClick={() => onShowView("religion")}>Show map</LensAction></div>
    <p className={styles.compositionSummary}><AtlasTerm term="dominant-religious-tradition">Map color</AtlasTerm>: <strong>{RELIGION_LABELS[religion.value.dominantCategory]}</strong><span className={styles.factYear}>{sourcePeriod ?? "Date not reported"}</span></p>
    {entries.length ? <div className={styles.compositionList}>{entries.map((entry) => <div className={styles.compositionRow} key={entry.category}><div><span>{RELIGION_LABELS[entry.category]}</span><strong>{entry.shareIsApproximate ? "~" : ""}{entry.sharePercent}%</strong></div><div className={styles.compositionTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, entry.sharePercent)}%`, background: RELIGION_COLORS.get(entry.category) ?? "#9caab9" }} /></div></div>)}</div> : <p className={styles.contextCopy}>The source gives a broad classification, but no comparable percentage breakdown.</p>}
    {sourceNote && <p className={styles.compositionCaveat}>Source note: {sourceNote}</p>}
    {dominantShareMissing && entries.length > 0 && <p className={styles.compositionCaveat}>No comparable percentage is available for the dominant tradition. Only the explicitly measured shares are charted.</p>}
    {sum > 100.5 && <p className={styles.compositionCaveat}>Reported shares total more than 100%. They may overlap or use different denominators; do not read these bars as exclusive parts of a whole.</p>}
    {entries.length > 0 && sum < 99.5 && <p className={styles.compositionCaveat}>Available shares do not cover the whole population. Unreported shares are not filled in.</p>}
    <details className={styles.sourceDetail}><summary>Source wording & method</summary><p>{religion.value.raw}</p>{religion.notes.map((note) => <p key={note}>{note}</p>)}<small>Observation: {religion.observedAt ?? "not dated"} · Archived CIA World Factbook. Broad traditions are grouped for the map; the source wording retains distinctions.</small></details>
  </section>;
}

export default function AtlasCountryPanel({ country, sources, activeLens, sheetDetent, onSheetDetentChange, onShowView, onClose }: AtlasCountryPanelProps) {
  const [facet, setFacet] = useState<CockpitFacet>("overview");
  const dragStartRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const { government, headOfState, headOfGovernment, religion, population, areaKm2: area, currency, languages, gdpCurrentUsd: gdp, gdpPerCapitaCurrentUsd: gdpPerCapita } = country.facts;
  const status = getAtlasTerritorialStatus(country);
  const facets: Array<{ id: CockpitFacet; label: string }> = [{ id: "overview", label: "Overview" }];
  if (population || religion || languages?.value.length) facets.push({ id: "people", label: "People" });
  if (government || headOfState || headOfGovernment) facets.push({ id: "politics", label: "Politics" });
  if (gdp || gdpPerCapita || country.geography.incomeLevel || currency) facets.push({ id: "economy", label: "Economy" });
  facets.push({ id: "geography", label: "Geography" });
  if (country.jjuLinks.length) facets.push({ id: "jju", label: "JJU" });
  const activeFacet = facets.some((candidate) => candidate.id === facet) ? facet : "overview";
  const religionLens = activeLens.name.toLowerCase().includes("religion");
  const usedSourceIds = useMemo(() => { const ids = new Set(activeLens.sourceIds); Object.values(country.facts).forEach((fact) => { if (fact) ids.add(fact.sourceId); }); return ids; }, [activeLens.sourceIds, country.facts]);
  const usedSources = sources.filter((source) => usedSourceIds.has(source.id));
  const lensSources = sources.filter((source) => activeLens.sourceIds.includes(source.id));
  const stepDetent = (direction: -1 | 1) => { const index = DETENT_ORDER.indexOf(sheetDetent); onSheetDetentChange(DETENT_ORDER[Math.max(0, Math.min(DETENT_ORDER.length - 1, index + direction))]); };
  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => { dragStartRef.current = event.clientY; draggedRef.current = false; event.currentTarget.setPointerCapture(event.pointerId); };
  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => { if (dragStartRef.current != null && Math.abs(event.clientY - dragStartRef.current) > 8) draggedRef.current = true; };
  const onHandlePointerUp = (event: PointerEvent<HTMLButtonElement>) => { if (dragStartRef.current == null) return; const distance = event.clientY - dragStartRef.current; dragStartRef.current = null; if (Math.abs(distance) >= 34) stepDetent(distance < 0 ? 1 : -1); };
  const cycleDetent = () => { if (draggedRef.current) { draggedRef.current = false; return; } stepDetent(sheetDetent === "full" ? -1 : 1); };

  return <aside className={styles.countryPanel} aria-labelledby="atlas-country-title" data-atlas-sheet={sheetDetent} tabIndex={-1}>
    <div className={styles.persistentHeader}>
      <button type="button" className={styles.sheetHandle} onPointerDown={onHandlePointerDown} onPointerMove={onHandlePointerMove} onPointerUp={onHandlePointerUp} onPointerCancel={() => { dragStartRef.current = null; }} onClick={cycleDetent} aria-label={`${sheetDetent === "full" ? "Collapse" : "Expand"} country details`}><span /></button>
      <header className={styles.countryHeader}>
        <div className={styles.countryFlag}>{country.codes.iso2 && /^[A-Z]{2}$/.test(country.codes.iso2) ? <span className={`fi fi-${country.codes.iso2.toLowerCase()} ${styles.flagArt}`} role="img" aria-label={`${country.name} flag`} /> : <span className={styles.flagFallback} aria-hidden="true">◈</span>}</div>
        <div className={styles.countryIdentity}><p>{country.geography.subregion || country.geography.region}</p><h2 id="atlas-country-title">{country.name}</h2>{country.officialName && country.officialName !== country.name && <span>{country.officialName}</span>}</div>
        <button className={styles.panelClose} type="button" onClick={onClose} aria-label={`Close ${country.name}`}><span aria-hidden="true">×</span></button>
      </header>
      <div className={styles.mobileDetents} role="group" aria-label="Country detail height">{DETENT_ORDER.map((detent) => <button key={detent} type="button" aria-pressed={sheetDetent === detent} onClick={() => onSheetDetentChange(detent)}>{detent}</button>)}</div>
      <section className={styles.lensContext} aria-label="What the map is showing"><div><span>On the map</span><strong>{activeLens.name}</strong></div><p>{activeLens.valueLabel}</p><small>{[yearLabel(activeLens.observedAt), ...lensSources.map((source) => source.publisher === "CIA World Factbook content preserved by pmusser via Internet Archive" ? "Archived Factbook" : source.publisher)].filter(Boolean).join(" · ")}</small></section>
    </div>
    <div className={styles.cockpitBody}>
      {status.kind !== "standard" && <details className={styles.statusNote} data-atlas-territorial-status={status.kind}><summary>{status.badge}</summary><p>{status.summary}</p><small>{status.caveat}</small><ul>{status.evidence.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a></li>)}</ul></details>}
      {religionLens && religion && <ReligionComposition religion={religion} onShowView={onShowView} />}
      {activeFacet === "overview" && <Leadership country={country} compact />}
      <section className={styles.glance} aria-labelledby="atlas-at-a-glance"><h3 id="atlas-at-a-glance">At a glance</h3><dl>
        <div><dt>Capital</dt><dd>{country.facts.capital?.value ?? <EmptyValue />}</dd></div><div><dt>Population</dt><dd>{population ? compactFormatter.format(population.value) : <EmptyValue />}{population && <FactYear observedAt={population.observedAt} />}</dd></div><div><dt><AtlasTerm term="gdp-per-capita">GDP / person</AtlasTerm></dt><dd>{gdpPerCapita ? moneyFormatter.format(gdpPerCapita.value) : <EmptyValue />}{gdpPerCapita && <FactYear observedAt={gdpPerCapita.observedAt} />}</dd></div><div><dt>Area</dt><dd>{area ? `${compactFormatter.format(area.value)} km²` : <EmptyValue />}</dd></div><div><dt>Currency</dt><dd>{currency ? currency.value.code : <EmptyValue />}</dd></div><div className={styles.glanceWide}><dt>Government</dt><dd>{government ? <GovernmentName category={government.value.category} /> : <EmptyValue />}</dd></div>
      </dl></section>
      <nav className={styles.cockpitTabs} aria-label={`${country.name} information`}>{facets.map((candidate) => <button key={candidate.id} type="button" aria-current={candidate.id === activeFacet ? "page" : undefined} onClick={() => setFacet(candidate.id)}>{candidate.label}</button>)}</nav>
      <div className={styles.facetBody}>
        {activeFacet === "overview" && <section aria-label="Country overview">
          {!religionLens && religion && <ReligionComposition religion={religion} onShowView={onShowView} />}
          {languages?.value.length ? <div className={styles.inlineDetail}><span>Languages</span><p>{languages.value.map((language) => language.name ?? language.code).join(", ")}</p></div> : null}
          <div className={styles.exploreRows}>{government && <LensAction onClick={() => onShowView("government")}>Show governments</LensAction>}{gdpPerCapita && <LensAction onClick={() => onShowView("gdp-per-capita")}>Show GDP per person</LensAction>}{population && <LensAction onClick={() => onShowView("where-people-live")}>See where people live</LensAction>}</div>
        </section>}
        {activeFacet === "people" && <section aria-labelledby="atlas-people"><div className={styles.sectionHeading}><h3 id="atlas-people">People</h3><LensAction onClick={() => onShowView("where-people-live")}>See settlement</LensAction></div><dl className={styles.detailFacts}><div><dt>Population</dt><dd>{population ? integerFormatter.format(population.value) : <EmptyValue />}{population && <FactYear observedAt={population.observedAt} />}</dd></div><div><dt>Languages</dt><dd>{languages?.value.length ? languages.value.map((language) => language.name ?? language.code).join(", ") : <EmptyValue />}</dd></div></dl><LensAction onClick={() => onShowView("population")}>Compare totals</LensAction>{!religionLens && religion && <ReligionComposition religion={religion} onShowView={onShowView} />}</section>}
        {activeFacet === "politics" && <section aria-labelledby="atlas-politics"><div className={styles.sectionHeading}><h3 id="atlas-politics">Politics</h3><LensAction onClick={() => onShowView("government")}>Show on map</LensAction></div>{government ? <><strong className={styles.primaryFact}><GovernmentName category={government.value.category} /></strong><p className={styles.contextCopy}>{government.value.raw}</p><FactYear observedAt={government.observedAt} /></> : <EmptyValue />}<Leadership country={country} /></section>}
        {activeFacet === "economy" && <section aria-labelledby="atlas-economy"><div className={styles.sectionHeading}><h3 id="atlas-economy">Economy</h3><LensAction onClick={() => onShowView("gdp-per-capita")}>Show on map</LensAction></div><dl className={styles.detailFacts}><div><dt>GDP</dt><dd>{gdp ? moneyFormatter.format(gdp.value) : <EmptyValue />}{gdp && <FactYear observedAt={gdp.observedAt} />}</dd></div><div><dt>GDP per person</dt><dd>{gdpPerCapita ? `$${integerFormatter.format(gdpPerCapita.value)}` : <EmptyValue />}{gdpPerCapita && <FactYear observedAt={gdpPerCapita.observedAt} />}</dd></div><div><dt>World Bank group</dt><dd>{country.geography.incomeLevel ?? <EmptyValue />}</dd></div><div><dt>Currency</dt><dd>{currency ? `${currency.value.name} (${currency.value.code})` : <EmptyValue />}</dd></div></dl><p className={styles.contextCopy}>GDP is economic output, not household income. Current US dollars are sensitive to exchange rates and do not adjust for local purchasing power.</p></section>}
        {activeFacet === "geography" && <section aria-labelledby="atlas-geography"><div className={styles.sectionHeading}><h3 id="atlas-geography">Geography</h3><LensAction onClick={() => onShowView("where-people-live")}>Show terrain & water</LensAction></div><dl className={styles.detailFacts}><div><dt>Region</dt><dd>{country.geography.region}</dd></div><div><dt>Subregion</dt><dd>{country.geography.subregion}</dd></div><div><dt>Capital</dt><dd>{country.facts.capital?.value ?? <EmptyValue />}</dd></div><div><dt>Area</dt><dd>{area ? `${integerFormatter.format(area.value)} km²` : <EmptyValue />}</dd></div><div><dt>Map-source status</dt><dd>{status.sourceClassification} (Natural Earth)</dd></div><div><dt>Source sovereign field</dt><dd>{status.sourceSovereignName} · Cartographic metadata, not an Atlas sovereignty judgment.</dd></div></dl>{status.summary && <p className={styles.boundaryNote}>{status.summary}</p>}{status.sourceBoundaryNote && <p className={styles.boundaryNote}>{status.sourceBoundaryNote}</p>}<LensAction onClick={() => onShowView("political")}>Show political map</LensAction></section>}
        {activeFacet === "jju" && country.jjuLinks.length > 0 && <section aria-labelledby="atlas-jju-links"><div className={styles.sectionHeading}><h3 id="atlas-jju-links">Explore in JJ University</h3></div><ul className={styles.jjuLinks}>{country.jjuLinks.map((link) => <li key={`${link.kind}-${link.href}`}><a href={link.href}>{link.title}<span>{jjuLinkLabel(link)}</span></a></li>)}</ul></section>}
      </div>
      <details className={styles.sourceFooter}><summary>Sources for this country</summary><ul>{usedSources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a>{source.sourceUpdatedAt && <span> · {yearLabel(source.sourceUpdatedAt)}</span>}</li>)}</ul></details>
    </div>
  </aside>;
}
