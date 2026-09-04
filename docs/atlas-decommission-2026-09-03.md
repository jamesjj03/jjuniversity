# Atlas decommission record

Date: September 3, 2026

The former JJ University Atlas was a theory-map, inventory, and generated-corpus experiment. It was replaced rather than adapted. The current `/atlas` product is an interactive geographic world atlas with a separate local, sourced country snapshot.

## Removed from the application

- The old theory-map UI and duplicate `/site-v2/atlas` route
- The isolated `/atlas/lab` prototype and image asset
- The public node/inventory APIs
- The Atlas review/factory admin desk
- The generated theory corpus (`atlas/`, 691 files)
- The old import, generation, ingest, and inventory scripts
- Old Atlas-only global CSS, configuration, and setup SQL

The historical cross-product design documents now carry supersession notes where they instructed future work to preserve the old Atlas.

## Supabase audit and backup

The linked project contained 20 `public.atlas_*` tables with 1,318 rows. Samples and table scopes were the former theory-map system (Arts, Humanities, Society, STEM, Technology, intellectual schools, movements, theories, and generation/review metadata), not reusable country records.

Before removal, every row from all 20 tables was exported and then copied to this recovery-only local backup outside the application and repository:

`C:\Users\james\AppData\Local\JJUniversity\backups\atlas\jju-retired-atlas-backup-20260903.json`

The original temporary export also remains at `C:\Users\james\AppData\Local\Temp\jju-retired-atlas-backup-20260903.json`.

Backup SHA-256:

`c6c706601269d04116f343f26040042633fa97cd1b3885ceb449fafa9fc2ac9a`

The migration at `supabase/migrations/20260903220000_retire_legacy_atlas.sql` requires the exact backed-up table set and row counts, checks catalog dependencies, and uses `DROP TABLE ... RESTRICT` inside one transaction. It does not use `CASCADE`.

The migration was applied successfully on September 3, 2026. A live catalog check afterward reported zero `public.atlas_*` tables. `public.set_updated_at()` remained present, and spot checks retained 333 book-catalog rows and 16 audio-track rows.

## Migration history reconciliation

The retirement was originally executed through the project's established reviewed-SQL workflow, so its successful schema change was not recorded in `supabase_migrations.schema_migrations`. On September 4, 2026, after committing the migration itself and independently confirming that the live `public` schema still contained no `atlas_*` tables, the remote ledger was repaired to mark version `20260903220000` as already applied. The migration SQL was not replayed and no application tables were changed during that reconciliation.

## Deliberately preserved

- `public.set_updated_at()`, because ordinary JJU book, reader, audio, and narrator tables use it
- Every non-Atlas table and all authentication/configuration infrastructure
- All four Storage buckets. A recursive inventory found 363 objects and zero Atlas paths, so there was nothing Atlas-specific to delete from Storage
- The general JJ University map route name, `/atlas`
- Generic site, theme, library, home, and Fiber CSS in `50-theme-library-atlas-entry.css`; its filename is historical, but its contents are shared and contain no Atlas selectors
- Ordinary manuscript, library-design, and source-credit uses of the word “atlas”
