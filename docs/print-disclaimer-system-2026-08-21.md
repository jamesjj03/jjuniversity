# JJ University print disclaimer system

Status: implemented for proof generation; **not legal approval and not sale approval**.

## Why this exists

JJ University manuscripts already contain substantial title-specific copyright and disclaimer language, but the print compilation generators intentionally remove repeated back matter. Before this change, both 101 volumes replaced all of those notices with a single generic paragraph. That lost important distinctions between scientific safety, mental health, financial topics, religion, historical interpretation, satire, independent commentary, and third-party material.

The answer is not one giant waiver and not 16 repeated copyright pages. The print system now creates:

1. exactly one profile-composed **Copyright and Disclaimer** page per volume;
2. a compact publication-information layer plus publication-wide and selected work-specific clauses on that same page;
3. explicit book-specific profiles that remain traceable in the proof manifest and audit even though the printed page does not repeat title lists;
4. a separate review gate that a disclaimer cannot satisfy.

## Canonical files

- `config/print-disclaimer-profiles.json` contains reusable, reader-facing language.
- `config/book-disclaimer-profiles.json` contains explicit work-specific assignments and review status.
- `public/print-products.json` declares publication-wide baseline profiles and publication-review gates.
- `scripts/print-disclaimer-system.mjs` validates and resolves the final plan. Unknown profiles, missing book reviews, duplicate profiles, and sale-enabled products without approval fail closed.
- `scripts/audit-print-disclaimers.mjs` audits the extracted manuscript corpus and print products without changing manuscripts.
- Both print generators use the same resolver, eliminating their earlier legal-copy drift.

Run the current audit with:

```powershell
npm run print:disclaimers
```

Use `npm run print:disclaimers -- --json` for structured output or add `--strict` to treat warnings as failures.

## Current 101 treatment

Every 101 volume gets these publication-wide clauses on its single copyright/disclaimer page:

- accuracy and corrections;
- general educational scope;
- independence, non-affiliation, and third-party identification.

The Natural World adds concise clauses for scientific/technical safety, historical interpretation, and satire/dramatization. The Human World adds concise clauses for medical/mental-health boundaries, legal/financial boundaries, religion/spirituality, historical interpretation, satire/dramatization, and third-party material. The resolver still records which titles triggered each clause, but the printed page omits long `Applies especially to` lists so the full notice remains readable on one 6x9 page.

All 16 current book assignments are `profiled-for-proof`, not `approved`. Both volumes remain `required-before-sale`. Before sale, each needs full-manuscript factual review, source/quotation/rights review, and final cover/metadata review.

Local 6x9 layout proofs were rendered and visually inspected for the combined page:

- `output/pdf/JJ-University-101-Volume-I-copyright-disclaimer-one-page-proof.pdf` - one page;
- `output/pdf/JJ-University-101-Volume-II-copyright-disclaimer-one-page-proof.pdf` - one page.

The corresponding proof interiors are now 354 pages for Volume I and 314 pages for Volume II. Lulu's current cover calculator returned 13.107 x 9.25 inches and 13.017 x 9.25 inches for the paperback wraps, and 14.813 x 10.75 inches and 14.75 x 10.75 inches for casewrap. These remain proof-only dimensions, not sealed or sale-approved package specifications. The superseded multi-page disclaimer proofs and earlier page counts must not be used for a new cover upload.

These ignored artifacts prove layout only. They are not the sealed 101 print packages, have not been revalidated against current Lulu cover dimensions, and must not be used to update public page counts or spine widths.

## Corpus baseline

The 2026-08-21 extracted-corpus audit found:

- 265 ready-main books, all with one copyright section;
- 201 with third-party quotation, public-domain, image, lyric, mark, or fair-use wording;
- 187 with fictionalization, paraphrase, condensation, reconstruction, or dramatization wording;
- 90 with non-affiliation or non-endorsement wording;
- 46 with trademark, brand, logo, or nominative-use wording;
- 37 with medical, health, psychological, psychiatric, or therapeutic wording;
- 52 that categorically invoke fair use;
- 7 that declare First Amendment or constitutional protection;
- 38 with duplicated `COPYRIGHT COPYRIGHT` text;
- 26 whose owner line says `JJ` or `JJ ARCHIVES` rather than confirmed owner language.

These pattern counts are editorial triage signals, not legal conclusions. The current explicit book-profile registry covers only the 16 books in the two 101 proof candidates. Any future print product containing another book fails generation until that book receives an explicit profile review; the audit can suggest where to begin but does not silently classify it.

## Rules for language and review

- State independence and non-affiliation plainly, but do not promise that a disclaimer eliminates confusion.
- Describe satire, dramatization, composites, changed names, and firsthand memory only when they are true for that work.
- Do not use categorical lines such as “all citations fall under fair use,” “no infringement intended,” or “protected by the First Amendment” as a substitute for source and rights review.
- Do not use a medical, legal, financial, or safety disclaimer as a substitute for correcting dangerous or unsupported instructions.
- Do not describe claims as fully verified without a claim-level source ledger.
- Keep source, permissions, cover-art, quotation, and attribution records separate from reader-facing disclaimer copy.
- Living-person allegations, active organizations, uncertain third-party rights, medical guidance, and legal or financial guidance can require qualified prepublication review. A disclaimer is not that review.

## Primary legal references

This document is an editorial workflow, not legal advice.

- A U.S. copyright notice identifies the work with the notice symbol or word, year, and copyright owner: https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title17-section401
- Fair use is a case-specific four-factor analysis: https://www.copyright.gov/fair-use/more-info.html
- Trademark infringement analysis considers likely confusion about source, sponsorship, or approval: https://www.uspto.gov/page/about-trademark-infringement
- Marketing disclaimers cannot cure an otherwise misleading claim: https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business

## Remaining work

- Review and assign profiles to the other 249 ready-main books in controlled editorial batches.
- Build source, permissions, and cover-art ledgers.
- Add a stable public Legal and Corrections destination, then replace the general contact route with edition-specific errata links.
- Rebuild and visually inspect the sealed 101 proof interiors after the combined page; page counts and cover spine widths will change.
- Obtain qualified review where the subject matter or claim risk justifies it before approving sales.
