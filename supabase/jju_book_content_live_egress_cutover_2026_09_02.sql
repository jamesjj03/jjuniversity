-- Stop public REST reads of whole manuscripts after the static Reader/sitemap
-- edition is live. This does not alter any manuscript rows, versions, admin
-- policy, or service-role access.
--
-- Run only after the paired preflight has passed. The transaction refuses to
-- run against an unexpected policy/grant state.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'book_content_live'
      and policy.policyname = 'book_content_live_public_read'
      and policy.cmd = 'SELECT'
  ) then
    raise exception 'Expected book_content_live_public_read SELECT policy is missing; stop and investigate.';
  end if;

  if not exists (
    select 1
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) privilege
    join pg_roles role on role.oid = privilege.grantee
    where namespace.nspname = 'public'
      and class.relname = 'book_content_live'
      and role.rolname = 'anon'
      and privilege.privilege_type = 'SELECT'
  ) or not exists (
    select 1
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) privilege
    join pg_roles role on role.oid = privilege.grantee
    where namespace.nspname = 'public'
      and class.relname = 'book_content_live'
      and role.rolname = 'authenticated'
      and privilege.privilege_type = 'SELECT'
  ) then
    raise exception 'Expected direct anonymous/authenticated SELECT grants are already absent; stop and investigate.';
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

  if not has_table_privilege('service_role', 'public.book_content_live', 'SELECT') then
    raise exception 'service_role SELECT is absent; stop and investigate.';
  end if;
end
$$;

drop policy "book_content_live_public_read" on public.book_content_live;
revoke select on table public.book_content_live from anon, authenticated;

commit;
