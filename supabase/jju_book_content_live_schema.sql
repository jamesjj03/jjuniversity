create table if not exists public.book_content_live (
  book_id text primary key references public.book_catalog(id) on delete cascade,
  version_number integer not null default 1,
  title text not null default '',
  creator text not null default '',
  description text not null default '',
  content_file text not null default '',
  content_path text not null default '',
  section_count integer not null default 0,
  word_count integer not null default 0,
  content jsonb not null default '{}'::jsonb,
  edit_message text not null default '',
  edited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.book_content_versions (
  id bigint generated always as identity primary key,
  book_id text not null references public.book_catalog(id) on delete cascade,
  version_number integer not null,
  title text not null default '',
  content_file text not null default '',
  content_path text not null default '',
  section_count integer not null default 0,
  word_count integer not null default 0,
  content jsonb not null default '{}'::jsonb,
  edit_message text not null default '',
  edited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (book_id, version_number)
);

create index if not exists book_content_versions_book_idx
on public.book_content_versions(book_id, version_number desc);

drop trigger if exists set_book_content_live_updated_at on public.book_content_live;
create trigger set_book_content_live_updated_at
before update on public.book_content_live
for each row execute function public.set_updated_at();

alter table public.book_content_live enable row level security;
alter table public.book_content_versions enable row level security;

drop policy if exists "book_content_live_public_read" on public.book_content_live;
create policy "book_content_live_public_read"
on public.book_content_live for select
using (
  exists (
    select 1 from public.book_catalog
    where book_catalog.id = book_content_live.book_id
      and book_catalog.status not in ('hidden', 'unavailable')
      and book_catalog.visibility <> 'private'
  )
);

drop policy if exists "book_content_live_admin_all" on public.book_content_live;
create policy "book_content_live_admin_all"
on public.book_content_live for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "book_content_versions_admin_all" on public.book_content_versions;
create policy "book_content_versions_admin_all"
on public.book_content_versions for all
using (public.is_admin())
with check (public.is_admin());

grant select on public.book_content_live to anon, authenticated;
grant select, insert, update, delete on public.book_content_live to authenticated;
grant select, insert, update, delete on public.book_content_versions to authenticated;
grant usage, select on sequence public.book_content_versions_id_seq to authenticated;
