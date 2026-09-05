# Atlas Phase 2 — finished experience, pending JJ's review

September 4, 2026 (New York; source reviews after midnight UTC use September 5).

This is the final refinement pass on Phase 2, not a new micro-phase. It stays in
the isolated `codex/atlas-phase25` checkout. The earlier `80d4caa` review baseline,
the deployed Phase 2 `06afbad`, and V1 `b4d7d10` remain recoverable. The separate
active JJU checkout and its unrelated work were not edited or staged.

## What changed for the reader

- Political colors are fixed editorial choices for all 242 entities. France and
  the United States are blue, the UK rose, China red, Mexico green. Data imports
  no longer decide these identities through Natural Earth's numeric color index.
- Mercator replaces the Equal Earth display after comparing Japan, India, China,
  Europe, Benelux and the world in four projections. It preserves familiar local
  directions and shapes, but enlarges high-latitude areas. This is a deliberate
  tradeoff, stated in the map sources, not a claim of equal-area accuracy.
- Zoom reaches 128× (previously 8×); country fitting is bounded at 64×. Clicking
  another country while already exploring a region preserves the camera. Search
  deliberately fits the chosen country. Canonical WGS84 identities remain intact.
  Hosted visual review exposed a separate framing defect: using a label's largest
  polygon as the camera extent cropped the other main islands of Japan and other
  archipelagos. Label placement and country-overview framing are now independent:
  nine reviewed regional overviews retain meaningful neighboring islands while
  the existing Kiribati/Netherlands handling of distant fragments is preserved.
- Country labels have authored anchors and orientation for major/awkward shapes.
  Country names, cities and physical features use distinct typography. Collision
  handling works in screen pixels, respects panels, and avoids repeating the same
  physical name across visible multipart features. Assistance dots do not expand
  a small country's actual territory or intercept a neighboring polygon.
- Rivers, lakes, relief and cities are shared geography in every familiar view,
  not ingredients users must first assemble. Closer zoom reveals finer rivers,
  lakes and city coverage. View selection is a six-choice illustrated overlay,
  not a set of unexplained color wheels. Search is available without dominating.
- A city selects a city, with its name, capital status, coordinates, source and
  a separate country action. Its stable feature link survives reload/history.
  Country details also provide keyboard-accessible mapped city choices.
- The country cockpit is one overview, not thin repeated tabs: persistent
  identity, active lens where meaningful, government, four useful scale facts,
  dated leadership/portraits, religion, then substantive expandable details.
  Religion view brings composition and caveats to the top. Japan's denominator
  and Russia's ranges/practicing-worshiper wording are explicit.
- Portraits are sharper local licensed derivatives, with source and attribution.
  Official evidence superseded the old UK prime-minister observation separately;
  the archived import was not altered. Most global office records still need
  review and are visibly dated. This is not a live leadership service.
- The Field Guide teaches with plain-language explanations, examples, related
  ideas, back/search and accessible modal controls. Technical method is secondary.
  Six disputed-place accounts distinguish claims, administration and the map's
  choice; they do not invent control-line geometry.
- Phone Atlas replaces the desktop site header with one compact JJ/view/search
  bar. Map taps and deep links begin with a small Peek card; search opens Half.
  Half and Full provide progressive
  detail. The map fills the screen; controls move above the actual sheet height.
  Covered controls are inactive, touch targets are usable, and pinch/drag remain
  map gestures. Physical iPhone/Safari review remains JJ's required checkpoint.

## Evidence and geography

The country facts still cover 242 mapped entities, 230 government classifications,
221 broad religion classifications, and 213 GDP-per-capita observations. No global
leadership refresh, denominational reconstruction, or new GDP/population fact
inference was performed.

The population source is unchanged: European Commission JRC **GHSL GHS-POP R2023A
V1.0**, modelled **2025 epoch**, original **1 km equal-area** grid. Three independently
resampled detail levels now use 556 viewport-loaded tiles; all 106.9 MB of global
tiles are not downloaded at once. More zoom does not invent higher-resolution
population evidence. The generalized Natural Earth relief source is unchanged.

Three public-domain Natural Earth **v5.1.2 1:10m** inputs were added: rivers/lake
centerlines, lakes, and populated places. They produce bounded selections of 582
river features, 511 lake features and 1,140 cities. All original 319 city feature
IDs remain present. The country coastline/boundary source remains 1:50m, not a
street map. Full exact sources, checksums, source limits, projection formulas and
reproduction steps are in [the cartography record](atlas-finish-cartography.md).

The four sourced population explanations remain the Nile, Java, eastern/western
China and the Indo-Gangetic Plain. Their canonical evidence and geographic meaning
are preserved; their display coordinates/highlights were reprojected. An open
explanation's highlight persists at closer scales even when overview markers hide.

Leadership evidence and the review commands are in
[the leadership review record](atlas-leadership-review.md). Portrait image licenses,
authors and binding checks remain in the media registry and acquisition script.

## Performance and recovery

The geographic SVG tree is indexed once. Label/city visibility updates are
coalesced to one animation frame and unchanged attributes are not rewritten.
Large physical path strings are external cacheable SVG resources, loaded by scale.
Development-page HTML gzip fell from about 2.27 MB to 636 KB. Eight measured
desktop/390px pan probes recorded no JavaScript task over 50 ms after the fix.
These are directional measurements, not a physical-iPhone FPS claim.

Measured desktop density views at zoom 6/12/24/128 used 12/12/8/2 tiles respectively;
the largest of those decoded sets was 74.9 MB. Exhaustive sampled viewport-bound
tests guard a maximum 20 tiles/124.8 MB for the tested desktop/phone sizes. Raster
decode memory, generalized coastlines and heuristic labeling remain real limits.

122 obsolete Equal Earth display derivatives were removed after their replacement
validated: old country SVG/JSON, two overview images and 118 detail tiles. They
are recoverable from `80d4caa`. Canonical sources, country facts, shared data,
database tables and books were not deleted. No migration was replayed. JJU's ten
unreviewed geographic association proposals remain private; zero were published.

The manuscript parity check verified the existing publication body snapshot and
refreshed only its local attestation timestamp. The 323 already-known legacy
metadata differences are not authority to overwrite current JJU content.

## Review checkpoints

1. Political world → Japan/India → Belgium/Luxembourg → deeper zoom.
2. Gabon/UK → portrait credits and leadership dates; Japan/Russia → Religion;
   Western Sahara → identity caveat and claims/control; Field Guide → back/search.
3. Where people live → Nile explanation → Cairo → Europe/Amsterdam; toggle water,
   relief and cities and verify that the map remains understandable.
4. On a real phone: pinch/drag, select a country, Peek/Half/Full, change view,
   return to the map, select a city and navigate history.

The preview deployment and final verification receipt will be recorded below.
Production must not be represented as changed by this review pass. Phase 2 closes
only after JJ reviews the candidate and signs off; no Phase 3 work is included.
