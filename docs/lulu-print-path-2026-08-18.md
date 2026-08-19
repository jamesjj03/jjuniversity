# JJ University Lulu Print Path

Date: 2026-08-18

## Decision

Use the Lulu Print API, but begin in Lulu's separate sandbox and keep automatic submission disabled until a physical 101 proof is approved.

Manual Lulu projects are acceptable for a one-off proof. They are not the best long-term system for 30 to 50 JJ University bundles because every file revision, product definition, quote, order, and fulfillment status would have to be coordinated by hand. The existing JJU code already implements most of the API path, including multi-volume bundles.

## What already exists in JJU

- OAuth client-credentials token exchange
- Sandbox API base URL by default
- Lulu print-job cost calculation
- Lulu print-job creation
- Product readiness checks
- Stripe checkout to Lulu fulfillment handoff
- Supabase print-order storage fields
- Separate line items for a multi-volume bundle
- A generated-paperback factory
- A Supabase upload script for interior and cover PDFs
- Public interior and cover URLs for both 101 volumes

Current 101 files:

- Fresh local Volume I interior: 356 pages, 6 by 9 inches
- Fresh local Volume II interior: 318 pages, 6 by 9 inches
- Both cover files: one-page full wraps with bleed and calculated spines
- The public Lulu-facing URLs still serve the older June files and the product catalog still records 357 and 319 pages. Those public assets and counts must not be used for validation or print jobs.

The current readiness endpoint reports only these product-level omissions:

- `101-volume-1.podPackageId`
- `101-volume-2.podPackageId`

The local environment now has the three sandbox credentials:

- `LULU_CLIENT_KEY`
- `LULU_CLIENT_SECRET`
- `LULU_CONTACT_EMAIL`

Sandbox OAuth authentication returned HTTP 200 and a bearer token on 2026-08-18. The credential values were not printed or committed. They are local only and have not been installed in Vercel.

## Confirmed sandbox experiment

On 2026-08-18, the real sandbox `cover-dimensions` endpoint accepted both fresh page counts with dotted 6 x 9 black-and-white standard matte paperback package IDs. Both white and cream paper variants returned the same required wrap dimensions:

| Interior | Pages | Lulu cover dimensions |
| --- | ---: | --- |
| Volume I | 356 | 13.112 x 9.250 in |
| Volume II | 318 | 13.026 x 9.250 in |

Accepted package variants:

- White paper: `0600X0900.BW.STD.PB.060UW444.MXX`
- Cream paper: `0600X0900.BW.STD.PB.060UC444.MXX`

The experiment created only sandbox cover-dimension calculations. It did not upload a file, create a print job, provide an address, charge a card, or submit an order. The returned dimensions agree with the current generator's wrap arithmetic to rounding precision.

`LULU_AUTO_SUBMIT_PRINT_JOBS` must remain `false` during development and proofing.

## What must be corrected before a sandbox print job

1. Approve the title model, binding, paper, cover finish, folios, recto starts, divider treatment, and whether grayscale original covers replace the current divider pages.
2. Fix the three leaked `Acknowledgements` sections, mirrored gutter treatment, page parity, sparse-page outliers, and self-complimentary divider descriptions.
3. Regenerate both interiors and covers with a provenance manifest, the approved JJU monogram, and the exact fresh page counts.
4. Select the exact dotted POD package IDs for paperback and any optional hardcover edition.
5. Confirm interior size and bleed against Lulu's current validator. The existing interiors are exactly 6 by 9 inches. Lulu's current published guidance describes a 6.25 by 9.25 inch interior when bleed is included. Do not guess. Submit the approved files to the sandbox validation endpoints and use Lulu's result as authority.
6. Request package-specific cover dimensions, then validate the matching cover with the exact normalized interior page count.
7. Update the public files and catalog only when their hashes and counts match the approved local outputs.
8. Request a sandbox quote with a test shipping address.
9. Create one sandbox print job with automatic payment and automatic production disabled.
10. Add Lulu status webhook ingestion with raw-body HMAC verification before production automation.
11. Make print-job creation idempotent so a repeated Stripe webhook cannot create a duplicate physical order.
12. Order and approve a real physical proof before enabling public checkout.

## Credentials James should obtain

The separate Lulu sandbox account is configured locally in `.env.local`. Do not paste either secret into chat or commit them to Git.

Production credentials should not be created or installed until the sandbox flow, PDF validation, pricing, and physical proof all pass.

## Official Lulu facts used for this decision

- The API uses OAuth 2.0 client credentials and has separate production and sandbox environments: https://api.lulu.com/docs/
- Sandbox jobs are not sent to production: https://help.api.lulu.com/en/support/solutions/articles/64000306383-do-you-have-a-sandbox-environment-
- Every product requires one multipage interior PDF and one single-page cover PDF, available through downloadable URLs: https://help.api.lulu.com/en/support/solutions/articles/64000254607-what-files-are-required-for-lulu-print-api-production-
- Lulu's current PDF layout and bleed guidance: https://help.api.lulu.com/en/support/solutions/articles/64000254609-pdf-creation-settings
- The API is free to use; charges are print cost, shipping, fulfillment, and tax: https://help.api.lulu.com/en/support/solutions/articles/64000254631-are-there-fees-to-use-lulu-s-print-api-
- Lulu.com project files are not directly reusable by the Print API. API jobs need separately hosted files: https://help.api.lulu.com/en/support/solutions/articles/64000306556-can-i-create-a-print-job-using-a-lulu-project-

## Bottom line

JJU does not need to start the Lulu integration from scratch, and it does not need a new PDF factory from scratch. It needs the existing factory hardened, the new brand applied, the files validated in sandbox, and the last fulfillment safety pieces completed.
