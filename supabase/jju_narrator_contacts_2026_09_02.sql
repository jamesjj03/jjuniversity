-- JJ University private narrator roster and invitation state.
--
-- REVIEWED ADDITIVE MIGRATION ONLY: do not apply to production as a side
-- effect of a deploy. The narrator control room remains backward-compatible
-- when this table is absent, and invitation sending has a separate runtime
-- switch.

create extension if not exists pgcrypto;

create table if not exists public.narrator_contacts (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,
  display_name text not null,
  contact_email text,
  source text not null default 'Manual',
  notes text not null default '',
  status text not null default 'contact'
    check (status in ('contact', 'invite-pending', 'invite-sent', 'active', 'paused', 'closed', 'repair-needed')),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  invite_sent_at timestamptz,
  invite_reservation_id uuid,
  invite_attempt_id uuid,
  invite_attempt_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contact_email is null or length(btrim(contact_email)) between 3 and 254),
  check (
    status <> 'invite-pending'
    or (invite_reservation_id is not null and invite_attempt_id is not null and invite_attempt_started_at is not null)
  ),
  check (
    status = 'invite-pending'
    or (invite_attempt_id is null and invite_attempt_started_at is null)
  )
);

create unique index if not exists narrator_contacts_normalized_email_idx
on public.narrator_contacts (lower(btrim(contact_email)))
where contact_email is not null and btrim(contact_email) <> '';

create index if not exists narrator_contacts_status_idx
on public.narrator_contacts (status, created_at);

create or replace function public.reset_narrator_contact_after_auth_unlink()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if old.auth_user_id is not null and new.auth_user_id is null then
    new.status := 'contact';
    new.invite_sent_at := null;
    new.invite_reservation_id := null;
    new.invite_attempt_id := null;
    new.invite_attempt_started_at := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.reset_narrator_contact_after_auth_unlink()
  from public, anon, authenticated, service_role;

drop trigger if exists reset_narrator_contact_after_auth_unlink on public.narrator_contacts;
create trigger reset_narrator_contact_after_auth_unlink
before update of auth_user_id on public.narrator_contacts
for each row execute function public.reset_narrator_contact_after_auth_unlink();

drop trigger if exists set_narrator_contacts_updated_at on public.narrator_contacts;
create trigger set_narrator_contacts_updated_at
before update on public.narrator_contacts
for each row execute function public.set_updated_at();

alter table public.narrator_contacts enable row level security;
revoke all on table public.narrator_contacts from anon, authenticated;

comment on table public.narrator_contacts is
  'Private Workshop roster. A contact row never grants portal access or sends email by itself.';
comment on column public.narrator_contacts.source is
  'Human-readable provenance such as Gmail, ACX, Voice123, or manual entry.';
comment on column public.narrator_contacts.source_key is
  'Optional stable key used for a repeatable, private roster import.';
comment on column public.narrator_contacts.auth_user_id is
  'Nullable until an explicit invite or existing-account link is completed.';
comment on column public.narrator_contacts.invite_reservation_id is
  'Stable identifier copied into Auth invitation metadata so retries can recover only this reviewed invitation.';
comment on column public.narrator_contacts.invite_attempt_id is
  'Short-lived lease token preventing overlapping invitation attempts.';

create or replace function public.link_narrator_portal_contact(
  p_contact_id uuid,
  p_expected_updated_at timestamptz,
  p_attempt_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_contact_email text,
  p_contact_status text,
  p_profile_status text,
  p_invite_sent_at timestamptz,
  p_invite_reservation_id uuid,
  p_linked_repair boolean
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  selected_contact_status text;
  selected_auth_user_id uuid;
  selected_attempt_id uuid;
  selected_reservation_id uuid;
  selected_contact_email text;
  resulting_profile_status text;
begin
  if p_contact_status not in ('invite-sent', 'active')
    or p_profile_status not in ('invited', 'active')
    or p_user_id is null
    or p_display_name is null
    or btrim(p_display_name) = ''
    or p_contact_email is null
    or btrim(p_contact_email) = '' then
    return 'invalid-input';
  end if;

  select status, auth_user_id, invite_attempt_id, invite_reservation_id, contact_email
  into selected_contact_status, selected_auth_user_id, selected_attempt_id, selected_reservation_id, selected_contact_email
  from public.narrator_contacts
  where id = p_contact_id and updated_at = p_expected_updated_at
  for update;

  if not found or selected_contact_email is null or lower(btrim(selected_contact_email)) <> lower(btrim(p_contact_email)) then
    return 'contact-conflict';
  end if;

  if p_linked_repair then
    if selected_contact_status <> 'repair-needed' or selected_auth_user_id is distinct from p_user_id then
      return 'contact-conflict';
    end if;
  elsif selected_contact_status <> 'invite-pending'
    or selected_auth_user_id is not null
    or selected_attempt_id is distinct from p_attempt_id
    or selected_reservation_id is distinct from p_invite_reservation_id then
    return 'contact-conflict';
  end if;

  resulting_profile_status := null;
  insert into public.narrator_profiles (user_id, display_name, contact_email, status)
  values (p_user_id, p_display_name, p_contact_email, p_profile_status)
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      contact_email = excluded.contact_email,
      status = case
        when narrator_profiles.status = 'active' then 'active'
        else excluded.status
      end
  where narrator_profiles.status in ('invited', 'active')
  returning status into resulting_profile_status;

  if resulting_profile_status is null then
    select status
    into resulting_profile_status
    from public.narrator_profiles
    where user_id = p_user_id;

    if resulting_profile_status in ('paused', 'closed') then
      return 'profile-' || resulting_profile_status;
    end if;
    return 'profile-conflict';
  end if;

  update public.narrator_contacts
  set auth_user_id = p_user_id,
      status = p_contact_status,
      invite_sent_at = coalesce(p_invite_sent_at, invite_sent_at),
      invite_reservation_id = case when p_contact_status = 'invite-sent' then p_invite_reservation_id else null end,
      invite_attempt_id = null,
      invite_attempt_started_at = null
  where id = p_contact_id;

  return 'linked';
end;
$function$;

revoke all on function public.link_narrator_portal_contact(uuid, timestamptz, uuid, uuid, text, text, text, text, timestamptz, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.link_narrator_portal_contact(uuid, timestamptz, uuid, uuid, text, text, text, text, timestamptz, uuid, boolean)
  to service_role;

comment on function public.link_narrator_portal_contact(uuid, timestamptz, uuid, uuid, text, text, text, text, timestamptz, uuid, boolean) is
  'Atomically links one reserved narrator contact and its portal profile without overriding paused or closed access.';

create or replace function public.activate_narrator_invite_contact(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  selected_contact_id uuid;
  selected_contact_status text;
  selected_profile_status text;
begin
  select id, status
  into selected_contact_id, selected_contact_status
  from public.narrator_contacts
  where auth_user_id = p_user_id
  for update;

  if selected_contact_id is null or selected_contact_status not in ('invite-sent', 'active') then
    return 'not-ready';
  end if;

  select status
  into selected_profile_status
  from public.narrator_profiles
  where user_id = p_user_id
  for update;

  if selected_profile_status is null then
    update public.narrator_contacts
    set status = 'repair-needed'
    where id = selected_contact_id;
    return 'repair-needed';
  end if;

  if selected_profile_status in ('paused', 'closed') then
    return selected_profile_status;
  end if;

  if selected_profile_status = 'active' then
    update public.narrator_contacts
    set status = 'active'
    where id = selected_contact_id and status = 'invite-sent';
    return 'active';
  end if;

  if selected_profile_status <> 'invited' then
    update public.narrator_contacts
    set status = 'repair-needed'
    where id = selected_contact_id;
    return 'repair-needed';
  end if;

  update public.narrator_profiles
  set status = 'active'
  where user_id = p_user_id and status = 'invited';

  update public.narrator_contacts
  set status = 'active'
  where id = selected_contact_id;

  return 'activated';
end;
$function$;

revoke all on function public.activate_narrator_invite_contact(uuid) from public, anon, authenticated, service_role;
grant execute on function public.activate_narrator_invite_contact(uuid) to service_role;

comment on function public.activate_narrator_invite_contact(uuid) is
  'Atomically activates a confirmed narrator invitation without overriding paused or closed access.';
