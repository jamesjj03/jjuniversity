-- Read-only preflight for the public manuscript egress cutover.
--
-- Run this in the production Supabase SQL Editor immediately after the static
-- public Reader and sitemap deployment have been verified. Every row must say
-- passed = true before running jju_book_content_live_egress_cutover_2026_09_02.sql.
-- This file makes no changes.

with checks as (
  select
    'book_content_live has row-level security enabled'::text as check_name,
    coalesce((
      select class.relrowsecurity
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'public' and class.relname = 'book_content_live'
    ), false) as passed
  union all
  select
    'legacy public manuscript-read policy is present',
    exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'book_content_live'
        and policy.policyname = 'book_content_live_public_read'
        and policy.cmd = 'SELECT'
    )
  union all
  select
    'anon has a direct SELECT grant to remove',
    exists (
      select 1
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) privilege
      join pg_roles role on role.oid = privilege.grantee
      where namespace.nspname = 'public'
        and class.relname = 'book_content_live'
        and role.rolname = 'anon'
        and privilege.privilege_type = 'SELECT'
    )
  union all
  select
    'authenticated has a direct SELECT grant to remove',
    exists (
      select 1
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) privilege
      join pg_roles role on role.oid = privilege.grantee
      where namespace.nspname = 'public'
        and class.relname = 'book_content_live'
        and role.rolname = 'authenticated'
        and privilege.privilege_type = 'SELECT'
    )
  union all
  select
    'PUBLIC has no unexpected SELECT grant',
    not exists (
      select 1
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      cross join lateral aclexplode(coalesce(class.relacl, acldefault('r', class.relowner))) privilege
      where namespace.nspname = 'public'
        and class.relname = 'book_content_live'
        and privilege.grantee = 0
        and privilege.privilege_type = 'SELECT'
    )
  union all
  select
    'service role retains SELECT for server-side editorial work',
    has_table_privilege('service_role', 'public.book_content_live', 'SELECT')
)
select check_name, passed
from checks
order by check_name;
