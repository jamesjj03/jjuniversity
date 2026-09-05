# JJU Atlas Phase 3 — product and engineering handoff

Date: September 5, 2026
Implementation worktree: `C:\Users\james\Desktop\MATRIX\jju\jjuniversity-atlas-phase25`
Branch: `codex/atlas-phase3`

Phase 3 is implemented in this dedicated worktree. **It has not been deployed.** This document describes the current local product and its checked-in data, including the experimental routes that are not yet linked from the primary Atlas toolbar.

## The 30-second version

Atlas is now a present-day, map-first world explorer rather than only a country choropleth. `/atlas` opens a Mercator world map where a user can search, hover, pan, zoom, and select **242 mapped political/geographic entities**, plus **2,470 named/searchable cities, rivers, and lakes**. A country opens a source-aware cockpit without replacing the map. A city, river, or lake opens a focused place card and retains links back to related countries.

The primary map has **12 authored views**: Political, Where people live, Religion, Government, Population, Urbanization, Population growth, Children and young teens, Older population, Fertility, Life expectancy, and GDP per capita. Contextual layers can add relief, population density, rivers, lakes, cities, and authored explanations where a view supports them.

Phase 3 also contains three bounded public explorations:

- `/atlas/globe`: an interactive orthographic globe experiment;
- `/atlas/subnational`: a six-country, 184-unit first-order subdivision pilot;
- `/atlas/index`: a searchable 58-term field guide to the concepts Atlas uses.

Editors have a separate protected `/admin/atlas` desk for evidence-backed explanation drafts, review decisions, and proposed JJU links. It does **not** automatically publish anything.

## What a user can open now

| Route | Current experience | Status and boundary |
| --- | --- | --- |
| `/atlas` | Full world map, unified country/place search, 12 views, contextual layer toggles, country cockpit, city/river/lake cards, legends, Pattern Notes, shareable state, and desktop/mobile layouts. | Primary product surface. |
| `/atlas/globe` | Canvas globe with drag rotation, pinch/wheel/buttons zoom, country hover/click/search, reset, deep links, and a compact selected-country card. | Working experiment; political coloring only and not linked from the main Atlas controls. |
| `/atlas/subnational` | Searchable first-order boundaries for the United States, Canada, China, Germany, India, and Nigeria. Users can pan, zoom, hover, select, reset, and share a unit. | Working bounded pilot; the contextual statistics shown are clearly labeled national, not subdivision measurements. |
| `/atlas/index` | Search and filter 58 Atlas terms across seven groups, with definitions, examples, caveats, related ideas, and sources. | Working standalone field guide. The same definitions are available through contextual term modals on the main map. |
| `/admin/atlas` | Review desk for private explanation drafts, existing explanation decisions, and geographic JJU association proposals. | Protected editorial surface; no automatic publication. |

The public routes are backed by two API families:

- `/api/atlas/countries/[slug]` returns full country detail only when needed and permits public caching.
- `/api/atlas/layers/[layerId]` serves status-bearing national observations for GDP per capita and the six Phase 3 demographic measures. `?at=` is accepted, but an unsupported historical date returns a clear error instead of relabeling present-day data as historical.

## The main Atlas experience

### Search and map interaction

The search box now says “Find a country, city, river, or lake.” It returns up to eight results and supports mouse/touch use, arrow keys, Enter, Escape, `/`, and Cmd/Ctrl-K. Country aliases and codes remain searchable. Selecting a result keeps the active view, moves the camera to the relevant geography, opens the corresponding cockpit/card, and writes a friendly URL using `country=`, `city=`, or `feature=`. Browser back and forward restore the mapped selection.

Country hover remains the quick reward. It identifies the place and adds the active view's value when one exists. Rivers, lakes, cities, and contextual notes have their own pointer interactions without replacing the country hit surface.

### The 12 map views

| View | What determines the map | What else can be shown |
| --- | --- | --- |
| Political | Authored neighboring-country contrast colors; these colors do not imply political similarity. | Modern borders and country interaction. |
| Where people live | Modelled 2025 GHSL population-density raster. | Relief, borders, rivers, lakes, cities, and four contextual explanations. |
| Religion | Normalized dominant broad religious tradition. | Categorical legend and source/missing-data treatment. |
| Government | Broad normalized government form derived from retained source wording. | Categorical legend and source/missing-data treatment. |
| Population | Latest available World Bank population total. | Binned legend with the actual observation year retained per country. |
| Urbanization | Urban population as a share of total population. | 215 observed entities and 27 explicit gaps. |
| Population growth | Annual population growth rate. | 215 observed entities and 27 explicit gaps. |
| Children and young teens | Population ages 0–14 as a share of total population. | 215 observed entities and 27 explicit gaps. |
| Older population | Population ages 65 and above as a share of total population. | 215 observed entities and 27 explicit gaps. |
| Fertility | Total fertility rate, births per woman. | 215 observed entities and 27 explicit gaps. |
| Life expectancy | Life expectancy at birth in years. | 215 observed entities and 27 explicit gaps. |
| GDP per capita | Latest available nominal GDP per person in current US dollars. | Continuous logarithmic scale, actual observation year, and 29 explicit gaps. |

The six new demographic observations use 2025 data for urbanization, population growth, ages 0–14, and ages 65+, and 2024 data for fertility and life expectancy. Atlas does not fill missing countries with estimates or silently substitute another concept.

### Country cockpit

Selecting a country preserves the map and opens a side cockpit on desktop or a swipeable Peek / Half / Full bottom sheet on mobile. The cockpit currently presents:

- flag, common name, official name, region, and subregion;
- territorial-status context where a reviewed explanation exists;
- what the current map view is showing, the selected value, observation year, source, and missing-data state;
- capital, population, area, total GDP, GDP per person, and World Bank income group;
- government classification plus the retained source wording;
- head of state and head of government, including term/source/freshness information when present;
- dominant religion and structured composition, including source wording, denominator, year, and caveats;
- languages and currency;
- urban share, population growth, ages 0–14, ages 65+, fertility, and life expectancy;
- up to 12 mapped cities;
- source and cartographic metadata;
- a JJU section only when approved geographic associations exist.

Each Phase 3 demographic fact has a “Compare on map” action, so reading a country's fact can immediately turn into a world comparison.

Leadership portraits are deliberately narrow: four reviewed, locally stored portraits support six exact office/person bindings across Gabon, the United Kingdom, and South Africa. Three are currently eligible to display; the obsolete Keir Starmer office binding is suppressed after the office record's supersession. A portrait is shown only when the selected country's office holder, identity, and reviewed binding still match.

### City, river, and lake cards

Atlas now treats a named place as a logical identity separate from its coarse/detail/multipart map geometry. That makes one river or lake searchable and selectable even when the renderer uses several source parts.

- **Cities** can show type or capital status, aliases, country, administrative region, population where available, coordinates, and sources.
- **Rivers and lakes** show names, aliases, the mapped countries their geometry intersects, and sources. The country relationship is explicitly cartographic; it does not claim ownership or an entire drainage basin.

The current source populates population for 460 of 1,140 cities and an administrative region for 1,102. It supplies no city elevation. The river/lake schema can hold length, area, depth, source, mouth, and basin information, but the current generated records do not contain those facts, so the UI does not invent them.

### Mobile behavior

The main country and place surfaces use deliberate bottom sheets instead of a shrunken desktop sidebar. Peek keeps spatial context, Half is the normal selected-place state, and Full gives the detail surface the viewport. Covered map controls and legends are removed from pointer and keyboard interaction. The globe supports touch rotation and pinch zoom; the subnational pilot uses the same general map-plus-sheet model.

## The three bounded explorations

### Globe experiment

`/atlas/globe` renders all 242 present-day units in a Canvas using D3's orthographic projection and the canonical WGS84 geometry. It supports rotation, zoom, reset, country search, hover, selection, tiny-country assistance, `?country=` deep links, and browser history. Its selected-country card shows the flag, names, capital, population/year, government, and dominant religious tradition, with a link to the full flat-map cockpit.

The experiment is honest about what it does not do: political coloring is the only view, and the flat Mercator relief and density rasters are not wrapped onto the sphere. The route is not yet a primary-navigation destination. The canonical globe asset is **2.29 MB raw and 733 KB Brotli**.

### Subnational pilot

`/atlas/subnational` contains **184 first-order units**:

- United States: 51
- Canada: 13
- China: 31
- Germany: 16
- India: 36
- Nigeria: 37

Users can switch pilot countries; search names, aliases, or ISO 3166-2 codes; and pan, zoom, hover, select, reset, and deep-link a unit. The detail surface shows the unit name, source administrative type, code, parent country, geometry type, and source. It can also show national population, GDP/person, urbanization, life expectancy, and government, but every such value is visibly labeled inherited national context.

This is not global subnational coverage and contains no subdivision-level statistical series. The Paracel Islands source record is deliberately excluded because Natural Earth identifies it at GADM level 0 and provides a non-standard provisional code.

### Atlas Index and on-map Field Guide

`/atlas/index` contains **58 terms in seven groups**: Geography, Territorial status, Demography, Economy, Government, Religion, and Reading the map. It searches across names, aliases, definitions, examples, caveats, and Atlas usage; supports group filters and related-term navigation; and retains source links and review dates. On the main map, the same material opens in a native modal through the Field Guide rather than forcing a route change.

This is an Atlas vocabulary, not a replacement for JJU-wide search.

## Data and provenance actually present

The current build recognizes **242 Natural Earth map entities**. Coverage is intentionally reported rather than hidden:

| Field | Entities with data |
| --- | ---: |
| Official ISO3 code | 236 |
| World Bank metadata join | 215 |
| GeoNames join | 237 |
| Factbook join | 235 |
| Capital | 235 |
| Population | 215 |
| Area | 237 |
| Languages | 235 |
| Currency | 236 |
| Total GDP | 213 |
| GDP per capita | 213 |
| Each of the six Phase 3 demographic indicators | 215 |
| Government classification | 230 |
| Head of state | 231 |
| Head of government | 230 |
| Religion source record | 228 |
| Normalized religion record | 221 |

Leadership currently contains **461 office records**. Of those, **460 are due for review or do not have a sufficiently current review date**, and one current update has a separate completed review. This is a dated snapshot, not a promise of live office-holder accuracy.

Religion remains deliberately structured rather than flattened to one eternal label. Atlas retains broad normalized traditions, available composition percentages, source wording, year/denominator context, and caveats. Government likewise retains source wording behind a versioned broad classification rather than treating the category as an ideology score.

### The 22 locked source inputs

`data/atlas/sources.lock.json` (`jju-atlas-sources-2026-09-05`) is the reproducibility record. Each entry pins a URL or Git revision, expected bytes, SHA-256, retrieval date, license, transformations, and outputs. It also describes four reproducible builds: the world snapshot, canonical WGS84 globe geometry, geography pack, and Admin-1 pilot.

| # | Locked input | Current use and provenance |
| ---: | --- | --- |
| 1 | Natural Earth Admin 0, 1:50m, v5.1.2 | Present-day 242-unit geometry, identifiers, cartographic status metadata, and political navigation colors. Public domain. |
| 2 | World Bank country metadata, snapshot 2026-09-03 | Country crosswalk, capital, region, and income group. CC BY 4.0. |
| 3 | World Bank `SP.POP.TOTL`, API update 2026-07-13 | Latest non-empty population observation. CC BY 4.0. |
| 4 | World Bank `NY.GDP.MKTP.CD` | Latest non-empty nominal GDP in current US dollars. CC BY 4.0. |
| 5 | World Bank `NY.GDP.PCAP.CD` | Latest non-empty nominal GDP per person in current US dollars. CC BY 4.0. |
| 6 | World Bank `SP.URB.TOTL.IN.ZS` | Urban population share. CC BY 4.0. |
| 7 | World Bank `SP.POP.GROW` | Annual population growth. CC BY 4.0. |
| 8 | World Bank `SP.POP.0014.TO.ZS` | Ages 0–14 share. CC BY 4.0. |
| 9 | World Bank `SP.POP.65UP.TO.ZS` | Ages 65+ share. CC BY 4.0. |
| 10 | World Bank `SP.DYN.TFRT.IN` | Fertility rate. CC BY 4.0. |
| 11 | World Bank `SP.DYN.LE00.IN` | Life expectancy at birth. CC BY 4.0. |
| 12 | GeoNames `countryInfo`, snapshot 2026-09-03 | Identity crosswalk, area, languages, and currencies. CC BY 4.0. |
| 13 | Final archived CIA World Factbook dataset, commit `2a40cddf0b0f57273c2f935be169d73496989a21`, captures through 2026-02 | Government, leadership, religion, and retained source wording. Repository distributed under CC0. This is an archive, not a live feed. |
| 14 | EC JRC GHSL GHS-POP R2023A V1, 2025 epoch, 1 km World Mollweide | Modelled population-density surface. CC BY 4.0. |
| 15 | Natural Earth Manual Shaded Relief 1:50m, v3.3.0 | Physical-relief raster. Public domain. |
| 16 | Natural Earth rivers/lake centerlines 1:50m, repo v5.1.2 | World-scale river geometry. Public domain. |
| 17 | Natural Earth lakes 1:50m, repo v5.1.2 | World-scale lake geometry. Public domain. |
| 18 | Natural Earth populated places 1:50m, repo v5.1.2 | Pinned and verified but not consumed by the current build (`usedBy: []`). Public domain. |
| 19 | Natural Earth rivers/lake centerlines 1:10m, repo v5.1.2 | Regional/country river detail. Public domain. |
| 20 | Natural Earth lakes 1:10m, repo v5.1.2 | Regional/country lake detail. Public domain. |
| 21 | Natural Earth populated places 1:10m, repo v5.1.2 | Current 1,140-city index and markers. Public domain. |
| 22 | Natural Earth Admin 1, 1:10m, repo v5.1.2 / data theme v5.1.1 | Six-country subdivision pilot. Public domain. |

Small mutable API snapshots are preserved under `data/atlas/source-seeds`. Large fetched inputs remain in `data/atlas/source-cache`, outside the normal committed product payload. Reproducible derivatives are committed with checksums.

### Geography payloads

The current geography pack contains **2,962 render features** before logical grouping:

- 1,311 river features;
- 511 lake features;
- 1,140 city features.

Multipart/coarse/detail geometry is grouped into **2,616 logical source places**. The visual surface retains all of their geometry, but 146 unnamed river/lake source groups are deliberately excluded from public search and deep links. The resulting public index contains **2,470 named/searchable places**:

- 993 rivers;
- 337 lakes;
- 1,140 cities.

The population-density pyramid is **106.9 MB across 556 tiles**: 46 regional tiles, 133 country-detail tiles, and 377 close-detail tiles. The relief pyramid is **15.5 MB across 224 source-detail tiles**. Those figures describe all stored detail, not one page download: the viewport loader asks only for visible tiles at the needed zoom. The underlying GHSL evidence remains a 1 km modelled grid; zooming does not create finer evidence.

Rivers, lakes, cities, annotations, and subnational units retain canonical EPSG:4326 geometry plus derived Mercator display geometry. The flat map uses a preprojected 1200 × 650 Mercator SVG coordinate space; the globe consumes a separate canonical WGS84 asset. Mercator's high-latitude area distortion is documented in the layer methodology rather than hidden.

## Editorial approval and public truth

`/admin/atlas` is designed around the question “Decide what Atlas can say.” It has three areas:

1. private contextual-explanation drafts;
2. review decisions for existing explanations;
3. proposed JJU geographic associations.

The boundary is intentionally strict:

- creating or approving a draft does **not** write a public Pattern Note;
- association approval requires a named human reviewer, review note and time, exact evidence text and locator, evidence hash, current source revision, relationship semantics, and a still-public/readable JJU subject;
- approved material becomes public only through a later product build;
- hosted writes fail closed if the durable GitHub-backed store is not configured;
- local development can use the versioned local JSON store;
- API updates require admin authentication, schema-valid payloads, exact version/ETag matching, and bounded request sizes.

The current authority contains:

- **0 new annotation drafts**;
- **4 visible contextual explanations**, source-reviewed and marked Atlas-visible, whose records still say `humanEditorialReview: not-performed`;
- **10 private JJU association proposals and 0 approved/public JJU links**;
- **7 source-reviewed territorial-status records** backed by 25 sources; their recorded reviewer kind is agent, not human;
- **4 licensed portrait files**, 5 reviewed people, 6 reviewed offices, and 6 exact portrait bindings.

The four legacy source-reviewed notes remain visible while their decision state is `proposed`; reject, retire, or supersede hides them. Approval records human review, but it still does not publish a hidden draft automatically.

There is no new Supabase Atlas schema in this phase. Editorial authority is versioned JSON persisted through configured GitHub storage or local development files. That keeps public output build-reviewed, but it is not yet a transactional multi-editor system.

## How the product is assembled

```text
/atlas
├── AtlasWorldExperience                 interaction, search, URL/history, selection
│   ├── AtlasViewBrowser                 12 authored questions/views
│   ├── AtlasWorldMap                    flat-map renderer registry
│   │   ├── admin-0 fill + borders       one active thematic country fill
│   │   ├── raster surfaces              density and relief, viewport-tiled
│   │   ├── lines/polygons/points        rivers, lakes, cities
│   │   └── interaction/annotations      country hit surface and explanations
│   ├── AtlasLegend                      scale, missing data, source/year, highlighting
│   ├── AtlasCountryPanel                lazy full country cockpit
│   └── AtlasPlaceCard                   city, river, and lake details
├── /atlas/globe                         Canvas + D3 orthographic experiment
├── /atlas/subnational                   184-unit Admin-1 pilot
├── /atlas/index                         58-term field guide
└── /admin/atlas                         protected editorial desk
```

Important entry points:

- route/runtime loading: `app/atlas/page.tsx`, `lib/atlas-world/getAtlasRuntime.ts`;
- primary shell: `components/atlas-world/AtlasWorldExperience.tsx`;
- flat renderer: `components/atlas-world/AtlasWorldMap.tsx`;
- country and place details: `AtlasCountryPanel.tsx`, `AtlasPlaceCard.tsx`;
- view/legend UI: `AtlasViewBrowser.tsx`, `AtlasLegend.tsx`;
- layer contract/catalog/planner: `lib/atlas-world/layers/contracts.ts`, `catalog.v2.json`, `planner.ts`;
- search/place identity: `lib/atlas-world/places.ts`;
- globe: `app/atlas/globe/page.tsx`, `components/atlas-world/AtlasGlobeExperiment.tsx`;
- subnational pilot: `app/atlas/subnational/page.tsx`, `lib/atlas-world/admin1Pilot.ts`, `components/atlas-world/AtlasSubnationalExperience.tsx`;
- glossary: `lib/atlas-world/glossary.ts`, `components/atlas-world/AtlasIndex.tsx`, `AtlasTerm.tsx`;
- editorial workflow: `app/admin/atlas/page.tsx`, `components/atlas-world/AtlasEditorialDesk.tsx`, `lib/atlasEditorialStore.ts`;
- source authority: `data/atlas/sources.lock.json`;
- generated validation summary: `lib/atlas-world/data/validation.v1.json`;
- generated geography summary: `lib/atlas-world/data/geography-pack.v1.json`.

### Layer model

The live flow is:

```text
Dataset
  → Layer definition
    → Layer instance
      → View preset
        → Scene state
          → validated render plan
            → registered renderer
```

The catalog currently declares **18 datasets, 19 layer definitions, and 12 view presets**. The renderer registry supports raster fields, country fills, polygon features, boundaries, lines, point symbols, annotations, and the independent country interaction surface. The planner validates data/geometry compatibility, ordering, dependencies, conflicts, opacity, exclusive visual channels, and time support before rendering.

The exact catalog dataset IDs are:

```text
admin0-geography                    admin0-political-contrast
admin0-government                   admin0-religion-dominant
admin0-population-total             admin0-gdp-per-capita
admin0-urban-population-share       admin0-population-growth-annual
admin0-population-ages-0-14         admin0-population-ages-65-plus
admin0-fertility-rate               admin0-life-expectancy
physical-relief                     population-density-2025
major-lakes                         major-rivers
major-cities                        population-geography-annotations
```

Their 19 render layers are the 11 country fills from Political through Life expectancy, plus `modern-borders`, `admin0-interaction`, `physical-relief`, `population-density-2025`, `major-lakes`, `major-rivers`, `major-cities`, and `population-geography-annotations`.

A preset can already combine one country-level thematic fill with borders, relief, density, rivers, lakes, cities, and annotations. Users can toggle the contextual layers assigned to that preset. The system does **not** yet support arbitrary user-built stacks, two simultaneous country fills, bivariate maps, or opacity controls in the product UI. Shared URLs reject custom stacks that contradict the authored preset.

The contracts anticipate historical areas, routes, points, labels, annotations, coordinate focus, and temporal policies. Present-day layers still only support their declared snapshot/latest policy. There is no global timeline or historical border dataset.

## Performance findings

The current design avoids downloading every stored raster tile and now progressively mounts rivers, lakes, and cities. The server still resolves a requested place before hydration, but the global named-place and feature indices arrive once through cacheable lazy APIs instead of being embedded in the opening page. Camera movement keeps only zoom-appropriate features inside an overscanned viewport mounted, while a selected multipart feature remains pinned in full.

These are Phase 3 handoff measurements from a 390 × 844 browser probe, not fixed validator invariants; they should be remeasured when the payload or renderer changes.

| Measurement | Current finding | What it means |
| --- | ---: | --- |
| Raw opening `/atlas` response | **3,357,263 bytes** | Below the checked 4.5 MB opening-page budget after removing the global place/feature payloads from the first frame. |
| Initial document | **2,695 DOM / 2,344 SVG nodes** | The same view previously mounted roughly 19,000 DOM nodes; the opening map is now bounded. |
| Mounted map features | **123 after hydration at world scale** | 47 rivers, 40 lakes, and 36 cities were visible in the phone viewport; after zoom/pan, the set changed to the exact 43 features expected for that camera. |
| Lazy public indices | **1 places request + 1 feature request** | The 2,470-place search index and 2,962-feature render manifest are session-cached after the first frame. |
| Approximate initial browser heap | **104 MB** | Directional browser instrumentation only; useful as a regression signal rather than a cross-browser guarantee. |
| Globe geometry | **2.29 MB raw / 733 KB Brotli** | Canvas avoids a huge SVG DOM, but the experiment still loads the complete present-day WGS84 geometry. |
| Population-density detail | **106.9 MB / 556 tiles** | Stored globally, fetched by visible viewport/zoom rather than all at once. |
| Relief detail | **15.5 MB / 224 tiles** | Stored globally, likewise fetched only as needed. |
| Locked source inputs | **22** | All have reproducibility metadata and passed the source-lock check. |

The current flat renderer is serviceable for this bounded product, and progressive feature mounting substantially raises its useful ceiling. The next scaling boundary is that each lazy endpoint still returns one complete compact index and the camera performs a small in-memory filter over 2,962 descriptors. Much larger gazetteers, global subdivisions, or dense interactive routes should add regional/queryable indices rather than expanding those two whole-index responses. The globe remains an alternative renderer experiment, not a feature-equivalent replacement.

## Verification at handoff

Verified in this Phase 3 worktree on September 5:

- `npm run atlas:sources:check` — **passed**, verifying all 22 locked inputs;
- `npm run atlas:world:check` — **passed**, covering 242 entities, 18 datasets, 19 layers, 12 views, all six new 215-entity World Bank layers and their 27 explicit gaps, 2,962 vector render features, 184 Admin-1 pilot units, leadership/portrait authorities, Pattern Notes, and the 0-public/10-private JJU boundary;
- `npm run atlas:globe:check` — **passed**, verifying 242 canonical WGS84 globe entities and 99,613 positions;
- complete Atlas Playwright suite — **194 passed, 24 intentional cross-profile skips, 0 failed** across desktop and mobile, including the curiosity loop, first-frame deep links, feature virtualization, raster failure/recovery, mobile sheets, globe, Admin-1, disputes, leadership, and editorial authority;
- `npm run lint` — **passed** across the repository after generated browser-test artifacts were explicitly excluded from lint discovery;
- standalone TypeScript check — **passed** with no diagnostics;
- `npm run build` — **passed** with Next.js 16.3.2/Turbopack, including TypeScript and 16,382 generated static pages. The new `/api/atlas/places` and `/api/atlas/features` routes are present in the production route table, and their geography pack is bundled into the traced server chunks.

The optimized production build was also started locally with protected admin credentials. `/admin/atlas` loaded its real 0/4/10 review queues, had no horizontal overflow, and exposed the WGS84 preview as one correctly named image without the earlier invalid wrapper label. No production-site smoke test was performed because Phase 3 was **not deployed**.

## Honest limits and deferred work

These are product boundaries, not hidden promises:

- **Present day only.** Time is represented in contracts and observations, but there is no global time slider, historical country series, polity succession model, or historical-border geometry.
- **One national fill at a time.** Presets can combine contextual raster/vector layers, but users cannot freely compose two thematic national datasets or make bivariate maps.
- **Place facts are uneven.** Cities are a cartographic/gazetteer set rather than a harmonized world-city database. Rivers and lakes do not yet have encyclopedic physical facts.
- **The globe is exploratory.** It lacks the flat map's thematic views, raster layers, place layers, Pattern Notes, and full country cockpit.
- **Subnational coverage is a pilot.** Six countries, no global Admin-1 coverage, and no subdivision statistics.
- **Leadership is stale by design until reviewed.** The archived Factbook is not a live political feed; 460 of 461 office records are due/undated.
- **Portraits are a tiny licensed pilot.** Four media files are not global leader coverage.
- **JJU integration is still private.** Ten proposals exist, but no link is public until a human approves the exact evidence and a build includes it.
- **Explanations need human editorial review.** The four visible notes are source-reviewed but explicitly record that human editorial review has not occurred.
- **No arbitrary pin workflow.** Coordinate focus can be serialized, but users cannot yet drop a pin and receive a “history of this place” result.
- **The lazy feature APIs still return complete compact indices.** They are cached and loaded after the first frame, but they are not yet server-filtered, paginated, or split by map region.
- **No deployment.** Nothing in this Phase 3 worktree has been released to production.

## Run and inspect locally

From `C:\Users\james\Desktop\MATRIX\jju\jjuniversity-atlas-phase25`:

```powershell
npm run dev
# Open the local address printed by the dev server, then visit:
# /atlas
# /atlas/globe
# /atlas/subnational
# /atlas/index
# /admin/atlas  (requires the existing admin credentials)
```

Reproducibility and Atlas checks:

```powershell
npm run atlas:sources:check
npm run atlas:world:check
npm run atlas:e2e
```

Rebuilding source-derived artifacts is separate from simply viewing the committed product:

```powershell
npm run atlas:sources:fetch
npm run atlas:world:build
npm run atlas:geography:build
```

The source fetch includes large raw inputs and is unnecessary for an ordinary local product review.
