-- JJ University reader-account hardening and Saved Books cloud sync.
-- Additive/reversible except for replacing the unsafe profile policies.

begin;

-- Saved Books was previously browser-only. This table is intentionally
-- separate from completed_books: saving a book is not reading it.
create table if not exists public.saved_books (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  is_saved boolean not null default true,
  saved_at timestamptz not null default now(),
  state_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index if not exists saved_books_user_updated_idx
on public.saved_books(user_id, state_changed_at desc);

drop trigger if exists set_saved_books_updated_at on public.saved_books;
create trigger set_saved_books_updated_at
before update on public.saved_books
for each row execute function public.set_updated_at();

alter table public.saved_books enable row level security;

drop policy if exists "saved_books_all_own" on public.saved_books;
create policy "saved_books_all_own"
on public.saved_books for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.saved_books to authenticated;

-- Completion rows are retained as small tombstones when a reader marks a book
-- incomplete. Without this, a stale second device can recreate a deleted row.
alter table public.completed_books
add column if not exists is_completed boolean not null default true;

alter table public.completed_books
add column if not exists updated_at timestamptz not null default now();

-- Keep the reader's logical change time separate from the server receipt time.
-- This prevents an older offline action from winning merely because it reached
-- Supabase after a newer action from another device.
alter table public.completed_books
add column if not exists state_changed_at timestamptz;

update public.completed_books
set state_changed_at = coalesce(state_changed_at, completed_at, updated_at, now())
where state_changed_at is null;

alter table public.completed_books
alter column state_changed_at set default now();

alter table public.completed_books
alter column state_changed_at set not null;

drop trigger if exists set_completed_books_updated_at on public.completed_books;
create trigger set_completed_books_updated_at
before update on public.completed_books
for each row execute function public.set_updated_at();

-- Preserve logical last-write-wins even when offline requests arrive out of
-- order. Equal-time ties favor removal, preventing stale resurrection.
create or replace function public.keep_newest_saved_book_state()
returns trigger language plpgsql as $$
begin
  if new.state_changed_at < old.state_changed_at
     or (new.state_changed_at = old.state_changed_at and old.is_saved = false and new.is_saved = true)
  then return old; end if;
  return new;
end;
$$;

drop trigger if exists keep_newest_saved_book_state on public.saved_books;
create trigger keep_newest_saved_book_state
before update on public.saved_books
for each row execute function public.keep_newest_saved_book_state();

create or replace function public.keep_newest_completed_book_state()
returns trigger language plpgsql as $$
begin
  if new.state_changed_at < old.state_changed_at
     or (new.state_changed_at = old.state_changed_at and old.is_completed = false and new.is_completed = true)
  then return old; end if;
  return new;
end;
$$;

drop trigger if exists keep_newest_completed_book_state on public.completed_books;
create trigger keep_newest_completed_book_state
before update on public.completed_books
for each row execute function public.keep_newest_completed_book_state();

create or replace function public.keep_newest_reading_progress()
returns trigger language plpgsql as $$
begin
  new.actual_seconds = greatest(new.actual_seconds, old.actual_seconds);
  if new.last_read_at < old.last_read_at then
    new.section_index = old.section_index;
    new.section_count = old.section_count;
    new.progress_percent = old.progress_percent;
    new.estimated_minutes = old.estimated_minutes;
    new.last_read_at = old.last_read_at;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_newest_reading_progress on public.reading_progress;
create trigger keep_newest_reading_progress
before update on public.reading_progress
for each row execute function public.keep_newest_reading_progress();

create or replace function public.clear_saved_books(expected_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if expected_user_id is null or expected_user_id <> auth.uid() then
    raise exception 'Authenticated user changed before Saved Books clear';
  end if;
  update public.saved_books
  set is_saved = false,
      state_changed_at = greatest(clock_timestamp(), state_changed_at + interval '1 microsecond')
  where user_id = expected_user_id;
end;
$$;

create or replace function public.clear_completed_books(expected_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if expected_user_id is null or expected_user_id <> auth.uid() then
    raise exception 'Authenticated user changed before completion clear';
  end if;
  update public.completed_books
  set is_completed = false,
      state_changed_at = greatest(clock_timestamp(), state_changed_at + interval '1 microsecond')
  where user_id = expected_user_id;
end;
$$;

revoke all on function public.clear_saved_books(uuid) from public, anon;
revoke all on function public.clear_completed_books(uuid) from public, anon;
grant execute on function public.clear_saved_books(uuid) to authenticated;
grant execute on function public.clear_completed_books(uuid) to authenticated;

-- PostgreSQL ORs permissive policies together. Remove the older policies that
-- allowed a reader to update their own role, then restore the intended split:
-- readers own their profile content; only existing admins can set roles.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id or public.is_admin());

drop policy if exists "profiles_insert_own_reader" on public.profiles;
create policy "profiles_insert_own_reader"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id and role = 'reader');

drop policy if exists "profiles_update_own_reader" on public.profiles;
create policy "profiles_update_own_reader"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id and role = 'reader')
with check ((select auth.uid()) = id and role = 'reader');

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Keep every private reader table explicitly scoped to authenticated users.
drop policy if exists "reading_progress_all_own" on public.reading_progress;
create policy "reading_progress_all_own"
on public.reading_progress for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "completed_books_all_own" on public.completed_books;
create policy "completed_books_all_own"
on public.completed_books for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "reading_sessions_all_own" on public.reading_sessions;
create policy "reading_sessions_all_own"
on public.reading_sessions for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "reader_bookmarks_all_own" on public.reader_bookmarks;
create policy "reader_bookmarks_all_own"
on public.reader_bookmarks for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "reader_notes_all_own" on public.reader_notes;
create policy "reader_notes_all_own"
on public.reader_notes for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "reader_quotes_all_own" on public.reader_quotes;
create policy "reader_quotes_all_own"
on public.reader_quotes for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- A coming-soon catalog card must not make its manuscript readable. Only a
-- genuinely ready, non-private catalog row can expose live book content.
drop policy if exists "book_content_live_public_read" on public.book_content_live;
create policy "book_content_live_public_read"
on public.book_content_live for select
to anon, authenticated
using (
  exists (
    select 1
    from public.book_catalog
    where book_catalog.id = book_content_live.book_id
      and book_catalog.status = 'ready'
      and book_catalog.visibility <> 'private'
  )
);

drop policy if exists "book_content_live_admin_all" on public.book_content_live;
create policy "book_content_live_admin_all"
on public.book_content_live for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

commit;

-- Rollback notes (data-preserving):
--   drop policy if exists "saved_books_all_own" on public.saved_books;
--   revoke all on public.saved_books from authenticated;
-- Keep the table if rollback is needed so saved-book rows are not destroyed.
