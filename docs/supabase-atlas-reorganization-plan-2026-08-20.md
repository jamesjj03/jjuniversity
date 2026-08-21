# Supabase Atlas reorganization plan

Status: read-only design. The live database has not been reorganized or had Atlas data deleted.

The Supabase project display name is now **JJ University**. Its stable project reference remains `nzlmnbppynjmutuukmbt`; changing the display name does not change the API URL, keys, or deployed website.

## What the 21 Atlas tables are

They are not duplicate copies of one table. They form four layers:

### Published map model

- `atlas_territories`
- `atlas_branches`
- `atlas_maps`
- `atlas_groups`
- `atlas_contributors`
- `atlas_texts`
- `atlas_relations`

### Source corpus and lineage

- `atlas_sources`
- `atlas_source_chunks`
- `atlas_map_sources`
- `atlas_generation_runs`

### Planning and generation

- `atlas_map_recipes`
- `atlas_planned_maps`
- `atlas_generation_jobs`

### Review and quality control

- `atlas_category_reviews`
- `atlas_category_group_reviews`
- `atlas_quality_scorecards`
- `atlas_review_corrections`
- `atlas_recipe_feedback`
- `atlas_category_checkpoints`

The current app, admin code, and generation scripts address these names directly in dozens of queries. Deleting or casually renaming them would break Atlas.

## Desired end state

Move all 21 tables from `public` into a dedicated Postgres schema named `atlas`. Supabase's Table Editor can then switch schemas, so the ordinary JJU tables stop being buried under Atlas internals.

The `atlas` schema should have two access profiles:

- published map tables: anonymous read access limited to published records;
- source, generation, and review tables: service/admin access only.

This is organization and security hardening, not database consolidation. JJU should remain its own Supabase project.

## Safe migration sequence

1. Pull and version the complete live schema and policies under `supabase/schemas` and `supabase/migrations`.
2. Produce a count-and-hash snapshot of all 21 tables plus storage references.
3. Update every app query, admin query, and script to explicitly use `.schema("atlas")`.
4. Create and configure the `atlas` schema, grants, and RLS policies in a reviewed transaction.
5. Move the tables with `ALTER TABLE ... SET SCHEMA atlas` inside the same maintenance transaction.
6. Expose `atlas` through the Data API only if the public Atlas UI still reads it directly; otherwise route reads through a server boundary and leave it unexposed.
7. Run public Atlas, admin Atlas, import, generation, and review tests against a non-production branch/project.
8. Apply to production during a short announced maintenance window, then compare counts/hashes and verify RLS.

## Why this is not being applied casually

Moving a table changes the qualified name used by PostgREST and every Supabase client call. The foreign keys move with the table, but API calls do not rewrite themselves. A half-applied migration would make the public maps or the Atlas workbench look empty even though the rows still exist.

No live Atlas row should be deleted merely to make the dashboard prettier. Once the schema move is proven, truly obsolete generation/review records can be assessed separately with retention rules and an explicit deletion approval.

Official Supabase references:

- https://supabase.com/docs/guides/database/tables
- https://supabase.com/docs/guides/api/using-custom-schemas
- https://supabase.com/docs/guides/local-development/declarative-database-schemas
- https://supabase.com/docs/guides/deployment/database-migrations
