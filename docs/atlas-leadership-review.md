# Atlas leadership: dated evidence, not assumed currency

## What changed in the finishing pass

The portrait check found a real stale record. The imported UK profile names Keir Starmer on 1 October 2025. On 5 September 2026, the official [GOV.UK office page](https://www.gov.uk/government/ministers/prime-minister) and [Andy Burnham biography](https://www.gov.uk/government/people/andy-burnham) identify Andy Burnham and give an appointment date of 20 July 2026. [Starmer's official biography](https://www.gov.uk/government/people/keir-starmer) records his completed term on that date.

The original Factbook observation was **not** edited or re-dated. A separate, source-reviewed office observation now appears in the UK cockpit with its own check date and links. No Burnham portrait was inferred or borrowed. Starmer's portrait is suppressed; the old text is still inspectable in “Updated officeholder · source & previous record.” This is one bounded correction, not a worldwide refresh.

## Authority and freshness

- `lib/atlas-world/data/leadership-context.json` owns the small reviewed context/update registry. Its v2 contract now names a person, a stable office, and the related polity separately. For example, `person:charles-iii`, `office:country:GBR:head-of-state`, and `country:GBR` are three different identities.
- `lib/atlas-world/leadership/types.ts` and the portable JSON Schemas under `leadership/schema/` define the maintainable contract. `leadership/authority.ts` validates it at import time and fails closed on crossed office/country relationships, unknown people, incomplete evidence, missing confidence, or unsafe publication policy.
- `contexts` explain a person's entry into office or institutional role, tied to the exact archived person/source/date. Reading these sources does **not** advance the officeholder observation date.
- `officeUpdates` are separate dated observations. Each has a stable person ID, stable office ID, polity relation, head-of-state/head-of-government role, term start, observation date, evidence, review deadline, occupancy state, confidence, and explicit predecessor. The original imported country facts remain unchanged.
- `portrait-pilot.json` remains the person/media/office binding authority. A known office supersession suppresses the old portrait. A date/name/source/vacancy mismatch also fails closed.
- Records older than 120 days, future-dated, or undated show that they are not recently verified. This threshold is an authored maintenance rule, not proof that someone has left office.
- A freshly checked observation is still a snapshot, not a live guarantee. The panel makes that distinction explicit.

### Status is two-dimensional

Leadership does not use one overloaded `current` flag. **Occupancy** is `occupied`, `vacant`, `collective`, or `uncertain`. **Freshness** is independently `recent_observation`, `review_due`, `future_dated`, or `undated`. This matters: a collective presidency can be recently observed, and a stale source can explicitly report a vacancy. An archived record never claims current office merely because its date is recent. A separately reviewed update claims only that the person occupied the office on the displayed observation date.

The imported global snapshot still has unassessed person-identity confidence. Confidence is added only to the bounded identities and reviewed updates that were actually checked; Atlas does not turn parsed uppercase names into a global politician registry.

The 2026-09-05 audit contains 461 office-role records. Of those, 460 are due for review or undated; only the separately checked UK prime minister observation is recent. The app should not be described as providing globally current leaders.

## Read-only review commands

```sh
node scripts/atlas/check-leadership.mjs
node scripts/atlas/check-leadership.mjs --report-all
node scripts/atlas/check-leadership.mjs --as-of=2026-09-05
node scripts/atlas/check-leadership.mjs --live
node scripts/atlas/acquire-portrait-pilot.mjs
npm run atlas:leadership:check
```

The first command checks bindings, evidence and dates, prints the maintenance summary, and lists the pilot countries. `--report-all` prints the records due for review. `--live` performs a bounded text-presence check on the reviewed update's official office page; it alerts if the named person disappears. It never changes data, advances dates, acquires images, or publishes a replacement. A retained mention could be a previous-officeholder entry, so this alert check is not a current-officeholder verification.

## Updating an office record

1. Inspect the official office page and, if available, a dated appointment or departure notice. Establish identity, role and term dates independently. Do not infer a replacement from a photograph or an old biography.
2. Add or revise the person and office identities, then the single explicit `officeUpdates` entry with that evidence and actual observation date. Keep its old imported source/date/name in `supersedes`. Do not change the old Factbook import merely to make the panel look current.
3. If a current update itself is replaced, preserve its prior observation in source-control history and document the new evidence. Only one active reviewed update per entity/role is accepted in this bounded registry; this is not the full historical office ontology.
4. Run the review checker and the portrait tests. The checker verifies the schemas, person/office/polity joins, occupancy and confidence fields, evidence, portrait licensing, and exact predecessor bindings. Changed source identity must not inherit an earlier portrait. If the import itself is regenerated, re-review any update whose predecessor no longer matches.
5. Inspect the panel, including its visible date and original-source disclosure, before deployment. A new portrait requires a separate licensing, resolution and identity review.

This workflow is intentionally local and reviewable. It performs no scheduled writes, broad ingestion, or automatic publication.

## Context sources

Gabon context is based on the [Foreign Ministry inauguration account](https://www.affaires-etrangeres.gouv.ga/9-actualites/2491-gabon-brice-clotaire-oligui-nguema-investi-president-du-gabon/) and [Presidency's oath-of-office account](https://presidence.ga/2025/05/04/le-president-brice-clotaire-oligui-nguema-prete-serment/). The panel uses institutional facts and dates, not the source's promotional characterization of the election.

UK constitutional role context uses the [Royal Household explanation](https://www.royal.uk/the-sovereign-and-the-prime-minister) and [House of Commons Library account of the accession](https://researchbriefings.files.parliament.uk/documents/CBP-9627/CBP-9627.pdf). South Africa context uses the [National Assembly election record](https://parliament.gov.za/press-releases/national-assembly-elects-cyril-ramaphosa-president-elect) and [government inauguration record](https://www.gov.za/news/speeches/president-cyril-ramaphosa-presidential-inauguration-19-jun-2024).

These are concise sourced explanations, not biographies or a claim of current office occupancy beyond each displayed observation.
