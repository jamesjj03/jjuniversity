# Atlas ↔ JJ University geographic associations

## What is authoritative now

The Phase 2 authority is the versioned repository file at
`lib/atlas-world/associations/data/authority.v1.json`. Its contract is documented by
`lib/atlas-world/associations/schema/authority.v1.schema.json` and the TypeScript types in
`lib/atlas-world/associations/types.ts`.

This is intentionally file-backed for the first reviewed pilot:

- Atlas and the public book edition already ship from versioned repository inputs.
- A code-reviewed JSON change is recoverable and keeps editorial decisions beside their evidence.
- There is not yet an Atlas association review UI. Adding a database now would create two authorities or make direct SQL the editorial workflow.
- Ten pilot records do not need database query infrastructure.

No Supabase migration is included in Phase 2. A database becomes warranted when the Workshop has a real proposal/review queue, multiple editors need concurrent writes, or the volume makes file review impractical. At that point, the JSON contract should be migrated rather than replaced: review state, typed relationship, exact evidence, source revision, temporal extent, and supersession all remain required. Only reviewed rows should be compiled into a public snapshot.

## Publication boundary

`lib/atlas-world/associations/authority.ts` is the only supported server-side reader. It exposes:

- `getApprovedAtlasJjuAssociationsForEntity(entityId)` for the complete reviewed records;
- `getApprovedAtlasJjuLinksForEntity(entityId)` for the existing country-detail `jjuLinks` slot;
- `getAtlasJjuAssociationAudit()` for health reporting.

The compatibility links preserve `relationship`, `salience`, temporal scope, authority revision,
and source IDs. Existing UI may read only `title`, `href`, and `kind`; a richer cockpit can use the
additional fields without changing the authority.

A record is public only when all of the following are true:

1. `review.state` is `approved`;
2. `review.reviewerKind` is `human`, with review identity and timestamp present;
3. the source subject revision still matches the current catalog;
4. for a book, the catalog entry remains readable and public.

Proposed, rejected, superseded, stale, missing, and no-longer-readable records are excluded. The
loader does not infer replacements.

## Relationship semantics

Relationships belong to the subject type instead of collapsing everything into “relevant.”

| Subject | Allowed relationships |
| --- | --- |
| Book / Series | `primary_subject`, `substantial_coverage`, `contextual_coverage` |
| Person | `born_in`, `died_in`, `lived_in`, `active_in`, `governed_in` |
| Event | `occurred_in`, `began_in`, `ended_in`, `affected` |
| Concept | `originated_in`, `institutionally_centered`, `historically_prominent` |

An association points at stable Atlas entity identity. `featureId` is available when a later link
targets a city, route, battlefield, or other geographic feature more precisely than a country.
Geometry is not copied into the association.

## Evidence and staleness

Every record needs an exact excerpt and locator. For the book-catalog pilot, each association pins
a SHA-256 hash of only these subject fields:

`id`, `title`, `description`, `tags`, `status`, `visibility`, and `slug`.

Changing a cover or word count does not invalidate a geographic review. Changing the text or
publication status that supported the decision does. A stale approved record fails the association
check and is also withheld by the runtime reader until it is re-reviewed.

Temporal scope describes the relationship, not the current map polygon. This prevents a historical
book from silently asserting that current borders existed throughout the book's period.

## Proposal and review workflow

1. Generate or author a proposal from exact evidence. The helper is deliberately stdout-only:

   ```powershell
   npm run atlas:associations:propose -- `
     --subject-id control `
     --place-id country:PRK `
     --relationship contextual_coverage `
     --evidence-field description `
     --exact-text "North Korea's total control" `
     --rationale "The catalog establishes inclusion, but not enough to infer major coverage." `
     --confidence 0.72 `
     --proposed-by "assistant-name"
   ```

2. Add the emitted record with `review.state: "proposed"`. Do not change its review fields as part
   of generation.
3. Review the precise place, relationship, salience, temporal caveat, and quoted evidence. Inspect
   the manuscript when catalog evidence cannot establish coverage strength.
4. Record one of `approved`, `rejected`, or `superseded`, with reviewer, time, and decision note.
   Rejected records stay in the authority so the same weak inference is not repeatedly proposed.
5. Run `npm run atlas:associations:check`. Approved stale records fail; unreviewed records must not
   appear in the compiled public set.

Confidence is proposal metadata, not truth and never bypasses review.

## The Mapmakers pilot

The pilot proposes eight high-confidence direct place portraits whose current catalog descriptions
explicitly name their subject: Egypt, Germany, Japan, China, North Korea, Cuba, Saudi Arabia, and
Antarctica. Antarctica retains its broader Atlas-entity identity; the proposal does not call it a
sovereign country. These remain private until a human editor approves their exact place,
relationship, salience, and temporal wording.

Two lower-confidence `Control Freaks` links (North Korea and Belarus) also remain proposals. Its short catalog description
establishes that the places appear, but not enough to decide chapter-level coverage. They prove the
private proposal boundary and require manuscript review before publication.

The pilot deliberately does **not** force:

- *Imperium Romanum* onto modern Italy;
- *The Borders Book* onto a single country;
- *United Nations* onto its headquarters country;
- the coming-soon Syria book into a readable-content link.

Those omissions are part of the model: geographic association is a reviewed claim, not a title/tag
matching side effect.
