-- JJ University reader-profile and manuscript-read hardening.
-- Review in the Supabase SQL Editor before running. This file is intentionally
-- not executed by the application or by the local build.

begin;

alter table public.profiles
add column if not exists role text not null default 'reader';

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

-- These names came from the older account-only schema. Permissive RLS
-- policies are ORed together, so they must not coexist with the stricter
-- reader-role policies.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

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

-- Manuscripts should only be anonymously readable once their catalog record
-- is actually ready. A coming-soon row can remain visible without exposing
-- uploaded content early.
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

commit;
