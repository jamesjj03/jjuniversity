# Atlas world data snapshot

Atlas V1 is built from a committed, reviewable snapshot rather than from live browser requests. The map can load immediately, every mutable fact points to a source and date, and a future historical snapshot can reuse the same entity/observation contract.

## Committed outputs

| File | Purpose |
| --- | --- |
| `lib/atlas-world/data/countries.v1.json` | 242 map entities, sourced facts, time metadata, source records, and empty reviewed-JJU link slots |
| `lib/atlas-world/data/geometry-equal-earth.v1.json` | 242 SVG country paths projected into a 1200 × 650 Equal Earth viewBox, plus sphere and graticule paths |
| `lib/atlas-world/data/validation.v1.json` | Exact field coverage, code-join audits, normalization counts, warnings, and fatal validation status |
| `public/atlas-world/geometry-equal-earth.v1.svg` | Browser-ready copy of the same versioned geometry, referenced once and cached instead of duplicating every path in the page response |
| `lib/atlas-world/types.ts` | TypeScript contract for the three JSON artifacts |

The geometry record for each map unit contains `entityId`, `path`, projected `centroid`, projected `bounds`, Natural Earth `tinyRank`, and `mapColor7`. Country and geometry snapshots share the same `snapshotId` and `country:<Natural Earth ADM0_A3>` entity IDs.

Country-panel flags use the MIT-licensed [`flag-icons`](https://github.com/lipis/flag-icons) package and ISO alpha-2 codes. Map units without an ISO alpha-2 code use a neutral symbol rather than an invented flag.

## Sources and licensing

### Natural Earth

- **Dataset:** Natural Earth 1:50m Admin 0 – Countries, version 5.1.2
- **Use:** country/map-unit polygons, cartographic names, regional groupings, map colors, status notes, and stable Natural Earth codes
- **License:** [public domain](https://www.naturalearthdata.com/about/terms-of-use/)
- **Source:** [Natural Earth 1:50m cultural vectors](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/)
- **Snapshot input:** `jju-atlas-ne-50m-v5.1.2.geojson`, retrieved 2026-09-03

Natural Earth is cartography, not a statement by JJU about sovereignty. This file has 242 contemporary de facto map units, including dependencies, disputed units, and an indeterminate Siachen Glacier unit. Atlas retains Natural Earth's `TYPE`, sovereign name, and boundary notes so the interface can disclose those distinctions.

### World Bank

- **Datasets:** country metadata; `SP.POP.TOTL`; `NY.GDP.MKTP.CD`; `NY.GDP.PCAP.CD`
- **Use:** capital, region/income classification, population, GDP, and GDP per capita
- **License:** [CC BY 4.0](https://datacatalog.worldbank.org/public-licenses)
- **Source:** [World Bank API](https://api.worldbank.org/)
- **Snapshot inputs:** `jju-atlas-wb-*-20260903.json`, retrieved 2026-09-03; indicator files report an API update date of 2026-07-13

Rows whose World Bank region is `Aggregates` are removed before joining. Population coverage is 215 map entities and all populated values in this snapshot are 2025 observations. GDP and GDP-per-capita coverage is 213 entities. Their years are deliberately not flattened: 186 values are from 2025, 14 from 2024, 3 from 2023, 5 from 2022, and one each from 2021, 2020, 2018, 2015, and 2011.

### GeoNames

- **Dataset:** `countryInfo.txt`
- **Use:** ISO/FIPS crosswalks, area, capital fallback, currency, language codes, and GeoNames IDs
- **License:** [CC BY 4.0](https://www.geonames.org/export/)
- **Source:** [GeoNames export dump](https://download.geonames.org/export/dump/countryInfo.txt)
- **Snapshot input:** `jju-atlas-countryInfo-20260903.txt`, retrieved 2026-09-03

GeoNames does not give separate measurement dates for the imported descriptive fields. They are marked `source_snapshot` at retrieval and carry that caveat. The undated GeoNames population column is not imported because the dated World Bank population series is preferable. GeoNames language values are codes, not claims that every listed language is official; English display labels are derived with the platform's `Intl.DisplayNames`.

### Final World Factbook capture

- **Dataset:** final World Factbook pages rescued from Internet Archive captures
- **Use:** government type, chief of state, head of government, leadership term-start wording, and religious composition/source wording
- **Repository license:** [CC0 1.0](https://github.com/pmusser/cia-world-factbook-final/blob/main/LICENSE)
- **Source:** [pmusser/cia-world-factbook-final](https://github.com/pmusser/cia-world-factbook-final)
- **Snapshot input:** `jju-atlas-factbook-20260903`, retrieved 2026-09-03

This is not a live CIA API. Individual records retain the Factbook profile update date and Internet Archive capture timestamp when present. Source wording is retained after presentation HTML is removed. It should be refreshed or replaced when a suitably licensed, maintained source is selected.

Every source record in `countries.v1.json` includes a SHA-256 checksum of the local source file, or of the relevant sorted Factbook file set.

## Code joins, never name joins

Natural Earth's unique `ADM0_A3` is the map entity key because all 242 polygons have one, including non-ISO map units. Other datasets remain separate namespaces.

1. A valid Natural Earth `ISO_A3` joins to GeoNames ISO3 and World Bank economy ID.
2. Two audited Natural Earth exceptions restore official codes exposed elsewhere in the Natural Earth record: `FRA → FRA` and `NOR → NOR`.
3. Kosovo is explicitly cross-walked `KOS → XKX` for World Bank/GeoNames and then `KV` for the Factbook. `XKX` is not presented as an officially assigned ISO 3166 code; Atlas's official `iso3` field remains `null`.
4. Factbook `placeCode` joins to GeoNames FIPS, then GeoNames ISO3, then the Atlas external-code map.
5. Factbook code `AT` is explicitly linked to Natural Earth `ATC` (Ashmore and Cartier Islands), which GeoNames does not list separately.

Names enter `names.aliases` only after a code join succeeds. They are never used to decide identity.

The pipeline deliberately refuses several tempting joins:

- The Factbook West Bank profile (`WE`) and separate Gaza profile (`GZ`) are not applied to Natural Earth's combined Palestine map unit (`PSX`/`PSE`). Using West Bank facts for the full polygon would be misleading.
- World Bank's combined Channel Islands record (`CHI`) is not split between Natural Earth's separate Jersey and Guernsey polygons.
- Small territories present in GeoNames or the Factbook but absent as their own 1:50m Natural Earth polygon remain unmatched rather than being assigned to a sovereign country's geometry.
- Somaliland, Northern Cyprus, Indian Ocean Territories, and Siachen Glacier are not silently assigned another polity's facts. Ashmore and Cartier is the only reviewed direct Factbook/map-unit exception.

The complete unmatched code lists are in `validation.v1.json`.

## Government normalization

The exact cleaned Factbook description is stored as `government.value.raw`. An ordered, versioned rule set maps only explicit source wording into these broad V1 categories:

- presidential republic
- parliamentary republic
- semi-presidential republic
- constitutional monarchy
- absolute monarchy
- one-party state
- military or transitional government
- theocracy
- territory or dependency
- other
- unknown

The rules prioritize current military/transitional language and territory status before generic constitutional phrases. They do not infer a presidential/parliamentary subtype when the source wording does not establish it. One reviewed exact phrase, `constitutional federal republic`, maps to `presidential_republic`; this fixes the United States classification without broadening the rule to every federal republic. Five populated records remain honestly in `other`: Antarctica, Cyprus's compound north/south description, Federated States of Micronesia, Switzerland, and the United Arab Emirates. The raw source text remains available beside every normalized category.

Current coverage is 230 of 242 map entities (95.0%).

## Leadership extraction

The Factbook's Executive branch section consistently labels `chief of state` and `head of government` separately. Atlas imports those two roles independently and retains the exact cleaned source text in each observation's `value.raw`.

The source does not structurally separate a person's name from the office or title that precedes it. Atlas therefore stores each safely delimited officeholder clause as `nameAndTitle` rather than guessing that boundary. Co-leaders and explicitly named representatives remain separate entries when the Factbook punctuation makes that split unambiguous. Each entry also carries a conservative `relationship`: `principal`, `representative`, `member`, or `associated_official`. This prevents a governor-general, presidency member, bailiff, or high commissioner listed in the same source block from silently appearing as a co-equal national leader. A role marked vacant has `isVacant: true`, an empty `officeholders` list, and its source wording intact.

Term starts are parsed only from an explicit `since` date attached to that officeholder clause. Each date retains day, month, or year precision; narrative dates and ambiguous collective-role dates are not reassigned to an individual. Of 242 map entities:

- chief of state is populated for 231 (95.5%), with at least one explicit term-start date for 227 (93.8%);
- head of government is populated for 230 (95.0%), with at least one explicit term-start date for 227 (93.8%);
- Haiti and Syria are explicitly marked as having a vacant chief-of-state role in their captured profiles.

These are real sourced observations, not a live officeholder lookup. Their `temporal.observedAt` value is each Factbook profile's own update date, which ranges from 2025-02-05 through 2026-01-21 in the joined snapshot; the Internet Archive capture date is retained separately in the observation notes. The data must be refreshed before Atlas presents it as current beyond those dates.

One source sequence is explicitly flagged for review: Saint Vincent and the Grenadines lists its governor general's term as beginning 2026-01-06 on a profile dated 2026-01-05. Atlas preserves both dates instead of silently changing either one.

## Religion normalization

The exact cleaned Factbook description is stored as `religion.value.raw`. Normalization is separate and intentionally conservative:

1. Only top-level percentages are parsed. Percentages nested inside a reported broad total are not counted twice.
2. Denominations such as Catholic, Protestant, Orthodox, Apostolic, and similar labels aggregate into Christianity; Sunni/Shia/Ibadi labels aggregate into Islam. Hinduism, Buddhism, Judaism, folk/traditional traditions, and religiously unaffiliated are retained as broad categories.
3. Ranges use their midpoint. A value reported as less than a threshold uses half the published upper bound. Such composition entries set `shareIsApproximate: true`, and the exact source wording remains beside them.
4. A tradition is called dominant only when its parsed share exceeds 50%. If parsed coverage is at least 80% but no tradition exceeds 50%, the result is `mixed_or_no_clear_majority`.
5. Qualitative classification is used only when all listed labels resolve to one broad tradition or when the source explicitly says predominant, overwhelming, or identifies a small minority against a leading tradition.
6. Partial, overlapping, contradictory, or genuinely mixed qualitative records stay `unknown`.

Raw religion data exists for 228 of 242 map entities (94.2%). A defensible broad result exists for 221 (91.3%). Seven populated raw fields remain unresolved: Democratic Republic of the Congo, Eritrea, Greenland, North Korea, Russia, Saint Martin, and Uruguay. Three of those have explicit percentage diagnostics in the validation file; no value was guessed to fill them.

## Time-safe contract

Every fact is an observation with:

- `observedAt` and its precision;
- nullable `validFrom` and `validTo`;
- `sourceId` and exact `sourceField`;
- explanatory notes.

Country and geometry entities also have nullable validity intervals. V1 leaves those intervals open because these sources do not establish precise constitutional or boundary start dates. A later historical build can add dated entity/geometry records instead of changing today's values in place.

## Current coverage

| Field | Populated map entities | Coverage |
| --- | ---: | ---: |
| Geometry | 242 / 242 | 100% |
| Official ISO3 | 236 / 242 | 97.5% |
| Capital | 235 / 242 | 97.1% |
| Area | 237 / 242 | 97.9% |
| Languages | 235 / 242 | 97.1% |
| Currency | 236 / 242 | 97.5% |
| Population | 215 / 242 | 88.8% |
| GDP | 213 / 242 | 88.0% |
| GDP per capita | 213 / 242 | 88.0% |
| Government raw/normalized | 230 / 242 | 95.0% |
| Chief of state | 231 / 242 | 95.5% |
| Chief of state with term date | 227 / 242 | 93.8% |
| Head of government | 230 / 242 | 95.0% |
| Head of government with term date | 227 / 242 | 93.8% |
| Religion raw | 228 / 242 | 94.2% |
| Religion broad result | 221 / 242 | 91.3% |

These denominators include uninhabited territories and disputed/indeterminate Natural Earth units, not only UN member states.

## Rebuild and validation

From the repository root:

```powershell
npm run atlas:world:build
```

The script defaults to the dated source files in the local temporary directory. Another source location can be provided with:

- `ATLAS_NATURAL_EARTH_SOURCE`
- `ATLAS_WORLD_BANK_COUNTRIES_SOURCE`
- `ATLAS_WORLD_BANK_POPULATION_SOURCE`
- `ATLAS_WORLD_BANK_GDP_SOURCE`
- `ATLAS_WORLD_BANK_GDP_PER_CAPITA_SOURCE`
- `ATLAS_GEONAMES_SOURCE`
- `ATLAS_FACTBOOK_SOURCE`
- `ATLAS_OUTPUT_DIRECTORY`
- `ATLAS_MAP_ASSET_DIRECTORY`

`ATLAS_SNAPSHOT_DATE` and `ATLAS_GENERATED_AT` can pin build metadata for a reproducible rebuild. `npm run atlas:world:check` also verifies that every committed map entity is present in the browser SVG and that both files carry the same snapshot ID. The generator exits non-zero if IDs collide, the entity/geometry counts diverge, or a geometry path is empty. Non-fatal gaps and contested joins are written to the validation artifact instead of being hidden.
