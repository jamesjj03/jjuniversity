-- JJ University core backend schema.
-- Run in the Supabase SQL Editor for the jjuniversity project.
-- This is designed to be additive and safe to rerun.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'JJU Reader',
  role text not null default 'reader' check (role in ('reader', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists display_name text not null default 'JJU Reader';
alter table public.profiles add column if not exists role text not null default 'reader';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_role_check check (role in ('reader', 'admin'));
  end if;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create table if not exists public.book_catalog (
  id text primary key,
  slug text not null unique,
  title text not null,
  subtitle text not null default '',
  creator text not null default 'James Johnson',
  description text not null default '',
  status text not null default 'ready',
  visibility text not null default 'main',
  archive_category text not null default '',
  primary_category text not null default 'Library',
  cover_file text not null default '',
  book_file text not null default '',
  content_key text not null default '',
  word_count integer not null default 0,
  reading_minutes integer not null default 0,
  reading_label text not null default '',
  chapter_count integer not null default 0,
  tags text[] not null default '{}',
  slug_aliases text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.book_catalog add column if not exists primary_category text not null default 'Library';

create table if not exists public.book_slug_aliases (
  alias text primary key,
  book_id text not null references public.book_catalog(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.series (
  id text primary key,
  slug text not null unique,
  title text not null,
  description text not null default '',
  level text not null default 'starter',
  kind text not null default 'series',
  tags text[] not null default '{}',
  published boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.series_books (
  series_id text not null references public.series(id) on delete cascade,
  book_id text not null references public.book_catalog(id) on delete cascade,
  position integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  primary key (series_id, book_id)
);

create table if not exists public.print_products (
  slug text primary key,
  title text not null,
  kicker text not null default '',
  subtitle text not null default '',
  description text not null default '',
  status text not null default 'draft',
  price_cents integer,
  currency text not null default 'usd',
  stripe_product_id text,
  stripe_price_id text,
  lulu_project_id text,
  lulu_pod_package_id text,
  public_interior_url text,
  public_cover_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.print_products add column if not exists lulu_pod_package_id text;
alter table public.print_products add column if not exists public_interior_url text;
alter table public.print_products add column if not exists public_cover_url text;

create table if not exists public.print_product_books (
  product_slug text not null references public.print_products(slug) on delete cascade,
  book_id text not null references public.book_catalog(id) on delete cascade,
  position integer not null default 0,
  primary key (product_slug, book_id)
);

create table if not exists public.print_orders (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  product_slug text references public.print_products(slug),
  status text not null default 'created',
  amount_cents integer,
  currency text not null default 'usd',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  lulu_print_job_id text,
  shipping_address jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  section_index integer not null default 0,
  section_count integer,
  progress_percent integer,
  estimated_minutes integer,
  actual_seconds integer not null default 0,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.completed_books (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table if not exists public.saved_paths (
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, path_id)
);

create table if not exists public.reading_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  seconds integer not null check (seconds >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now(),
  source text not null default 'reader'
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists book_catalog_slug_idx on public.book_catalog(slug);
create index if not exists book_catalog_status_idx on public.book_catalog(status, visibility);
create index if not exists book_catalog_tags_idx on public.book_catalog using gin(tags);
create index if not exists series_slug_idx on public.series(slug);
create index if not exists series_books_book_id_idx on public.series_books(book_id);
create index if not exists print_orders_user_id_idx on public.print_orders(user_id);
create index if not exists print_orders_status_idx on public.print_orders(status);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_book_catalog_updated_at on public.book_catalog;
create trigger set_book_catalog_updated_at
before update on public.book_catalog
for each row execute function public.set_updated_at();

drop trigger if exists set_series_updated_at on public.series;
create trigger set_series_updated_at
before update on public.series
for each row execute function public.set_updated_at();

drop trigger if exists set_print_products_updated_at on public.print_products;
create trigger set_print_products_updated_at
before update on public.print_products
for each row execute function public.set_updated_at();

drop trigger if exists set_print_orders_updated_at on public.print_orders;
create trigger set_print_orders_updated_at
before update on public.print_orders
for each row execute function public.set_updated_at();

drop trigger if exists set_saved_paths_updated_at on public.saved_paths;
create trigger set_saved_paths_updated_at
before update on public.saved_paths
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), 'JJU Reader')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.book_catalog enable row level security;
alter table public.book_slug_aliases enable row level security;
alter table public.series enable row level security;
alter table public.series_books enable row level security;
alter table public.print_products enable row level security;
alter table public.print_product_books enable row level security;
alter table public.print_orders enable row level security;
alter table public.reading_progress enable row level security;
alter table public.completed_books enable row level security;
alter table public.saved_paths enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.app_settings enable row level security;

-- Remove policy names created by the older account-only schema. PostgreSQL
-- combines permissive policies with OR, so leaving the old insert/update
-- policies in place would weaken the role='reader' checks below.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_insert_own_reader" on public.profiles;
create policy "profiles_insert_own_reader"
on public.profiles for insert
to authenticated
with check (auth.uid() = id and role = 'reader');

drop policy if exists "profiles_update_own_reader" on public.profiles;
create policy "profiles_update_own_reader"
on public.profiles for update
to authenticated
using (auth.uid() = id and role = 'reader')
with check (auth.uid() = id and role = 'reader');

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "book_catalog_public_read" on public.book_catalog;
create policy "book_catalog_public_read"
on public.book_catalog for select
to anon, authenticated
using (status not in ('hidden', 'unavailable') and visibility <> 'private');

drop policy if exists "book_slug_aliases_public_read" on public.book_slug_aliases;
create policy "book_slug_aliases_public_read"
on public.book_slug_aliases for select
to anon, authenticated
using (
  exists (
    select 1 from public.book_catalog
    where book_catalog.id = book_slug_aliases.book_id
      and book_catalog.status not in ('hidden', 'unavailable')
      and book_catalog.visibility <> 'private'
  )
);

drop policy if exists "series_public_read" on public.series;
create policy "series_public_read"
on public.series for select
to anon, authenticated
using (published);

drop policy if exists "series_books_public_read" on public.series_books;
create policy "series_books_public_read"
on public.series_books for select
to anon, authenticated
using (
  exists (
    select 1 from public.series
    where series.id = series_books.series_id
      and series.published
  )
  and exists (
    select 1 from public.book_catalog
    where book_catalog.id = series_books.book_id
      and book_catalog.status not in ('hidden', 'unavailable')
      and book_catalog.visibility <> 'private'
  )
);

drop policy if exists "print_products_public_read" on public.print_products;
create policy "print_products_public_read"
on public.print_products for select
to anon, authenticated
using (status in ('published', 'coming-soon'));

drop policy if exists "print_product_books_public_read" on public.print_product_books;
create policy "print_product_books_public_read"
on public.print_product_books for select
to anon, authenticated
using (
  exists (
    select 1 from public.print_products
    where print_products.slug = print_product_books.product_slug
      and print_products.status in ('published', 'coming-soon')
  )
  and exists (
    select 1 from public.book_catalog
    where book_catalog.id = print_product_books.book_id
      and book_catalog.status not in ('hidden', 'unavailable')
      and book_catalog.visibility <> 'private'
  )
);

drop policy if exists "catalog_admin_all" on public.book_catalog;
create policy "catalog_admin_all"
on public.book_catalog for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "slug_alias_admin_all" on public.book_slug_aliases;
create policy "slug_alias_admin_all"
on public.book_slug_aliases for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "series_admin_all" on public.series;
create policy "series_admin_all"
on public.series for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "series_books_admin_all" on public.series_books;
create policy "series_books_admin_all"
on public.series_books for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "print_products_admin_all" on public.print_products;
create policy "print_products_admin_all"
on public.print_products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "print_product_books_admin_all" on public.print_product_books;
create policy "print_product_books_admin_all"
on public.print_product_books for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "print_orders_select_own_or_admin" on public.print_orders;
create policy "print_orders_select_own_or_admin"
on public.print_orders for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "print_orders_admin_all" on public.print_orders;
create policy "print_orders_admin_all"
on public.print_orders for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "reading_progress_all_own" on public.reading_progress;
create policy "reading_progress_all_own"
on public.reading_progress for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "completed_books_all_own" on public.completed_books;
create policy "completed_books_all_own"
on public.completed_books for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "saved_paths_all_own" on public.saved_paths;
create policy "saved_paths_all_own"
on public.saved_paths for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "reading_sessions_all_own" on public.reading_sessions;
create policy "reading_sessions_all_own"
on public.reading_sessions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "app_settings_admin_all" on public.app_settings;
create policy "app_settings_admin_all"
on public.app_settings for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.book_catalog to anon, authenticated;
grant select on public.book_slug_aliases to anon, authenticated;
grant select on public.series to anon, authenticated;
grant select on public.series_books to anon, authenticated;
grant select on public.print_products to anon, authenticated;
grant select on public.print_product_books to anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.reading_progress to authenticated;
grant select, insert, update, delete on public.completed_books to authenticated;
grant select, insert, update, delete on public.saved_paths to authenticated;
grant select, insert, update, delete on public.reading_sessions to authenticated;
grant select, insert, update, delete on public.print_orders to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;
grant select, insert, update, delete on public.book_catalog to authenticated;
grant select, insert, update, delete on public.book_slug_aliases to authenticated;
grant select, insert, update, delete on public.series to authenticated;
grant select, insert, update, delete on public.series_books to authenticated;
grant select, insert, update, delete on public.print_products to authenticated;
grant select, insert, update, delete on public.print_product_books to authenticated;

grant usage, select on sequence public.print_orders_id_seq to authenticated;
grant usage, select on sequence public.reading_sessions_id_seq to authenticated;
