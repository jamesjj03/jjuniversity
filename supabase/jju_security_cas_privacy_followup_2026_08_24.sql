-- Final security, exact-CAS, privacy, and telemetry hardening found by the
-- independent second pass of the 2026-08-24 JJ University audit.
--
-- Apply after jju_security_followup_2026_08_24.sql. The migration is
-- transactional and idempotent. It preserves all catalog, manuscript, Reader,
-- Auth, and Storage rows while closing unversioned client write paths.

begin;

-- PostgreSQL gives functions PUBLIC EXECUTE globally by default. A
-- schema-scoped revoke cannot subtract that global default, so fail closed at
-- the owning-role level as well as retaining the schema-specific defaults.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

-- Workshop catalog and manuscript writes are server-owned. Signed-in admins
-- must not be able to bypass the version checks with direct Data API writes.
revoke insert, update, delete on public.book_catalog from authenticated;
revoke insert, update, delete on public.book_slug_aliases from authenticated;
revoke insert, update, delete on public.book_content_live from authenticated;
revoke all privileges on public.book_content_versions from anon, authenticated;
revoke usage, select on sequence public.book_content_versions_id_seq from authenticated;

drop policy if exists "catalog_admin_all" on public.book_catalog;
drop policy if exists "slug_alias_admin_all" on public.book_slug_aliases;
drop policy if exists "book_content_live_admin_all" on public.book_content_live;
drop policy if exists "book_content_versions_admin_all" on public.book_content_versions;

do $live_content_shape$
begin
  if exists (
    select 1 from public.book_content_live
    where jsonb_typeof(content) is distinct from 'object'
       or case
            when jsonb_typeof(content->'sections') = 'array'
              then jsonb_array_length(content->'sections') = 0
            else true
          end
  ) then
    raise exception 'A live manuscript has no valid non-empty sections array.'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.book_content_live'::regclass
      and conname = 'book_content_live_sections_shape_check'
  ) then
    alter table public.book_content_live
      add constraint book_content_live_sections_shape_check
      check (
        jsonb_typeof(content) = 'object'
        and case
              when jsonb_typeof(content->'sections') = 'array'
                then jsonb_array_length(content->'sections') > 0
              else false
            end
      );
  end if;
end;
$live_content_shape$;

-- Normalize the current dual alias representation before installing the
-- invariant triggers. The audited live state is already exact; these updates
-- therefore make no row changes there and remain safe on a clean install.
do $alias_preflight$
begin
  if exists (
    select 1
    from public.book_slug_aliases
    where trim(alias) = '' or trim(book_id) = ''
  ) then
    raise exception 'A blank normalized slug alias or owner must be resolved before hardening.'
      using errcode = '23514';
  end if;

  if exists (
    select lower(trim(alias))
    from public.book_slug_aliases
    group by lower(trim(alias))
    having count(*) > 1
  ) then
    raise exception 'Case-insensitive duplicate slug aliases must be resolved before hardening.'
      using errcode = '23505';
  end if;

  if exists (
    select lower(trim(alias_value))
    from public.book_catalog book
    cross join lateral unnest(coalesce(book.slug_aliases, '{}'::text[])) alias_value
    where trim(alias_value) <> ''
    group by lower(trim(alias_value))
    having count(distinct book.id) > 1
  ) then
    raise exception 'The catalog arrays assign one normalized alias to multiple books.'
      using errcode = '23505';
  end if;
end;
$alias_preflight$;

update public.book_slug_aliases
set alias = lower(trim(alias)),
    book_id = lower(trim(book_id))
where alias is distinct from lower(trim(alias))
   or book_id is distinct from lower(trim(book_id));

update public.book_catalog book
set slug_aliases = (
  select coalesce(array_agg(alias_key order by first_position), '{}'::text[])
  from (
    select lower(trim(alias_value)) alias_key, min(alias_position) first_position
    from unnest(coalesce(book.slug_aliases, '{}'::text[])) with ordinality aliases(alias_value, alias_position)
    where trim(alias_value) <> ''
    group by lower(trim(alias_value))
  ) values_to_keep
)
where book.slug_aliases is distinct from (
  select coalesce(array_agg(alias_key order by first_position), '{}'::text[])
  from (
    select lower(trim(alias_value)) alias_key, min(alias_position) first_position
    from unnest(coalesce(book.slug_aliases, '{}'::text[])) with ordinality aliases(alias_value, alias_position)
    where trim(alias_value) <> ''
    group by lower(trim(alias_value))
  ) values_to_keep
);

delete from public.book_slug_aliases alias_row
where not exists (
  select 1
  from public.book_catalog book
  cross join lateral unnest(coalesce(book.slug_aliases, '{}'::text[])) alias_value
  where book.id = alias_row.book_id
    and lower(trim(alias_value)) = alias_row.alias
);

insert into public.book_slug_aliases (alias, book_id)
select distinct lower(trim(alias_value)), book.id
from public.book_catalog book
cross join lateral unnest(coalesce(book.slug_aliases, '{}'::text[])) alias_value
where trim(alias_value) <> ''
on conflict (alias) do update set book_id = excluded.book_id;

create unique index if not exists book_slug_aliases_alias_lower_uidx
  on public.book_slug_aliases (lower(alias));

create or replace function public.jju_normalize_catalog_slug_aliases()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  select coalesce(array_agg(alias_key order by first_position), '{}'::text[])
  into new.slug_aliases
  from (
    select lower(trim(alias_value)) alias_key, min(alias_position) first_position
    from unnest(coalesce(new.slug_aliases, '{}'::text[])) with ordinality aliases(alias_value, alias_position)
    where trim(alias_value) <> ''
    group by lower(trim(alias_value))
  ) normalized;
  return new;
end;
$$;

create or replace function public.jju_sync_catalog_slug_aliases()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.book_slug_aliases existing
    join unnest(coalesce(new.slug_aliases, '{}'::text[])) alias_value
      on lower(existing.alias) = alias_value
    where existing.book_id <> new.id
  ) then
    raise exception 'A slug alias is already owned by another book.'
      using errcode = '23505';
  end if;

  delete from public.book_slug_aliases existing
  where existing.book_id = new.id
    and not (existing.alias = any(coalesce(new.slug_aliases, '{}'::text[])));

  insert into public.book_slug_aliases (alias, book_id)
  select alias_value, new.id
  from unnest(coalesce(new.slug_aliases, '{}'::text[])) alias_value
  on conflict (alias) do nothing;

  if exists (
    select 1
    from unnest(coalesce(new.slug_aliases, '{}'::text[])) alias_value
    left join public.book_slug_aliases stored
      on stored.alias = alias_value and stored.book_id = new.id
    where stored.alias is null
  ) then
    raise exception 'A concurrent catalog save claimed one of these slug aliases.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create or replace function public.jju_normalize_slug_alias_row()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.alias := lower(trim(new.alias));
  new.book_id := lower(trim(new.book_id));
  if new.alias = '' or new.book_id = '' then
    raise exception 'A normalized slug alias and owner are required.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.jju_enforce_slug_alias_mirror()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.book_catalog book
      where book.id = old.book_id and old.alias = any(book.slug_aliases)
    ) then
      raise exception 'Remove the alias from book_catalog.slug_aliases first.'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and (old.alias is distinct from new.alias or old.book_id is distinct from new.book_id)
     and exists (
       select 1 from public.book_catalog old_book
       where old_book.id = old.book_id and old.alias = any(old_book.slug_aliases)
     ) then
    raise exception 'Remove the old alias from its catalog array before reassigning it.'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.book_catalog book
    where book.id = new.book_id and new.alias = any(book.slug_aliases)
  ) then
    raise exception 'A normalized alias row must match its catalog array.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists jju_normalize_catalog_slug_aliases on public.book_catalog;
create trigger jju_normalize_catalog_slug_aliases
before insert or update of slug_aliases on public.book_catalog
for each row execute function public.jju_normalize_catalog_slug_aliases();

drop trigger if exists jju_sync_catalog_slug_aliases on public.book_catalog;
create trigger jju_sync_catalog_slug_aliases
after insert or update of slug_aliases on public.book_catalog
for each row execute function public.jju_sync_catalog_slug_aliases();

drop trigger if exists jju_10_normalize_slug_alias_row on public.book_slug_aliases;
create trigger jju_10_normalize_slug_alias_row
before insert or update on public.book_slug_aliases
for each row execute function public.jju_normalize_slug_alias_row();

drop trigger if exists jju_20_enforce_slug_alias_mirror on public.book_slug_aliases;
create trigger jju_20_enforce_slug_alias_mirror
before insert or update or delete on public.book_slug_aliases
for each row execute function public.jju_enforce_slug_alias_mirror();

revoke execute on function public.jju_normalize_catalog_slug_aliases()
  from public, anon, authenticated, service_role;
revoke execute on function public.jju_sync_catalog_slug_aliases()
  from public, anon, authenticated, service_role;
revoke execute on function public.jju_normalize_slug_alias_row()
  from public, anon, authenticated, service_role;
revoke execute on function public.jju_enforce_slug_alias_mirror()
  from public, anon, authenticated, service_role;

-- One transaction now archives the old live manuscript and advances its exact
-- version. The protected Workshop server is the only caller.
create or replace function public.jju_admin_save_book_content(
  p_expected_version integer,
  p_book_id text,
  p_content jsonb,
  p_content_file text,
  p_content_path text,
  p_message text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_book_id text := lower(trim(coalesce(p_book_id, '')));
  v_current public.book_content_live%rowtype;
  v_next_version integer;
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'A non-negative expected manuscript version is required.'
      using errcode = '22023';
  end if;
  if v_book_id = ''
     or jsonb_typeof(p_content) is distinct from 'object'
     or lower(trim(coalesce(p_content->>'id', ''))) <> v_book_id
     or jsonb_typeof(p_content->'sections') is distinct from 'array' then
    raise exception 'The manuscript payload is malformed or does not match its book.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_content->'sections') = 0 then
    raise exception 'The manuscript payload is malformed or does not match its book.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.book_catalog where id = v_book_id) then
    raise exception 'The manuscript book does not exist in the catalog.'
      using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('jju-book-content:' || v_book_id, 0));

  select * into v_current
  from public.book_content_live
  where book_id = v_book_id
  for update;

  if found then
    if v_current.version_number is distinct from p_expected_version then
      raise exception 'The manuscript changed after it was loaded.'
        using errcode = '40001';
    end if;
    v_next_version := p_expected_version + 1;

    if exists (
      select 1
      from public.book_content_versions archived
      where archived.book_id = v_current.book_id
        and archived.version_number = v_current.version_number
        and (
          archived.title is distinct from v_current.title
          or archived.content_file is distinct from v_current.content_file
          or archived.content_path is distinct from v_current.content_path
          or archived.section_count is distinct from v_current.section_count
          or archived.word_count is distinct from v_current.word_count
          or archived.content is distinct from v_current.content
          or archived.edit_message is distinct from v_current.edit_message
          or archived.edited_by is distinct from v_current.edited_by
        )
    ) then
      raise exception 'The existing manuscript history slot does not match the live version.'
        using errcode = '40001';
    end if;

    insert into public.book_content_versions (
      book_id, version_number, title, content_file, content_path,
      section_count, word_count, content, edit_message, edited_by, created_at
    ) values (
      v_current.book_id, v_current.version_number, v_current.title,
      v_current.content_file, v_current.content_path, v_current.section_count,
      v_current.word_count, v_current.content, v_current.edit_message,
      v_current.edited_by, v_current.updated_at
    )
    on conflict (book_id, version_number) do nothing;

    update public.book_content_live
    set version_number = v_next_version,
        title = coalesce(p_content->>'title', ''),
        creator = coalesce(p_content->>'creator', ''),
        description = coalesce(p_content->>'description', ''),
        content_file = coalesce(p_content_file, ''),
        content_path = coalesce(p_content_path, ''),
        section_count = coalesce((p_content->>'sectionCount')::integer, jsonb_array_length(p_content->'sections')),
        word_count = coalesce((p_content->>'wordCount')::integer, 0),
        content = p_content,
        edit_message = coalesce(p_message, ''),
        updated_at = now()
    where book_id = v_book_id;
  else
    if p_expected_version <> 0 then
      raise exception 'The manuscript changed after it was loaded.'
        using errcode = '40001';
    end if;
    v_next_version := 1;
    insert into public.book_content_live (
      book_id, version_number, title, creator, description, content_file,
      content_path, section_count, word_count, content, edit_message, updated_at
    ) values (
      v_book_id, v_next_version, coalesce(p_content->>'title', ''),
      coalesce(p_content->>'creator', ''), coalesce(p_content->>'description', ''),
      coalesce(p_content_file, ''), coalesce(p_content_path, ''),
      coalesce((p_content->>'sectionCount')::integer, jsonb_array_length(p_content->'sections')),
      coalesce((p_content->>'wordCount')::integer, 0), p_content,
      coalesce(p_message, ''), now()
    );
  end if;

  return v_next_version;
end;
$$;

revoke execute on function public.jju_admin_save_book_content(integer, text, jsonb, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.jju_admin_save_book_content(integer, text, jsonb, text, text, text)
  to service_role;

-- Bind the one-time canonicalization evidence to its owner. This keeps the
-- retained audit recoverable today, makes account deletion cascade, and gives
-- an owner an explicit erasure path without exposing the rows to clients.
alter table public.jju_reader_book_id_canonicalization_audit
  add column if not exists user_id uuid;

update public.jju_reader_book_id_canonicalization_audit
set user_id = nullif(row_data->>'user_id', '')::uuid
where user_id is null;

do $audit_owner_preflight$
begin
  if exists (
    select 1 from public.jju_reader_book_id_canonicalization_audit
    where user_id is null
  ) then
    raise exception 'A canonicalization audit row has no recoverable owner.'
      using errcode = '23502';
  end if;
end;
$audit_owner_preflight$;

alter table public.jju_reader_book_id_canonicalization_audit
  alter column user_id set not null;

do $audit_owner_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.jju_reader_book_id_canonicalization_audit'::regclass
      and conname = 'jju_reader_canonicalization_audit_user_id_fkey'
  ) then
    alter table public.jju_reader_book_id_canonicalization_audit
      add constraint jju_reader_canonicalization_audit_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$audit_owner_fk$;

create index if not exists jju_reader_canonicalization_audit_user_idx
  on public.jju_reader_book_id_canonicalization_audit(user_id);

create or replace function public.jju_set_canonicalization_audit_user_id()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.user_id is null then
    new.user_id := nullif(new.row_data->>'user_id', '')::uuid;
  end if;
  if new.user_id is null then
    raise exception 'A canonicalization audit row requires an owner.'
      using errcode = '23502';
  end if;
  return new;
end;
$$;

drop trigger if exists jju_set_canonicalization_audit_user_id
  on public.jju_reader_book_id_canonicalization_audit;
create trigger jju_set_canonicalization_audit_user_id
before insert or update of row_data, user_id
on public.jju_reader_book_id_canonicalization_audit
for each row execute function public.jju_set_canonicalization_audit_user_id();

revoke execute on function public.jju_set_canonicalization_audit_user_id()
  from public, anon, authenticated, service_role;

create or replace function public.clear_reader_canonicalization_audit(expected_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
begin
  if expected_user_id is null or expected_user_id is distinct from auth.uid() then
    raise exception 'Authenticated user changed before Reader audit clear.'
      using errcode = '42501';
  end if;

  delete from public.jju_reader_book_id_canonicalization_audit
  where user_id = expected_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.clear_reader_canonicalization_audit(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_reader_canonicalization_audit(uuid)
  to authenticated;

-- Reading analytics remains clearly labeled client telemetry, but direct row
-- fabrication is replaced by a bounded, deduplicated, catalog-checked RPC.
alter table public.reading_sessions add column if not exists dedupe_key text;
update public.reading_sessions
set dedupe_key = md5('legacy:' || id::text)
where dedupe_key is null;
alter table public.reading_sessions alter column dedupe_key set not null;

create unique index if not exists reading_sessions_user_dedupe_uidx
  on public.reading_sessions(user_id, dedupe_key);
create index if not exists reading_sessions_user_ended_idx
  on public.reading_sessions(user_id, ended_at desc);

do $reading_book_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reading_sessions'::regclass
      and conname = 'reading_sessions_book_id_fkey'
  ) then
    alter table public.reading_sessions
      add constraint reading_sessions_book_id_fkey
      foreign key (book_id) references public.book_catalog(id) on delete cascade;
  end if;
end;
$reading_book_fk$;

drop policy if exists "reading_sessions_insert_own" on public.reading_sessions;
revoke insert, update on public.reading_sessions from authenticated;
revoke usage, select on sequence public.reading_sessions_id_seq from authenticated;

create or replace function public.record_reading_session(
  p_book_id text,
  p_source text,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_book_id text := lower(trim(coalesce(p_book_id, '')));
  v_now timestamptz := statement_timestamp();
  v_seconds integer;
  v_ordinal bigint;
  v_dedupe_key text;
  v_id bigint;
  v_recent_count bigint;
  v_daily_source_count bigint;
begin
  if v_user_id is null then
    raise exception 'Sign in before recording reading activity.'
      using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('reader_engaged_minute', 'qualified_read') then
    raise exception 'Unknown reading-activity source.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.book_catalog book
    where book.id = v_book_id
      and book.status = 'ready'
      and book.visibility <> 'private'
  ) then
    raise exception 'Reading activity requires a ready public book.'
      using errcode = '23503';
  end if;
  if p_started_at is null or p_ended_at is null
     or p_started_at > p_ended_at
     or p_ended_at > p_started_at + interval '24 hours'
     or p_started_at < v_now - interval '24 hours'
     or p_started_at > v_now + interval '2 minutes'
     or p_ended_at < v_now - interval '10 minutes'
     or p_ended_at > v_now + interval '2 minutes' then
    raise exception 'Reading-activity timestamps are outside the accepted live window.'
      using errcode = '22023';
  end if;

  if p_source = 'reader_engaged_minute' then
    if p_ended_at < p_started_at + interval '60 seconds' then
      raise exception 'An engaged-minute event requires at least 60 seconds.'
        using errcode = '22023';
    end if;
    v_seconds := 60;
    v_ordinal := floor(extract(epoch from (p_ended_at - p_started_at)) / 60)::bigint;
  else
    if p_ended_at < p_started_at + interval '120 seconds' then
      raise exception 'A qualified-read event requires at least 120 seconds.'
        using errcode = '22023';
    end if;
    v_seconds := 0;
    v_ordinal := 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  v_dedupe_key := md5(concat_ws('|', v_user_id::text, v_book_id, p_source,
    date_trunc('second', p_started_at)::text, v_ordinal::text));
  select id into v_id
  from public.reading_sessions
  where user_id = v_user_id and dedupe_key = v_dedupe_key;
  if found then
    return v_id;
  end if;

  select count(*) into v_recent_count
  from public.reading_sessions
  where user_id = v_user_id and ended_at >= v_now - interval '10 minutes';
  if v_recent_count >= 15 then
    raise exception 'Reading activity is arriving too quickly. Retry shortly.'
      using errcode = '54000';
  end if;

  select count(*) into v_daily_source_count
  from public.reading_sessions
  where user_id = v_user_id
    and book_id = v_book_id
    and source = p_source
    and ended_at >= date_trunc('day', v_now);
  if (p_source = 'qualified_read' and v_daily_source_count >= 20)
     or (p_source = 'reader_engaged_minute' and v_daily_source_count >= 1440) then
    raise exception 'The daily reading-activity limit was reached.'
      using errcode = '54000';
  end if;

  insert into public.reading_sessions (
    user_id, book_id, seconds, started_at, ended_at, source, dedupe_key
  ) values (
    v_user_id, v_book_id, v_seconds,
    v_now - (p_ended_at - p_started_at), v_now, p_source, v_dedupe_key
  )
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.reading_sessions
    where user_id = v_user_id and dedupe_key = v_dedupe_key;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.record_reading_session(text, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_reading_session(text, text, timestamptz, timestamptz)
  to authenticated;

commit;
