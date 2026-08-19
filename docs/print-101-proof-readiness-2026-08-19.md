# JJ University 101 print-proof readiness

Date: 2026-08-19

Status: **Proof-ready candidate assets; sandbox validated; not approved for sale or physical production.**

This report is the authoritative tracked summary for the current JJ University 101 Volume I and Volume II print-proof candidates. It supersedes the readiness conclusions and page counts in the dated 2026-08-18 PDF audit. Generated PDFs, rendered previews, the machine-readable manifest, and raw sandbox responses remain local proof artifacts under the ignored `output/pdf/` directory.

## Safety boundary

- Lulu environment: sandbox only.
- Paid or physical print job created: **No**.
- Lulu `/print-jobs/` endpoint called: **No**.
- Assets enabled for sale: **No**.
- Delivery address supplied by the user: **No**.
- Quote basis: quantity one per volume, USD, MAIL shipping, using a public institutional test destination published in Lulu's API documentation. These are comparison estimates, not delivery quotes for the user.

## Proof identity and storage

- Proof digest: `236e80e626c63f7a`
- Proof bucket: `paperbacks`
- Proof-only object namespace: `proofs/2026-08-19/jju-101-236e80e626c63f7a`
- Source model: checked-in `public/books.json`, `public/print-products.json`, `public/book-content/manifest.json`, and the corresponding checked-in book-content JSON files.

The namespace is proof-only. It must not be repointed to production products or treated as a sale-ready asset location without a separate approval and release step.

## Interior candidates

| Volume | Product title | Pages | Trim | Interior SHA-256 |
| --- | --- | ---: | --- | --- |
| I | The Natural World | 354 | 6 x 9 in | `480c835dfb22e05492a8d258705e39c9ebfc106ad4e2f5696f817666afcb8bc4` |
| II | The Human World | 314 | 6 x 9 in | `5efeb2534a3b5a424d0fcca62ee2176869c610b8189f9f6240773fc33f4c71c8` |

Both interiors are exactly 432 x 648 pt on every page, unencrypted, and use embedded fonts. Their margins are mirrored so the larger margin sits at the binding edge. Every book divider starts on an odd-numbered recto page. Product title, legal, contents, divider, and intentionally blank pages have no folio.

Per-book title pages, dedications, acknowledgments, copyright pages, and about-the-author pages were removed. Each volume retains one product-level title leaf, one legal page, one contents page, eight recto book dividers, the retained manuscript sections, and one product-level About JJ University page.

Intentional blank versos are pages 4, 44, 94, 130, 220, and 260 in Volume I, and pages 4, 50, 136, 166, and 276 in Volume II. They are empty and unnumbered. The final density review found no one-line narrative orphan pages. Volume II has no narrative page below 180 extracted characters. Volume I has four deliberately short, visually reviewed multi-line rhetorical endings on pages 143, 156, 197, and 249.

## Cover candidates

The package-ready wrap proofs use the restrained System direction. The separate review board also records the Index and Split directions. No generated illustration is used.

| Volume | Binding | Exact page size | Raster resolution | Cover SHA-256 |
| --- | --- | --- | --- | --- |
| I | Paperback | 13.107 x 9.25 in | 300 PPI | `69ee5346c765976da4f1878dc3f17e42be0c9ce5ab398cd500e37a0f70cdede6` |
| I | Casewrap | 14.813 x 10.75 in | 300 PPI | `f6a28bcf56610cb1e66c17eb00eaf01756b17c1e16ac531c40fce04a2879272d` |
| II | Paperback | 13.017 x 9.25 in | 300 PPI | `7f4b51aa325ac7d2b514f097a2752e8c3029ff925abd536cf8a291e3e3a88a97` |
| II | Casewrap | 14.75 x 10.75 in | 300 PPI | `c20c186fbef37171ea83ca3809f8c72636c34301da648bdb0a866fe492c9a9c7` |

The three-page cover-direction review board has SHA-256 `2a992a3d09a4fb9d926d23165e6be5008564b11ae05236e5d612dc67154a3cdb`. The final System backs have unobstructed descriptive copy and a reserved white barcode zone.

## Lulu package candidates

| Binding | Lulu POD package ID | Specification |
| --- | --- | --- |
| Paperback | `0600X0900.BW.STD.PB.060UC444.MXX` | 6 x 9 in, black-and-white standard, paperback, 60# cream, matte |
| Casewrap | `0600X0900.BW.STD.CW.060UC444.MXX` | 6 x 9 in, black-and-white standard, casewrap, 60# cream, matte |

These are validated candidate packages, not a final binding or material decision.

## Lulu sandbox file validation

All eight current interior and cover validations returned `NORMALIZED` with no errors.

| Volume | Binding | File | Validation ID | Status |
| --- | --- | --- | ---: | --- |
| I | Paperback | Interior | 947217 | `NORMALIZED` |
| I | Paperback | Cover | 947219 | `NORMALIZED` |
| I | Casewrap | Interior | 947223 | `NORMALIZED` |
| I | Casewrap | Cover | 947222 | `NORMALIZED` |
| II | Paperback | Interior | 947224 | `NORMALIZED` |
| II | Paperback | Cover | 947218 | `NORMALIZED` |
| II | Casewrap | Interior | 947220 | `NORMALIZED` |
| II | Casewrap | Cover | 947221 | `NORMALIZED` |

## Sandbox quote comparison

Each row is a separate quantity-one sandbox estimate. Shipping, fulfillment, and tax are included in the total.

| Volume | Binding | Manufacturing | Shipping | Fulfillment | Tax | Sandbox total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| I, 354 pages | Paperback | $10.84 | $5.69 | $0.75 | $1.05 | $18.33 |
| I, 354 pages | Casewrap | $19.53 | $5.69 | $0.75 | $1.57 | $27.54 |
| II, 314 pages | Paperback | $9.84 | $5.69 | $0.75 | $0.99 | $17.27 |
| II, 314 pages | Casewrap | $18.53 | $5.69 | $0.75 | $1.51 | $26.48 |
| Both volumes | Paperback | $20.68 | $11.38 | $1.50 | $2.04 | $35.60 |
| Both volumes | Casewrap | $38.06 | $11.38 | $1.50 | $3.08 | $54.02 |

The combined rows add the two independent estimates; they are not a single cart or bundled-shipping quote. Actual production cost depends on the approved files, quantity, shipping method, destination, and tax treatment.

## Remaining approval decisions

No physical proof should be submitted until all of the following are explicitly resolved:

1. Approve or revise the metadata model: series `JJ University 101`; titles `The Natural World` and `The Human World`; designations Volume I and Volume II.
2. Select and approve the final cover direction.
3. Select paperback, casewrap, or both.
4. Confirm cream paper and matte finish.
5. Approve the copyright and AI-assisted editorial disclosure language.
6. Decide ISBN ownership, barcode content, distribution, and retail pricing.
7. Supply the actual proof-delivery address and explicitly approve creation of a physical proof order.

Until those decisions are complete, these files remain proof candidates only. **No order has been placed, no paid print job has been created, and no production submission is authorized by this report.**
