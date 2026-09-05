# Atlas Phase 2.5 — experience rebuild

## Scope and recovery

Built in the isolated `jjuniversity-atlas-phase25` worktree on
`codex/atlas-phase25`, from Phase 2 `06afbadee1602e79127baaef6785fc887809a08c`
(application baseline `deb4480`). The original active JJU checkout was not
staged, reset, or deployed. The recoverable V1 commit `b4d7d10` remains intact.
No database migration, content publication, association approval, or production
alias change is part of this pass.

## What changed

- A compact, grouped view chooser replaces the equal-weight row of mode buttons.
  All six existing views and their URLs remain. Country search has a dedicated
  trigger and `/` or Ctrl/Cmd-K shortcut, with modal/focus guards.
- Brighter mineral country colors, a blue ocean, subdued borders, selected-place
  emphasis, quieter controls, and a narrower 348px country cockpit give more of
  the screen to geography. Legends explain what to notice and keep secondary
  layer controls behind a disclosure. Hover/focus on a categorical key briefly
  highlights matching countries without changing share state.
- Tiny-place assistance uses bounded screen-space circles beneath the real
  polygon hits. An assistance circle cannot steal Belgium from Luxembourg.
  Assistance retires when a polygon is large enough. Main-part geometry anchors
  avoid labels or camera fits being distorted by overseas/dateline pieces.
- Country, city, river, and lake labels appear by geographic scale, compete for
  space, and stay readable as the map zooms. City symbols stay screen-sized.
  Label geometry is derived presentation metadata, not a new geographic
  authority or a replacement for canonical WGS84 geometry.
- The cockpit preserves identity, active lens, lazy loading, cache and mobile
  sheets. Facts are compact rows rather than nested cards. Religion composition
  is immediately visible in the Religion view; source wording, age, overlaps,
  and incomplete coverage remain visible rather than forced to add to 100%.
- Four local, licensed portraits across Gabon, South Africa, and the UK's two
  offices form a bounded pilot. Exact person/office/source-date bindings prevent
  a changed record from silently inheriting a photo. These are dated archived
  officeholder observations, not a current-leader service. See
  `atlas-phase25-portrait-pilot.md` for source pages, licenses, checksums and
  reproduction.
- A 36-term field guide and inline definitions explain map vocabulary without
  leaving the selected country. Explicit territorial-status notes retain source
  classifications and evidence. Dashed whole-entity outlines invite inspection;
  they do **not** claim to trace every contested boundary segment.
- The existing four population explanations have a readable place list and
  visible geographic highlights. Their cameras fit the authored geographic
  extents and reach real source detail instead of a fixed, overly-wide zoom.
  Authored guide geometry is kept distinct from
  measured geographic features.

## Where People Live

No new population authority was introduced. The pinned EC JRC GHS-POP R2023A
V1.0, 2025 epoch, 1 km World Mollweide input now supplies independently resampled
world/regional/country representations. Only intersecting tiles at the current
level load. The original overview remains until each replacement tile arrives,
including after a failed request or pan-away/pan-back. Loaded detail replaces,
rather than alpha-stacks over, the overview.

The raster warp now matches D3's spherical Equal Earth formula exactly; the old
ellipsoidal warp had a small but visible close-zoom offset. The original Natural
Earth relief, river/lake vectors, and cities are preserved with better contrast,
screen-size symbols, scale-dependent labels, and an understated land base.

See `atlas-phase25-cartography.md` for all four projection comparisons, exact
source/version details, registration checks, palettes, sizes and limitations.
Equal Earth was retained after comparing Natural Earth I, Robinson and Web
Mercator in the same frame. A projection change did not solve the actual
target-size, readability and framing problems.

## Engine preserved

The Dataset → Layer Definition → Layer Instance → View Preset → Scene State →
Validated Render Plan architecture remains. There are still 242 entities,
12 datasets, 13 layers and six authored views. Government coverage is 230,
religion 221, GDP-per-capita 213. There are 490 physical/point vector features,
four explanatory notes, and no automatically published JJU associations.

The new generic raster surface consumes optional `assetPyramid` metadata; it
does not add a special renderer for every view. No arbitrary stacking, historical
timeline, subdivisions, WebGL migration, or broad new-data ingestion was added.

## Verification and review

- TypeScript and scoped ESLint pass.
- `atlas:world:check`, `atlas:sources:check`, portrait identity/license/checksum
  verification, and whitespace checks pass.
- Browser regressions cover country search/selection, view switching, old/new
  deep links and history, partial/missing data, source/year semantics, layer
  toggles, note evidence, Belgium/Luxembourg and Vatican hit targets, city/label
  scaling, glossary focus, territorial status, religion composition, and mobile
  Peek/Half/Full with inert-state and touch-control checks.
- Network-controlled tests verify density first load, viewport-only requests,
  failure fallback, successful retry, delayed tile re-entry, and bounded mobile
  decoding. One tile is at most 1200×1300, or 6.24 MB decoded RGBA. A deliberately
  narrow desktop Egypt view used 15 tiles, about 8 MB compressed / 93.6 MB
  worst-case decoded; it did not fetch all 118 global tiles.
- The optimized local site passed 38 applicable Playwright checks, with 18
  intentional device-specific skips, including six pure geometry cases run
  under each device project and protect concave/multipart/dateline anchors.
- The complete local optimized build generated all 16,371 site routes/pages.
- Desktop review at 1440px and phone review at 390×844 covered portrait-bearing
  and missing-portrait countries, Religion composition and overlaps, grouped
  views, labels and the Nile density corridor.

The local dependency folder is a junction to the unchanged Phase 2 dependency
installation. Turbopack refuses that out-of-root junction, so the local optimized
build uses the supported `npm run build -- --webpack` flag. This does not change
the repository build command or production bundler. The hosted Vercel preview
also passed the default Turbopack build; see the deployment receipt below.

The verified local optimized server runs with `npm run start -- --port 3212`
after `npm run build -- --webpack` in this junction-based worktree. To test an existing local or
deployed build without starting another server, set `ATLAS_TEST_BASE_URL`, then
run `npm run atlas:e2e`. The default automatic test-server port remains 3211;
`ATLAS_TEST_PORT` can override it for isolated worktrees.

Suggested review: Political → Luxembourg/Belgium; Government → a definition;
Religion → Zimbabwe or Japan; Gabon/UK → portraits and credits; Where People
Live → the Nile, Java, eastern China and the Indo-Gangetic Plain. On a phone,
try the view chooser with the half sheet open and then Peek/Full.

## Preview deployment receipt — September 4, 2026 (New York)

- Preview source: `250e2ee4ce11f6761f2899e074661e3912c8641f`, branch
  `codex/atlas-phase25`. Deployment `dpl_BihZraTyafJEHsRrnhp82sEbX4q4` is READY.
- Stable preview address:
  https://jjuniversity-d6ioojwc1-jamesjj03s-projects.vercel.app/atlas
  Vercel protects this address; a temporary sign-in-free share link was supplied
  separately. Access cookies and share tokens are not repository content.
- The normal remote Turbopack build and TypeScript check passed, generating
  16,371 site routes/pages. No app source changed after this deployment;
  subsequent changes concern verification and this record only.
- Hosted tests: **38 passed, 18 intentional device-specific skips**, including
  browser flows and pure geometry/observation/portrait contracts. The hosted
  review captured **18 scenes, all HTTP 200, no unexpected console/page errors**.
  All six views, portrait/no-portrait cases, explanations, and phone sheets
  were covered. A fresh 390×844 unauthenticated browser opened the shared Gabon
  link and loaded its portrait successfully.
- Public JJU smoke checks passed on the preview: `/`, `/books`, `/books/1776`,
  `/about`, and `/reader?book=what-people-actually-believe`. The last rendered
  the actual reader and chapter content, not just a successful HTTP response.
- Two platform-specific test adjustments were necessary, with no app workaround:
  [Vercel consumes CDN-only cache directives](https://vercel.com/docs/caching/cache-control-headers),
  so the API test checks the browser cache lifetime on Vercel and also checks
  stale-while-revalidate directly at the local origin. Vercel's preview feedback
  badge can overlap a phone control; automated interaction checks use the
  [documented toolbar opt-out header](https://vercel.com/docs/vercel-toolbar/managing-toolbar).
  No authentication, project toolbar setting, or production behavior was changed.
  The badge may still appear when manually visiting a preview.
- Reproduction against an accessible hosted preview: set `ATLAS_TEST_BASE_URL`,
  optionally `ATLAS_TEST_STORAGE_STATE` to an ignored Playwright authentication
  file, and `ATLAS_SKIP_PREVIEW_TOOLBAR=1`, then run `npm run atlas:e2e`.
  `scripts/atlas/capture-review.mjs` accepts the same base URL/auth file and
  `ATLAS_REVIEW_OUTPUT` for a separate screenshot directory. Never commit auth.
- Directional local performance check: a 40-step pan produced no recorded JS
  long tasks at desktop and 390px phone widths. This is not a formal FPS result
  or evidence from a physical iPhone; raster decoding remains the largest
  memory cost described above.
- **Production was not changed.** `www.jjuniversity.com` still resolves to
  Phase 2 `06afbadee1602e79127baaef6785fc887809a08c`, deployment
  `dpl_8F8ypq97Jpjpe9E4oN4GbpBP45ZP`. That deployment and the V1 `b4d7d10`
  recovery baseline remain available. No database or content migration ran.

## Remaining boundaries

- Density is modeled 2025 population, not individual census counts. The finest
  display is about 1.84 projected km per pixel; it is not street-level detail.
  Relief and physical vectors remain generalized global cartography.
- Leadership is an archived 2025–2026 snapshot. Three-country portrait coverage
  is intentional; absent media or uncertain identity means no portrait.
- Religion estimates vary in year, denominator and method. No global
  denominational reconstruction or fabricated percentages were introduced.
- Labels use bounded heuristic collision estimates, not a full GIS labeling
  engine. Cities/physical features remain display-only, without feature search
  or their own detail panels.
- `/atlas` is still static: a query-specific scene is restored after hydration.
- Touch emulation is covered; physical iPhone/Safari testing is still valuable.
- The Atlas stylesheet still contains some unused V1 panel selectors. They are
  isolated CSS-module rules and were not broadly removed during the visual pass.
