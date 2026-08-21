-- Atomic Workshop catalog saves and draft creation.
-- Apply after jju_core_schema.sql and jju_book_content_live_schema.sql.

begin;

create table if not exists public.jju_admin_document_revisions (
  document_key text primary key,
  revision text not null,
  updated_at timestamptz not null default now()
);

alter table public.jju_admin_document_revisions enable row level security;

insert into public.jju_admin_document_revisions (document_key, revision)
values ('book_catalog', gen_random_uuid()::text)
on conflict (document_key) do nothing;

create or replace function public.jju_admin_save_book_catalog(
  p_expected_revision text,
  p_books jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_revision text;
  v_next_revision text := gen_random_uuid()::text;
begin
  if jsonb_typeof(p_books) <> 'array' or jsonb_array_length(p_books) = 0 then
    raise exception 'Catalog payload must be a non-empty array.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_books) as item
    where trim(coalesce(item->>'id', '')) = ''
  ) then
    raise exception 'Catalog payload contains a book without an id.' using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_books)
  ) <> (
    select count(distinct lower(trim(item->>'id')))
    from jsonb_array_elements(p_books) as item
  ) then
    raise exception 'Catalog payload contains duplicate book ids.' using errcode = '22023';
  end if;

  select revision
  into v_current_revision
  from public.jju_admin_document_revisions
  where document_key = 'book_catalog'
  for update;

  if not found then
    raise exception 'Workshop catalog revision is not initialized.' using errcode = '55000';
  end if;

  if v_current_revision is distinct from p_expected_revision then
    raise exception 'The catalog changed after it was loaded.' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.book_catalog current_book
    where not exists (
      select 1
      from jsonb_array_elements(p_books) as item
      where lower(trim(item->>'id')) = current_book.id
    )
  ) then
    raise exception 'Catalog deletion is not supported by this Workshop save.' using errcode = '22023';
  end if;

  insert into public.book_catalog (
    id,
    slug,
    title,
    subtitle,
    creator,
    description,
    status,
    visibility,
    archive_category,
    primary_category,
    cover_file,
    book_file,
    content_key,
    word_count,
    reading_minutes,
    reading_label,
    chapter_count,
    tags,
    slug_aliases,
    metadata
  )
  select
    lower(trim(item->>'id')),
    trim(item->>'slug'),
    trim(item->>'title'),
    coalesce(item->>'subtitle', ''),
    coalesce(nullif(trim(item->>'creator'), ''), 'James Johnson'),
    coalesce(item->>'description', ''),
    coalesce(nullif(trim(item->>'status'), ''), 'ready'),
    coalesce(nullif(trim(item->>'visibility'), ''), 'main'),
    coalesce(item->>'archive_category', ''),
    coalesce(nullif(trim(item->>'primary_category'), ''), 'Library'),
    coalesce(item->>'cover_file', ''),
    coalesce(item->>'book_file', ''),
    coalesce(item->>'content_key', ''),
    coalesce((item->>'word_count')::integer, 0),
    coalesce((item->>'reading_minutes')::integer, 0),
    coalesce(item->>'reading_label', ''),
    coalesce((item->>'chapter_count')::integer, 0),
    coalesce(array(select jsonb_array_elements_text(coalesce(item->'tags', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(item->'slug_aliases', '[]'::jsonb))), '{}'::text[]),
    coalesce(item->'metadata', '{}'::jsonb)
  from jsonb_array_elements(p_books) as item
  on conflict (id) do update set
    slug = excluded.slug,
    title = excluded.title,
    subtitle = excluded.subtitle,
    creator = excluded.creator,
    description = excluded.description,
    status = excluded.status,
    visibility = excluded.visibility,
    archive_category = excluded.archive_category,
    primary_category = excluded.primary_category,
    cover_file = excluded.cover_file,
    book_file = excluded.book_file,
    content_key = excluded.content_key,
    word_count = excluded.word_count,
    reading_minutes = excluded.reading_minutes,
    reading_label = excluded.reading_label,
    chapter_count = excluded.chapter_count,
    tags = excluded.tags,
    slug_aliases = excluded.slug_aliases,
    metadata = excluded.metadata;

  insert into public.book_slug_aliases (alias, book_id)
  select distinct alias_value, lower(trim(item->>'id'))
  from jsonb_array_elements(p_books) as item
  cross join lateral jsonb_array_elements_text(coalesce(item->'slug_aliases', '[]'::jsonb)) as aliases(alias_value)
  where trim(alias_value) <> ''
  on conflict (alias) do update set book_id = excluded.book_id;

  update public.jju_admin_document_revisions
  set revision = v_next_revision,
      updated_at = now()
  where document_key = 'book_catalog';

  return v_next_revision;
end;
$$;

create or replace function public.jju_admin_create_book_draft(
  p_expected_revision text,
  p_book jsonb,
  p_content jsonb,
  p_content_file text,
  p_content_path text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_revision text;
  v_next_revision text := gen_random_uuid()::text;
  v_book_id text := lower(trim(coalesce(p_book->>'id', '')));
begin
  if v_book_id = '' or trim(coalesce(p_book->>'title', '')) = '' then
    raise exception 'Draft catalog row is missing its id or title.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_content) <> 'object'
     or coalesce(p_content->>'id', '') = ''
     or lower(trim(p_content->>'id')) <> v_book_id
     or jsonb_typeof(p_content->'sections') <> 'array'
     or jsonb_array_length(p_content->'sections') = 0 then
    raise exception 'Draft content is malformed or empty.' using errcode = '22023';
  end if;

  select revision
  into v_current_revision
  from public.jju_admin_document_revisions
  where document_key = 'book_catalog'
  for update;

  if not found then
    raise exception 'Workshop catalog revision is not initialized.' using errcode = '55000';
  end if;
  if v_current_revision is distinct from p_expected_revision then
    raise exception 'The catalog changed after it was loaded.' using errcode = '40001';
  end if;
  if exists (select 1 from public.book_catalog where id = v_book_id) then
    raise exception 'A book with id "%" already exists.', v_book_id using errcode = '23505';
  end if;

  insert into public.book_catalog (
    id, slug, title, subtitle, creator, description, status, visibility,
    archive_category, primary_category, cover_file, book_file, content_key,
    word_count, reading_minutes, reading_label, chapter_count, tags,
    slug_aliases, metadata
  ) values (
    v_book_id,
    trim(p_book->>'slug'),
    trim(p_book->>'title'),
    coalesce(p_book->>'subtitle', ''),
    coalesce(nullif(trim(p_book->>'creator'), ''), 'James Johnson'),
    coalesce(p_book->>'description', ''),
    coalesce(nullif(trim(p_book->>'status'), ''), 'hidden'),
    coalesce(nullif(trim(p_book->>'visibility'), ''), 'main'),
    coalesce(p_book->>'archive_category', ''),
    coalesce(nullif(trim(p_book->>'primary_category'), ''), 'Library'),
    coalesce(p_book->>'cover_file', ''),
    coalesce(p_book->>'book_file', ''),
    coalesce(p_book->>'content_key', ''),
    coalesce((p_book->>'word_count')::integer, 0),
    coalesce((p_book->>'reading_minutes')::integer, 0),
    coalesce(p_book->>'reading_label', ''),
    coalesce((p_book->>'chapter_count')::integer, 0),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_book->'tags', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_book->'slug_aliases', '[]'::jsonb))), '{}'::text[]),
    coalesce(p_book->'metadata', '{}'::jsonb)
  );

  insert into public.book_slug_aliases (alias, book_id)
  select distinct alias_value, v_book_id
  from jsonb_array_elements_text(coalesce(p_book->'slug_aliases', '[]'::jsonb)) as aliases(alias_value)
  where trim(alias_value) <> ''
  on conflict (alias) do update set book_id = excluded.book_id;

  insert into public.book_content_live (
    book_id, version_number, title, creator, description, content_file,
    content_path, section_count, word_count, content, edit_message, updated_at
  ) values (
    v_book_id,
    1,
    coalesce(p_content->>'title', p_book->>'title'),
    coalesce(p_content->>'creator', p_book->>'creator', 'James Johnson'),
    coalesce(p_content->>'description', p_book->>'description', ''),
    p_content_file,
    p_content_path,
    coalesce((p_content->>'sectionCount')::integer, jsonb_array_length(p_content->'sections')),
    coalesce((p_content->>'wordCount')::integer, 0),
    p_content,
    coalesce(p_message, 'Create Workshop draft'),
    now()
  );

  update public.jju_admin_document_revisions
  set revision = v_next_revision,
      updated_at = now()
  where document_key = 'book_catalog';

  return jsonb_build_object(
    'revision', v_next_revision,
    'contentVersion', 1
  );
end;
$$;

revoke all on table public.jju_admin_document_revisions from anon, authenticated;
grant select on table public.jju_admin_document_revisions to service_role;
revoke execute on function public.jju_admin_save_book_catalog(text, jsonb) from public, anon, authenticated;
revoke execute on function public.jju_admin_create_book_draft(text, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.jju_admin_save_book_catalog(text, jsonb) to service_role;
grant execute on function public.jju_admin_create_book_draft(text, jsonb, jsonb, text, text, text) to service_role;

commit;
