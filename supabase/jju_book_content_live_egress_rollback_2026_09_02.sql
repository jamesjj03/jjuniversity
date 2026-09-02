-- Roll back only the 2026-09-02 public manuscript egress cutover.
--
-- Run this only if the new static Reader is proven to need the old public REST
-- path. It refuses to overwrite another policy/grant state. It restores the
-- former narrow ready/non-private rule, not a broad public read.

begin;

do $$
begin
  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'book_content_live'
      and policy.policyname = 'book_content_live_public_read'
  ) then
    raise exception 'Public manuscript-read policy already exists; this rollback is not applicable.';
  end if;

  if has_table_privilege('anon', 'public.book_content_live', 'SELECT')
     or has_table_privilege('authenticated', 'public.book_content_live', 'SELECT') then
    raise exception 'Public SELECT grant already exists; this rollback is not applicable.';
  end if;

  if exists (
    select 1
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) privilege
    where namespace.nspname = 'public'
      and class.relname = 'book_content_live'
      and privilege.grantee = 0
      and privilege.privilege_type = 'SELECT'
  ) then
    raise exception 'Unexpected PUBLIC SELECT grant exists; stop and investigate.';
  end if;
end
$$;

create policy "book_content_live_public_read"
on public.book_content_live
for select
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

grant select on table public.book_content_live to anon, authenticated;

commit;
