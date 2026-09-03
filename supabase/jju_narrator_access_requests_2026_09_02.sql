-- JJ University narrator access requests.
--
-- ADDITIVE REVIEWED MIGRATION ONLY. Apply after:
--   1. jju_audio_foundation_2026_08_20.sql
--   2. jju_narrator_contacts_2026_09_02.sql
--
-- Public browsers never receive direct table or function access. The public
-- form talks to a server route, and that route uses only these service-role
-- RPCs. Approval creates or links a contact; it never sends a portal invite.

begin;

create table if not exists public.narrator_access_requests (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  contact_email text not null,
  note text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined')),
  requester_fingerprint text not null,
  notification_status text not null default 'pending'
    check (notification_status in ('pending', 'sending', 'sent', 'failed')),
  notification_attempted_at timestamptz,
  notification_sent_at timestamptz,
  notification_last_error text not null default '',
  linked_contact_id uuid references public.narrator_contacts(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(display_name)) between 1 and 80),
  check (length(btrim(contact_email)) between 3 and 254),
  check (length(note) <= 600),
  check (requester_fingerprint ~ '^[0-9a-f]{64}$')
);

create unique index if not exists narrator_access_requests_pending_email_idx
on public.narrator_access_requests (lower(btrim(contact_email)))
where status = 'pending';

create index if not exists narrator_access_requests_review_queue_idx
on public.narrator_access_requests (status, created_at desc);

create table if not exists public.narrator_access_request_rate_limits (
  requester_fingerprint text primary key,
  request_count integer not null default 0 check (request_count >= 0),
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_fingerprint ~ '^[0-9a-f]{64}$')
);

create table if not exists public.narrator_access_request_global_limit (
  singleton boolean primary key default true check (singleton),
  request_count integer not null default 0 check (request_count >= 0),
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_narrator_access_requests_updated_at on public.narrator_access_requests;
create trigger set_narrator_access_requests_updated_at
before update on public.narrator_access_requests
for each row execute function public.set_updated_at();

drop trigger if exists set_narrator_access_request_rate_limits_updated_at on public.narrator_access_request_rate_limits;
create trigger set_narrator_access_request_rate_limits_updated_at
before update on public.narrator_access_request_rate_limits
for each row execute function public.set_updated_at();

drop trigger if exists set_narrator_access_request_global_limit_updated_at on public.narrator_access_request_global_limit;
create trigger set_narrator_access_request_global_limit_updated_at
before update on public.narrator_access_request_global_limit
for each row execute function public.set_updated_at();

alter table public.narrator_access_requests enable row level security;
alter table public.narrator_access_request_rate_limits enable row level security;
alter table public.narrator_access_request_global_limit enable row level security;
revoke all on table public.narrator_access_requests from public, anon, authenticated;
revoke all on table public.narrator_access_request_rate_limits from public, anon, authenticated;
revoke all on table public.narrator_access_request_global_limit from public, anon, authenticated;

comment on table public.narrator_access_requests is
  'Private requests from the public narrator interest form. A request never grants portal access.';
comment on column public.narrator_access_requests.requester_fingerprint is
  'Keyed server-side digest used only for abuse throttling; no raw address is stored.';
comment on column public.narrator_access_requests.linked_contact_id is
  'Roster contact created or selected by an explicit Workshop approval.';

create or replace function public.submit_narrator_access_request(
  p_display_name text,
  p_contact_email text,
  p_note text,
  p_requester_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  selected_request_id uuid;
  selected_rate_count integer;
  selected_window_started_at timestamptz;
  selected_global_count integer;
  selected_global_window_started_at timestamptz;
begin
  p_display_name := btrim(regexp_replace(coalesce(p_display_name, ''), '\s+', ' ', 'g'));
  p_contact_email := lower(btrim(coalesce(p_contact_email, '')));
  p_note := btrim(coalesce(p_note, ''));
  p_requester_fingerprint := lower(btrim(coalesce(p_requester_fingerprint, '')));

  if length(p_display_name) not between 1 and 80
    or length(p_contact_email) not between 3 and 254
    or p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(p_note) > 600
    or p_requester_fingerprint !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  insert into public.narrator_access_request_rate_limits (requester_fingerprint)
  values (p_requester_fingerprint)
  on conflict (requester_fingerprint) do nothing;

  select request_count, window_started_at
  into selected_rate_count, selected_window_started_at
  from public.narrator_access_request_rate_limits
  where requester_fingerprint = p_requester_fingerprint
  for update;

  if selected_window_started_at <= now() - interval '1 hour' then
    update public.narrator_access_request_rate_limits
    set request_count = 1, window_started_at = now()
    where requester_fingerprint = p_requester_fingerprint;
  elsif selected_rate_count >= 5 then
    return null;
  else
    update public.narrator_access_request_rate_limits
    set request_count = request_count + 1
    where requester_fingerprint = p_requester_fingerprint;
  end if;

  insert into public.narrator_access_request_global_limit (singleton)
  values (true)
  on conflict (singleton) do nothing;

  select request_count, window_started_at
  into selected_global_count, selected_global_window_started_at
  from public.narrator_access_request_global_limit
  where singleton = true
  for update;

  if selected_global_window_started_at <= now() - interval '1 hour' then
    update public.narrator_access_request_global_limit
    set request_count = 1, window_started_at = now()
    where singleton = true;
  elsif selected_global_count >= 20 then
    return null;
  else
    update public.narrator_access_request_global_limit
    set request_count = request_count + 1
    where singleton = true;
  end if;

  delete from public.narrator_access_request_rate_limits
  where requester_fingerprint in (
    select requester_fingerprint
    from public.narrator_access_request_rate_limits
    where updated_at < now() - interval '7 days'
      and requester_fingerprint <> p_requester_fingerprint
    order by updated_at
    limit 25
    for update skip locked
  );

  select id
  into selected_request_id
  from public.narrator_access_requests
  where lower(btrim(contact_email)) = p_contact_email
    and status = 'pending'
  order by created_at desc
  limit 1;

  if selected_request_id is not null then
    return selected_request_id;
  end if;

  insert into public.narrator_access_requests (
    display_name,
    contact_email,
    note,
    requester_fingerprint
  )
  values (
    p_display_name,
    p_contact_email,
    p_note,
    p_requester_fingerprint
  )
  on conflict do nothing
  returning id into selected_request_id;

  if selected_request_id is null then
    select id
    into selected_request_id
    from public.narrator_access_requests
    where lower(btrim(contact_email)) = p_contact_email
      and status = 'pending'
    order by created_at desc
    limit 1;
  end if;

  return selected_request_id;
end;
$function$;

revoke all on function public.submit_narrator_access_request(text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_narrator_access_request(text, text, text, text)
  to service_role;

create or replace function public.claim_narrator_access_notification(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  selected_notification_status text;
  selected_attempted_at timestamptz;
begin
  select notification_status, notification_attempted_at
  into selected_notification_status, selected_attempted_at
  from public.narrator_access_requests
  where id = p_request_id
  for update;

  if not found or selected_notification_status = 'sent' then
    return false;
  end if;

  if selected_notification_status = 'sending'
    and selected_attempted_at > now() - interval '10 minutes' then
    return false;
  end if;

  update public.narrator_access_requests
  set notification_status = 'sending',
      notification_attempted_at = now(),
      notification_last_error = ''
  where id = p_request_id;

  return true;
end;
$function$;

revoke all on function public.claim_narrator_access_notification(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_narrator_access_notification(uuid)
  to service_role;

create or replace function public.review_narrator_access_request(
  p_request_id uuid,
  p_expected_updated_at timestamptz,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  selected_request public.narrator_access_requests%rowtype;
  selected_contact_id uuid;
begin
  if p_decision not in ('approve', 'decline') then
    return 'invalid-decision';
  end if;

  select *
  into selected_request
  from public.narrator_access_requests
  where id = p_request_id
    and updated_at = p_expected_updated_at
  for update;

  if not found or selected_request.status <> 'pending' then
    return 'request-conflict';
  end if;

  if p_decision = 'decline' then
    update public.narrator_access_requests
    set status = 'declined', reviewed_at = now()
    where id = p_request_id;
    return 'declined';
  end if;

  select id
  into selected_contact_id
  from public.narrator_contacts
  where lower(btrim(contact_email)) = lower(btrim(selected_request.contact_email))
  for update;

  if selected_contact_id is null then
    insert into public.narrator_contacts (
      source_key,
      display_name,
      contact_email,
      source,
      notes,
      status
    )
    values (
      'access-request:' || selected_request.id::text,
      selected_request.display_name,
      lower(btrim(selected_request.contact_email)),
      'Narrator access request',
      '',
      'contact'
    )
    on conflict do nothing
    returning id into selected_contact_id;

    if selected_contact_id is null then
      select id
      into selected_contact_id
      from public.narrator_contacts
      where lower(btrim(contact_email)) = lower(btrim(selected_request.contact_email))
      for update;
    end if;
  end if;

  if selected_contact_id is null then
    return 'contact-conflict';
  end if;

  update public.narrator_access_requests
  set status = 'approved',
      linked_contact_id = selected_contact_id,
      reviewed_at = now()
  where id = p_request_id;

  return 'approved';
end;
$function$;

revoke all on function public.review_narrator_access_request(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_narrator_access_request(uuid, timestamptz, text)
  to service_role;

commit;
