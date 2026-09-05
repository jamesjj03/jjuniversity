# Atlas 2.5: bounded portrait pilot

Four people across three countries are included: Brice Oligui Nguema (Gabon), Charles III and Keir Starmer (United Kingdom), and Cyril Ramaphosa (South Africa).

This is not a current-officeholder service. Existing country facts remain the archived Factbook observations, with their full observation date visible beside leadership. The term start is a separate fact. A photograph's date is never presented as the officeholder observation date.

## Identity and fail-closed matching

`lib/atlas-world/data/portrait-pilot.json` separates people, reusable media, and dated country-office bindings. `portraitPilot.ts` requires an exact country ID, role, source name, source ID and observation date before displaying a portrait. A source refresh, vacancy, changed person, or changed date returns no portrait until the binding is reviewed. Other countries retain text-only leaders without silhouette cards. Collective, representative, and associated officeholder records retain their existing role semantics; compact previews show up to two principal/member entries, while Politics preserves the full source list.

No portraits are inferred from country names and no identity assignments are generated at runtime. The registry records a bounded source/identity check by Codex on 2026-09-04, not a claim of human editorial approval or current leadership verification.

## Image sources and reuse

| Person | Image/source page | Credit | Reuse |
|---|---|---|---|
| Brice Oligui Nguema | [Commons file record](https://commons.wikimedia.org/wiki/File:Brice_Oligui_Nguema_in_2024_(cropped).jpg) | Freddie Everett / U.S. Department of State; source photo 2024-10-01 | Public-domain official U.S. government work; Commons crop by Ooligan |
| Charles III | [Commons file record](https://commons.wikimedia.org/wiki/File:King_Charles_III_(July_2023).jpg) | The White House; source photo 2023-07-10 | Public-domain official U.S. government work; Commons crop and tonal adjustments retained |
| Keir Starmer | [Commons file record](https://commons.wikimedia.org/wiki/File:Keir_Starmer_official_portrait_(2x3_cropped).jpg) | Simon Dawson / No 10 Downing Street; source photo 2024-07-05 | [Open Government Licence v3](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/); required attribution statement included |
| Cyril Ramaphosa | [Commons file record](https://commons.wikimedia.org/wiki/File:Cyril_Ramaphosa_2024.jpg) | Ricardo Stuckert / Presidency of Brazil; source photo 2024-09-25 | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/); Atlas WebP derivative is distributed under the same license |

Each portrait exposes its author, original source link, license link, photograph date, and alteration statement through the photo-credit control. The displayed viewport crops the portrait to fit; the local file retains the Commons crop's aspect ratio. No synthetic faces, replacements, or inferred portraits are used.

## Reproduction and validation

Run from the repository root:

```sh
node scripts/atlas/acquire-portrait-pilot.mjs --acquire
node scripts/atlas/acquire-portrait-pilot.mjs
```

The acquisition script checks the source license, downloads the original Commons image, validates its locked SHA-256 once a manifest exists, and derives a 360px-wide WebP using the repository's Sharp version. It fails if source bytes change rather than silently updating the identity image. The checked-in manifest preserves input URL, original and derivative checksums, date, dimensions, byte size, author and license. The no-argument check is offline and verifies asset checksums plus the exact local officeholder bindings.

The four WebP files total 130,312 bytes. Individual files are 22–47 KB and are local static assets. No remote image host, new Next image-domain rule, third-party request, or runtime image lookup is needed. The cockpit uses Next Image with explicit dimensions and `unoptimized`, since these small versioned WebP files are already prepared.

`tests/atlas/portrait-pilot.spec.ts` protects exact positive identity matches and negative changed-person/date/source/vacancy cases. Browser verification additionally checks loaded images, distinct UK roles, date disclosure, attribution controls, and the text-only fallback.
