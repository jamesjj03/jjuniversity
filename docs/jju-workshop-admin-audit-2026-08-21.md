# JJU Workshop: admin audit and local-workspace boundary

## Current state

`/admin` is now presented as **JJU Workshop**, but it remains an online Next.js admin surface. It is protected by the existing Basic Auth boundary in `proxy.ts`; it is not yet an offline application. The redesign preserves the existing routes, APIs, and data locations.

The shell unifies the existing work into five mobile-first areas:

- Books: catalog metadata, archive placement, tags, shelf visibility, cover/source references, and JSON manuscript editing.
- Collections: the existing taxonomy review desk, linked without changing its internal workflow.
- Manuscripts: the existing capitalization/editorial case queue, linked without changing its internal workflow.
- Atlas: the existing map editor, factory, evidence, category review, and quality workflows.
- Arena: the existing visual source review workflow.

Editorial overview, homepage curation, reading-series editing, Fiber settings, and new-book creation remain available through their existing routes or the Books workspace.

## Preserved routes and workflows

Pages reviewed and retained:

- `/admin`
- `/admin/editorial`
- `/admin/taxonomy-review`
- `/admin/manuscript-case`
- `/admin/atlas`
- `/admin/arena`

Admin data endpoints reviewed and retained:

- Books and creation: `/api/admin/books`, `/api/admin/book-draft`, `/api/admin/content/[id]`, `/api/admin/epub/[id]`, `/api/admin/titles`
- Curation and configuration: `/api/admin/paths`, `/api/admin/pathgen`, `/api/admin/site`, `/api/admin/fiber`, `/api/admin/availability`
- Editorial review: `/api/admin/manuscript-case`, `/api/admin/taxonomy-review`, `/api/admin/review/[id]`, `/api/admin/review/claims`, `/api/admin/review/config`, `/api/admin/review/fact-check`
- Atlas: `/api/admin/atlas-inventory` plus the existing server actions in `/admin/atlas`

The shell preserves the existing canonical data locations. Books remain in Supabase when it is configured; paths, site settings, and Fiber settings remain current-GitHub-or-local documents. The books endpoint remains fail-closed when Supabase is configured and unavailable; it does not expose a stale local catalog as an editable replacement.

Supabase catalog writes now require the additive migration `supabase/jju_admin_catalog_cas_2026_08_21.sql`. It adds a private catalog revision and two transaction RPCs: one atomically compares-and-saves the complete catalog, and one atomically creates a draft catalog row and its first live manuscript. Until that migration is deliberately applied, Supabase-backed catalog editing and draft creation fail closed with a setup message; they do not fall through to mixed local storage. This pass did not apply the migration to the live project.

## Data-safety rules added

- Books, paths, site settings, and Fiber configuration must all return successful, structurally valid responses before any editor, mutation, or export control opens.
- Current GitHub JSON and blob revisions are read when GitHub is canonical. Full-document writes require the exact loaded version and return `409` on conflict.
- Supabase catalog saves use a revision locked inside the same database transaction as the catalog upsert. Draft creation inserts the catalog and first manuscript in one transaction. No application code path performs an unconditional catalog upsert.
- Manuscript reads carry a source version. Supabase manuscript updates condition on the loaded row version; GitHub/local updates condition on the loaded content revision. A stale editor remains dirty and receives a conflict instead of overwriting newer content.
- A failed bootstrap is shown as an explicit locked state; error payloads are never normalized into empty editable defaults.
- Workspace and manuscript dirtiness are shared with the layout. Internal Workshop links and public-site links require confirmation before discarding changes, and the browser unload warning remains active.
- Manuscript changes have a separate save path from catalog/config changes. The mobile dock labels and invokes the manuscript's real save action rather than implying that “Save workspace” includes it.
- Book, section, and in-page workspace switching are guarded while a manuscript is dirty.
- Editor surfaces become inert or disabled during saves.
- The mobile book picker is a labeled modal dialog with trigger state, focus transfer, Escape close, and focus return.
- Custom `ADMIN_PATH` values are used by the shell and Atlas post-save redirects; canonical admin links inside the shell are rewritten to the configured protected base.

## Recommended local-only boundary

Use the repo-root folder **`workshop/`**, referred to conversationally as **JJU Workshop**, for future local editorial utilities and private working files.

The exact boundary is already excluded by both deployment and version control:

- `.gitignore`: `/workshop/`
- `.vercelignore`: `/workshop/`

Rules for the future move:

1. Keep browser routes under `app/admin` until a local replacement has functional parity.
2. Build local-only tools under `workshop/`; do not place them under `app`, `public`, or any imported production dependency path.
3. Keep secrets in ignored environment files, never in Workshop source or exports.
4. Verify `git check-ignore -v workshop/<file>` and the Vercel exclusion before adding private material.
5. Mirror and verify each workflow before changing ownership or deleting an online route. No route or data has been moved by this pass.

## Still open

- Decide whether JJU Workshop should become a separate local desktop app, a localhost-only Next.js target, or a small local service with a document-style editor.
- Decide which online admin capabilities must remain available from a phone after the offline workspace exists.
- Add end-to-end tests for authentication, custom admin path navigation, failed bootstrap states, save concurrency, and unsaved-change confirmations.
- Apply and verify `supabase/jju_admin_catalog_cas_2026_08_21.sql` in the intended Supabase project before enabling Supabase-backed Workshop catalog mutations.
- Taxonomy and manuscript editorial tools retain their current internals; their dedicated redesigns remain separate work.
