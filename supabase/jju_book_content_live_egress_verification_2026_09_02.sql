-- Read-only post-cutover verification for the public manuscript egress fix.
-- Every row must say passed = true. This file makes no changes.

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
    'public manuscript-read policy is absent',
    not exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'book_content_live'
        and policy.policyname = 'book_content_live_public_read'
    )
  union all
  select
    'anon cannot SELECT whole manuscripts',
    not has_table_privilege('anon', 'public.book_content_live', 'SELECT')
  union all
  select
    'authenticated cannot SELECT whole manuscripts',
    not has_table_privilege('authenticated', 'public.book_content_live', 'SELECT')
  union all
  select
    'service role retains SELECT for server-side editorial work',
    has_table_privilege('service_role', 'public.book_content_live', 'SELECT')
  union all
  select
    'PUBLIC has no SELECT grant',
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
)
select check_name, passed
from checks
order by check_name;
