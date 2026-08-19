# JJ University 101 Print PDF and Lulu Audit

Date: 2026-08-18

Status: Read-only inspection. No PDF was generated, changed, uploaded, or submitted to Lulu during this audit.

## Executive verdict

The freshly regenerated local candidates are the correct post-bold-cleanup manuscript snapshot, but the current Lulu-facing product records do not point to them. The public URLs still serve the June PDFs, and the recorded page counts are one page too high for each fresh interior.

The local candidates are credible layout drafts, not production-ready Lulu files. Font embedding and paperback cover arithmetic look good. The major blockers are source and URL drift, missing folios, inadequate mirrored gutter treatment, leaked acknowledgements, sparse pages, unresolved title metadata, unvalidated interior bleed rules, unflattened cover effects, and the absence of a real Lulu package-specific validation result.

## Exact candidate snapshot

| File | Created | Pages | Page size | SHA-256 |
| --- | --- | ---: | --- | --- |
| `generated/paperbacks/101-volume-1/interior.pdf` | 2026-08-18 16:24:45 EDT | 356 | 6 x 9 in | `BF0808A92C1982610FD27EF9A14CFBFDD74AEBDE5943385DC189933AD2F9576B` |
| `generated/paperbacks/101-volume-1/cover-wrap.pdf` | 2026-08-18 16:24:46 EDT | 1 | 13.110 x 9.25 in | `FE33CEC438227E7225EB3E5241A62FFEFA3BE5D4461059EFC45415B5EF35410F` |
| `generated/paperbacks/101-volume-2/interior.pdf` | 2026-08-18 16:24:47 EDT | 318 | 6 x 9 in | `4B03C760C369AD8E7F76085A48B6F0898C3F1F4BC035206B6B14D73F8C7AA172` |
| `generated/paperbacks/101-volume-2/cover-wrap.pdf` | 2026-08-18 16:24:48 EDT | 1 | 13.027 x 9.25 in | `60AE0C5A6FF117117EFE3A9357A267CA16660F7CBF624CE9962A94B953A2D7E8` |

All interior pages within each PDF have identical media, crop, bleed, trim, and art boxes. The interiors are unencrypted, tagged PDF 1.4 files. Each cover is one unencrypted PDF 1.4 page.

## Are these the latest manuscripts?

### Local candidates: yes, with an important scope limit

The generator reads `public/books.json`, `public/book-content/manifest.json`, and the resolved checked-in `public/book-content/*.json` files. It does not query Supabase while rendering (`scripts/generate-paperback.mjs:14-16`, `scripts/generate-paperback.mjs:72-79`, `scripts/generate-paperback.mjs:766-786`).

The approved cleanup synchronized the 287 checked-in fallback files with live Supabase and confirmed exact live/fallback parity, zero body-prose bold runs, and preserved headings and text (`docs/manuscript-formatting-audit-2026-08-17.md:247-263`). The affected 101 inputs were written at 16:23:41 EDT, and the PDFs were created at 16:24:45 through 16:24:48 EDT. The three unaffected 101 inputs, Electricity, Ethics, and Economics, did not need a cleanup write.

That proves the fresh local candidates contain the latest approved manuscript state as of this generation. It does not create a permanent freshness guarantee. The PDF factory records no input hash manifest inside or beside each output, and a future live-only edit could make the local fallback stale.

### Lulu-facing files: no

The product records still advertise June URLs and June-era counts:

- Volume I says 357 pages and `generatedAt` 2026-06-15 (`public/print-products.json:16-19`).
- Volume II says 319 pages and `generatedAt` 2026-06-15 (`public/print-products.json:59-62`).

A read-only HEAD request on 2026-08-18 confirmed those URLs still serve the older assets:

| Product | Public asset | Bytes | Last modified |
| --- | --- | ---: | --- |
| Volume I | interior | 2,504,359 | 2026-06-16 15:30:21 UTC |
| Volume I | cover | 140,834 | 2026-06-16 15:30:22 UTC |
| Volume II | interior | 2,391,731 | 2026-06-16 15:30:23 UTC |
| Volume II | cover | 133,943 | 2026-06-16 15:30:23 UTC |

The Lulu readiness and quote path trusts `actualInteriorPages` (`lib/publishing.ts:540-560`) and sends those values as `page_count` (`lib/lulu.ts:100-118`, `lib/lulu.ts:171-177`). Print jobs pull the files from the catalog URLs (`lib/lulu.ts:201-210`). Therefore, a Lulu request made from the current catalog would use the old PDFs and stale counts, not the fresh candidates.

## Title and naming problem

The naming is not yet one coherent bibliographic identity:

- Catalog title: `JJ University 101, Volume I` or `Volume II` (`public/print-products.json:6`, `public/print-products.json:49`).
- The actual subject titles, `The Natural World` and `The Human World`, are stored only as kickers (`public/print-products.json:7`, `public/print-products.json:50`).
- The cover hardcodes the main title to `101`, extracts `Volume I` or `Volume II`, and prints the kicker beneath it (`scripts/generate-paperback.mjs:604-612`, `scripts/generate-paperback.mjs:852-857`).
- The spine abbreviates the catalog title to `JJU 101, Volume I` or `II`, omitting the subject title (`scripts/generate-paperback.mjs:600-602`).
- The interior repeats the catalog title on two title leaves (`scripts/generate-paperback.mjs:311-322`).

This is not just aesthetic. Lulu distribution requires the title and author on the cover to match the metadata. A final naming model should be approved before any ISBN or production project is created. A clean model would treat `JJ University 101` as the series, `The Natural World` or `The Human World` as the book title, and `Volume I` or `Volume II` as the volume designation. That is a recommendation, not a change made by this audit.

## Page numbers and contents

There are no visible page numbers anywhere in either interior. There is no authored page-counter or running-footer rule in the interior CSS (`scripts/generate-paperback.mjs:90-106`), and Chrome's own headers and footers are explicitly disabled (`scripts/generate-paperback.mjs:875-880`).

The contents pages list every book and section title but no page references (`scripts/generate-paperback.mjs:345-356`). Lulu does not require folios, but a 318 to 356 page omnibus with a four-page contents section is materially harder to navigate without them.

The first title leaf is page 1, so it lands on the right. The copyright page is page 3, also on the right. Lulu recommends the title page on an odd right page and the copyright page on an even left page. The extra second title leaf causes the copyright page parity to be wrong.

## Repeated pages, leaked sections, and sparse pagination

No exact duplicate full-page text was found in either fresh PDF. There are still several kinds of repetition or layout waste:

1. Pages 1 and 2 are two separate title leaves. They are not byte-identical, but they repeat the same volume title (`scripts/generate-paperback.mjs:311-322`).
2. The four-page contents list is repeated in abbreviated form by `Included Works` at the end (`scripts/generate-paperback.mjs:338-340`, `scripts/generate-paperback.mjs:381-387`). The same eight-book list also appears on the back cover (`scripts/generate-paperback.mjs:589-596`).
3. Three digital acknowledgements sections leak into the print interiors: Biology on Volume I page 354, Religion on Volume II page 240, and Government on Volume II page 279.
4. The leak is a spelling and case bug. The exact filter handles American `Acknowledgments`, while the broader fallback is case-sensitive and misses capitalized British `Acknowledgements` (`scripts/generate-paperback.mjs:640-649`). This contradicts the printed claim that repeated digital front matter was removed (`scripts/generate-paperback.mjs:332-335`).
5. Every section starts on a new page (`scripts/generate-paperback.mjs:110-116`). This creates many nearly empty carryover pages. Volume I has nine narrative pages under 100 extracted characters after excluding its first title page. Volume II has seven. Examples include Volume I page 60, which contains only `Enter Newton.`, and Volume II page 263, which contains only `Heads would roll.`

The sparse pages are not duplicates. They are pagination outliers caused by forced section starts after short final fragments.

## Book transition treatment

Each original book gets one full divider page with `Book N`, title, optional subtitle, and the catalog description. Its first retained section begins on the following page (`scripts/generate-paperback.mjs:359-378`). No original cover image is used.

The divider uses `break-before: page`, not a right-page or recto rule (`scripts/generate-paperback.mjs:110-116`). The actual divider pages are:

| Volume I | PDF page | Side |
| --- | ---: | --- |
| Math | 9 | right |
| Calculus | 48 | left |
| Science | 97 | right |
| Physics | 132 | left |
| Quantum | 164 | left |
| Chemistry | 222 | left |
| Electricity | 260 | left |
| Biology | 318 | left |

| Volume II | PDF page | Side |
| --- | ---: | --- |
| Anatomy | 9 | right |
| Psychology | 53 | right |
| Philosophy | 95 | right |
| Ethics | 138 | left |
| History | 167 | right |
| Religion | 204 | left |
| Government | 241 | right |
| Economics | 280 | left |

James should decide whether every included book begins on a right page. If so, the generator must insert intentional blank versos and recalculate page counts and wraps.

## Which descriptions are used?

The book-divider descriptions come directly from each record's `description` in `public/books.json`. The generator normalizes that field (`scripts/generate-paperback.mjs:823-832`) and prints it verbatim on the divider (`scripts/generate-paperback.mjs:359-365`). It does not use manuscript prose or a separate print description.

Two of the 16 included descriptions use complimentary self-characterization:

- Anatomy: `A witty journey...` (`public/books.json:456`).
- Chemistry: `A witty, narrative-driven history...` (`public/books.json:1934`).

Those claims are harmless on a web card but self-congratulatory in a printed book's own divider. The print edition should use neutral factual summaries, or omit divider descriptions and let the title or original cover carry the transition.

The back cover uses the product-level description from `public/print-products.json:9` and `public/print-products.json:52`, preceded by the hardcoded line `Eight short books in one physical curriculum.` (`scripts/generate-paperback.mjs:589-594`).

## Adding the original covers inside

The current interiors contain no images and the generator never reads `coverFile` while building them. Adding cover art has two independent cost effects:

1. **Color mode:** Lulu states that if even one interior page is intended to print in color, the entire book is printed and priced as color. Eight color cover pages would therefore move the full 318 or 356 page book to color pricing.
2. **Page count:** If each cover replaces the existing one-page divider, page count need not change. If covers are added beside the dividers, or are forced to right pages with blank versos, the additional pages increase print cost and spine width.

A grayscale edition can include grayscale versions of the covers under a black-and-white package without paying full-color rates. The result will not preserve the cover colors. A separate premium color edition remains possible, but it should be quoted as a separate product.

The checked-in cover assets are only 420 x 630 RGB WebP files. At full 6 x 9 inch placement they are 70 ppi. Lulu recommends 300 ppi and warns below 200 ppi. The current files are suitable only around 1.4 x 2.1 inches at 300 ppi, or 2.1 x 3.15 inches at 200 ppi. Full-page interior covers require higher-resolution originals or rebuilt art.

Official cost and image guidance:

- https://help.lulu.com/en/support/solutions/articles/64000255486-how-to-create-a-print-book
- https://help.api.lulu.com/en/support/solutions/articles/64000254624-what-is-the-difference-between-print-color-options-
- https://help.api.lulu.com/en/support/solutions/articles/64000254609-pdf-creation-settings

## Paperback versus hardcover at these page counts

Both are feasible by page count:

- Perfect-bound paperback accepts 32 to 800 pages.
- Casewrap and linen hardcover accept 24 to 800 pages.
- Lulu's current US Trade 6 x 9 product guide includes paperback and hardcover combinations at these counts.

Paperback is the economical default and matches the current cover math. The generator uses Lulu's published perfect-bound formula, `(pages / 444) + 0.06 in` (`scripts/generate-paperback.mjs:397-402`, `scripts/generate-paperback.mjs:842-844`). That yields about 0.862 in for Volume I and 0.776 in for Volume II.

Hardcover is not a checkbox on the current files. It requires a different POD package, a separate package-specific cover template, wider safety areas, hinge and wrap allowances, and Lulu's stepped hardcover spine table. At the current counts, the published table gives approximately 1.0625 in for 356 pages and 1.0 in for 318 pages. The paperback wraps cannot be reused.

Official binding and page-count guidance:

- https://help.lulu.com/en/support/solutions/articles/64000255583-tips-for-formatting-documents
- https://help.api.lulu.com/en/support/solutions/articles/64000254625-what-is-the-difference-between-binding-types-
- https://help.api.lulu.com/en/support/solutions/articles/64000254616-how-is-spine-width-calculated-
- https://assets.lulu.com/media/guides/en/lulu-global-distribution-eligible-products.pdf

## Do the current PDFs meet Lulu requirements?

### Checks that pass locally

- Both interiors are multipage, single-page-layout PDFs with uniform page boxes.
- Both covers are one-piece, one-page back-spine-front wraps.
- Files are unencrypted.
- Every PDF font resource is embedded as a subset. Interior fonts are Arial Bold, Georgia Bold, Georgia Italic, Georgia, Times New Roman, and Times New Roman Italic as applicable. Cover fonts are Arial Black, Arial, Georgia Bold, and Georgia.
- The paperback cover generator includes 0.125 in outside bleed and uses Lulu's 444 PPI perfect-bound spine formula.
- Cover panel padding is 0.42 in inside the trim panels, which exceeds the 0.25 in paperback cover safety minimum for ordinary front and back content.

### Checks that do not pass or remain unproven

1. **Interior size and bleed:** The PDFs are exactly 6 x 9 in (`scripts/generate-paperback.mjs:90-93`). Lulu's general project help permits 6 x 9 for a no-bleed file, but the Print API creation guide says a 6 x 9 product should be submitted as 6.25 x 9.25 with 0.125 in bleed. The Print API sandbox validator must resolve this for the selected package.
2. **Gutter:** The generator uses the same 0.62 in left and right margin on every page (`scripts/generate-paperback.mjs:90-93`). Extracted body text reaches approximately 0.625 in from the left edge and 0.615 in from the right edge. There is no mirrored inside gutter. Lulu recommends at least a 0.5 in margin plus 0.2 to 0.3 in gutter, and its current 151 to 400 page guide recommends a 1.0 in interior margin for non-bleed books.
3. **Color space:** The intended product is black-and-white cream (`public/print-products.json:20-25`, `public/print-products.json:63-68`), but the HTML uses brown and gold CSS accents (`scripts/generate-paperback.mjs:131-143`, `scripts/generate-paperback.mjs:284-290`). A proper grayscale source or a successful Lulu normalization result is still needed.
4. **Cover flattening:** The cover PDFs contain transparency masks, shadings, patterns, and vector content from gradients and the SVG mark. Lulu's guide says to rasterize vectors and flatten transparent layers. A visual PDF preview is not proof that normalization will accept them.
5. **Exact cover size:** The source requests 13.112 x 9.25 in for Volume I and 13.026 x 9.25 in for Volume II. Chrome emitted about 13.110 and 13.027 in. The differences are tiny, but the API cover-dimensions endpoint should be the authority for the exact package and page count.
6. **Stale counts and URLs:** The product records still say 357 and 319 pages and still host the June files. This is a hard operational blocker.
7. **POD package IDs:** Both are blank (`public/print-products.json:15`, `public/print-products.json:58`). Without the final dotted package ID, the correct paper, ink, binding, dimensions, cost, and validator target are not fixed.
8. **Barcode and distribution metadata:** The current back covers reserve no explicit template-verified barcode area. If these become ISBN or retail-distribution editions, the cover and metadata must be finalized together.
9. **Normalized proof:** No Lulu validation or normalization ID exists for these four fresh hashes. There is no evidence yet that Lulu accepts or normalizes them correctly.

Official validation guidance:

- https://api.lulu.com/docs/
- https://help.api.lulu.com/en/support/solutions/articles/64000254609-pdf-creation-settings
- https://help.api.lulu.com/en/support/solutions/articles/64000254607-what-files-are-required-for-lulu-print-api-production-

## What makes the cover composition feel formulaic or AI-made?

The cover is visually competent, but it reads as a reusable generated template rather than a designed edition:

- Both volumes use the exact same grid overlay, two radial glows, diagonal gradient, title stack, two-column back list, and large empty zones. Only the three palette colors change (`scripts/generate-paperback.mjs:431-451`).
- The product `mood` strings describe blueprint, atoms, circuits, cities, anatomy, law, and maps (`public/print-products.json:27-32`, `public/print-products.json:70-75`), but `mood` is never used by the renderer. There is no subject-specific visual idea.
- `101` is hardcoded as the main front-cover title for every generated product (`scripts/generate-paperback.mjs:852-857`).
- The back headline is hardcoded as `Eight short books in one physical curriculum.` (`scripts/generate-paperback.mjs:589-592`).
- Production metadata such as `356 interior pages / 6x9 / cream` is printed on the customer-facing front cover (`scripts/generate-paperback.mjs:610-612`). That makes the design look like a factory proof or mockup.
- Volume II's included-book line wraps with a dangling separator before `Government`, a visible symptom of feeding variable copy into one rigid layout.
- Faint lines at the spine edges and the uniform gridded darkness look like construction guides even though the previous dashed trim guide was removed.

The strongest path is not to add random decoration. Keep the shared series system, but give each volume one authored visual thesis, remove production metadata, tighten the title hierarchy, and let the subject title carry more authority than the volume number.

## Required outlier gate for every print package

No package should be uploaded until it passes this checklist.

### Source and identity

- Freeze live manuscript versions and checked-in fallback hashes.
- Record product JSON hash, ordered book IDs, input file hashes, generator version, output hashes, and UTC generation time.
- Fail if any input is newer than the output or if live and fallback content differ.
- Confirm every book resolves exactly once, with no missing, duplicate, hidden, or wrong-order record.
- Approve title, subtitle, series, volume, author, and ISBN identity before cover generation.
- Make cover, spine, title page, copyright page, store metadata, and Lulu metadata match.

### Section and copy audit

- Classify front, body, and back matter with explicit aliases for `Acknowledgments` and `Acknowledgements`.
- Flag every nonstandard title, prologue, epilogue, note, bonus section, and tail section for review.
- Assert expected retained section counts for every included book.
- Reject leaked title pages, contents, dedications, acknowledgements, copyright, and about-author pages unless explicitly allowed.
- Flag self-praise such as `witty`, `brilliant`, `definitive`, or `essential` in internal dividers and jacket copy.

### Pagination and navigation

- Decide whether each included book begins recto and apply that rule consistently.
- Put the title page on an odd page and copyright on an even page.
- Add folios and page references to the contents, or explicitly approve their omission.
- Reject exact duplicate pages.
- Flag narrative pages under 100 extracted characters, orphaned final lines, widows, and excessive blank area.
- Verify page count, parity, TOC references, divider pages, and cover spine after every pagination change.

### Interior production

- Confirm one uniform trim or bleed size for every page.
- Use mirrored inner and outer margins appropriate to page count and binding.
- Confirm all fonts embedded, no encryption, no clipping, and no missing glyphs.
- Fix the intended grayscale or sRGB color space before export.
- Verify every image at its actual placement size. Require 300 ppi where practical and never accept below Lulu's 200 ppi warning threshold without signoff.
- Render the first pages, every divider transition, every sparse page, and the final pages for visual inspection.

### Cover production

- Obtain dimensions from Lulu's package-specific cover-dimensions endpoint.
- Use the correct paperback formula or hardcover spine table for the final page count and paper.
- Overlay the official Lulu template and inspect bleed, trim, safety, hinge, wrap, spine, and barcode zones.
- Remove customer-irrelevant production metadata.
- Flatten or rasterize required effects and verify the final color profile.
- Render the full wrap and separate front, spine, and back crops at print resolution.

### Lulu and proofing

- Make the public URLs' byte lengths and SHA-256 hashes match the approved local files.
- Validate and normalize the interior with the final dotted POD package ID.
- Request exact cover dimensions, then validate and normalize the matching cover with the exact interior page count.
- Record validator IDs, statuses, errors, normalized hashes, quote, package ID, and shipping assumptions.
- Keep automatic payment and production submission off.
- Order one physical proof and inspect gutter readability, trim shift, spine centering, cover darkness, grayscale conversion, paper show-through, sparse pages, and binding behavior.
- Require explicit proof approval before public checkout.

## Recommended immediate order

1. Approve the title and series naming model.
2. Decide on folios, recto book starts, divider descriptions, and whether covers replace the divider pages.
3. Fix acknowledgements filtering, sparse-page layout, mirrored gutters, and page parity.
4. Regenerate locally with a provenance manifest and correct catalog page counts.
5. Select exact paperback and optional hardcover dotted POD package IDs.
6. Generate package-specific covers from Lulu's returned dimensions.
7. Upload only the approved hashes, then run sandbox interior and cover validation.
8. Quote paperback black-and-white, paperback color, and hardcover variants before choosing the public products.
9. Order and approve physical proofs.
