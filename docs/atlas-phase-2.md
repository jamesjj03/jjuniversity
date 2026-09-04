# JJU Atlas Phase 2 — implementation handoff

Date: September 4, 2026
Implementation worktree: `C:\Users\james\Desktop\MATRIX\jju\jjuniversity-atlas-phase2`
Branch: `codex/atlas-phase2`

Phase 2 is implemented in the dedicated worktree. It has **not** been deployed from this worktree.

## What Atlas is now

`/atlas` remains a map-first Equal Earth world atlas. It preserves the 242-place ontology, country search, hover facts, click selection, pan/zoom, tiny-territory hit targets, intelligent camera fitting, reset controls, country deep links, and browser back/forward behavior from V1.

Phase 2 adds a real scene-and-layer system and a sixth authored view:

| View | What the user sees |
| --- | --- |
| Political | Neighbor-contrast country colors and modern borders. The colors aid navigation; they do not encode political similarity. |
| Government | Broad, sourced government classifications with categorical legend and missing-data treatment. |
| Religion | Dominant broad religious tradition, with deliberately unresolved or mixed cases left visible as such. |
| Population | Country population totals in sourced, categorical ranges. |
| GDP per capita | A continuous, logarithmic World Bank choropleth. The tooltip and cockpit retain each economy's actual observation year; no inflation or purchasing-power adjustment is implied. |
| Where people live | A 2025 modelled population-density surface over subtle relief, country context, major lakes, modern borders, major rivers, cities, and four contextual explanations. Its individual physical layers can be turned on and off without leaving the view. |

Search results can be used from the keyboard. Selecting a place fits it into the usable map area, keeps the current view, updates the URL, and loads full details only when needed. Hover still gives the fast reward: place, capital, population, and the active view's value where one exists.

## Country cockpit

The selected-place surface is now a map-connected cockpit rather than one long fact sheet.

- The persistent header carries flag, common and official names, and regional identity.
- **Map is showing** explains the current lens, the selected place's value or missing status, observation year, and source publisher.
- **At a glance** prioritizes capital, population, GDP per person, area, government, and currency.
- Facets appear only when the place has useful data: Overview, People, Politics, Economy, Geography, and, once approved links exist, JJU.
- Overview cards and facet actions can move directly to the relevant map view: government, religion, GDP per capita, population totals, settlement geography, or political geography.
- People includes languages and sourced religious-composition bars. Politics preserves raw government wording and distinct heads of state/government, including term dates where present. Economy contains GDP, GDP per person, World Bank income group, and currency. Geography includes area, region, the retained Natural Earth map classification, association-to-sovereign context, and boundary notes.
- The footer lists the sources actually used for the selected place.

Full details still come through the cacheable country-detail route and are held in a session cache. Moving between places does not navigate away from the map.

### Mobile

Mobile uses a deliberate **Peek / Half / Full** bottom sheet. The handle supports taps and vertical swipes, and explicit 44-pixel detent controls remain available. Half is the normal search-selection state; map taps can open the lighter peek state. Any open country sheet removes its covered legend from interaction. Full gives the cockpit the viewport and temporarily makes the toolbar, map controls, and explanation controls inert; the map stage itself is non-focusable and covered. An open explanation likewise removes map controls hidden beneath its card from keyboard and assistive-technology navigation. Safe-area insets, focus entry/return, map-aware camera fitting, and touch pan/pinch preserve a map-first experience.

## Contextual map explanations

The internal model is named `PatternNote`; that name is not exposed as a permanent product label. In the UI the surface currently says **Notice a pattern** and **Map explanation**.

The first four notes explain visually conspicuous features in the population surface:

1. the Nile Valley and Delta;
2. Java;
3. the Heihe–Tengchong population divide in China;
4. the Indo-Gangetic Plain.

Each record has a stable ID and revision, view/dataset triggers, zoom bounds, WGS84 focus/bounds, linked Atlas entities plus optional sourced or authored geometry, the rendered observation it explains, related layers, a multifactor causal-strength label, evidence links, caveats, temporal extent, and review metadata. Selecting a note focuses its geography and creates shareable feature-focus state. A single-country note can then open that country without losing the map context; the multi-country Indo-Gangetic note deliberately does not choose one arbitrary country.

These notes passed an AI-assisted source review and are explicitly Atlas-visible, but their records also state `humanEditorialReview: not-performed`. Human editorial review is still recommended before they become permanent featured scholarship. Their external evidence links and claim metadata are retained in the note records, but the linked explanatory webpages are not downloaded or byte-pinned by the twelve-source build lock.

## The architecture that shipped

The live path is now:

```text
Dataset
  → Layer definition
    → Layer instance
      → View preset
        → Scene state
          → Validated render plan
            → SVG renderer registry
```

The contracts are in `lib/atlas-world/layers/contracts.ts`; the versioned catalog is `lib/atlas-world/layers/catalog.v2.json`.

### 1. Dataset

A dataset declares what the evidence is: value and geometry type, unit, geographic resolution, conceptual taxonomy depth, stable entity/feature key, access method, source IDs, source field, and temporal policy. Geographic resolution and conceptual resolution are independent. Access can be inline, a cacheable API, a bundled resource, or a static asset.

### 2. Layer definition

A layer declares how evidence is represented: resolver, renderer type, visual channel, semantic slot, order, default opacity and style, interaction behavior, legend, observation-status-aware missing data, compatibility rules, provenance, methodology, authored visual choices, and time policy. The catalog has 12 datasets and 13 layer definitions.

### 3. Layer instance

An instance is the serializable use of a layer in one scene: enabled state, opacity, optional layer-specific time, and renderer parameters. Definitions remain stable while instances can differ between authored views.

### 4. View preset

The six familiar buttons are authored compositions, not bespoke map components. Each preset carries its layer order, a human question, share behavior, and any legacy mode aliases. Phase 2 deliberately exposes curated views rather than arbitrary user stacking.

### 5. Scene state

Scene state contains the preset, ordered layer instances, time selection, and focus on an entity, feature, or coordinate. URLs use `view`, `focus`, and optional `time` and `layers=v2:…`; custom layer state preserves enabled state, opacity, parameters, and per-layer time. Existing `mode` and `country` deep links are still read and canonicalized. Hover and open-menu state are intentionally not serialized.

### 6. Validated render plan

`lib/atlas-world/layers/planner.ts` is the gate between URL/UI state and rendering. It checks registered datasets and layers, renderer/geometry compatibility, opacity, required and conflicting layers, exclusive visual channels, and whether the requested time is actually supported. It then orders valid layers by semantic slot and authored z-order and aggregates legends and sources. Current present-day layers reject unsupported historical dates instead of silently displaying them as historical data.

### SVG renderer registry

`components/atlas-world/AtlasWorldMap.tsx` registers renderers by data shape rather than by view name:

- `raster-field` for preprojected population and relief images;
- `polygon-feature` for lakes;
- `polygon-boundary` for modern borders;
- `line` for rivers;
- `point-symbol` for cities;
- `annotation` for explanations;
- `interaction` for the separate admin-0 hit surface.

The existing country choropleths share one server-rendered admin-0 fill surface and are recolored from the validated plan as data arrives. This preserves 242-country interaction and avoids duplicating geometry for every national fill. Passive layers are ordered beneath the country hit surface; feature-specific interactive layers such as annotations sit above it. Zoom changes the feature level-of-detail marker between world, regional, and country display.

The registry makes another raster, line, point, polygon-feature, border, or annotation layer a catalog/data addition instead of a new view-specific JSX branch. It does **not** yet promise that every arbitrary combination is meaningful or safe.

## Data, provenance, and limits

`data/atlas/sources.lock.json` is the reproducibility authority. It pins URLs or Git commit, exact byte length where applicable, SHA-256, retrieval date, license, transformations, outputs, and the source IDs used by each build.

### Country and political data

| Source | Pinned version | Use | License |
| --- | --- | --- | --- |
| Natural Earth Admin 0, 1:50m | 5.1.2 | 242 map entities, modern geometry, navigation colors, names/codes/status metadata | Public domain |
| World Bank country metadata | 2026-09-03 API snapshot | crosswalks, region, capital, income group | CC BY 4.0 |
| World Bank `SP.POP.TOTL` | API update 2026-07-13 | latest population observation | CC BY 4.0 |
| World Bank `NY.GDP.MKTP.CD` | API update 2026-07-13 | current-US-dollar GDP | CC BY 4.0 |
| World Bank `NY.GDP.PCAP.CD` | API update 2026-07-13 | current-US-dollar GDP per capita | CC BY 4.0 |
| GeoNames `countryInfo` | 2026-09-03 snapshot | identity crosswalk, area, languages, currencies | CC BY 4.0 |
| Final archived CIA World Factbook capture | Git commit `2a40cddf…`, captures through 2026-02 | government, leadership, religion, and selected country wording | CC0 repository license |

Coverage across the preserved 242 entities is: 235 capitals, 215 population values, 237 areas, 235 language records, 236 currencies, 213 GDP values, 213 GDP-per-capita values, 230 normalized government records, and 221 normalized dominant-religion records. GDP per capita is loaded through `/api/atlas/layers/admin0-gdp-per-capita`; it returns status-bearing observations, actual years, sources, a 213 observed / 29 unavailable coverage summary, HTTP cache headers, and a 422 response for unsupported historical dates.

Important limits:

- World Bank files are latest-non-empty snapshots, not historical series. Observation years vary and remain visible.
- GDP is nominal current US dollars, not real or purchasing-power-adjusted output.
- The Factbook is a final archive, not a live service. Leadership and other mutable facts require refresh or editorial review as they age.
- Government is a broad, versioned normalization of retained source wording, not an ideology label.
- Religion is broad-tradition data. Incomplete, overlapping, or incomparable source percentages are not forced into a confident category.
- The 242 Natural Earth units are map entities, not 242 equivalent sovereign states. Natural Earth's type and sovereign relationship are retained as source metadata rather than converted into an Atlas sovereignty judgment.

### Population and physical geography pack

| Source | Pinned version | Built result | License |
| --- | --- | --- | --- |
| EC JRC GHSL GHS-POP | R2023A V1.0, 2025 epoch, World Mollweide 1 km | 2400 × 1300 Equal Earth WebP population surface | CC BY 4.0 |
| Natural Earth Manual Shaded Relief | 1:50m 3.3.0 | 2400 × 1300 Equal Earth relief WebP | Public domain |
| Natural Earth Rivers and Lake Centerlines | 1:50m 5.1.2 | 94 WGS84 river features plus Equal Earth paths | Public domain |
| Natural Earth Lakes | 1:50m 5.1.2 | 77 WGS84 lake features plus Equal Earth paths | Public domain |
| Natural Earth Populated Places | 1:50m 5.1.2 | 319 national-capital or high-rank city points plus Equal Earth points | Public domain |

The GHSL grid is a modelled 2025 spatial distribution. It is area-resampled into the display raster and rendered with an authored `log1p` color/alpha scale. A display pixel averages many source cells; Atlas does not present it as an exact queryable one-kilometre value. Relief is cartographic shading, not elevation data. Rivers are generalized centerlines, lakes are a selected cartographic set, and the city layer is not a complete gazetteer. Natural Earth's `POP2025` values are converted from thousands to people and retained as estimated future/audit hints; current city marker size is based on cartographic rank and capital status, not population.

The new river, lake, city, and authored annotation features retain canonical EPSG:4326 geometry and stable feature/geometry IDs. Their Equal Earth EPSG:8857 paths and points are recorded as derived representations, not the authority. The preserved 242 admin-0 runtime geometry has not yet been migrated into that full geometry-record shape: its committed artifact still contains projected paths, centroids, and bounds, while its canonical WGS84 authority remains the checksum-locked, reproducibly fetchable Natural Earth GeoJSON in the ignored source cache.

## Entity and time foundations

For new geography records, Phase 2 separates:

- entity identity (`country:ZWE`, typed codes, parent/sovereign hooks, admin level, validity);
- geographic feature identity (river, lake, city, annotation);
- canonical WGS84 geometry;
- derived Equal Earth display geometry;
- status-bearing observations and their source/time;
- scene-level and layer-level time selections.

This is the minimum useful foundation for later subdivisions and historical data. It intentionally does not normalize every political status, ingest Admin 1/2, model polity succession, or provide historical geometry. Physical relief can coexist with any time cursor because it is timeless; present-day snapshots explicitly report that they do not support arbitrary time.

## JJU association authority

`lib/atlas-world/associations/data/authority.v1.json` is the current versioned authority, with a JSON schema, TypeScript contract, validated loader, and stdout-only proposal helper.

Associations preserve subject type, relationship semantics, salience, exact evidence and locator, evidence hash, source revision, confidence as proposal metadata, temporal scope, review state, reviewer, and supersession. A book catalog change to the evidence-bearing fields makes an approved link stale. Publication requires `approved` state, a named human reviewer and time, a matching source revision, and a still-public/readable subject.

The pilot currently contains **10 private proposals and 0 approved/public links**:

- eight direct place portraits from *The Mapmakers*: Egypt, Germany, Japan, China, North Korea, Cuba, Saudi Arabia, and Antarctica;
- two lower-confidence *Control Freaks* proposals: North Korea and Belarus.

No proposal is sent to the public country payload. There is no Supabase association migration and no automatic publication. This is deliberate until a real multi-editor review surface warrants a database workflow.

## Reproducing and checking Atlas

From the Phase 2 worktree:

```powershell
# Restore or download every byte pinned by the source lock.
# The GHSL input alone is about 323 MB; raw caches remain outside Git.
npm run atlas:sources:fetch
npm run atlas:sources:check

# Rebuild the country snapshot and Equal Earth admin-0 geometry.
npm run atlas:world:build

# Rebuild population, relief, rivers, lakes, and cities.
# This creates a local Python 3.11 virtual environment from the pinned requirements file.
npm run atlas:geography:build

# Validate entity joins, layer contracts, geography assets/checksums, annotations,
# source lock, and the JJU review boundary.
npm run atlas:world:check
```

At this handoff, `atlas:world:check` passes and reports 242 entities, 230 government classifications, 221 religion classifications, 12 datasets, 13 layers, 6 views, 213 GDP-per-capita observations, 490 physical/point vector features, 2 raster assets, 4 contextual explanations, and 10 private / 0 public JJU association records.

Run and inspect locally:

```powershell
npm run dev
# Open http://localhost:3000/atlas (or the port printed by the dev server).
```

Regression and release checks:

```powershell
npx tsc --noEmit
npx eslint app/atlas app/api/atlas components/atlas-world lib/atlas-world tests/atlas playwright.config.ts
npm run atlas:e2e
npm run build
```

The Playwright suite covers the desktop curiosity loop, search and focus, legacy and canonical deep links, browser history, GDP loading/year/provenance/missing data, unsupported time, API semantics, composed physical layers, toggle/share/reload behavior, explanations and evidence, and mobile Peek/Half/Full behavior including focus/inert state and touch-target size.

Final verification on September 4 passed `npx tsc --noEmit`, the targeted ESLint command above, `npm run atlas:world:check`, `npm run atlas:sources:check`, and the full optimized `npm run build`. Playwright enumerated 22 project/test combinations from nine browser-flow tests and two observation-contract tests across desktop and mobile: **13 passed and 9 intentionally skipped by device guard, with zero failures**. A separate visual smoke pass covered desktop at 1440 × 900 and mobile at 390 × 844 across Political, GDP per capita, Where people live, Zimbabwe selection, the country-sheet detents, and the Nile explanation. It found no console/page errors or framework overlay. Automated accessibility checks found only the existing shared-site skip-link landmark warning; gradient-based contrast still requires human inspection.

Local development measurements are directional, not a production benchmark: Where people live measured about 468 ms FCP, 0.03 CLS, and a 1.46 s relief-image LCP on desktop; mobile measured about 440 ms FCP, 0.08 CLS, and a 1.09 s relief-image LCP. No Phase 2 production deployment or production performance run was performed.

## Recovery and database record

- The recoverable V1 baseline is commit `b4d7d10` (`Replace legacy Atlas with sourced world atlas`).
- The complete pre-Phase-2 recovery archive and its checksum are recorded in `docs/atlas-phase-2-baseline.md`. The original mixed working tree was not reset, cleaned, or staged.
- The former Atlas database experiment was backed up before its 20 `public.atlas_*` tables were retired. The safe, `RESTRICT`-only migration is `supabase/migrations/20260903220000_retire_legacy_atlas.sql`.
- The live database was independently confirmed to have zero `public.atlas_*` tables. On September 4 the migration ledger was repaired to mark `20260903220000` as already applied; the destructive SQL was **not** replayed and no application table changed during reconciliation. Shared book, audio, trigger-function, authentication, and Storage infrastructure was preserved. Full evidence is in `docs/atlas-decommission-2026-09-03.md`.

## Bounded debt and deliberate exclusions

Needs attention before a broader public-data expansion:

- Physical vectors and city points are display-only in this phase; they have no dedicated feature cockpit, search index, or keyboard picking yet.
- The population raster is preprojected and intentionally bounded. It has no per-pixel inspection and is not a substitute for a tiled analytical raster system.
- Contextual notes store and validate authored bounds, highlight geometry, the Heihe–Tengchong guide line, and related-layer suggestions, but the current UI renders only the numbered focus marker, camera move, and explanation card. It does not yet draw those highlight geometries or activate a related layer.
- Direct query-string deep links are restored and canonicalized after hydration because `/atlas` remains a static route. Their server-rendered first frame is the Political/no-selection shell, and a JavaScript-disabled page will not apply the requested scene. Making the initial frame query-aware would require deliberately changing that static-rendering tradeoff.
- Full source and methodology presentation is strongest for legend-bearing analytical layers. Passive non-legend layers such as relief, rivers, lakes, and cities participate in aggregated source attribution, but their full layer-specific methodology is not yet exposed in the main UI.
- The association workflow has a strong publication gate but no human review UI.
- Source-reviewed map explanations should receive a human editorial pass before permanent featured placement.
- Archived leadership/government facts need a planned freshness workflow if “current” political information becomes a prominent promise.
- Python packages are exact-version pinned, and committed derivatives have checksums, but wheel hashes and a fixed cross-platform build image are not yet pinned.

Deliberately out of scope:

- historical borders or a global timeline;
- arbitrary user layer stacking or bivariate-map generation;
- worldwide Admin 1/Admin 2 ingestion;
- pitched 3D terrain or a WebGL renderer replacement;
- a universal JJU ontology;
- full denominational religion reconstruction;
- comprehensive leader portraits;
- mass automatic geographic classification of the JJU corpus.

The current SVG stack is appropriate for the shipped scale: 242 selectable admin-0 entities, two preprojected rasters, and hundreds of bounded line/point/polygon features. A second renderer becomes justified when dense interactive rasters, global subdivisions, or much larger point/route sets are actual product requirements—not merely future possibilities.
