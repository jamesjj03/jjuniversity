# Atlas Phase 2.5: projection and source-detail evaluation

## Projection comparison

`scripts/compare-atlas-projections.py` renders Equal Earth, Natural Earth I,
Robinson, and Web Mercator from the same checksum-verified Natural Earth 1:50m
v5.1.2 WGS84 country geometry. It uses the same palette, graticule, frame, and
landmark extent for every candidate. This is an evaluation tool, not a second
runtime map engine. Run it through the geography Python environment with
`--source-cache data/atlas/source-cache`; generated SVGs and comparison metadata
go to the ignored `output/atlas-phase25/projections/` folder. SVGs can be opened
directly or rendered to PNG with the existing `sharp` dependency.

All four candidate PNGs were inspected at 1440 × 900. Natural Earth I and
Robinson soften the world outline and give some northern regions a different
shape. They do not substantially enlarge Europe in the same available map
space: the explicitly chosen Europe bounding frame (-12° to 42°, 35° to 60°)
occupies 13,995 square viewBox units in Equal Earth, 14,185 in Natural Earth I
(+1.4%), and 14,587 in Robinson (+4.2%). This is a framing diagnostic, **not an
area-accuracy score**. Web Mercator at its conventional ±85.05° extent occupies
a square within the landscape map slot, shrinking useful world geography and
inflating high-latitude areas. Cropping it to fill the slot would omit much of
the globe.

Recommendation for this bounded redesign: retain Equal Earth and improve map
framing, legibility, zoom, and screen-space interaction. A new projection would
require regenerating every country, physical feature, raster, camera target,
annotation focus, and existing projected deep-link position. The small Europe
footprint improvement does not address the reported hit-target and layout
problems. Canonical WGS84 inputs remain intact for a later deliberate change.

Projection facts are grounded in [PROJ's Equal Earth documentation](https://proj.org/en/stable/operations/projections/eqearth.html),
[PROJ's projection catalogue](https://proj.org/en/stable/operations/projections/index.html),
and [NASA G.Projector's classifications](https://www.giss.nasa.gov/tools/gprojector/help/projections/).
Equal Earth preserves relative area; Natural Earth I and Robinson are compromise
projections. Web Mercator's useful local-angle behavior does not make its global
area comparisons accurate.

## Actual raster registration correction

The Phase 2 SVG formula uses geographic latitude in spherical Equal Earth. The
old raster warp used ellipsoidal `EPSG:8857`, whose authalic-latitude conversion
shifted the image by approximately 0.45 viewBox units around 30° latitude—small
at world scale, visibly misregistered at close zoom. Phase 2.5 keeps the SVG
projection unchanged and records the exact matching raster CRS:

`+proj=eqearth +R=6371007.180918475 +units=m +no_defs`

The geography build checks the Nile delta, Himalayan foothills, Java, and
Central Europe against the SVG formula. The permitted error is 0.008 viewBox
units, bounded by the existing two-decimal SVG-coordinate precision. These
checks are recorded in the pack and checked again by geography validation.

## Population detail without a new data source

The population authority remains EC JRC GHS-POP **R2023A V1.0, epoch 2025,
1 km World Mollweide**, with the same source checksum and CC BY 4.0 provenance.
The source is a modeled population-count grid with equal-area 1 km cells, not
individual-cell census observations. Each display level independently reads
the original grid and applies area-average resampling, the same authored log1p
color/opacity transfer, and the same projected-sphere clipping:

| Level | Equivalent whole-world pixels | Activation zoom | Delivery |
| --- | --- | --- | --- |
| Overview | 2400 × 1300 | World scale | One WebP |
| Regional | 9600 × 5200 | 2.4× | Viewport-selected tiles, maximum 1200 × 1300 pixels each |
| Country | 19200 × 10400 | 6× | Viewport-selected tiles, maximum 1200 × 1300 pixels each |

Verified generated payload: overview 495,718 bytes; regional level 28 nonempty
tiles totaling 5,560,970 bytes; country level 90 nonempty tiles totaling
18,676,828 bytes. Those are **entire-world totals**, not first-load requests.
The corresponding projected pixel sizes are 3,678.32 m and 1,839.16 m. The
relief overview is 167,398 bytes. The build process was observed at roughly
291 MB resident memory while processing tiles.

These are genuinely different source averages, not sharpened/upscaled copies
of the overview. GDAL's windowed warp limits the build to a 128 MiB source cache,
a 64 MiB warp budget, and one tile's numeric/color arrays. No full 200-million-
pixel display image is created or decoded by the browser. Each decoded tile
requires at most 6,240,000 RGBA bytes. Every tile has an exact projected
destination rectangle, pixel dimensions, byte count, and SHA-256 in
`geography-pack.v1.json`.

Only the active level and intersecting viewport tiles should be requested.
Keep overview fallback while detail is loading, but **replace** its pixels
inside loaded tile rectangles. Alpha-stacking the overview with detail would
falsely intensify the density palette. Wholly empty tiles are omitted and mean
transparent/no rendered population estimate, not a missing network request.

The highest level is roughly two projected kilometres per pixel. It reveals
settlement corridors and metropolitan structure, not street-level geography.
Further magnification does not create finer data. The 2025 epoch remains a
projection within the GHSL series; source census age and model quality vary.

## Authored appearance

The same population scale is used at every resolution, from restrained teal
through light green and amber to orange/red, then cream at the highest end.
Both RGB and alpha stops are recorded in the pack; the legend must use the same
stops. Changing resolution does not change the scale or normalize each tile
independently.

`scripts/compare-atlas-raster-detail.py` generates same-palette, same-extent
before/after review figures for the Nile, Java, the Indo-Gangetic Plain, and
eastern China. All four figures were inspected. The detail sides expose
settlement corridors, coastline separation, and unpopulated gaps that were
lost when the overview was merely enlarged. The scripts retain the comparison
metadata next to the generated figures; no fabricated detail is introduced.

Relief uses the same public-domain Natural Earth Manual Shaded Relief 3.3.0.
The global transfer `clamp(255 - (255 - gray) × 1.45)` improves shadow separation
without inventing elevation. Layer-owned opacity remains adjustable. It is
cartographic artwork, not a measurement surface, and remains generalized at
close zoom.
