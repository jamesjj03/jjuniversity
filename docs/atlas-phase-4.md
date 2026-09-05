# JJU Atlas Phase 4 — Compare the world

Date: September 5, 2026
Worktree: `C:\Users\james\Desktop\MATRIX\jju\jjuniversity-atlas-phase25`
Branch: `codex/atlas-phase4`
Starting point: Phase 3 at `7289787417d58b09828d42b072e30e4d154bc1d3`

Phase 4 is a local product build. It has **not been deployed**.

## What changed for a user

Atlas can now investigate relationships, not only display one map at a time.

- Six authored comparisons pair fertility, population growth, age structure, GDP per person, life expectancy, and urbanization.
- A/B controls flip instantly between the two maps while preserving the camera, selected place, and contextual geography.
- Each comparison shows the selected country's two sourced values and years, a country scatterplot, and the three countries with the largest absolute residuals from the displayed linear relationship. The language is explicitly descriptive, not causal.
- Map views are faster to reach through categories, search, recent and related views, previous/next controls, and keyboard shortcuts.
- `Population density` is now the analytical view's canonical name. Older `where-people-live` links continue to resolve and are rewritten into the current URL.

Physical geography is more connected:

- Oceans, major seas, gulfs, bays, straits, and channels are searchable, labeled, selectable places.
- Five river systems—Amazon, Nile, Danube, Mississippi, and Yangtze—have sourced basin pilots and bounded physical facts.
- Cairo, Pittsburgh, and New Orleans demonstrate conservative city-to-river/coast relationships.
- A river card can lead into its drainage basin; a city can lead into nearby mapped physical geography; every relationship retains a caveat about what the geometry does and does not establish.
- The experimental globe is now reachable from the main Atlas and progressively shows a bounded context set of major rivers, selected cities, and water names.

The flat map now wraps horizontally. Panning east or west continues around the world while country/place identity and shared URLs remain canonical. Wrapped copies reuse the same real geography and hit targets; they are not duplicate entities.

## Phase 3 repairs included

- Removed the zoom-transition circle flash at its rendering lifecycle source.
- Added a cartographic label grammar for countries, cities, rivers, and water.
- Suppressed arbitrary world-scale country labels until a useful zoom.
- Added stable authored JJU political-color overrides for several countries with strong conventional map identities while retaining neighbor contrast. These colors are map design, not sourced claims about regimes, alliances, or recognition.
- Rebuilt the map key around meaning, color, period, missing data, interaction, and a secondary source/method section.
- Compressed repeated provenance in the country cockpit and added only defensible global/regional rank context.
- Humanized all-caps leadership names without changing the underlying sourced observation.
- Added direct country-to-Admin-1 entry points for the six pilot countries.

## Subnational pilot

The six-country first-order pilot still contains 184 sourced administrative units. The United States is now the first genuinely populated pilot:

- 50 states plus the District of Columbia have official 2024 Census population estimates.
- Puerto Rico remains its own Admin-0 Atlas entity and is not silently treated as a state.
- Germany, India, China, Canada, and Nigeria continue to show sourced boundaries and parent-country context only. No subdivision statistics were invented to make the pilot look complete.

## Data and provenance added

The Atlas source lock now verifies 27 inputs. Phase 4 adds:

1. **Natural Earth 1:10m Geography Marine Polygons, release 5.1.2** — public domain. Used for the bounded marine-water feature pack. Coastline adjacency is not presented as ownership, jurisdiction, or a maritime claim.
2. **World Bank, Major River Basins of the World** — catalog snapshot dated June 25, 2019, CC BY 4.0. Used for the five basin geometries. Basin intersections are physical-geography intersections, not political control.
3. **Wikidata bounded major-river statements and linked labels** — pinned September 5, 2026 snapshots, CC0. Used only for the reviewed five-river fact pilot; exact entity/statement identities remain in the source material.
4. **U.S. Census Bureau 2024 Population Estimates** — official NST-EST2024 state totals. Used for 50 states and D.C.

The generated context assets contain:

- 112 marine geometries resolving to 110 searchable logical water places;
- five drainage-basin geometries;
- 22 major river lines, 230 city points, and 59 water labels in the bounded globe context asset.

Discharge was deliberately omitted from River V2 because the bounded observations were not globally comparable. Conflicting definitions of river length remain qualified. The source did not yield a suitable Bering Strait geometry, so Atlas does not invent one.

## Editorial and JJU boundary

The protected Atlas desk now lets an editor open both sides of a proposed geographic association—the JJU subject and the place in Atlas—beside exact evidence, relationship type, salience, and approval controls.

No proposal was auto-approved during this build:

- ten JJU geographic associations remain private proposals;
- zero JJU links are public in Atlas;
- four visible contextual explanations remain source-reviewed but not human-editorially approved.

This is intentional. A user saying “yes to routine implementation” is not a substitute for a named human editorial decision on a specific claim.

## Deliberate limits

- A real synchronized split-screen map was not added. The current wrapped SVG/raster scene would require a second full render tree or fragile inverse clipping. Phase 4 instead ships camera-stable instant A/B comparison plus a genuine joint scatter view.
- Comparisons do not claim causation and do not combine unlike units into a fake “difference” score.
- Marine adjacency is generalized cartography, not maritime law.
- The river and city relationship pilots are intentionally bounded, not an incomplete-looking world encyclopedia.
- Globe context is curated and lightweight; it does not claim flat-map thematic parity.
- There is still no historical timeline, historical-border corpus, global Admin 2, arbitrary layer stacking, or automatically published AI geography.

## Verification record

The frozen local build passed:

- TypeScript (`tsc --noEmit --incremental false`), targeted ESLint, and `git diff --check`;
- all 27 pinned source-lock checks;
- Atlas snapshot, layer, observation, geography, Admin-1, leadership, editorial, JJU-association, and globe-geometry checks;
- a fresh Next production build: 16,382 static pages, publication edition `edition-d0090847002768d8571a`;
- the complete Atlas Playwright suite against that production build: **232 passed, 34 deliberately inapplicable cross-device skips, 0 failed** across desktop Chromium and an iPhone-sized touch viewport in 4.6 minutes;
- nine final visual-review routes covering Political, Nile basin/population density, Compare World, globe context, California, and the corresponding phone surfaces. All returned HTTP 200 with no Atlas console or page errors.

The browser gate explicitly covers search, country/place selection, view changes, history and share state, comparison A/B controls and scatter interaction, mobile Peek/Half/Full sheets, horizontal world seams, raster fallback/detail budgets, water-to-basin navigation, globe context, U.S. state data, accessibility paths, and the public editorial boundary.

Visual receipts are in the ignored local folder `output/atlas-phase4-final-screens`; test artifacts are not part of the product commit.

## Recovery

- Phase 3 starting point: `7289787417d58b09828d42b072e30e4d154bc1d3`
- Phase 2.5 recovery point: `46b9c64a133383d720e22e5bf8840c964af71fd9`

No database migration or destructive remote action is part of Phase 4.
