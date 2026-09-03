-- JJ University follow-up hardening from the 2026-08-24 live audit.
--
-- Apply after:
--   1. jju_print_lulu_columns.sql
--   2. jju_admin_catalog_cas_2026_08_21.sql
--   3. jju_tacos_release_gate_correction_2026_08_24.sql
--   4. jju_reader_book_id_canonicalization_2026_08_24.sql
--
-- This migration is intentionally idempotent. It makes public-schema defaults
-- fail closed, narrows RPC execution, removes the one policy accidentally
-- addressed to PUBLIC, hardens SECURITY DEFINER search paths, and makes
-- reading_sessions immutable except for user-initiated erasure. DELETE remains
-- temporarily available to the owner until both production clear-data clients
-- have been promoted to clear_reading_sessions().

begin;

-- Neither untrusted API role may create shadow objects in the trusted schema.
revoke create on schema public from public, anon, authenticated;

-- Supabase starts projects with permissive defaults. Existing objects remain
-- governed by their explicit grants below, while newly created application
-- objects now require a deliberate client grant.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

-- Anonymous clients never need mutation, DDL-adjacent, or sequence rights.
-- Keep any deliberately granted SELECT rights intact; RLS still applies.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- Authenticated application users do not need these ownership-adjacent rights.
-- Table-specific SELECT/INSERT/UPDATE/DELETE grants remain unchanged below.
revoke truncate, references, trigger
  on all tables in schema public from authenticated;

-- Start from no externally callable public-schema functions, then restore only
-- the reviewed RPC surface. Trigger functions continue to run as triggers; a
-- caller does not need direct EXECUTE on them.
revoke execute on all functions in schema public
  from public, anon, authenticated, service_role;

-- These trigger helpers use only NEW/OLD and pg_catalog built-ins. Keeping
-- their path to pg_catalog removes all name-resolution dependence.
alter function public.set_updated_at() set search_path = pg_catalog;
alter function public.keep_newest_saved_book_state() set search_path = pg_catalog;
alter function public.keep_newest_completed_book_state() set search_path = pg_catalog;
alter function public.keep_newest_reading_progress() set search_path = pg_catalog;

alter function public.is_admin() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.clear_saved_books(uuid) set search_path = public, pg_temp;
alter function public.clear_completed_books(uuid) set search_path = public, pg_temp;
alter function public.require_active_narrator(uuid) set search_path = public, pg_temp;
alter function public.narrator_accept_assignment(uuid) set search_path = public, pg_temp;
alter function public.narrator_prepare_submission(uuid, uuid, uuid, text, text, bigint, text)
  set search_path = public, pg_temp;
alter function public.narrator_complete_submission(uuid, uuid, bigint)
  set search_path = public, pg_temp;
alter function public.narrator_submit_assignment(uuid) set search_path = public, pg_temp;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.clear_saved_books(uuid) to authenticated;
grant execute on function public.clear_completed_books(uuid) to authenticated;
grant execute on function public.narrator_accept_assignment(uuid) to authenticated;
grant execute on function public.narrator_prepare_submission(uuid, uuid, uuid, text, text, bigint, text)
  to authenticated;
grant execute on function public.narrator_complete_submission(uuid, uuid, bigint)
  to service_role;
grant execute on function public.narrator_submit_assignment(uuid) to authenticated;

-- Preserve the later, independently reviewed RPCs if this idempotent migration
-- is ever rerun after the final audit follow-up.
do $later_rpc_hardening$
begin
  if to_regprocedure('public.clear_reader_canonicalization_audit(uuid)') is not null then
    execute 'grant execute on function public.clear_reader_canonicalization_audit(uuid) to authenticated';
  end if;
  if to_regprocedure('public.record_reading_session(text,text,timestamptz,timestamptz)') is not null then
    execute 'grant execute on function public.record_reading_session(text, text, timestamptz, timestamptz) to authenticated';
  end if;
  if to_regprocedure('public.jju_admin_save_book_content(integer,text,jsonb,text,text,text)') is not null then
    execute 'grant execute on function public.jju_admin_save_book_content(integer, text, jsonb, text, text, text) to service_role';
  end if;
  if to_regprocedure('public.activate_narrator_invite_contact(uuid)') is not null then
    execute 'grant execute on function public.activate_narrator_invite_contact(uuid) to service_role';
  end if;
  if to_regprocedure('public.link_narrator_portal_contact(uuid,timestamptz,uuid,uuid,text,text,text,text,timestamptz,uuid,boolean)') is not null then
    execute 'grant execute on function public.link_narrator_portal_contact(uuid, timestamptz, uuid, uuid, text, text, text, text, timestamptz, uuid, boolean) to service_role';
  end if;
  if to_regprocedure('public.submit_narrator_access_request(text,text,text,text)') is not null then
    execute 'grant execute on function public.submit_narrator_access_request(text, text, text, text) to service_role';
  end if;
  if to_regprocedure('public.claim_narrator_access_notification(uuid)') is not null then
    execute 'grant execute on function public.claim_narrator_access_notification(uuid) to service_role';
  end if;
  if to_regprocedure('public.review_narrator_access_request(uuid,timestamptz,text)') is not null then
    execute 'grant execute on function public.review_narrator_access_request(uuid, timestamptz, text) to service_role';
  end if;
end;
$later_rpc_hardening$;

-- The CAS migration is intentionally applied before this migration. These
-- guards keep this file rerunnable in a partial/dev environment while ensuring
-- the live CAS functions get the same search-path and ACL treatment.
do $cas_hardening$
begin
  if to_regprocedure('public.jju_admin_save_book_catalog(text,jsonb)') is not null then
    execute 'alter function public.jju_admin_save_book_catalog(text, jsonb) set search_path = public, pg_temp';
    execute 'revoke execute on function public.jju_admin_save_book_catalog(text, jsonb) from public, anon, authenticated, service_role';
    execute 'grant execute on function public.jju_admin_save_book_catalog(text, jsonb) to service_role';
  end if;

  if to_regprocedure('public.jju_admin_create_book_draft(text,jsonb,jsonb,text,text,text)') is not null then
    execute 'alter function public.jju_admin_create_book_draft(text, jsonb, jsonb, text, text, text) set search_path = public, pg_temp';
    execute 'revoke execute on function public.jju_admin_create_book_draft(text, jsonb, jsonb, text, text, text) from public, anon, authenticated, service_role';
    execute 'grant execute on function public.jju_admin_create_book_draft(text, jsonb, jsonb, text, text, text) to service_role';
  end if;
end;
$cas_hardening$;

-- Workshop catalog and manuscript mutations are server-owned. Drop every
-- direct authenticated admin mutation path; the versioned server RPCs remain.
revoke insert, update, delete on public.book_catalog from authenticated;
revoke insert, update, delete on public.book_slug_aliases from authenticated;
revoke insert, update, delete on public.book_content_live from authenticated;
revoke all privileges on public.book_content_versions from anon, authenticated;
revoke usage, select on sequence public.book_content_versions_id_seq from authenticated;
drop policy if exists "catalog_admin_all" on public.book_catalog;
drop policy if exists "slug_alias_admin_all" on public.book_slug_aliases;
drop policy if exists "book_content_live_admin_all" on public.book_content_live;
drop policy if exists "book_content_versions_admin_all" on public.book_content_versions;

-- reading_sessions is directional, client-reported telemetry. Accept only the
-- two event shapes the Reader emits and bound each session window. The table is
-- empty in the audited live state. Canonicalization runs before this file so a
-- future refreshed audit cannot strand a mixed-case session behind the new
-- lowercase constraint.
alter table public.reading_sessions alter column source drop default;

do $reading_session_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reading_sessions'::regclass
      and conname = 'reading_sessions_source_shape_check'
  ) then
    alter table public.reading_sessions
      add constraint reading_sessions_source_shape_check
      check (
        (source = 'reader_engaged_minute' and seconds = 60)
        or (source = 'qualified_read' and seconds = 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reading_sessions'::regclass
      and conname = 'reading_sessions_timestamp_order_check'
  ) then
    alter table public.reading_sessions
      add constraint reading_sessions_timestamp_order_check
      check (
        ended_at >= started_at
        and ended_at <= started_at + interval '24 hours'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reading_sessions'::regclass
      and conname = 'reading_sessions_canonical_book_id_check'
  ) then
    alter table public.reading_sessions
      add constraint reading_sessions_canonical_book_id_check
      check (book_id = lower(book_id) and length(book_id) between 1 and 500);
  end if;
end;
$reading_session_constraints$;

drop policy if exists "reading_sessions_all_own" on public.reading_sessions;
drop policy if exists "reading_sessions_select_own" on public.reading_sessions;
drop policy if exists "reading_sessions_insert_own" on public.reading_sessions;
drop policy if exists "reading_sessions_delete_own" on public.reading_sessions;

create policy "reading_sessions_select_own"
on public.reading_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

-- Compatibility bridge: production AccountClient and SiteV2SettingsClient
-- still issue an own-user DELETE. Keep exactly that erasure path until those
-- clients call clear_reading_sessions(), but remove all client UPDATE ability.
create policy "reading_sessions_delete_own"
on public.reading_sessions for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke insert, update on public.reading_sessions from authenticated;
revoke usage, select on sequence public.reading_sessions_id_seq from authenticated;
grant select, delete on public.reading_sessions to authenticated;

create or replace function public.clear_reading_sessions(expected_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
begin
  if expected_user_id is null or expected_user_id is distinct from auth.uid() then
    raise exception 'Authenticated user changed before reading-session clear.'
      using errcode = '42501';
  end if;

  delete from public.reading_sessions
  where user_id = expected_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.clear_reading_sessions(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_reading_sessions(uuid) to authenticated;

commit;
