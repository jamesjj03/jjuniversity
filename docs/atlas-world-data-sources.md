# Atlas world data snapshot

Atlas V1 is built from a committed, reviewable snapshot rather than from live browser requests. The map can load immediately, every mutable fact points to a source and date, and a future historical snapshot can reuse the same entity/observation contract.

## Committed outputs

| File | Purpose |
| --- | --- |
| `lib/atlas-world/data/countries.v1.json` | 242 map entities, sourced facts, time metadata, source records, and empty reviewed-JJU link slots |
| `lib/atlas-world/data/geometry-equal-earth.v1.json` | 242 SVG country paths projected into a 1200 × 650 Equal Earth viewBox, plus sphere and graticule paths |
| `lib/atlas-world/data/validation.v1.json` | Exact field coverage, code-join audits, normalization counts, warnings, and fatal validation status |
| `public/atlas-world/geometry-equal-earth.v1.svg` | Browser-ready copy of the same versioned geometry, referenced once and cached instead of duplicating every path in the page response |
| `lib/atlas-world/data/geography-pack.v1.json` | Canonical WGS84 river, lake, and city features; derived Equal Earth paths/points; raster manifests; source, transformation, and time contracts |
| `lib/atlas-world/data/pattern-notes.v1.json` | Four evidence-backed contextual annotations that passed an AI-assisted source review; human editorial review is explicitly not claimed |
| `public/atlas-world/layers/*.equal-earth.webp` | Bounded 2400 × 1300 population-density and relief rasters aligned to the map viewBox |
| `data/atlas/sources.lock.json` | Exact source URLs, versions, dates, licenses, byte counts, checksums, and the pinned Factbook commit for all twelve inputs |
| `lib/atlas-world/types.ts` and `geographyTypes.ts` | TypeScript contracts for the V1 country snapshot and Phase 2 geography/annotation records |

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

## Phase 2 geography pack

### Bounded population-source decision

Atlas evaluated the two strongest practical open global inputs before choosing a source:

| Candidate | Strengths | Constraint for this bounded release | Decision |
| --- | --- | --- | --- |
| [GHS-POP R2023A](https://human-settlement.emergency.copernicus.eu/datasets.php) | European Commission JRC product; a stable global 1975–2030 series at five-year intervals; 1 km World Mollweide is already equal-area; published methods and durable product/version identifiers | The 2025 epoch is a projection, and the 1 km grid cannot resolve block-level settlement | **Selected:** epoch 2025, R2023A V1.0, 1 km Mollweide |
| [WorldPop Global 2 R2025A v1](https://hub.worldpop.org/geodata/listing?id=135) | Newer circa-2020 census inputs, building-informed 100 m estimates, annual 2015–2030 coverage, age/sex products | The provider labels the current release an **alpha** that may change; a global 100 m product is much larger than this world-view use case; country-specific model quality complicates global visual comparison | Retain as a future evaluation candidate after the release stabilizes; do not mix it into this snapshot |

This choice is about repeatability and fitness for a world analytical view, not a claim that GHSL is universally more accurate. Both products redistribute census/administrative estimates with models, both inherit unequal source-census quality, and both project future epochs. The rendered field must be described as an estimate.

The locked GHSL input is the official `GHS_POP_E2025_GLOBE_R2023A_54009_1000_V1_0.zip` (323,340,844 bytes, SHA-256 `cd630f51ac65dff2a0c7ad252333bbb20c5cf9de4d85eef04e22ef3699d80c95`, CC BY 4.0). Its cells store estimated people per 1 km equal-area cell. Atlas area-averages it into a 2400 × 1300 Equal Earth display raster, applies an explicit `log1p` color/opacity scale, and makes zero/no-data pixels transparent. The committed WebP is 486,352 bytes. Its displayed pixels aggregate many source cells at world scale and are not exact per-pixel measurements.

### Physical context

- **Relief:** [Natural Earth 1:50m Manual Shaded Relief 3.3.0](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-manual-shaded-relief/), public domain. Atlas bilinear-warps the 10,800 × 5,400 WGS84 grayscale source to Equal Earth, clips it to the sphere, and stores styling opacity outside the raster. It is cartographic shading based on elevation reference data, not an elevation measurement layer. The committed WebP is 133,098 bytes.
- **Rivers:** Natural Earth 1:50m Rivers and Lake Centerlines 5.1.2, public domain. Phase 2 retains features explicitly classed as `River` with source `min_zoom <= 3` (94 renderable lines).
- **Lakes:** Natural Earth 1:50m Lakes 5.1.2, public domain. Phase 2 retains source `min_zoom <= 3` (77 renderable polygons). The build removes one byte-for-byte duplicate Lake Zaysan source feature and records no invented replacement.
- **Cities:** Natural Earth 1:50m Populated Places 5.1.2, public domain. Phase 2 retains all national capitals plus places with `SCALERANK <= 2` (319 points). `SCALERANK` derives the current world/regional/country display level; `MIN_ZOOM` is retained for future refinement but does not currently drive rendering. Natural Earth's UN urban-agglomeration `POP2025` series is stored in thousands and Atlas converts it to integer people. It remains an estimated future/audit hint—not a harmonized metropolitan-population statistic—and current marker size uses cartographic rank and capital status.

The three vector collections preserve the Natural Earth feature identifier when it is unambiguous, canonical EPSG:4326 geometry, stable Atlas feature/entity IDs, nullable validity bounds, source and observation-time metadata, and a derived Equal Earth path or point. Canonical coordinates stay projection-independent so a later renderer does not have to reverse-engineer SVG paths.

### Contextual annotations

`pattern-notes.v1.json` contains four source-reviewed annotations for patterns visible in the density raster: the Nile Valley and Delta, Java, the Heihe–Tengchong east/west population divide, and the Indo-Gangetic Plain. Each record has:

- layer/view triggers and zoom bounds;
- country and geography references;
- WGS84 focus/bounds plus an Equal Earth focus point;
- concise explanation and causal-strength label;
- evidence title, publisher, URL, publication/retrieval dates, and the exact claim that evidence supports;
- time bounds, caveats, related explanatory layers, and editorial review state.

`PatternNote` remains an internal model name, not a permanent user-facing label. The four records are explicitly approved for the Atlas surface after an AI-assisted source review; their metadata also says plainly that human editorial review has not been performed. This is a narrower standard than the human approval required for JJU content associations, and Atlas does not present the notes as human-edited scholarship. The Heihe–Tengchong line is marked as an authored heuristic guide, not a border.

The explanatory citations embedded in `pattern-notes.v1.json` are editorial evidence metadata, not downloaded build inputs. Their URLs, publishers, titles, retrieval dates, and supported claims are retained, but those external pages are not byte-pinned in the twelve-source lock and can therefore move or disappear. The lock's reproducibility guarantee applies to the data and geometry used to build the visualization, not to permanent archival custody of every explanatory webpage.

### Geography-pack limitations

- Population is modeled residential population. It does not show daytime population, commuting, seasonal mobility, displacement after the source model, or uncertainty as a separate visual channel.
- GHSL 2025 is a projected epoch within R2023A. It must not be presented as a literal 2025 census surface.
- A 2400 × 1300 world raster is deliberately bounded for fast delivery. Zooming it cannot reveal the original 1 km detail; a tiled renderer would be needed for close-scale analysis.
- Relief is generalized artwork, not raw DEM data. Rivers and lakes are a small cartographic selection, not a hydrology network. Cities are a labeled-map selection, not a comprehensive gazetteer.
- Natural Earth includes political and naming choices. Physical features do not imply JJU endorsement of a sovereignty claim.
- Vector validity dates remain open because these sources do not establish feature-by-feature change dates. The contract can accept dated replacements later, but Phase 2 does not claim a historical physical-geography model.

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

- a required status: `observed`, `estimated`, `inherited`, `carried_forward`, `suppressed`, `not_applicable`, or `unavailable`;
- `observedAt` and its precision;
- nullable `validFrom` and `validTo`;
- `sourceId` and exact `sourceField`;
- explanatory notes.

The first four statuses may carry a displayable value while preserving how it was obtained. Suppressed, not-applicable, and unavailable observations remain explicit missing-data states. A real numeric zero is never treated as missing.

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
npm run atlas:sources:fetch
npm run atlas:sources:check
npm run atlas:world:build
npm run atlas:geography:build
npm run atlas:world:check
```

`atlas:sources:fetch` reads `data/atlas/sources.lock.json`, resolves inputs into the ignored repository-local `data/atlas/source-cache`, and accepts a file only when both its byte length and SHA-256 match. Because the World Bank and GeoNames URLs are mutable, their five small exact V1 inputs are preserved in `data/atlas/source-seeds`; the fetcher restores those locked bytes rather than pretending a later API response is the same snapshot. Version-tagged Natural Earth inputs remain remotely fetchable. The archived Factbook is a sparse checkout pinned to commit `2a40cddf0b0f57273c2f935be169d73496989a21`; its sorted file set is checked against the locked aggregate SHA-256. Useful bounded variants are:

```powershell
node scripts/fetch-atlas-sources.mjs --group=atlas-v1
node scripts/fetch-atlas-sources.mjs --group=phase2-geography
node scripts/fetch-atlas-sources.mjs --verify-only
```

The world builder now defaults to this repository-local cache. It no longer depends on files surviving in a user's operating-system temp directory. Another source location can still be provided with:

- `ATLAS_NATURAL_EARTH_SOURCE`
- `ATLAS_WORLD_BANK_COUNTRIES_SOURCE`
- `ATLAS_WORLD_BANK_POPULATION_SOURCE`
- `ATLAS_WORLD_BANK_GDP_SOURCE`
- `ATLAS_WORLD_BANK_GDP_PER_CAPITA_SOURCE`
- `ATLAS_GEONAMES_SOURCE`
- `ATLAS_FACTBOOK_SOURCE`
- `ATLAS_OUTPUT_DIRECTORY`
- `ATLAS_MAP_ASSET_DIRECTORY`

`ATLAS_SNAPSHOT_DATE` and `ATLAS_GENERATED_AT` can pin build metadata for a reproducible rebuild. The checked-in defaults reproduce the preserved V1 snapshot metadata.

`atlas:geography:build` creates an ignored Python 3.11 virtual environment under `data/atlas/tool-cache`, installs the exact package versions in `scripts/atlas-geography-requirements.txt`, verifies the five locked geography inputs, and regenerates the bounded raster/vector pack. Set `ATLAS_PYTHON` only when Python 3.11 is not discoverable normally.

`npm run atlas:world:check` verifies the original 242-entity snapshot, the layer contracts, the geography pack and raster hashes/dimensions, city-population unit conversion, contextual-annotation references/review gates, and the human-only JJU association publication gate. The current association authority contains ten unreviewed private proposals and zero published links; the check does not call those proposals reviewed. The generators exit non-zero if IDs collide, counts diverge, source hashes change, geometries are invalid, or a committed browser asset no longer matches its manifest. Non-fatal source gaps and contested joins remain visible in validation artifacts instead of being hidden.
