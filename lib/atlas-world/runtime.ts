import type {
  AtlasCurrency,
  AtlasGovernmentValue,
  AtlasJjuLink,
  AtlasLanguage,
  AtlasLeadershipValue,
  AtlasProjectedFeature,
  AtlasReligionValue,
  AtlasObservationStatus,
} from "./types";
import type { AtlasAdmin0EntityIdentity } from "./geographyTypes";

export type AtlasRuntimeFact<T> = {
  value: T;
  status: AtlasObservationStatus;
  observedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  precision: "day" | "month" | "year" | "source_snapshot" | "unknown";
  sourceId: string;
  sourceField: string;
  notes: string[];
};

export type AtlasRuntimeCountry = {
  id: string;
  entity: AtlasAdmin0EntityIdentity;
  slug: string;
  name: string;
  officialName: string | null;
  aliases: string[];
  codes: {
    iso2: string | null;
    iso3: string | null;
    naturalEarth: string;
  };
  geography: {
    continent: string;
    region: string;
    subregion: string;
    incomeLevel: string | null;
    naturalEarthType: string;
    sovereignName: string;
    boundaryNote: string | null;
  };
  validFrom: string | null;
  validTo: string | null;
  facts: {
    capital: AtlasRuntimeFact<string> | null;
    population: AtlasRuntimeFact<number> | null;
    areaKm2: AtlasRuntimeFact<number> | null;
    languages: AtlasRuntimeFact<AtlasLanguage[]> | null;
    currency: AtlasRuntimeFact<AtlasCurrency> | null;
    gdpCurrentUsd: AtlasRuntimeFact<number> | null;
    gdpPerCapitaCurrentUsd: AtlasRuntimeFact<number> | null;
    government: AtlasRuntimeFact<AtlasGovernmentValue> | null;
    headOfState: AtlasRuntimeFact<AtlasLeadershipValue> | null;
    headOfGovernment: AtlasRuntimeFact<AtlasLeadershipValue> | null;
    religion: AtlasRuntimeFact<AtlasReligionValue> | null;
  };
  jjuLinks: AtlasJjuLink[];
};

export type AtlasRuntimeSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  licenseName: string;
  licenseUrl: string;
  retrievedAt: string;
  sourceUpdatedAt: string | null;
  checksumSha256: string;
  notes: string[];
};

export type AtlasRuntimeDataset = {
  snapshotId: string;
  generatedAt: string;
  countries: AtlasRuntimeCountry[];
  sources: AtlasRuntimeSource[];
  geometry: {
    projectionId: "equal-earth";
    viewBox: [0, 0, 1200, 650];
    spherePath: string;
    graticulePath: string;
    features: AtlasProjectedFeature[];
    validFrom: string | null;
    validTo: string | null;
  };
};

export type AtlasRuntimeCountrySummary = Pick<
  AtlasRuntimeCountry,
  "id" | "entity" | "slug" | "name" | "officialName" | "aliases" | "codes" | "geography"
> & {
  facts: Pick<
    AtlasRuntimeCountry["facts"],
    "capital" | "population" | "gdpPerCapitaCurrentUsd" | "government" | "religion"
  >;
};

export type AtlasRuntimeFeatureMeta = Omit<AtlasProjectedFeature, "path">;

export type AtlasClientDataset = {
  snapshotId: string;
  generatedAt: string;
  countries: AtlasRuntimeCountrySummary[];
  sources: AtlasRuntimeSource[];
  geometry: {
    projectionId: "equal-earth";
    viewBox: [0, 0, 1200, 650];
    features: AtlasRuntimeFeatureMeta[];
    validFrom: string | null;
    validTo: string | null;
  };
};
