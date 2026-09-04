-- Retire the pre-2026 theory-map Atlas after the interactive world-atlas rebuild.
--
-- Recovery backup made before this migration:
-- C:\Users\james\AppData\Local\Temp\jju-retired-atlas-backup-20260903.json
-- SHA-256: c6c706601269d04116f343f26040042633fa97cd1b3885ceb449fafa9fc2ac9a
--
-- Safety rules:
--   * Abort if the Atlas table set or row counts changed after backup.
--   * Abort on recorded dependencies from non-Atlas tables, views, or routines.
--   * Drop explicitly with RESTRICT; never CASCADE.
--   * Preserve public.set_updated_at(), which is shared across JJ University.

begin;

do $$
declare
  expected_tables constant text[] := array[
    'atlas_branches',
    'atlas_category_checkpoints',
    'atlas_category_group_reviews',
    'atlas_category_reviews',
    'atlas_contributors',
    'atlas_generation_jobs',
    'atlas_generation_runs',
    'atlas_groups',
    'atlas_map_recipes',
    'atlas_map_sources',
    'atlas_maps',
    'atlas_planned_maps',
    'atlas_quality_scorecards',
    'atlas_recipe_feedback',
    'atlas_relations',
    'atlas_review_corrections',
    'atlas_source_chunks',
    'atlas_sources',
    'atlas_territories',
    'atlas_texts'
  ];
  discovered_tables text[];
  atlas_oids oid[];
  atlas_table text;
  actual_rows bigint;
  expected_rows bigint;
  dependency_report text;
begin
  select coalesce(array_agg(tablename order by tablename), array[]::text[])
  into discovered_tables
  from pg_catalog.pg_tables
  where schemaname = 'public'
    and tablename like 'atlas\_%' escape '\';

  if discovered_tables is distinct from expected_tables then
    raise exception 'Atlas retirement aborted: expected table set %, found %', expected_tables, discovered_tables;
  end if;

  select array_agg(c.oid)
  into atlas_oids
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(expected_tables)
    and c.relkind = 'r';

  foreach atlas_table in array expected_tables loop
    expected_rows := case atlas_table
      when 'atlas_territories' then 5
      when 'atlas_branches' then 11
      when 'atlas_maps' then 19
      when 'atlas_groups' then 85
      when 'atlas_contributors' then 244
      when 'atlas_texts' then 265
      when 'atlas_relations' then 70
      when 'atlas_sources' then 83
      when 'atlas_source_chunks' then 257
      when 'atlas_generation_runs' then 25
      when 'atlas_map_sources' then 81
      when 'atlas_map_recipes' then 8
      when 'atlas_planned_maps' then 10
      when 'atlas_generation_jobs' then 13
      when 'atlas_category_reviews' then 10
      when 'atlas_category_group_reviews' then 77
      when 'atlas_quality_scorecards' then 10
      when 'atlas_review_corrections' then 27
      when 'atlas_recipe_feedback' then 10
      when 'atlas_category_checkpoints' then 8
    end;
    execute format('select count(*) from public.%I', atlas_table) into actual_rows;
    if actual_rows <> expected_rows then
      raise exception 'Atlas retirement aborted: %.% has % rows; backup recorded %', 'public', atlas_table, actual_rows, expected_rows;
    end if;
  end loop;

  select string_agg(format('%s via %I', conrelid::regclass, conname), ', ' order by conrelid::regclass::text)
  into dependency_report
  from pg_catalog.pg_constraint
  where contype = 'f'
    and confrelid = any(atlas_oids)
    and not (conrelid = any(atlas_oids));
  if dependency_report is not null then
    raise exception 'Atlas retirement aborted: non-Atlas foreign keys found: %', dependency_report;
  end if;

  select string_agg(distinct format('%I.%I', n.nspname, c.relname), ', ')
  into dependency_report
  from pg_catalog.pg_depend d
  join pg_catalog.pg_rewrite r on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
  join pg_catalog.pg_class c on c.oid = r.ev_class
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where d.refobjid = any(atlas_oids)
    and not (c.oid = any(atlas_oids));
  if dependency_report is not null then
    raise exception 'Atlas retirement aborted: non-Atlas views found: %', dependency_report;
  end if;

  select string_agg(distinct format('%I.%I', n.nspname, p.proname), ', ')
  into dependency_report
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prokind in ('f', 'p')
    and position('atlas_' in lower(pg_get_functiondef(p.oid))) > 0;
  if dependency_report is not null then
    raise exception 'Atlas retirement aborted: routines still reference Atlas tables: %', dependency_report;
  end if;

  if to_regclass('cron.job') is not null then
    execute 'select string_agg(jobid::text, '','') from cron.job where position(''atlas_'' in lower(command)) > 0'
      into dependency_report;
    if dependency_report is not null then
      raise exception 'Atlas retirement aborted: cron jobs still reference Atlas tables: %', dependency_report;
    end if;
  end if;
end
$$;

drop table public.atlas_category_group_reviews restrict;
drop table public.atlas_quality_scorecards restrict;
drop table public.atlas_review_corrections restrict;
drop table public.atlas_category_checkpoints restrict;
drop table public.atlas_category_reviews restrict;
drop table public.atlas_recipe_feedback restrict;
drop table public.atlas_map_sources restrict;
drop table public.atlas_source_chunks restrict;
drop table public.atlas_generation_runs restrict;
drop table public.atlas_generation_jobs restrict;
drop table public.atlas_planned_maps restrict;
drop table public.atlas_map_recipes restrict;
drop table public.atlas_texts restrict;
drop table public.atlas_contributors restrict;
drop table public.atlas_relations restrict;
drop table public.atlas_groups restrict;
drop table public.atlas_maps restrict;
drop table public.atlas_branches restrict;
drop table public.atlas_territories restrict;
drop table public.atlas_sources restrict;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_tables
    where schemaname = 'public'
      and tablename like 'atlas\_%' escape '\'
  ) then
    raise exception 'Atlas retirement verification failed: an Atlas table remains.';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Atlas retirement verification failed: shared public.set_updated_at() is missing.';
  end if;
end
$$;

commit;
