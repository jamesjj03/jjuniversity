# JJ University print-edition strategy

Status: editorial and production recommendation. This does not make any product purchasable and does not submit a Lulu print job.

## Recommendation

Do not turn all 265 ready books into individual Lulu projects. Most JJU books are intentionally short: the median ready/main manuscript is 5,583 words, only 15 exceed 10,000 words, and only 8 exceed 12,000 words. A 32-page perfect-bound book is technically allowed, but technical eligibility is not the same as a physical product worth buying.

Use three lanes instead:

1. **Curriculum volumes** — the default. Bundle coherent books into 180–420 page volumes. These create the best physical value and map naturally to the reviewed Collections system.
2. **Flagship standalones** — reserved for unusually substantial or demanded books. The first candidates by current word count are *Heroes and Villains*, *humanity.exe*, *The Pyramid*, *Pantheon I*, *The Presidents*, *They Don’t Want You to Know*, *The Borders Book*, and *Echoes of Power*. A final page-layout proof, not word count alone, decides eligibility.
3. **Special editions** — occasional visual, gift, workbook, or hardcover objects where the format itself is the reason to buy. These should be intentional exceptions rather than automatic exports.

The practical standalone floor should be about 96 finished pages, with 140+ preferred. Below that, combine the work with related books unless the object has a specific collectible or gift purpose.

## Binding policy

- Perfect-bound paperback is the default proof and default public edition.
- Casewrap hardcover is a premium companion only after the paperback interior and cover system has passed a physical proof.
- Do not create paperback and hardcover as one interchangeable package. Each binding needs its own Lulu package ID, cover template, spine, wrap PDF, validation, and physical proof.
- Keep the current 6 × 9 inch, black-and-white, cream-paper, matte-cover direction as the baseline. It is readable, economical, and the current 354/314-page 101 volumes fit Lulu's 32–800 page perfect-bound and 24–800 page casewrap limits.

## Price policy

JJU does not need to maximize margin. Use a transparent floor:

`manufacturing + payment cost + expected fulfillment overhead + a small error/refund buffer`

Then choose one simple contribution amount, such as $2–$4 per book, rather than optimizing each title independently. Lulu's own bookstore can price as low as manufacturing cost; global distribution requires a higher minimum because retailer/distribution fees must be covered. Direct API sales and global distribution are different commercial paths and should not share a guessed price.

The sandbox quotes already establish a useful manufacturing baseline:

| Volume | Pages | Paperback | Casewrap |
| --- | ---: | ---: | ---: |
| The Natural World | 354 | $10.84 | $19.53 |
| The Human World | 314 | $9.84 | $18.53 |

Shipping and tax remain address-dependent. Requote immediately before setting a public price.

## Factory policy

The PDF factory should create every project from data rather than hand-authored Lulu forms:

- canonical product title/subtitle/description;
- ordered included-book IDs;
- generated title, copyright, contents, book dividers, body, folios, and closing page;
- separate paperback and casewrap cover wraps from the exact normalized page count;
- immutable hash-named interior and cover assets;
- Lulu sandbox validation for every changed package;
- a human approval gate before any paid proof or production order.

The public website must never point to an older PDF while metadata claims a newer page count. Assets, hashes, page counts, package IDs, and product metadata move as one release unit.

## Proof sequence

1. Finish metadata and copyright language.
2. Pick one approved cover direction.
3. Order one paperback proof of each 101 volume.
4. Mark issues directly on the physical copies and regenerate.
5. Once the paperback template passes, order one representative casewrap proof.
6. Only then decide whether to expose a buy button or create additional bundles.

## Current official constraints

- Lulu requires separate interior and cover PDFs.
- Perfect-bound books support 32–800 pages; casewrap supports 24–800 pages.
- Odd PDF pages print on the right; even pages print on the left.
- Lulu recommends 300 ppi images.
- Distribution requires matching title/author/ISBN metadata, correct pagination, embedded fonts, and a reviewed proof.
- Lulu's current AI policy focuses on creator responsibility and prohibits low-quality automated flooding. It does not state that every print copyright page must contain a special AI disclosure.

Sources:

- https://help.lulu.com/en/support/solutions/articles/64000255583
- https://help.lulu.com/en/support/solutions/articles/64000255462
- https://help.lulu.com/en/support/solutions/articles/64000262744
- https://help.lulu.com/en/support/solutions/articles/64000255590
- https://developers.lulu.com/home
