# Atlas 2.5: bounded portrait pilot

Four licensed media assets across three countries are retained: Brice Oligui Nguema (Gabon), Charles III and Keir Starmer (United Kingdom), and Cyril Ramaphosa (South Africa). The current cockpit displays **three** of these portraits: Starmer's is suppressed because the September 2026 source review found his archived officeholder record had been superseded. The dated, text-only UK prime minister update is separately sourced; see [leadership review](./atlas-leadership-review.md).

This is not a current-officeholder service. Existing country facts remain the archived Factbook observations, with their full observation date visible beside leadership. The term start is a separate fact. A photograph's date is never presented as the officeholder observation date.

## Identity and fail-closed matching

`lib/atlas-world/data/portrait-pilot.json` separates people, reusable media, and dated country-office bindings. `portraitPilot.ts` requires an exact country ID, role, source name, source ID and observation date before displaying a portrait. A source refresh, vacancy, changed person, changed date, or separately reviewed supersession returns no portrait until the binding is reviewed. Other countries retain text-only leaders without silhouette cards. Collective, representative, and associated officeholder records retain their existing role semantics; the overview preserves the full source list without creating an otherwise empty Politics tab.

No portraits are inferred from country names and no identity assignments are generated at runtime. The media registry records a bounded source/identity check by Codex on 2026-09-05, not a claim of human editorial approval or global current-leadership verification.

## Image sources and reuse

| Person | Image/source page | Credit | Reuse |
|---|---|---|---|
| Brice Oligui Nguema | [Commons file record](https://commons.wikimedia.org/wiki/File:Brice_Oligui_Nguema_on_November_26,_2024_(cropped).jpg) | Lukasz Kobus / European Communities, 2024 / EC Audiovisual Service; source photo 2024-11-26 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); Commons crop by Sashi Suseshi; exact EU credit retained |
| Charles III | [Commons file record](https://commons.wikimedia.org/wiki/File:King_Charles_III_(July_2023).jpg) | The White House; source photo 2023-07-10 | Public-domain official U.S. government work; Commons crop and tonal adjustments retained |
| Keir Starmer | [Commons file record](https://commons.wikimedia.org/wiki/File:Keir_Starmer_official_portrait_(2x3_cropped).jpg) | Simon Dawson / No 10 Downing Street; source photo 2024-07-05 | [Open Government Licence v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/); required attribution statement included |
| Cyril Ramaphosa | [Commons file record](https://commons.wikimedia.org/wiki/File:Cyril_Ramaphosa_2024.jpg) | Ricardo Stuckert / Presidency of Brazil; source photo 2024-09-25 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/); Atlas WebP derivative is distributed under the same license |

Each portrait exposes its author, original source link, license link, photograph date, and alteration statement through “Sources & photo credit.” The displayed viewport crops the portrait to fit; the local file retains the Commons crop's aspect ratio. No synthetic faces, generated detail, or inferred identities are used. The Gabon source was explicitly replaced with a 1,252 × 1,611 original, rather than enlarging the older 479px crop. The reviewed old/new source hashes are recorded in the acquisition script so arbitrary source replacement still fails closed.

## Reproduction and validation

Run from the repository root:

```sh
node scripts/atlas/acquire-portrait-pilot.mjs --acquire
node scripts/atlas/acquire-portrait-pilot.mjs
```

The acquisition script checks the source license, downloads the original Commons image, validates its locked SHA-256 once a manifest exists, and derives a 560px-wide, quality-92 WebP without enlargement using the repository's Sharp version. It fails if source bytes change rather than silently updating the identity image. The checked-in manifest preserves input URL, original and derivative checksums, source/output dimensions, date, byte size, author and license. The no-argument check is offline and verifies asset checksums, sufficient image resolution, a 190 KB per-image ceiling, and the exact local officeholder bindings.

The four WebP files total 450,856 bytes. Individual files are 83–135 KB and are local static assets. Only portraits visible for the selected country load; the superseded Starmer asset is not requested by the cockpit. The 560px derivatives cover the 112px desktop display at well over 3× pixel density. No remote image host, new Next image-domain rule, third-party request, or runtime image lookup is needed. The cockpit uses Next Image with explicit dimensions and `unoptimized`, since these files are already prepared.

`tests/atlas/portrait-pilot.spec.ts` protects exact positive identity matches and negative changed-person/date/source/vacancy cases. Browser verification additionally checks loaded images, distinct UK roles, date disclosure, attribution controls, and the text-only fallback.
