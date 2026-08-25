# JJ University Topics and descriptions audit

Date: 2026-08-25

Scope: 265 `ready` / `main` books and the 68 approved public Topic labels

Mode: read-only audit and review workflow; no catalog, manuscript, Supabase, or public-site mutation

## Topic health

- 68 approved Topic labels.
- 2 empty labels: `19th Century`, `Sociology`.
- 2 one-book labels: `Space Exploration` (`musk`) and `Vietnam War` (`hochi`).
- 7 labels with 2–4 books:
  - `Public Health` — 2
  - `Victorian Era` — 2
  - `African History` — 3
  - `World War I` — 3
  - `Ancient Egypt` — 4
  - `British History` — 4
  - `Slavery & Abolition` — 4
- 1 overbroad label under the current more-than-25-percent rule: `Biography` — 94 books.
- 0 exact or normalized duplicate labels.
- 5 lexical lookalike pairs. These are review prompts, not confirmed duplicates:
  - `19th Century` / `20th Century`
  - `African History` / `American History`
  - `African History` / `Asian History`
  - `Asian History` / `Russian History`
  - `World War I` / `World War II`

The five pairs above are meaningfully distinct on their face. The desk labels them as wording checks so similarity is never mistaken for authorization to merge.

## Overlap

Every current ready/main book has multiple Topics. No book has zero or one Topic.

| Topics on one book | Books |
|---:|---:|
| 2 | 5 |
| 3 | 25 |
| 4 | 113 |
| 5 | 97 |
| 6 | 25 |

This distribution is visible in the Workshop. Multi-Topic membership is preserved and is not treated as a defect.

## Description audit

- 265 descriptions checked; none are blank.
- 103 contain a `from … to …` construction.
- 88 begin with either a repeated three-word opening or `How`.
- 59 share one of eight three-word openings used by at least three books:
  - `The story of` — 16
  - `A critical examination` — 9
  - `A sweeping history` — 9
  - `A deep dive` — 7
  - `A history of` — 6
  - `An exposé of` — 6
  - `The rise and` — 3
  - `The rise of` — 3
- 29 start with `How`.
- 6 have an obvious `A` / `An` error: `humanity.exe`, `Islam`, `Shakespeare`, `The NSA`, `The Ones Who Woke Up`, and `The Great War`.
- 154 descriptions have at least one of the formula or grammar flags above.
- 0 exact duplicate descriptions.
- 13 descriptions are under 100 characters; 1 is over 220 characters. Length is shown as context, not an automatic quality judgment.

The `from … to …` detector requires `from` and then `to` within 160 characters. The repeated-opening detector normalizes the first three words and flags an opening only when at least three books use it. These are triage signals, not automatic rewrite instructions.

## Review workflow

The protected Workshop route `/admin/topics` now provides three phone-first views:

1. Topics: filter by empty, one-book, 2–4-book, overbroad, wording similarity, or decision state; inspect every assigned book; record keep, rename, merge, retire, or think.
2. Books: search all 265 books and inspect every many-to-many Topic membership.
3. Descriptions: filter `from … to …`, repeated openings, grammar, length, or decision state; record keep, rewrite, fact-check, or think, including a replacement draft and notes.

Decisions autosave in the current browser under a catalog-fingerprint-specific key. Older fingerprints remain separately downloadable instead of being overwritten. A deterministic JSON handoff can be exported at any time.

The desk intentionally has no Apply button. Topic changes span both public Topic definitions and many catalog assignments, so the existing per-book exact-CAS path is not a safe atomic bulk-application path. Description and Topic decisions should be reviewed from the export, applied in a separate controlled change, and verified before any live save.
