-- JJ University account and reading sync schema.
-- Run this in Supabase SQL Editor for the jjuniversity project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'JJU Reader',
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

alter table public.profiles enable row level security;
alter table public.reading_progress enable row level security;
alter table public.completed_books enable row level security;
alter table public.saved_paths enable row level security;
alter table public.reading_sessions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "reading_progress_all_own" on public.reading_progress;
create policy "reading_progress_all_own"
on public.reading_progress for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "completed_books_all_own" on public.completed_books;
create policy "completed_books_all_own"
on public.completed_books for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "saved_paths_all_own" on public.saved_paths;
create policy "saved_paths_all_own"
on public.saved_paths for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "reading_sessions_all_own" on public.reading_sessions;
create policy "reading_sessions_all_own"
on public.reading_sessions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

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
