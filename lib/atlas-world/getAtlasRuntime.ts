import countrySnapshotJson from "./data/countries.v1.json";
import geometrySnapshotJson from "./data/geometry-mercator.v1.json";
import type {
  AtlasCountrySnapshot,
  AtlasGeometrySnapshot,
  AtlasObservation,
} from "./types";
import type {
  AtlasClientDataset,
  AtlasRuntimeDataset,
  AtlasRuntimeFact,
} from "./runtime";
import { getApprovedAtlasJjuLinksForEntity } from "./associations";
import { getAtlasGeographyPack } from "./getAtlasGeography";
import { deriveAtlasLabelGeometry } from "./labelGeometry";
import { deriveAtlasCountryFocusBounds } from "./countryFraming";

const countrySnapshot = countrySnapshotJson as unknown as AtlasCountrySnapshot;
const geometrySnapshot = geometrySnapshotJson as unknown as AtlasGeometrySnapshot;
const displayFeatures = geometrySnapshot.features.map((feature) => {
  const label = deriveAtlasLabelGeometry(feature);
  return { ...feature, ...label, focusBounds: deriveAtlasCountryFocusBounds(feature, label.focusBounds) };
});

function compactFact<T>(fact: AtlasObservation<T> | null): AtlasRuntimeFact<T> | null {
  if (!fact) return null;
  return {
    value: fact.value,
    status: fact.status ?? "observed",
    observedAt: fact.temporal.observedAt,
    validFrom: fact.temporal.validFrom,
    validTo: fact.temporal.validTo,
    precision: fact.temporal.precision,
    sourceId: fact.sourceId,
    sourceField: fact.sourceField,
    notes: fact.notes,
  };
}

function uniqueRuntimeSources(sources: AtlasRuntimeDataset["sources"]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

export function getAtlasRuntimeDataset(): AtlasRuntimeDataset {
  if (countrySnapshot.snapshotId !== geometrySnapshot.snapshotId) {
    throw new Error("Atlas country and geometry snapshots do not match.");
  }

  const geographyPack = getAtlasGeographyPack();
  const entityIdBySovereignName = new Map<string, string>();
  for (const country of countrySnapshot.countries) {
    for (const name of [country.names.common, country.names.official, ...country.names.aliases]) {
      if (name) entityIdBySovereignName.set(name.toLocaleLowerCase("en-US"), country.id);
    }
  }
  return {
    snapshotId: countrySnapshot.snapshotId,
    generatedAt: countrySnapshot.generatedAt,
    countries: countrySnapshot.countries.map((country) => ({
      id: country.id,
      entity: (() => {
        const sovereignId = entityIdBySovereignName.get(
          country.geography.sovereignName.toLocaleLowerCase("en-US"),
        ) ?? null;
        const relationToSovereign = sovereignId === country.id
          ? "self" as const
          : sovereignId && ["Country", "Dependency"].includes(country.geography.naturalEarthType)
            ? "associated" as const
            : sovereignId
              ? "contested_or_cartographic" as const
              : "unresolved" as const;
        return {
          entityId: country.id,
          kind: "present-day-admin0" as const,
          parentId: relationToSovereign === "associated" ? sovereignId : null,
          sovereignId: relationToSovereign === "self" || relationToSovereign === "associated" ? sovereignId : null,
          countryId: country.id,
          adminLevel: 0,
          codes: [
            { scheme: "natural-earth-adm0-a3", value: country.codes.naturalEarthAdm0A3 },
            ...(country.codes.iso2 ? [{ scheme: "iso-3166-1-alpha-2", value: country.codes.iso2 }] : []),
            ...(country.codes.iso3 ? [{ scheme: "iso-3166-1-alpha-3", value: country.codes.iso3 }] : []),
            ...(country.codes.wikidataId ? [{ scheme: "wikidata", value: country.codes.wikidataId }] : []),
            ...(country.codes.geonamesId ? [{ scheme: "geonames", value: country.codes.geonamesId }] : []),
          ],
          temporal: {
            validFrom: country.temporal.validFrom,
            validTo: country.temporal.validTo,
          },
          politicalStatus: {
            sourceClassification: country.geography.naturalEarthType,
            sovereignName: country.geography.sovereignName,
            relationToSovereign,
          },
        };
      })(),
      slug: country.slug,
      name: country.names.common,
      officialName: country.names.official,
      aliases: country.names.aliases,
      codes: {
        iso2: country.codes.iso2,
        iso3: country.codes.iso3,
        naturalEarth: country.codes.naturalEarthAdm0A3,
      },
      geography: {
        continent: country.geography.continent,
        region: country.geography.region,
        subregion: country.geography.subregion,
        incomeLevel: country.geography.incomeLevel,
        naturalEarthType: country.geography.naturalEarthType,
        sovereignName: country.geography.sovereignName,
        boundaryNote: country.geography.boundaryNote,
      },
      validFrom: country.temporal.validFrom,
      validTo: country.temporal.validTo,
      facts: {
        capital: compactFact(country.facts.capital),
        population: compactFact(country.facts.population),
        areaKm2: compactFact(country.facts.areaKm2),
        languages: compactFact(country.facts.languages),
        currency: compactFact(country.facts.currency),
        gdpCurrentUsd: compactFact(country.facts.gdpCurrentUsd),
        gdpPerCapitaCurrentUsd: compactFact(country.facts.gdpPerCapitaCurrentUsd),
        urbanPopulationPercent: compactFact(country.facts.urbanPopulationPercent),
        populationGrowthAnnualPercent: compactFact(country.facts.populationGrowthAnnualPercent),
        populationAges0To14Percent: compactFact(country.facts.populationAges0To14Percent),
        populationAges65PlusPercent: compactFact(country.facts.populationAges65PlusPercent),
        fertilityRateBirthsPerWoman: compactFact(country.facts.fertilityRateBirthsPerWoman),
        lifeExpectancyYears: compactFact(country.facts.lifeExpectancyYears),
        government: compactFact(country.facts.government),
        headOfState: compactFact(country.facts.headOfState),
        headOfGovernment: compactFact(country.facts.headOfGovernment),
        religion: compactFact(country.facts.religion),
      },
      jjuLinks: getApprovedAtlasJjuLinksForEntity(country.id),
    })),
    sources: uniqueRuntimeSources([
      ...countrySnapshot.sources.map((source) => ({
        id: source.id,
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        licenseName: source.license.name,
        licenseUrl: source.license.url,
        retrievedAt: source.retrievedAt,
        sourceUpdatedAt: source.sourceUpdatedAt,
        checksumSha256: source.checksumSha256,
        notes: source.notes,
      })),
      ...geographyPack.sources.map((source) => ({
        id: source.id,
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        licenseName: source.license.name,
        licenseUrl: source.license.url,
        retrievedAt: source.retrievedAt,
        sourceUpdatedAt: null,
        checksumSha256: source.checksumSha256,
        notes: [`Pinned source version: ${source.version}.`],
      })),
    ]),
    geometry: {
      projectionId: geometrySnapshot.projection.id,
      viewBox: geometrySnapshot.projection.viewBox,
      spherePath: geometrySnapshot.spherePath,
      graticulePath: geometrySnapshot.graticulePath,
      features: displayFeatures,
      validFrom: geometrySnapshot.temporal.validFrom,
      validTo: geometrySnapshot.temporal.validTo,
    },
  };
}

export function getAtlasClientDataset(data = getAtlasRuntimeDataset()): AtlasClientDataset {
  return {
    snapshotId: data.snapshotId,
    generatedAt: data.generatedAt,
    sources: data.sources,
    countries: data.countries.map((country) => ({
      id: country.id,
      entity: country.entity,
      slug: country.slug,
      name: country.name,
      officialName: country.officialName,
      aliases: country.aliases,
      codes: country.codes,
      geography: country.geography,
      facts: {
        capital: country.facts.capital,
        population: country.facts.population,
        gdpPerCapitaCurrentUsd: country.facts.gdpPerCapitaCurrentUsd,
        urbanPopulationPercent: country.facts.urbanPopulationPercent,
        populationGrowthAnnualPercent: country.facts.populationGrowthAnnualPercent,
        populationAges0To14Percent: country.facts.populationAges0To14Percent,
        populationAges65PlusPercent: country.facts.populationAges65PlusPercent,
        fertilityRateBirthsPerWoman: country.facts.fertilityRateBirthsPerWoman,
        lifeExpectancyYears: country.facts.lifeExpectancyYears,
        government: country.facts.government,
        religion: country.facts.religion,
      },
    })),
    geometry: {
      projectionId: data.geometry.projectionId,
      viewBox: data.geometry.viewBox,
      features: data.geometry.features.map((feature) => ({
        entityId: feature.entityId,
        centroid: feature.centroid,
        bounds: feature.bounds,
        tinyRank: feature.tinyRank,
        mapColor7: feature.mapColor7,
        labelPoint: feature.labelPoint,
        labelArea: feature.labelArea,
        focusBounds: feature.focusBounds,
      })),
      validFrom: data.geometry.validFrom,
      validTo: data.geometry.validTo,
    },
  };
}
