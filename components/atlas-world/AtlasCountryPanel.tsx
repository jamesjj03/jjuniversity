"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, type PointerEvent } from "react";
import type { AtlasReligionCategory } from "@/lib/atlas-world/types";
import type { AtlasRuntimeCountry, AtlasRuntimeSource } from "@/lib/atlas-world/runtime";
import type { AtlasCityPlaceSummary } from "@/lib/atlas-world/places";
import { atlasLeadershipReviewDue, findAtlasLeadershipContext, findAtlasOfficeUpdate, findAtlasPortrait } from "@/lib/atlas-world/portraitPilot";
import { getAtlasTerritorialStatus } from "@/lib/atlas-world/territorialStatus";
import { ATLAS_LAYER_BY_ID } from "@/lib/atlas-world/layers";
import type { AtlasComparableCountryFact, AtlasCountryInsight } from "@/lib/atlas-world/countryInsights";
import AtlasTerm from "./AtlasTerm";
import styles from "./AtlasCountryPanel.module.css";

export type AtlasSheetDetent = "peek" | "half" | "full";
export type AtlasCountryLensContext = {
  name: string; description: string; valueLabel: string; observedAt: string | null; sourceIds: string[];
};
type AtlasCountryPanelProps = {
  country: AtlasRuntimeCountry;
  sources: AtlasRuntimeSource[];
  activeLens: AtlasCountryLensContext;
  sheetDetent: AtlasSheetDetent;
  onSheetDetentChange: (detent: AtlasSheetDetent) => void;
  onShowView: (viewId: string) => void;
  insights?: ReadonlyMap<AtlasComparableCountryFact, AtlasCountryInsight>;
  cities?: AtlasCityPlaceSummary[];
  onShowCity?: (placeId: string) => void;
  onClose: () => void;
};
type LeadershipFact = NonNullable<AtlasRuntimeCountry["facts"]["headOfState"]>;
type ReligionFact = NonNullable<AtlasRuntimeCountry["facts"]["religion"]>;
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const populationScale = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const oneDecimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const RELIGION_LABELS: Record<AtlasReligionCategory, string> = {
  christianity: "Christianity", islam: "Islam", hinduism: "Hinduism", buddhism: "Buddhism", judaism: "Judaism",
  folk_or_traditional: "Folk / traditional", religiously_unaffiliated: "Unaffiliated", other: "Other",
  mixed_or_no_clear_majority: "Mixed / no clear majority", unknown: "Not classified",
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
const NO_CITIES: AtlasCityPlaceSummary[] = [];
const ADMIN1_LABELS = new Map([
  ["USA", "Explore states"],
  ["DEU", "Explore Länder"],
  ["IND", "Explore states & territories"],
  ["CHN", "Explore provinces"],
  ["CAN", "Explore provinces & territories"],
  ["NGA", "Explore states"],
]);
function readableDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? dateFormatter.format(new Date(value)) : value ?? "date not recorded";
}
function readableYear(value: string | null) { return value?.match(/^\d{4}/)?.[0] ?? value; }
function humanizeOfficeholder(value: string) {
  return value.replace(/\p{L}[\p{L}'’.-]*/gu, (word) => {
    if (word !== word.toLocaleUpperCase("en-US") || word === word.toLocaleLowerCase("en-US")) return word;
    if (/^[IVXLCDM]+$/.test(word)) return word;
    return `${word[0]}${word.slice(1).toLocaleLowerCase("en-US")}`;
  });
}
function FactYear({ observedAt }: { observedAt: string | null }) { return observedAt ? <span className={styles.factYear}>{observedAt.match(/^\d{4}/)?.[0] ?? observedAt}</span> : null; }
function populationLabel(value: number) { return value >= 1e9 ? `${populationScale.format(value / 1e9)} billion` : value >= 1e6 ? `${populationScale.format(value / 1e6)} million` : integer.format(value); }
function LensAction({ children, onClick }: { children: string; onClick: () => void }) { return <button type="button" className={styles.showOnMap} onClick={onClick}>{children}<span aria-hidden="true">↗</span></button>; }
function GovernmentName({ category }: { category: string }) { return <AtlasTerm term={category} context="government">{GOVERNMENT_LABELS.get(category) ?? "Other system"}</AtlasTerm>; }
function RankNote({ insight }: { insight: AtlasCountryInsight | undefined }) {
  if (!insight) return null;
  const isNotable = insight.global.percentile >= 0.9 || insight.global.percentile <= 0.1;
  const regionalLead = insight.regional?.rank === 1 && insight.regional.total >= 5;
  if (!isNotable && !regionalLead) return null;
  return <small className={styles.rankNote}>
    {insight.comparisonNote}
    {regionalLead ? ` Highest reported value in ${insight.region}.` : ""}
  </small>;
}

function LeadershipRole({ countryId, role, label, leadership }: {
  countryId: string; role: "headOfState" | "headOfGovernment"; label: string; leadership: LeadershipFact;
}) {
  const update = findAtlasOfficeUpdate(countryId, role, leadership);
  if (update) return <div className={styles.leadershipRole} data-atlas-office-update={update.id}>
    <div className={styles.leaderText}><span>{label}</span><strong>{update.personName}</strong><b>{update.title}</b></div>
    <p className={styles.leaderContext}>{update.summary}</p>
    <p className={styles.leadershipDate}>{readableYear(update.observedAt)} check{atlasLeadershipReviewDue(update.observedAt) ? " · review due" : ""}</p>
    <details className={styles.sourceDetail}><summary>Freshness, source & previous record</summary><p>This separately checked record replaces the older officeholder shown in the archived Factbook snapshot; it does not rewrite that source.</p><p>The archived record names {humanizeOfficeholder(update.supersedes.exactSourceName)} on {readableDate(update.supersedes.observedAt)}. GOV.UK records that term ending on {readableDate(update.supersedes.termEndedAt)}.</p><ul>{update.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a></li>)}</ul></details>
  </div>;
  const people = leadership.value.officeholders;
  return <div className={styles.leadershipRole}>
    {leadership.value.isVacant ? <div className={styles.leaderText}><span>{label}</span><strong>Vacant in this source record</strong></div>
      : people.length ? people.map((officeholder, index) => {
        const portrait = findAtlasPortrait(countryId, role, leadership, officeholder);
        const context = findAtlasLeadershipContext(countryId, role, leadership, officeholder);
        return <div className={styles.officeholder} key={`${officeholder.nameAndTitle}-${index}`} data-atlas-person={portrait?.person.id}>
          <div className={styles.leader}>
            {portrait && <Image className={styles.portrait} src={portrait.media.href} width={portrait.media.width} height={portrait.media.height} alt={portrait.person.name} sizes="112px" unoptimized />}
            <div className={styles.leaderText}><span>{label}</span><strong>{portrait?.person.name ?? humanizeOfficeholder(officeholder.nameAndTitle)}</strong>{portrait && <b>{portrait.title}</b>}<small>{officeholder.relationship !== "principal" ? `${officeholder.relationship.replace(/_/g, " ")} · ` : ""}{officeholder.termStartedAt ? `${readableYear(officeholder.termStartedAt)}–` : "Term start unavailable"}</small></div>
          </div>
          {context && <p className={styles.leaderContext}>{context.summary}</p>}
          {(portrait || context) && <details className={styles.sourceDetail}><summary>{portrait ? "Sources & photo credit" : "Sources"}</summary>
            {context && <ul>{context.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a></li>)}</ul>}
            {portrait && <div className={styles.portraitCredit}><strong>{portrait.media.author}</strong><p>Photographed {readableDate(portrait.media.photoDate)}. {portrait.media.changes}</p><a href={portrait.media.sourceUrl} target="_blank" rel="noreferrer">Image source</a>{" · "}<a href={portrait.media.licenseUrl} target="_blank" rel="noreferrer">{portrait.media.licenseName}</a>{portrait.media.attributionStatement && <p>{portrait.media.attributionStatement}</p>}</div>}
          </details>}
        </div>;
      }) : <div className={styles.leaderText}><span>{label}</span><strong>{humanizeOfficeholder(leadership.value.raw)}</strong></div>}
    <p className={styles.leadershipDate}>{readableYear(leadership.observedAt) ?? "Undated"} snapshot{atlasLeadershipReviewDue(leadership.observedAt) ? " · review due" : ""}</p>
  </div>;
}

function Leadership({ country }: { country: AtlasRuntimeCountry }) {
  const state = country.facts.headOfState;
  const government = country.facts.headOfGovernment;
  if (!state && !government) return null;
  const same = state && government && state.value.raw === government.value.raw && state.observedAt === government.observedAt;
  return <section className={styles.leadership} aria-label="Leadership snapshot">
    <div className={styles.sectionHeading}><h3>Leadership</h3><span className={styles.archiveLabel}>Source-dated</span></div>
    {same ? <LeadershipRole countryId={country.id} role="headOfState" label="Head of state & government" leadership={state} /> : <>{state && <LeadershipRole countryId={country.id} role="headOfState" label="Head of state" leadership={state} />}{government && <LeadershipRole countryId={country.id} role="headOfGovernment" label="Head of government" leadership={government} />}</>}
    <details className={styles.sourceDetail}><summary>About leadership freshness</summary><p>Leadership is shown from source-dated records, not a live officeholder service. A “review due” label means Atlas has not recently verified that record.</p></details>
  </section>;
}

/** Keep source ranges as ranges; a midpoint is only used to position a bar. */
function religionShare(entry: ReligionFact["value"]["composition"][number], raw: string) {
  if (!entry.shareIsApproximate) return `${entry.sharePercent}%`;
  let low = 0, high = 0, matched = 0;
  for (const label of entry.rawLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(new RegExp(`${escaped}\\s+(\\d+(?:\\.\\d+)?)(?:[-–](\\d+(?:\\.\\d+)?))?%`, "i"));
    if (!match) continue;
    low += Number(match[1]); high += Number(match[2] ?? match[1]); matched++;
  }
  return matched === entry.rawLabels.length && high > low ? `${Number(low.toFixed(1))}–${Number(high.toFixed(1))}%` : `~${entry.sharePercent}%`;
}

function religionSourceLabel(entry: ReligionFact["value"]["composition"][number]) {
  const label = entry.rawLabels.length === 1 ? entry.rawLabels[0] : null;
  if (!label || /^(christian(ity)?|muslims?|islam|hindu(ism)?|buddhis[mt]s?|jewish|jews?|judaism|none|nothing in particular|other|unspecified|unknown)$/i.test(label) || /^or /i.test(label)) return null;
  return label.toLowerCase() === RELIGION_LABELS[entry.category].toLowerCase() ? null : label;
}

function ReligionComposition({ religion, countryName, active, onShowView }: { religion: ReligionFact; countryName: string; active: boolean; onShowView: (view: string) => void }) {
  const entries = [...religion.value.composition].sort((a, b) => b.sharePercent - a.sharePercent);
  const sum = entries.reduce((total, entry) => total + entry.sharePercent, 0);
  const raw = religion.value.raw;
  const sourceNote = raw.match(/\bnote:\s*(.+)$/i)?.[1] ?? null;
  const sourcePeriod = religion.observedAt ?? raw.match(/\((\d{4}(?:[-–]\d{2,4})?[^)]*)\)/)?.[1] ?? null;
  const practicing = /practicing worshipers/i.test(raw);
  const affiliationOnly = /among persons claiming a religious affiliation/i.test(raw);
  const dominantShareMissing = !["mixed_or_no_clear_majority", "unknown"].includes(religion.value.dominantCategory)
    && !entries.some((entry) => entry.category === religion.value.dominantCategory);
  return <section className={styles.compositionBlock} aria-label="Religious composition" data-atlas-religion-composition>
    <div className={styles.sectionHeading}><h3>Religion</h3>{!active && <LensAction onClick={() => onShowView("religion")}>Show map</LensAction>}</div>
    <p className={styles.compositionSummary}>{sourcePeriod ? `${sourcePeriod.replace(/\s*est\.$/, "")} estimates` : "Year not reported"} · <AtlasTerm term="dominant-religious-tradition">Broad traditions</AtlasTerm></p>
    {practicing && <p className={styles.compositionCaveat}>These estimates count practicing worshipers, not everyone who identifies with a religion. They do not describe the whole population.</p>}
    {affiliationOnly && <p className={styles.compositionCaveat}>The denominator is people who claim a religious affiliation, not {countryName}’s whole population.</p>}
    {entries.length ? <div className={styles.compositionList}>{entries.map((entry) => <div className={styles.compositionRow} key={entry.category}><div><span>{RELIGION_LABELS[entry.category]}{religionSourceLabel(entry) && <small>{religionSourceLabel(entry)}</small>}</span><strong>{religionShare(entry, raw)}</strong></div><div className={styles.compositionTrack} aria-hidden="true"><span style={{ width: `${Math.min(100, entry.sharePercent)}%`, background: RELIGION_COLORS.get(entry.category) ?? "#9caab9" }} /></div></div>)}</div> : <p className={styles.contextCopy}>The source gives a broad classification, but no comparable percentage breakdown.</p>}
    {sum > 100.5 && <p className={styles.compositionCaveat}>These shares total more than 100%. Membership may overlap or use different denominators; the bars are not exclusive pieces of a whole.</p>}
    {dominantShareMissing && <p className={styles.compositionCaveat}>The source names {RELIGION_LABELS[religion.value.dominantCategory]} as dominant but gives no percentage for it. Only stated shares are shown.</p>}
    {entries.length > 0 && sum < 99.5 && !practicing && <p className={styles.compositionCaveat}>Some shares are unreported. Atlas leaves them unknown rather than filling in the rest.</p>}
    <details className={styles.sourceDetail}><summary>Read the original figures & how to interpret them</summary>
      <blockquote>{raw}</blockquote>
      {sourceNote && <p><strong>Source note:</strong> {sourceNote}</p>}
      <p><strong>Map classification:</strong> {RELIGION_LABELS[religion.value.dominantCategory]}. The color is a broad starting point, not a description of everyone here.</p>
      <p>Atlas groups the source labels into broad traditions. It adds explicitly reported shares in the same tradition; it does not infer missing beliefs. {entries.some((entry) => entry.shareIsApproximate) && "Source ranges are preserved above. Their midpoint positions the bars, not a claim of extra precision."}</p>
      {entries.some((entry) => entry.rawLabels.length > 1) && <ul>{entries.filter((entry) => entry.rawLabels.length > 1).map((entry) => <li key={entry.category}>{RELIGION_LABELS[entry.category]} combines {entry.rawLabels.join(" + ")}.</li>)}</ul>}
      <p>Observation: {sourcePeriod ?? "not dated"}. Archived CIA World Factbook. Estimates from different years or denominators should not be treated as directly comparable.</p>
      <details><summary>Import notes</summary>{religion.notes.map((note) => <p key={note}>{note}</p>)}<p>Normalization: {religion.value.normalizationMethod}</p></details>
    </details>
  </section>;
}

export default function AtlasCountryPanel({ country, sources, activeLens, sheetDetent, onSheetDetentChange, onShowView, insights = new Map(), cities = NO_CITIES, onShowCity, onClose }: AtlasCountryPanelProps) {
  const dragStartRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const {
    government, religion, population, areaKm2: area, currency, languages,
    gdpCurrentUsd: gdp, gdpPerCapitaCurrentUsd: gdpPerCapita,
    urbanPopulationPercent, populationGrowthAnnualPercent,
    populationAges0To14Percent, populationAges65PlusPercent,
    fertilityRateBirthsPerWoman, lifeExpectancyYears,
  } = country.facts;
  const status = getAtlasTerritorialStatus(country);
  const hasClaimantIdentity = country.id === "country:SAH";
  const mappedCities = useMemo(() => cities.filter((city) => city.countryId === country.id)
    .sort((a, b) => Number(b.isNationalCapital) - Number(a.isNationalCapital) || a.name.localeCompare(b.name)), [cities, country.id]);
  const religionLens = activeLens.name.toLowerCase().includes("religion");
  const usedSourceIds = useMemo(() => { const ids = new Set(activeLens.sourceIds); Object.values(country.facts).forEach((fact) => { if (fact) ids.add(fact.sourceId); }); return ids; }, [activeLens.sourceIds, country.facts]);
  const usedSources = sources.filter((source) => usedSourceIds.has(source.id));
  const stepDetent = (direction: -1 | 1) => { const index = DETENT_ORDER.indexOf(sheetDetent); onSheetDetentChange(DETENT_ORDER[Math.max(0, Math.min(DETENT_ORDER.length - 1, index + direction))]); };
  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>) => { dragStartRef.current = event.clientY; draggedRef.current = false; event.currentTarget.setPointerCapture(event.pointerId); };
  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => { if (dragStartRef.current != null && Math.abs(event.clientY - dragStartRef.current) > 8) draggedRef.current = true; };
  const onHandlePointerUp = (event: PointerEvent<HTMLButtonElement>) => { if (dragStartRef.current == null) return; const distance = event.clientY - dragStartRef.current; dragStartRef.current = null; if (Math.abs(distance) >= 34) stepDetent(distance < 0 ? 1 : -1); };
  const cycleDetent = () => { if (draggedRef.current) { draggedRef.current = false; return; } stepDetent(sheetDetent === "full" ? -1 : 1); };
  return <aside className={styles.countryPanel} aria-labelledby="atlas-country-title" data-atlas-sheet={sheetDetent} tabIndex={-1}>
    <div className={styles.persistentHeader}>
      <button type="button" className={styles.sheetHandle} onPointerDown={onHandlePointerDown} onPointerMove={onHandlePointerMove} onPointerUp={onHandlePointerUp} onPointerCancel={() => { dragStartRef.current = null; }} onClick={cycleDetent} aria-label={`${sheetDetent === "full" ? "Collapse" : "Expand"} country details`}><span /><b>{sheetDetent === "full" ? "Less detail ↓" : "Details ↑"}</b></button>
      <header className={styles.countryHeader}>
        <div className={styles.countryFlag}>{country.codes.iso2 && /^[A-Z]{2}$/.test(country.codes.iso2) ? <span className={`fi fi-${country.codes.iso2.toLowerCase()} ${styles.flagArt}`} role="img" aria-label={hasClaimantIdentity ? "Sahrawi Arab Democratic Republic flag; one claimant in Western Sahara" : `${country.name} flag`} /> : <span className={styles.flagFallback} aria-hidden="true">◈</span>}</div>
        <div className={styles.countryIdentity}><h2 id="atlas-country-title">{country.name}</h2>{country.officialName && country.officialName !== country.name && <span>{country.officialName}</span>}{hasClaimantIdentity && <p className={styles.identityQualifier}>SADR name & flag · one claimant</p>}<p>{country.geography.subregion || country.geography.region}</p></div>
        <button className={styles.panelClose} type="button" onClick={onClose} aria-label={`Close ${country.name}`}><span aria-hidden="true">×</span></button>
      </header>
      {activeLens.name !== "Political" && <section className={styles.lensContext} aria-label="What the map is showing"><span>{activeLens.name}</span><strong>{activeLens.valueLabel}</strong>{!activeLens.valueLabel.includes(activeLens.observedAt?.slice(0, 4) ?? "") && <FactYear observedAt={activeLens.observedAt} />}</section>}
      <div className={styles.mobileDetents} role="group" aria-label="Country detail height">{DETENT_ORDER.map((detent) => <button key={detent} type="button" aria-pressed={sheetDetent === detent} onClick={() => onSheetDetentChange(detent)}>{detent}</button>)}</div>
    </div>
    <div className={styles.cockpitBody}>
      {status.kind !== "standard" && <section className={styles.statusNote} data-atlas-territorial-status={status.kind}><h3>{status.badge}</h3><p>{status.summary}</p><details><summary>Claims, control & what this map shows</summary><dl>{status.claims && <><dt>Who claims it</dt><dd>{status.claims}</dd></>}{status.administration && <><dt>Who administers it</dt><dd>{status.administration}</dd></>}{status.disputeReason && <><dt>Why disputed</dt><dd>{status.disputeReason}</dd></>}{status.mapChoice && <><dt>What this map shows</dt><dd>{status.mapChoice}</dd></>}</dl><p>{status.caveat}</p><details><summary>Sources · checked {readableDate(status.observedAt)}</summary><ul>{status.evidence.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a></li>)}</ul></details></details></section>}
      {religionLens && religion && <ReligionComposition religion={religion} countryName={country.name} active onShowView={onShowView} />}
      {government && activeLens.name !== "Government" && <div className={styles.governmentLine}><GovernmentName category={government.value.category} /><LensAction onClick={() => onShowView("government")}>Compare</LensAction></div>}
      <section className={styles.glance} aria-label="Country overview"><dl>
        {country.facts.capital && <div><dt>Capital</dt><dd>{country.facts.capital.value}</dd></div>}
        {population && <div><dt>Population <FactYear observedAt={population.observedAt} /></dt><dd title={integer.format(population.value)}>{populationLabel(population.value)}</dd><RankNote insight={insights.get("population")} /></div>}
        {area && <div><dt>Area</dt><dd>{integer.format(area.value)} <span className={styles.unit}>km²</span></dd></div>}
        {gdpPerCapita && <div><dt><AtlasTerm term="gdp-per-capita">GDP per person</AtlasTerm> <FactYear observedAt={gdpPerCapita.observedAt} /></dt><dd>${integer.format(gdpPerCapita.value)} <span className={styles.unit}>USD</span></dd><RankNote insight={insights.get("gdpPerCapitaCurrentUsd")} /></div>}
      </dl><div className={styles.glanceActions}>{population && <LensAction onClick={() => onShowView("population-density")}>See population density</LensAction>}{ADMIN1_LABELS.has(country.codes.naturalEarth) && <Link className={styles.exploreSubnational} href={`/atlas/subnational?country=${country.codes.naturalEarth}`}>{ADMIN1_LABELS.get(country.codes.naturalEarth)}<span aria-hidden="true">→</span></Link>}</div></section>
      {(urbanPopulationPercent || populationGrowthAnnualPercent || populationAges0To14Percent
        || populationAges65PlusPercent || fertilityRateBirthsPerWoman || lifeExpectancyYears) && (
        <details className={styles.overviewDisclosure} data-atlas-people-facts>
          <summary>How people live</summary>
          <dl className={styles.detailFacts}>
            {urbanPopulationPercent && <div><dt>Urban population <FactYear observedAt={urbanPopulationPercent.observedAt} /></dt><dd>{oneDecimal.format(urbanPopulationPercent.value)}%</dd><RankNote insight={insights.get("urbanPopulationPercent")} /><LensAction onClick={() => onShowView("urbanization")}>Compare on map</LensAction></div>}
            {populationGrowthAnnualPercent && <div><dt>Population growth <FactYear observedAt={populationGrowthAnnualPercent.observedAt} /></dt><dd>{populationGrowthAnnualPercent.value > 0 ? "+" : ""}{oneDecimal.format(populationGrowthAnnualPercent.value)}% <span className={styles.unit}>per year</span></dd><RankNote insight={insights.get("populationGrowthAnnualPercent")} /><LensAction onClick={() => onShowView("population-growth")}>Compare on map</LensAction></div>}
            {populationAges0To14Percent && <div><dt>Ages 0–14 <FactYear observedAt={populationAges0To14Percent.observedAt} /></dt><dd>{oneDecimal.format(populationAges0To14Percent.value)}%</dd><RankNote insight={insights.get("populationAges0To14Percent")} /><LensAction onClick={() => onShowView("children-share")}>Compare on map</LensAction></div>}
            {populationAges65PlusPercent && <div><dt>Ages 65+ <FactYear observedAt={populationAges65PlusPercent.observedAt} /></dt><dd>{oneDecimal.format(populationAges65PlusPercent.value)}%</dd><RankNote insight={insights.get("populationAges65PlusPercent")} /><LensAction onClick={() => onShowView("older-population")}>Compare on map</LensAction></div>}
            {fertilityRateBirthsPerWoman && <div><dt><AtlasTerm term="total-fertility-rate">Fertility rate</AtlasTerm> <FactYear observedAt={fertilityRateBirthsPerWoman.observedAt} /></dt><dd>{oneDecimal.format(fertilityRateBirthsPerWoman.value)} <span className={styles.unit}>births per woman</span></dd><RankNote insight={insights.get("fertilityRateBirthsPerWoman")} /><LensAction onClick={() => onShowView("fertility")}>Compare on map</LensAction></div>}
            {lifeExpectancyYears && <div><dt><AtlasTerm term="life-expectancy">Life expectancy</AtlasTerm> <FactYear observedAt={lifeExpectancyYears.observedAt} /></dt><dd>{oneDecimal.format(lifeExpectancyYears.value)} <span className={styles.unit}>years</span></dd><RankNote insight={insights.get("lifeExpectancyYears")} /><LensAction onClick={() => onShowView("life-expectancy")}>Compare on map</LensAction></div>}
          </dl>
          <p className={styles.contextCopy}>These are national observations. Definitions and measurement years remain attached to each value.</p>
        </details>
      )}
      {!religionLens && <Leadership country={country} />}
      {!religionLens && religion && <ReligionComposition religion={religion} countryName={country.name} active={false} onShowView={onShowView} />}
      {religionLens && <details className={styles.overviewDisclosure}><summary>Government & leadership</summary><Leadership country={country} /></details>}
      {(gdp || currency || languages?.value.length) && <details className={styles.overviewDisclosure}><summary>Economy, currency & languages</summary><dl className={styles.detailFacts}>
        {gdp && <div><dt>Total GDP <FactYear observedAt={gdp.observedAt} /></dt><dd>{compactMoney.format(gdp.value)} USD</dd></div>}
        {country.geography.incomeLevel && <div><dt>World Bank income group</dt><dd>{country.geography.incomeLevel}</dd></div>}
        {currency && <div><dt>Currency</dt><dd>{currency.value.name} ({currency.value.code})</dd></div>}
        {languages?.value.length ? <div><dt>Languages</dt><dd>{languages.value.map((language) => language.name ?? language.code).join(", ")}</dd></div> : null}
      </dl>{gdpPerCapita && <><p className={styles.contextCopy}>GDP measures economic output, not household income. Dollar values do not adjust for local purchasing power.</p><LensAction onClick={() => onShowView("gdp-per-capita")}>Compare GDP per person</LensAction></>}</details>}
      {onShowCity && mappedCities.length > 0 && <details className={styles.overviewDisclosure} data-atlas-mapped-cities><summary>Cities on this map</summary>
        <p className={styles.contextCopy}>Open a mapped city to see its location and source. This is the map’s selection, not a complete list of settlements.</p>
        <ul className={styles.cityList}>{mappedCities.slice(0, 12).map((city) => <li key={city.placeId}><button type="button" onClick={() => onShowCity(city.placeId)} aria-label={`Show ${city.name} on map`}><span>{city.name}{city.isNationalCapital && <small>National capital</small>}</span><span aria-hidden="true">↗</span></button></li>)}</ul>
        {mappedCities.length > 12 && <p className={styles.contextCopy}>Showing 12 of {mappedCities.length} mapped cities.</p>}
      </details>}
      {country.jjuLinks.length > 0 && <section className={styles.jjuSection}><h3>Read in JJ University</h3><ul className={styles.jjuLinks}>{country.jjuLinks.map((link) => <li key={`${link.kind}-${link.href}`}><a href={link.href}>{link.title}<span>{"relationshipLabel" in link ? String(link.relationshipLabel) : link.kind}</span></a></li>)}</ul></section>}
      <details className={styles.sourceFooter}><summary>Country sources & map record</summary><ul>{usedSources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.publisher}: {source.title}</a></li>)}</ul><p>Natural Earth map-source classification: {status.sourceClassification}. Source sovereign field: {status.sourceSovereignName}. These are cartographic metadata, not an Atlas sovereignty judgment.</p>{status.sourceBoundaryNote && <p>{status.sourceBoundaryNote}</p>}</details>
    </div>
  </aside>;
}
