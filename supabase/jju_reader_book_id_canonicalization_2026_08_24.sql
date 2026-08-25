-- Canonicalize the exact legacy mixed-case Reader book IDs observed live on
-- 2026-08-24 and backfill the seven exact catalog aliases missing from the
-- normalized alias table.
--
-- This migration is deliberately fail closed:
--   * it locks the affected tables while it preflights and merges;
--   * it accepts only the audited 28-row legacy state or the completed state;
--   * it archives every legacy row and both sides of all 22 PK collisions;
--   * it uses the existing last-write-wins triggers for collision merges;
--   * it refuses unknown/ambiguous catalog or alias mappings.

begin;

lock table public.book_catalog in share mode;
lock table public.book_slug_aliases in share row exclusive mode;
lock table public.reading_progress in share row exclusive mode;
lock table public.completed_books in share row exclusive mode;
lock table public.saved_books in share row exclusive mode;
lock table public.reading_sessions in share row exclusive mode;
lock table public.reader_bookmarks in share row exclusive mode;
lock table public.reader_notes in share row exclusive mode;
lock table public.reader_quotes in share row exclusive mode;

create temp table jju_legacy_book_id_map (
  legacy_book_id text primary key,
  canonical_book_id text not null unique,
  expect_progress boolean not null,
  expect_completed boolean not null,
  expect_bookmark boolean not null
) on commit drop;

insert into jju_legacy_book_id_map
  (legacy_book_id, canonical_book_id, expect_progress, expect_completed, expect_bookmark)
values
  ('Adolf',        'adolf',        true, true,  true),
  ('AI',           'ai',           true, true,  false),
  ('Bezos',        'bezos',        true, true,  false),
  ('CIA',          'cia',          true, false, false),
  ('Cult',         'cult',         true, false, false),
  ('Dopamine',     'dopamine',     true, true,  false),
  ('Edison',       'edison',       true, false, false),
  ('Egypt',        'egypt',        true, false, false),
  ('Franklin',     'franklin',     true, false, false),
  ('Harriet',      'harriet',      true, true,  false),
  ('Humans',       'humans',       true, false, false),
  ('InsideChina',  'insidechina',  true, false, false),
  ('JW',           'jw',           true, false, false),
  ('Lincoln',      'lincoln',      true, false, false),
  ('LR',           'lr',           true, false, false),
  ('Orwell',       'orwell',       true, false, false),
  ('Tamerlane',    'tamerlane',    true, false, false),
  ('Tesla',        'tesla',        true, false, false),
  ('Thanksgiving', 'thanksgiving', true, false, false),
  ('Tiktok',       'tiktok',       true, true,  false),
  ('Xmas',         'xmas',         true, false, false);

create temp view jju_invalid_reader_book_ids as
select 'reading_progress'::text source_table, book_id, count(*)::bigint row_count
from public.reading_progress row_value
where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
group by book_id
union all
select 'completed_books', book_id, count(*)::bigint
from public.completed_books row_value
where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
group by book_id
union all
select 'saved_books', book_id, count(*)::bigint
from public.saved_books row_value
where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
group by book_id
union all
select 'reading_sessions', book_id, count(*)::bigint
from public.reading_sessions row_value
where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
group by book_id
union all
select 'reader_bookmarks', book_id, count(*)::bigint
from public.reader_bookmarks row_value
where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
group by book_id
union all
select 'reader_notes', book_id, count(*)::bigint
from public.reader_notes row_value
where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
group by book_id
union all
select 'reader_quotes', book_id, count(*)::bigint
from public.reader_quotes row_value
where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
group by book_id;

do $preflight$
declare
  v_invalid_rows bigint;
  v_progress_collisions bigint;
  v_completed_collisions bigint;
  v_saved_collisions bigint;
begin
  if exists (
    select 1
    from jju_legacy_book_id_map mapping
    left join public.book_catalog book
      on book.id = mapping.canonical_book_id
    where book.id is null
       or mapping.canonical_book_id <> lower(mapping.legacy_book_id)
  ) then
    raise exception 'A canonical legacy book-ID target is missing or ambiguous.'
      using errcode = '23503';
  end if;

  select coalesce(sum(row_count), 0) into v_invalid_rows
  from jju_invalid_reader_book_ids;

  if v_invalid_rows not in (0, 28) then
    raise exception 'Expected the audited 28 invalid Reader rows or the completed state; found %.', v_invalid_rows
      using errcode = '55000';
  end if;

  if v_invalid_rows = 28 and exists (
    select 1
    from jju_invalid_reader_book_ids invalid
    left join jju_legacy_book_id_map mapping
      on mapping.legacy_book_id = invalid.book_id
    where invalid.row_count <> 1
       or mapping.legacy_book_id is null
       or case invalid.source_table
            when 'reading_progress' then not mapping.expect_progress
            when 'completed_books' then not mapping.expect_completed
            when 'reader_bookmarks' then not mapping.expect_bookmark
            else true
          end
  ) then
    raise exception 'The invalid Reader row set differs from the audited per-table mapping.'
      using errcode = '55000';
  end if;

  if v_invalid_rows = 28 and (
       (select count(*) from jju_invalid_reader_book_ids where source_table = 'reading_progress') <> 21
    or (select count(*) from jju_invalid_reader_book_ids where source_table = 'completed_books') <> 6
    or (select count(*) from jju_invalid_reader_book_ids where source_table = 'reader_bookmarks') <> 1
  ) then
    raise exception 'The invalid Reader row distribution differs from the audited 21/6/1 state.'
      using errcode = '55000';
  end if;

  select count(*) into v_progress_collisions
  from public.reading_progress legacy
  join jju_legacy_book_id_map mapping
    on mapping.legacy_book_id = legacy.book_id and mapping.expect_progress
  join public.reading_progress canonical
    on canonical.user_id = legacy.user_id
   and canonical.book_id = mapping.canonical_book_id;

  select count(*) into v_completed_collisions
  from public.completed_books legacy
  join jju_legacy_book_id_map mapping
    on mapping.legacy_book_id = legacy.book_id and mapping.expect_completed
  join public.completed_books canonical
    on canonical.user_id = legacy.user_id
   and canonical.book_id = mapping.canonical_book_id;

  select count(*) into v_saved_collisions
  from public.saved_books legacy
  join jju_legacy_book_id_map mapping
    on mapping.legacy_book_id = legacy.book_id
  join public.saved_books canonical
    on canonical.user_id = legacy.user_id
   and canonical.book_id = mapping.canonical_book_id;

  if v_invalid_rows = 28 and (
       v_progress_collisions <> 16
    or v_completed_collisions <> 6
    or v_saved_collisions <> 0
  ) then
    raise exception 'Expected audited collision counts 16/6/0; found %/%/%.',
      v_progress_collisions, v_completed_collisions, v_saved_collisions
      using errcode = '55000';
  end if;
end;
$preflight$;

create table if not exists public.jju_reader_book_id_canonicalization_audit (
  migration_key text not null,
  source_table text not null,
  record_role text not null check (record_role in ('legacy_source', 'canonical_collision')),
  source_key text not null,
  legacy_book_id text not null,
  canonical_book_id text not null,
  row_data jsonb not null,
  archived_at timestamptz not null default now(),
  primary key (migration_key, source_table, record_role, source_key)
);

alter table public.jju_reader_book_id_canonicalization_audit enable row level security;
revoke all on public.jju_reader_book_id_canonicalization_audit
  from public, anon, authenticated, service_role;
grant select on public.jju_reader_book_id_canonicalization_audit to service_role;

-- Archive every legacy row before changing it.
insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'reading_progress', 'legacy_source',
       jsonb_build_array(row_value.user_id, row_value.book_id)::text,
       row_value.book_id, mapping.canonical_book_id, to_jsonb(row_value)
from public.reading_progress row_value
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = row_value.book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'completed_books', 'legacy_source',
       jsonb_build_array(row_value.user_id, row_value.book_id)::text,
       row_value.book_id, mapping.canonical_book_id, to_jsonb(row_value)
from public.completed_books row_value
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = row_value.book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'saved_books', 'legacy_source',
       jsonb_build_array(row_value.user_id, row_value.book_id)::text,
       row_value.book_id, mapping.canonical_book_id, to_jsonb(row_value)
from public.saved_books row_value
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = row_value.book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'reading_sessions', 'legacy_source', row_value.id::text,
       row_value.book_id, mapping.canonical_book_id, to_jsonb(row_value)
from public.reading_sessions row_value
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = row_value.book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'reader_bookmarks', 'legacy_source',
       jsonb_build_array(row_value.user_id, row_value.key)::text,
       row_value.book_id, mapping.canonical_book_id, to_jsonb(row_value)
from public.reader_bookmarks row_value
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = row_value.book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'reader_notes', 'legacy_source',
       jsonb_build_array(row_value.user_id, row_value.key)::text,
       row_value.book_id, mapping.canonical_book_id, to_jsonb(row_value)
from public.reader_notes row_value
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = row_value.book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'reader_quotes', 'legacy_source',
       jsonb_build_array(row_value.user_id, row_value.id)::text,
       row_value.book_id, mapping.canonical_book_id, to_jsonb(row_value)
from public.reader_quotes row_value
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = row_value.book_id
on conflict do nothing;

-- Archive the canonical side of every primary-key collision as well, so the
-- exact pre-merge state is recoverable under service-role review.
insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'reading_progress', 'canonical_collision',
       jsonb_build_array(canonical.user_id, canonical.book_id)::text,
       legacy.book_id, mapping.canonical_book_id, to_jsonb(canonical)
from public.reading_progress legacy
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = legacy.book_id
join public.reading_progress canonical
  on canonical.user_id = legacy.user_id and canonical.book_id = mapping.canonical_book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'completed_books', 'canonical_collision',
       jsonb_build_array(canonical.user_id, canonical.book_id)::text,
       legacy.book_id, mapping.canonical_book_id, to_jsonb(canonical)
from public.completed_books legacy
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = legacy.book_id
join public.completed_books canonical
  on canonical.user_id = legacy.user_id and canonical.book_id = mapping.canonical_book_id
on conflict do nothing;

insert into public.jju_reader_book_id_canonicalization_audit
  (migration_key, source_table, record_role, source_key, legacy_book_id, canonical_book_id, row_data)
select 'reader-book-id-lowercase-v1', 'saved_books', 'canonical_collision',
       jsonb_build_array(canonical.user_id, canonical.book_id)::text,
       legacy.book_id, mapping.canonical_book_id, to_jsonb(canonical)
from public.saved_books legacy
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = legacy.book_id
join public.saved_books canonical
  on canonical.user_id = legacy.user_id and canonical.book_id = mapping.canonical_book_id
on conflict do nothing;

-- Collision-safe merge. The existing keep_newest_* BEFORE UPDATE triggers are
-- intentionally preserved and decide the winner by logical event time while
-- retaining the greatest accumulated actual_seconds value.
insert into public.reading_progress
  (user_id, book_id, section_index, section_count, progress_percent,
   estimated_minutes, actual_seconds, last_read_at, updated_at)
select legacy.user_id, mapping.canonical_book_id, legacy.section_index,
       legacy.section_count, legacy.progress_percent, legacy.estimated_minutes,
       legacy.actual_seconds, legacy.last_read_at, legacy.updated_at
from public.reading_progress legacy
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = legacy.book_id
on conflict (user_id, book_id) do update set
  section_index = excluded.section_index,
  section_count = excluded.section_count,
  progress_percent = excluded.progress_percent,
  estimated_minutes = excluded.estimated_minutes,
  actual_seconds = excluded.actual_seconds,
  last_read_at = excluded.last_read_at,
  updated_at = excluded.updated_at;

delete from public.reading_progress legacy
using jju_legacy_book_id_map mapping
where legacy.book_id = mapping.legacy_book_id;

insert into public.completed_books
  (user_id, book_id, completed_at, is_completed, updated_at, state_changed_at)
select legacy.user_id, mapping.canonical_book_id, legacy.completed_at,
       legacy.is_completed, legacy.updated_at, legacy.state_changed_at
from public.completed_books legacy
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = legacy.book_id
on conflict (user_id, book_id) do update set
  completed_at = excluded.completed_at,
  is_completed = excluded.is_completed,
  updated_at = excluded.updated_at,
  state_changed_at = excluded.state_changed_at;

delete from public.completed_books legacy
using jju_legacy_book_id_map mapping
where legacy.book_id = mapping.legacy_book_id;

insert into public.saved_books
  (user_id, book_id, is_saved, saved_at, state_changed_at, updated_at)
select legacy.user_id, mapping.canonical_book_id, legacy.is_saved,
       legacy.saved_at, legacy.state_changed_at, legacy.updated_at
from public.saved_books legacy
join jju_legacy_book_id_map mapping on mapping.legacy_book_id = legacy.book_id
on conflict (user_id, book_id) do update set
  is_saved = excluded.is_saved,
  saved_at = excluded.saved_at,
  state_changed_at = excluded.state_changed_at,
  updated_at = excluded.updated_at;

delete from public.saved_books legacy
using jju_legacy_book_id_map mapping
where legacy.book_id = mapping.legacy_book_id;

update public.reading_sessions row_value
set book_id = mapping.canonical_book_id
from jju_legacy_book_id_map mapping
where row_value.book_id = mapping.legacy_book_id;

update public.reader_bookmarks row_value
set book_id = mapping.canonical_book_id
from jju_legacy_book_id_map mapping
where row_value.book_id = mapping.legacy_book_id;

update public.reader_notes row_value
set book_id = mapping.canonical_book_id
from jju_legacy_book_id_map mapping
where row_value.book_id = mapping.legacy_book_id;

update public.reader_quotes row_value
set book_id = mapping.canonical_book_id
from jju_legacy_book_id_map mapping
where row_value.book_id = mapping.legacy_book_id;

-- The catalog arrays already contain these seven aliases. The normalized rows
-- were the missing half of the dual representation.
create temp table jju_missing_alias_map (
  alias text primary key,
  book_id text not null
) on commit drop;

insert into jju_missing_alias_map (alias, book_id)
values
  ('quantum-fields',     'field'),
  ('vibe-check',         'music'),
  ('nicotine',           'nic'),
  ('what-are-the-odds',  'odd'),
  ('youre-what',         'prenancy'),
  ('van-gogh',           'vangogh'),
  ('insert-coin',        'videogames');

do $alias_preflight$
begin
  if exists (
    select 1
    from jju_missing_alias_map mapping
    left join public.book_catalog book on book.id = mapping.book_id
    where book.id is null or not (mapping.alias = any(book.slug_aliases))
  ) then
    raise exception 'An audited alias is no longer present on its catalog book.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from jju_missing_alias_map mapping
    join public.book_slug_aliases alias_row on alias_row.alias = mapping.alias
    where alias_row.book_id <> mapping.book_id
  ) then
    raise exception 'An audited alias now belongs to a different book.'
      using errcode = '23505';
  end if;
end;
$alias_preflight$;

insert into public.book_slug_aliases (alias, book_id)
select alias, book_id from jju_missing_alias_map
on conflict (alias) do nothing;

do $postcheck$
declare
  v_invalid_rows bigint;
  v_legacy_audit_rows bigint;
  v_collision_audit_rows bigint;
begin
  select coalesce(sum(row_count), 0) into v_invalid_rows
  from jju_invalid_reader_book_ids;
  if v_invalid_rows <> 0 then
    raise exception 'Reader book-ID canonicalization left % invalid rows.', v_invalid_rows
      using errcode = '23503';
  end if;

  select count(*) filter (where record_role = 'legacy_source'),
         count(*) filter (where record_role = 'canonical_collision')
  into v_legacy_audit_rows, v_collision_audit_rows
  from public.jju_reader_book_id_canonicalization_audit
  where migration_key = 'reader-book-id-lowercase-v1';

  -- A later owner-authorized Clear All may legitimately erase only that
  -- reader's retained snapshots. Never recreate erased copies on a rerun, but
  -- reject counts beyond the sealed original 28/22 ceiling.
  if v_legacy_audit_rows > 28 or v_collision_audit_rows > 22 then
    raise exception 'Unexpected canonicalization audit counts %/%; maximum retained counts are 28/22.',
      v_legacy_audit_rows, v_collision_audit_rows
      using errcode = '55000';
  end if;

  if exists (
    select 1 from jju_missing_alias_map mapping
    left join public.book_slug_aliases alias_row
      on alias_row.alias = mapping.alias and alias_row.book_id = mapping.book_id
    where alias_row.alias is null
  ) then
    raise exception 'One or more audited alias rows were not backfilled.'
      using errcode = '55000';
  end if;
end;
$postcheck$;

commit;
