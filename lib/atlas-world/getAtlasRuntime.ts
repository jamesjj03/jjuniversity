import countrySnapshotJson from "./data/countries.v1.json";
import geometrySnapshotJson from "./data/geometry-equal-earth.v1.json";
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

const countrySnapshot = countrySnapshotJson as unknown as AtlasCountrySnapshot;
const geometrySnapshot = geometrySnapshotJson as unknown as AtlasGeometrySnapshot;

function compactFact<T>(fact: AtlasObservation<T> | null): AtlasRuntimeFact<T> | null {
  if (!fact) return null;
  return {
    value: fact.value,
    observedAt: fact.temporal.observedAt,
    precision: fact.temporal.precision,
    sourceId: fact.sourceId,
    notes: fact.notes,
  };
}

export function getAtlasRuntimeDataset(): AtlasRuntimeDataset {
  if (countrySnapshot.snapshotId !== geometrySnapshot.snapshotId) {
    throw new Error("Atlas country and geometry snapshots do not match.");
  }

  return {
    snapshotId: countrySnapshot.snapshotId,
    generatedAt: countrySnapshot.generatedAt,
    countries: countrySnapshot.countries.map((country) => ({
      id: country.id,
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
        government: compactFact(country.facts.government),
        headOfState: compactFact(country.facts.headOfState),
        headOfGovernment: compactFact(country.facts.headOfGovernment),
        religion: compactFact(country.facts.religion),
      },
      jjuLinks: country.jjuLinks,
    })),
    sources: countrySnapshot.sources.map((source) => ({
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      licenseName: source.license.name,
      licenseUrl: source.license.url,
      retrievedAt: source.retrievedAt,
      sourceUpdatedAt: source.sourceUpdatedAt,
      notes: source.notes,
    })),
    geometry: {
      projectionId: geometrySnapshot.projection.id,
      viewBox: geometrySnapshot.projection.viewBox,
      spherePath: geometrySnapshot.spherePath,
      graticulePath: geometrySnapshot.graticulePath,
      features: geometrySnapshot.features,
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
      slug: country.slug,
      name: country.name,
      officialName: country.officialName,
      aliases: country.aliases,
      codes: country.codes,
      geography: country.geography,
      facts: {
        capital: country.facts.capital,
        population: country.facts.population,
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
      })),
      validFrom: data.geometry.validFrom,
      validTo: data.geometry.validTo,
    },
  };
}
