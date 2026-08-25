-- Read-only post-application verification for the 2026-08-24 JJU audit.
--
-- Recommended application order (each file in its own SQL Editor run):
--   1. jju_print_lulu_columns.sql
--   2. jju_admin_catalog_cas_2026_08_21.sql
--   3. jju_tacos_release_gate_correction_2026_08_24.sql
--   4. jju_reader_book_id_canonicalization_2026_08_24.sql
--   5. jju_security_followup_2026_08_24.sql
--   6. jju_security_cas_privacy_followup_2026_08_24.sql
--   7. this file
--
-- Every returned row must have passed=true. This script performs no writes.

with
public_functions as (
  select procedure.oid, procedure.oid::regprocedure::text signature,
         procedure.prosecdef, procedure.proconfig
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
),
expected_authenticated_functions(oid) as (
  values
    (to_regprocedure('public.is_admin()')),
    (to_regprocedure('public.clear_saved_books(uuid)')),
    (to_regprocedure('public.clear_completed_books(uuid)')),
    (to_regprocedure('public.clear_reading_sessions(uuid)')),
    (to_regprocedure('public.clear_reader_canonicalization_audit(uuid)')),
    (to_regprocedure('public.record_reading_session(text,text,timestamptz,timestamptz)')),
    (to_regprocedure('public.narrator_accept_assignment(uuid)')),
    (to_regprocedure('public.narrator_prepare_submission(uuid,uuid,uuid,text,text,bigint,text)')),
    (to_regprocedure('public.narrator_submit_assignment(uuid)'))
),
expected_service_functions(oid) as (
  values
    (to_regprocedure('public.narrator_complete_submission(uuid,uuid,bigint)')),
    (to_regprocedure('public.jju_admin_save_book_catalog(text,jsonb)')),
    (to_regprocedure('public.jju_admin_create_book_draft(text,jsonb,jsonb,text,text,text)')),
    (to_regprocedure('public.jju_admin_save_book_content(integer,text,jsonb,text,text,text)'))
),
invalid_reader_rows as (
  select 'reading_progress'::text source_table, count(*)::bigint row_count
  from public.reading_progress row_value
  where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
  union all
  select 'completed_books', count(*) from public.completed_books row_value
  where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
  union all
  select 'saved_books', count(*) from public.saved_books row_value
  where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
  union all
  select 'reading_sessions', count(*) from public.reading_sessions row_value
  where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
  union all
  select 'reader_bookmarks', count(*) from public.reader_bookmarks row_value
  where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
  union all
  select 'reader_notes', count(*) from public.reader_notes row_value
  where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
  union all
  select 'reader_quotes', count(*) from public.reader_quotes row_value
  where not exists (select 1 from public.book_catalog book where book.id = row_value.book_id)
),
expected_aliases(alias, book_id) as (
  values
    ('quantum-fields', 'field'),
    ('vibe-check', 'music'),
    ('nicotine', 'nic'),
    ('what-are-the-odds', 'odd'),
    ('youre-what', 'prenancy'),
    ('van-gogh', 'vangogh'),
    ('insert-coin', 'videogames')
),
checks as (
  select
    'required CAS and print objects exist'::text check_name,
    to_regclass('public.jju_admin_document_revisions') is not null
      and to_regprocedure('public.jju_admin_save_book_catalog(text,jsonb)') is not null
      and to_regprocedure('public.jju_admin_create_book_draft(text,jsonb,jsonb,text,text,text)') is not null
      and to_regprocedure('public.jju_admin_save_book_content(integer,text,jsonb,text,text,text)') is not null
      and (
        select count(*) = 3
        from information_schema.columns
        where table_schema = 'public' and table_name = 'print_products'
          and column_name in ('lulu_pod_package_id', 'public_interior_url', 'public_cover_url')
      ) passed,
    jsonb_build_object(
      'cas_table', to_regclass('public.jju_admin_document_revisions'),
      'save_rpc', to_regprocedure('public.jju_admin_save_book_catalog(text,jsonb)'),
      'create_rpc', to_regprocedure('public.jju_admin_create_book_draft(text,jsonb,jsonb,text,text,text)'),
      'content_rpc', to_regprocedure('public.jju_admin_save_book_content(integer,text,jsonb,text,text,text)'),
      'print_columns', (
        select jsonb_agg(column_name order by column_name)
        from information_schema.columns
        where table_schema = 'public' and table_name = 'print_products'
          and column_name in ('lulu_pod_package_id', 'public_interior_url', 'public_cover_url')
      )
    ) details

  union all
  select
    'all public API tables retain RLS',
    count(*) filter (where not rel.relrowsecurity) = 0,
    coalesce(jsonb_agg(rel.relname order by rel.relname) filter (where not rel.relrowsecurity), '[]'::jsonb)
  from pg_class rel
  join pg_namespace namespace on namespace.oid = rel.relnamespace
  where namespace.nspname = 'public' and rel.relkind in ('r', 'p')

  union all
  select
    'no policy is addressed to PUBLIC',
    count(*) = 0,
    coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname)), '[]'::jsonb)
  from pg_policies
  where schemaname = 'public' and 'public' = any(roles)

  union all
  select
    'anonymous role executes no public RPC',
    count(*) = 0,
    coalesce(jsonb_agg(signature order by signature), '[]'::jsonb)
  from public_functions
  where has_function_privilege('anon', oid, 'EXECUTE')

  union all
  select
    'authenticated RPC grants are an exact allowlist',
    not exists (
      select 1 from public_functions function_row
      where has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
        and function_row.oid not in (select oid from expected_authenticated_functions)
    ) and not exists (
      select 1 from expected_authenticated_functions expected
      where expected.oid is null
         or not has_function_privilege('authenticated', expected.oid, 'EXECUTE')
    ),
    jsonb_build_object(
      'granted', (
        select coalesce(jsonb_agg(signature order by signature), '[]'::jsonb)
        from public_functions where has_function_privilege('authenticated', oid, 'EXECUTE')
      )
    )

  union all
  select
    'service-role RPC grants are an exact allowlist',
    not exists (
      select 1 from public_functions function_row
      where has_function_privilege('service_role', function_row.oid, 'EXECUTE')
        and function_row.oid not in (select oid from expected_service_functions)
    ) and not exists (
      select 1 from expected_service_functions expected
      where expected.oid is null
         or not has_function_privilege('service_role', expected.oid, 'EXECUTE')
    ),
    jsonb_build_object(
      'granted', (
        select coalesce(jsonb_agg(signature order by signature), '[]'::jsonb)
        from public_functions where has_function_privilege('service_role', oid, 'EXECUTE')
      )
    )

  union all
  select
    'all SECURITY DEFINER functions use public then pg_temp',
    count(*) = 0,
    coalesce(jsonb_agg(jsonb_build_object('function', signature, 'config', proconfig) order by signature), '[]'::jsonb)
  from public_functions
  where prosecdef
    and not coalesce(proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']::text[]

  union all
  select
    'all four trigger helpers have a fixed pg_catalog path',
    count(*) = 4 and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]),
    coalesce(jsonb_agg(jsonb_build_object('function', signature, 'config', proconfig) order by signature), '[]'::jsonb)
  from public_functions
  where oid in (
    to_regprocedure('public.set_updated_at()'),
    to_regprocedure('public.keep_newest_saved_book_state()'),
    to_regprocedure('public.keep_newest_completed_book_state()'),
    to_regprocedure('public.keep_newest_reading_progress()')
  )

  union all
  select
    'postgres global function and public-schema defaults fail closed',
    count(*) = 0,
    coalesce(jsonb_agg(jsonb_build_object(
      'object_type', defaults.defaclobjtype,
      'namespace', coalesce(namespace.nspname, '<global>'),
      'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
      'privilege', acl.privilege_type
    )), '[]'::jsonb)
  from pg_default_acl defaults
  join pg_roles owner_role on owner_role.oid = defaults.defaclrole
  left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
  cross join lateral aclexplode(defaults.defaclacl) acl
  left join pg_roles grantee on grantee.oid = acl.grantee
  where owner_role.rolname = 'postgres'
    and (
      (defaults.defaclobjtype = 'f' and defaults.defaclnamespace = 0)
      or namespace.nspname = 'public'
    )
    and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))

  union all
  select
    'anonymous role has no table mutation privilege',
    count(*) = 0,
    coalesce(jsonb_agg(rel.relname order by rel.relname), '[]'::jsonb)
  from pg_class rel
  join pg_namespace namespace on namespace.oid = rel.relnamespace
  where namespace.nspname = 'public'
    and rel.relkind in ('r', 'p')
    and (
      has_table_privilege('anon', rel.oid, 'INSERT')
      or has_table_privilege('anon', rel.oid, 'UPDATE')
      or has_table_privilege('anon', rel.oid, 'DELETE')
      or has_table_privilege('anon', rel.oid, 'TRUNCATE')
      or has_table_privilege('anon', rel.oid, 'REFERENCES')
      or has_table_privilege('anon', rel.oid, 'TRIGGER')
    )

  union all
  select
    'Workshop CAS tables reject direct authenticated mutation',
    not has_table_privilege('authenticated', 'public.book_catalog', 'INSERT')
      and not has_table_privilege('authenticated', 'public.book_catalog', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.book_catalog', 'DELETE')
      and not has_table_privilege('authenticated', 'public.book_slug_aliases', 'INSERT')
      and not has_table_privilege('authenticated', 'public.book_slug_aliases', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.book_slug_aliases', 'DELETE')
      and not has_table_privilege('authenticated', 'public.book_content_live', 'INSERT')
      and not has_table_privilege('authenticated', 'public.book_content_live', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.book_content_live', 'DELETE')
      and not has_table_privilege('authenticated', 'public.book_content_versions', 'SELECT')
      and not has_table_privilege('authenticated', 'public.book_content_versions', 'INSERT')
      and not has_table_privilege('authenticated', 'public.book_content_versions', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.book_content_versions', 'DELETE')
      and not has_sequence_privilege('authenticated', 'public.book_content_versions_id_seq', 'USAGE')
      and not has_sequence_privilege('authenticated', 'public.book_content_versions_id_seq', 'SELECT')
      and exists (
        select 1 from pg_constraint
        where conrelid = 'public.book_content_live'::regclass
          and conname = 'book_content_live_sections_shape_check'
          and convalidated
      )
      and (
        select count(*) = 3
          and count(*) filter (where policyname = 'book_catalog_public_read' and cmd = 'SELECT') = 1
          and count(*) filter (where policyname = 'book_slug_aliases_public_read' and cmd = 'SELECT') = 1
          and count(*) filter (where policyname = 'book_content_live_public_read' and cmd = 'SELECT') = 1
        from pg_policies
        where schemaname = 'public'
          and tablename in ('book_catalog', 'book_slug_aliases', 'book_content_live', 'book_content_versions')
      ),
    jsonb_build_object(
      'authenticated_catalog_insert', has_table_privilege('authenticated', 'public.book_catalog', 'INSERT'),
      'authenticated_alias_update', has_table_privilege('authenticated', 'public.book_slug_aliases', 'UPDATE'),
      'authenticated_live_update', has_table_privilege('authenticated', 'public.book_content_live', 'UPDATE'),
      'content_rpc', to_regprocedure('public.jju_admin_save_book_content(integer,text,jsonb,text,text,text)'),
      'policies', (
        select coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'command', cmd) order by tablename, policyname), '[]'::jsonb)
        from pg_policies
        where schemaname = 'public'
          and tablename in ('book_catalog', 'book_slug_aliases', 'book_content_live', 'book_content_versions')
      )
    )

  union all
  select
    'alias arrays and normalized rows are an exact mirror',
    to_regclass('public.book_slug_aliases_alias_lower_uidx') is not null
      and (
        select count(*) = 4
        from pg_trigger
        where tgrelid in ('public.book_catalog'::regclass, 'public.book_slug_aliases'::regclass)
          and not tgisinternal
          and tgname in (
            'jju_normalize_catalog_slug_aliases',
            'jju_sync_catalog_slug_aliases',
            'jju_10_normalize_slug_alias_row',
            'jju_20_enforce_slug_alias_mirror'
          )
      )
      and not exists (
        select 1 from public.book_slug_aliases alias_row
        where alias_row.alias <> lower(trim(alias_row.alias))
          or alias_row.book_id <> lower(trim(alias_row.book_id))
      )
      and not exists (
        select 1 from public.book_catalog book
        where book.slug_aliases is distinct from (
          select coalesce(array_agg(alias_key order by first_position), '{}'::text[])
          from (
            select lower(trim(alias_value)) alias_key, min(alias_position) first_position
            from unnest(coalesce(book.slug_aliases, '{}'::text[])) with ordinality aliases(alias_value, alias_position)
            where trim(alias_value) <> ''
            group by lower(trim(alias_value))
          ) normalized
        )
      )
      and not exists (
        select 1
        from public.book_catalog book
        cross join lateral unnest(coalesce(book.slug_aliases, '{}'::text[])) alias_value
        left join public.book_slug_aliases alias_row
          on alias_row.alias = alias_value and alias_row.book_id = book.id
        where alias_row.alias is null
      )
      and not exists (
        select 1 from public.book_slug_aliases alias_row
        left join public.book_catalog book
          on book.id = alias_row.book_id and alias_row.alias = any(book.slug_aliases)
        where book.id is null
      ),
    jsonb_build_object(
      'catalog_aliases', (
        select coalesce(sum(cardinality(slug_aliases)), 0) from public.book_catalog
      ),
      'normalized_rows', (select count(*) from public.book_slug_aliases)
    )

  union all
  select
    'new invariant trigger helpers have fixed trusted paths',
    count(*) = 5
      and bool_and(
        case
          when oid in (
            to_regprocedure('public.jju_normalize_slug_alias_row()'),
            to_regprocedure('public.jju_set_canonicalization_audit_user_id()')
          )
            then coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]
          else coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog, public']::text[]
        end
      ),
    coalesce(jsonb_agg(jsonb_build_object('function', signature, 'config', proconfig) order by signature), '[]'::jsonb)
  from public_functions
  where oid in (
    to_regprocedure('public.jju_normalize_catalog_slug_aliases()'),
    to_regprocedure('public.jju_sync_catalog_slug_aliases()'),
    to_regprocedure('public.jju_normalize_slug_alias_row()'),
    to_regprocedure('public.jju_enforce_slug_alias_mirror()'),
    to_regprocedure('public.jju_set_canonicalization_audit_user_id()')
  )

  union all
  select
    'reading_sessions accepts only bounded RPC writes and own-user erasure',
    (
      select count(*) = 4 and bool_and(convalidated)
      from pg_constraint
      where conrelid = 'public.reading_sessions'::regclass
        and conname in (
          'reading_sessions_source_shape_check',
          'reading_sessions_timestamp_order_check',
          'reading_sessions_canonical_book_id_check',
          'reading_sessions_book_id_fkey'
        )
    )
    and (
      select count(*) = 2
        and count(*) filter (
          where policyname = 'reading_sessions_select_own'
            and cmd = 'SELECT'
            and roles = array['authenticated'::name]
            and with_check is null
            and regexp_replace(coalesce(qual, ''), '\s', '', 'g') like '%auth.uid()%user_id%'
        ) = 1
        and count(*) filter (
          where policyname = 'reading_sessions_delete_own'
            and cmd = 'DELETE'
            and roles = array['authenticated'::name]
            and with_check is null
            and regexp_replace(coalesce(qual, ''), '\s', '', 'g') like '%auth.uid()%user_id%'
        ) = 1
      from pg_policies
      where schemaname = 'public' and tablename = 'reading_sessions'
    )
    and not has_table_privilege('authenticated', 'public.reading_sessions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.reading_sessions', 'UPDATE')
    and has_table_privilege('authenticated', 'public.reading_sessions', 'DELETE')
    and not has_sequence_privilege('authenticated', 'public.reading_sessions_id_seq', 'USAGE')
    and not has_sequence_privilege('authenticated', 'public.reading_sessions_id_seq', 'SELECT')
    and (
      select is_nullable = 'NO'
      from information_schema.columns
      where table_schema = 'public' and table_name = 'reading_sessions' and column_name = 'dedupe_key'
    )
    and to_regclass('public.reading_sessions_user_dedupe_uidx') is not null
    and has_function_privilege('authenticated', 'public.clear_reading_sessions(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.record_reading_session(text,text,timestamptz,timestamptz)', 'EXECUTE'),
    jsonb_build_object(
      'policies', (
        select jsonb_agg(jsonb_build_object('name', policyname, 'command', cmd, 'roles', roles, 'using', qual, 'check', with_check) order by policyname)
        from pg_policies where schemaname = 'public' and tablename = 'reading_sessions'
      ),
      'client_insert', has_table_privilege('authenticated', 'public.reading_sessions', 'INSERT'),
      'client_update', has_table_privilege('authenticated', 'public.reading_sessions', 'UPDATE'),
      'client_delete_compatibility_bridge', has_table_privilege('authenticated', 'public.reading_sessions', 'DELETE'),
      'record_rpc', to_regprocedure('public.record_reading_session(text,text,timestamptz,timestamptz)')
    )

  union all
  select
    'legacy Reader IDs are canonical and retained audit rows honor erasure',
    (select coalesce(sum(row_count), 0) = 0 from invalid_reader_rows)
      and (
        select count(*) <= 50
           and count(*) filter (where record_role = 'legacy_source') <= 28
           and count(*) filter (where record_role = 'canonical_collision') <= 22
           and count(*) filter (where user_id is null) = 0
        from public.jju_reader_book_id_canonicalization_audit
        where migration_key = 'reader-book-id-lowercase-v1'
      )
      and (
        select is_nullable = 'NO'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'jju_reader_book_id_canonicalization_audit'
          and column_name = 'user_id'
      )
      and exists (
        select 1 from pg_constraint
        where conrelid = 'public.jju_reader_book_id_canonicalization_audit'::regclass
          and confrelid = 'auth.users'::regclass
          and conname = 'jju_reader_canonicalization_audit_user_id_fkey'
          and confdeltype = 'c'
      )
      and not has_table_privilege('anon', 'public.jju_reader_book_id_canonicalization_audit', 'SELECT')
      and not has_table_privilege('authenticated', 'public.jju_reader_book_id_canonicalization_audit', 'SELECT')
      and has_function_privilege('authenticated', 'public.clear_reader_canonicalization_audit(uuid)', 'EXECUTE'),
    jsonb_build_object(
      'invalid_by_table', (select jsonb_object_agg(source_table, row_count) from invalid_reader_rows),
      'retained_audit_by_role', (
        select jsonb_object_agg(record_role, row_count)
        from (
          select record_role, count(*) row_count
          from public.jju_reader_book_id_canonicalization_audit
          where migration_key = 'reader-book-id-lowercase-v1'
          group by record_role
        ) audit_counts
      )
    )

  union all
  select
    'all seven normalized aliases are present',
    count(alias_row.alias) = 7 and bool_and(alias_row.book_id = expected.book_id),
    jsonb_build_object(
      'present', count(alias_row.alias),
      'missing', coalesce(jsonb_agg(expected.alias) filter (where alias_row.alias is null), '[]'::jsonb)
    )
  from expected_aliases expected
  left join public.book_slug_aliases alias_row on alias_row.alias = expected.alias

  union all
  select
    'Tacos is QA with 16 size-matched objects in policy-closed private Storage',
    exists (
      select 1 from public.audio_editions
      where id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
        and book_id = 'tacos' and edition_key = 'standard'
        and status = 'qa' and published_at is null
    )
    and (
      select count(*) = 16
      from public.audio_tracks
      where edition_id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
        and status = 'qa' and published_at is null
    )
    and exists (
      select 1 from public.jju_audio_release_state_audit
      where migration_key = 'tacos-published-to-qa-v1'
        and previous_edition->>'status' = 'published'
        and jsonb_array_length(previous_tracks) = 16
    )
    and (
      select count(*) = 16
      from public.audio_tracks track
      join storage.objects object
        on object.bucket_id = track.storage_bucket and object.name = track.storage_path
      where track.edition_id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
        and coalesce((object.metadata->>'size')::bigint, -1) = track.file_size_bytes
    )
    and (
      select count(*) = 2 and bool_and(not public)
      from storage.buckets
      where id in ('audiobooks', 'narrator-audio-intake')
    )
    and not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
    ),
    jsonb_build_object(
      'edition_status', (
        select status from public.audio_editions
        where id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
      ),
      'qa_tracks', (
        select count(*) from public.audio_tracks
        where edition_id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid and status = 'qa'
      ),
      'size_matched_objects', (
        select count(*)
        from public.audio_tracks track
        join storage.objects object
          on object.bucket_id = track.storage_bucket and object.name = track.storage_path
        where track.edition_id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
          and coalesce((object.metadata->>'size')::bigint, -1) = track.file_size_bytes
      ),
      'private_buckets', (
        select jsonb_object_agg(id, not public)
        from storage.buckets where id in ('audiobooks', 'narrator-audio-intake')
      ),
      'storage_object_policies', (
        select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      ),
      'all_audiobook_objects_preserved', (
        select count(*) from storage.objects where bucket_id = 'audiobooks'
      )
    )
)
select
  check_name,
  passed,
  details,
  count(*) over () as total_checks,
  count(*) filter (where not passed) over () as failed_checks,
  bool_and(passed) over () as all_passed
from checks
order by check_name;
