-- JJ University audiobook and narrator-workflow foundation.
--
-- REVIEWED DRAFT ONLY: do not run against production until the storage plan,
-- narrator invitations, and first real audiobook edition are approved.
-- The migration is additive and intentionally keeps both audio buckets private.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.narrator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  contact_email text not null default '',
  status text not null default 'invited'
    check (status in ('invited', 'active', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audio_editions (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.book_catalog(id) on delete cascade,
  source_content_version integer not null default 0 check (source_content_version >= 0),
  source_content_sha256 text not null default '',
  edition_key text not null default 'standard',
  narrator_name text not null,
  language_code text not null default 'en',
  status text not null default 'planning'
    check (status in ('planning', 'assigned', 'recording', 'submitted', 'qa', 'approved', 'published', 'retired')),
  access_model text not null default 'free'
    check (access_model in ('free', 'account', 'subscription')),
  description text not null default '',
  total_seconds integer not null default 0 check (total_seconds >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, edition_key)
);

create unique index if not exists audio_editions_one_published_per_book_idx
on public.audio_editions(book_id)
where status = 'published';

create table if not exists public.audio_tracks (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.audio_editions(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null,
  section_key text not null default '',
  required_for_submission boolean not null default true,
  storage_bucket text not null default 'audiobooks',
  storage_path text not null default '',
  mime_type text not null default 'audio/mpeg',
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  sha256 text not null default '',
  status text not null default 'expected'
    check (status in ('expected', 'uploaded', 'qa', 'approved', 'published', 'rejected')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, position)
);

create table if not exists public.narrator_assignments (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null unique references public.audio_editions(id) on delete cascade,
  narrator_user_id uuid not null references public.narrator_profiles(user_id) on delete restrict,
  status text not null default 'offered'
    check (status in ('offered', 'accepted', 'recording', 'submitted', 'changes-requested', 'approved', 'closed')),
  due_at timestamptz,
  narrator_brief text not null default '',
  narrator_notes text not null default '',
  admin_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.narrator_submissions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null,
  assignment_id uuid not null references public.narrator_assignments(id) on delete cascade,
  narrator_user_id uuid not null references public.narrator_profiles(user_id) on delete restrict,
  audio_track_id uuid not null references public.audio_tracks(id) on delete restrict,
  track_position integer not null check (track_position > 0),
  track_title text not null,
  original_file_name text not null,
  storage_bucket text not null default 'narrator-audio-intake',
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  upload_status text not null default 'awaiting-upload'
    check (upload_status in ('awaiting-upload', 'uploaded', 'upload-failed', 'in-review', 'changes-requested', 'approved', 'superseded')),
  narrator_note text not null default '',
  narrator_feedback text not null default '',
  review_note text not null default '',
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.narrator_submissions add column if not exists idempotency_key uuid;
update public.narrator_submissions
set idempotency_key = gen_random_uuid()
where idempotency_key is null;
alter table public.narrator_submissions alter column idempotency_key set not null;

-- Keep the draft rerunnable if an earlier foundation revision was applied in a
-- disposable environment. Planned tracks intentionally have no storage object
-- yet, so only non-blank delivery targets are unique.
alter table public.audio_editions
  add column if not exists source_content_version integer not null default 0
    check (source_content_version >= 0);
alter table public.audio_editions
  add column if not exists source_content_sha256 text not null default '';
alter table public.audio_tracks
  add column if not exists required_for_submission boolean not null default true;
alter table public.audio_tracks alter column storage_path set default '';
alter table public.audio_tracks
  drop constraint if exists audio_tracks_storage_bucket_storage_path_key;
alter table public.narrator_submissions
  add column if not exists audio_track_id uuid references public.audio_tracks(id) on delete restrict;
alter table public.narrator_submissions
  add column if not exists narrator_feedback text not null default '';

update public.narrator_submissions submission
set audio_track_id = track.id
from public.narrator_assignments assignment
join public.audio_tracks track
  on track.edition_id = assignment.edition_id
where submission.audio_track_id is null
  and assignment.id = submission.assignment_id
  and track.position = submission.track_position;

create index if not exists audio_editions_book_status_idx
on public.audio_editions(book_id, status);

create index if not exists audio_tracks_edition_position_idx
on public.audio_tracks(edition_id, position);

create unique index if not exists audio_tracks_storage_target_unique_idx
on public.audio_tracks(storage_bucket, storage_path)
where length(trim(storage_path)) > 0;

create index if not exists narrator_assignments_user_status_idx
on public.narrator_assignments(narrator_user_id, status);

create index if not exists narrator_submissions_assignment_idx
on public.narrator_submissions(assignment_id, track_position, created_at desc);

create index if not exists narrator_submissions_assignment_track_idx
on public.narrator_submissions(assignment_id, audio_track_id, created_at desc);

create unique index if not exists narrator_submissions_idempotency_idx
on public.narrator_submissions(narrator_user_id, idempotency_key);

drop trigger if exists set_narrator_profiles_updated_at on public.narrator_profiles;
create trigger set_narrator_profiles_updated_at
before update on public.narrator_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_audio_editions_updated_at on public.audio_editions;
create trigger set_audio_editions_updated_at
before update on public.audio_editions
for each row execute function public.set_updated_at();

drop trigger if exists set_audio_tracks_updated_at on public.audio_tracks;
create trigger set_audio_tracks_updated_at
before update on public.audio_tracks
for each row execute function public.set_updated_at();

drop trigger if exists set_narrator_assignments_updated_at on public.narrator_assignments;
create trigger set_narrator_assignments_updated_at
before update on public.narrator_assignments
for each row execute function public.set_updated_at();

drop trigger if exists set_narrator_submissions_updated_at on public.narrator_submissions;
create trigger set_narrator_submissions_updated_at
before update on public.narrator_submissions
for each row execute function public.set_updated_at();

-- All narrator state changes go through these transaction-scoped functions.
-- The caller's JWT supplies auth.uid(); SECURITY DEFINER grants only the exact
-- transitions below and never exposes general table mutation privileges.
create or replace function public.require_active_narrator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception 'Active narrator access required.' using errcode = '42501';
  end if;

  -- Hold a row lock through the caller's transaction so an administrator
  -- cannot pause/close the narrator between authorization and mutation.
  perform 1
  from public.narrator_profiles
  where user_id = p_user_id
    and status = 'active'
  for share;
  if not found then
    raise exception 'Active narrator access required.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.narrator_accept_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_assignment public.narrator_assignments%rowtype;
  v_edition public.audio_editions%rowtype;
begin
  perform public.require_active_narrator(v_user_id);

  select * into v_assignment
  from public.narrator_assignments
  where id = p_assignment_id
    and narrator_user_id = v_user_id
  for update;

  if not found then
    raise exception 'Assignment not found.' using errcode = '42501';
  end if;

  if v_assignment.status = 'accepted' then
    return jsonb_build_object('assignment_id', v_assignment.id, 'edition_id', v_assignment.edition_id, 'status', 'accepted');
  end if;
  if v_assignment.status <> 'offered' then
    raise exception 'Assignment is not open for acceptance.' using errcode = '55000';
  end if;

  select * into v_edition
  from public.audio_editions
  where id = v_assignment.edition_id
  for update;
  if not found or v_edition.status not in ('planning', 'assigned') then
    raise exception 'Edition is not ready for assignment.' using errcode = '55000';
  end if;

  update public.narrator_assignments
  set status = 'accepted'
  where id = v_assignment.id
    and status = 'offered';
  if not found then
    raise exception 'Assignment state changed.' using errcode = '40001';
  end if;

  update public.audio_editions
  set status = 'assigned'
  where id = v_assignment.edition_id
    and status in ('planning', 'assigned');
  if not found then
    raise exception 'Edition state changed.' using errcode = '40001';
  end if;

  return jsonb_build_object('assignment_id', v_assignment.id, 'edition_id', v_assignment.edition_id, 'status', 'accepted');
end;
$$;

-- Remove the first draft's client-authored position/title overload. Expected
-- track identity is the only narrator-supplied track field; the transaction
-- derives display metadata from the assignment's edition.
drop function if exists public.narrator_prepare_submission(uuid, uuid, integer, text, text, text, bigint, text);
create or replace function public.narrator_prepare_submission(
  p_assignment_id uuid,
  p_idempotency_key uuid,
  p_audio_track_id uuid,
  p_original_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_narrator_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_assignment public.narrator_assignments%rowtype;
  v_track public.audio_tracks%rowtype;
  v_submission public.narrator_submissions%rowtype;
  v_submission_id uuid := gen_random_uuid();
  v_file_name text;
  v_storage_path text;
begin
  perform public.require_active_narrator(v_user_id);

  if p_idempotency_key is null
    or p_audio_track_id is null
    or length(trim(coalesce(p_original_file_name, ''))) = 0
    or p_file_size_bytes is null or p_file_size_bytes < 1 or p_file_size_bytes > 52428800
    or lower(coalesce(p_mime_type, '')) not in ('audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/flac')
  then
    raise exception 'Invalid audio submission.' using errcode = '22023';
  end if;

  select * into v_assignment
  from public.narrator_assignments
  where id = p_assignment_id
    and narrator_user_id = v_user_id
  for update;
  if not found or v_assignment.status not in ('accepted', 'recording', 'changes-requested') then
    raise exception 'Assignment is not open for uploads.' using errcode = '42501';
  end if;

  select * into v_track
  from public.audio_tracks
  where id = p_audio_track_id
    and edition_id = v_assignment.edition_id
  for share;
  if not found or length(trim(v_track.title)) = 0 then
    raise exception 'Expected audio track not found.' using errcode = '42501';
  end if;

  select * into v_submission
  from public.narrator_submissions
  where narrator_user_id = v_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_submission.assignment_id <> p_assignment_id
      or v_submission.audio_track_id is distinct from v_track.id
      or v_submission.track_position <> v_track.position
      or v_submission.track_title <> left(trim(v_track.title), 160)
      or v_submission.original_file_name <> left(trim(p_original_file_name), 120)
      or v_submission.mime_type <> lower(p_mime_type)
      or v_submission.file_size_bytes <> p_file_size_bytes
      or v_submission.narrator_note <> left(trim(coalesce(p_narrator_note, '')), 1000)
    then
      raise exception 'Idempotency key was reused with different upload data.' using errcode = '22023';
    end if;

    return jsonb_build_object(
      'submission_id', v_submission.id,
      'assignment_id', v_submission.assignment_id,
      'audio_track_id', v_submission.audio_track_id,
      'track_position', v_submission.track_position,
      'track_title', v_submission.track_title,
      'storage_bucket', v_submission.storage_bucket,
      'storage_path', v_submission.storage_path,
      'upload_status', v_submission.upload_status
    );
  end if;

  v_file_name := regexp_replace(left(trim(coalesce(p_original_file_name, 'audio.mp3')), 120), '[^a-zA-Z0-9._-]+', '-', 'g');
  v_file_name := trim(both '-' from v_file_name);
  if length(v_file_name) = 0 then v_file_name := 'audio.mp3'; end if;
  v_storage_path := v_user_id::text || '/' || p_assignment_id::text || '/' || v_submission_id::text || '-' || v_file_name;

  insert into public.narrator_submissions (
    id,
    idempotency_key,
    assignment_id,
    narrator_user_id,
    audio_track_id,
    track_position,
    track_title,
    original_file_name,
    storage_bucket,
    storage_path,
    mime_type,
    file_size_bytes,
    upload_status,
    narrator_note
  ) values (
    v_submission_id,
    p_idempotency_key,
    p_assignment_id,
    v_user_id,
    v_track.id,
    v_track.position,
    left(trim(v_track.title), 160),
    left(trim(p_original_file_name), 120),
    'narrator-audio-intake',
    v_storage_path,
    lower(p_mime_type),
    p_file_size_bytes,
    'awaiting-upload',
    left(trim(coalesce(p_narrator_note, '')), 1000)
  )
  on conflict (narrator_user_id, idempotency_key) do nothing
  returning * into v_submission;

  if not found then
    select * into v_submission
    from public.narrator_submissions
    where narrator_user_id = v_user_id
      and idempotency_key = p_idempotency_key;
  end if;

  if v_submission.id is null
    or v_submission.assignment_id <> p_assignment_id
    or v_submission.audio_track_id is distinct from v_track.id
    or v_submission.track_position <> v_track.position
    or v_submission.track_title <> left(trim(v_track.title), 160)
    or v_submission.original_file_name <> left(trim(p_original_file_name), 120)
    or v_submission.mime_type <> lower(p_mime_type)
    or v_submission.file_size_bytes <> p_file_size_bytes
    or v_submission.narrator_note <> left(trim(coalesce(p_narrator_note, '')), 1000)
  then
    raise exception 'Could not establish an idempotent submission.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'submission_id', v_submission.id,
    'assignment_id', v_submission.assignment_id,
    'audio_track_id', v_submission.audio_track_id,
    'track_position', v_submission.track_position,
    'track_title', v_submission.track_title,
    'storage_bucket', v_submission.storage_bucket,
    'storage_path', v_submission.storage_path,
    'upload_status', v_submission.upload_status
  );
end;
$$;

-- Completion is deliberately service-only because object existence and byte size
-- are verified against Supabase Storage by the trusted Next.js route first.
-- Dropping the earlier two-argument draft prevents a stale authenticated-callable
-- overload from surviving a rerun of this migration.
drop function if exists public.narrator_complete_submission(uuid, bigint);
create or replace function public.narrator_complete_submission(
  p_expected_user_id uuid,
  p_submission_id uuid,
  p_observed_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := p_expected_user_id;
  v_assignment public.narrator_assignments%rowtype;
  v_submission public.narrator_submissions%rowtype;
  v_track public.audio_tracks%rowtype;
  v_edition public.audio_editions%rowtype;
  v_expected_prefix text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted audio completion service required.' using errcode = '42501';
  end if;
  if v_user_id is null then
    raise exception 'Expected narrator identity is required.' using errcode = '22023';
  end if;
  if p_observed_size_bytes is null or p_observed_size_bytes < 1 then
    raise exception 'A verified non-zero object size is required.' using errcode = '22023';
  end if;

  perform public.require_active_narrator(v_user_id);

  select * into v_submission
  from public.narrator_submissions
  where id = p_submission_id
    and narrator_user_id = v_user_id
  for update;
  if not found then
    raise exception 'Submission not found.' using errcode = '42501';
  end if;

  select * into v_assignment
  from public.narrator_assignments
  where id = v_submission.assignment_id
    and narrator_user_id = v_user_id
  for update;
  if not found or v_assignment.status not in ('accepted', 'recording', 'changes-requested') then
    raise exception 'Assignment is not open for completion.' using errcode = '42501';
  end if;

  -- Serialize completion per expected track so exactly one verified version is
  -- current even when two uploads finish close together.
  select * into v_track
  from public.audio_tracks
  where id = v_submission.audio_track_id
    and edition_id = v_assignment.edition_id
  for update;
  if not found then
    raise exception 'Submission is not linked to an expected track.' using errcode = '42501';
  end if;

  v_expected_prefix := v_user_id::text || '/' || v_assignment.id::text || '/';
  if v_submission.storage_bucket <> 'narrator-audio-intake'
    or left(v_submission.storage_path, length(v_expected_prefix)) <> v_expected_prefix
  then
    raise exception 'Submission storage target is invalid.' using errcode = '42501';
  end if;

  if p_observed_size_bytes <> v_submission.file_size_bytes then
    raise exception 'Uploaded object size does not match the prepared submission.' using errcode = '22000';
  end if;

  if v_submission.upload_status = 'uploaded' then
    return jsonb_build_object(
      'submission_id', v_submission.id,
      'assignment_id', v_assignment.id,
      'audio_track_id', v_track.id,
      'status', 'uploaded',
      'replayed', true
    );
  end if;
  if v_submission.upload_status <> 'awaiting-upload' then
    raise exception 'Submission is not awaiting upload.' using errcode = '55000';
  end if;

  select * into v_edition
  from public.audio_editions
  where id = v_assignment.edition_id
  for update;
  if not found or v_edition.status not in ('assigned', 'recording', 'submitted', 'qa') then
    raise exception 'Edition is not open for narrator changes.' using errcode = '55000';
  end if;

  update public.narrator_submissions
  set upload_status = 'superseded'
  where assignment_id = v_assignment.id
    and narrator_user_id = v_user_id
    and audio_track_id = v_track.id
    and id <> v_submission.id
    and upload_status in ('uploaded', 'in-review', 'changes-requested', 'approved');

  update public.narrator_submissions
  set upload_status = 'uploaded', uploaded_at = coalesce(uploaded_at, now())
  where id = v_submission.id
    and upload_status = 'awaiting-upload';
  if not found then
    raise exception 'Submission state changed.' using errcode = '40001';
  end if;

  update public.narrator_assignments
  set status = 'recording'
  where id = v_assignment.id
    and status in ('accepted', 'recording', 'changes-requested');
  if not found then
    raise exception 'Assignment state changed.' using errcode = '40001';
  end if;

  update public.audio_editions
  set status = 'recording'
  where id = v_assignment.edition_id
    and status in ('assigned', 'recording', 'submitted', 'qa');
  if not found then
    raise exception 'Edition state changed.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'submission_id', v_submission.id,
    'assignment_id', v_assignment.id,
    'audio_track_id', v_track.id,
    'status', 'uploaded',
    'replayed', false
  );
end;
$$;

create or replace function public.narrator_submit_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_assignment public.narrator_assignments%rowtype;
  v_edition public.audio_editions%rowtype;
begin
  perform public.require_active_narrator(v_user_id);

  select * into v_assignment
  from public.narrator_assignments
  where id = p_assignment_id
    and narrator_user_id = v_user_id
  for update;
  if not found then
    raise exception 'Assignment not found.' using errcode = '42501';
  end if;

  if v_assignment.status not in ('accepted', 'recording', 'changes-requested', 'submitted') then
    raise exception 'Assignment is not open for submission.' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.audio_tracks track
    where track.edition_id = v_assignment.edition_id
      and track.required_for_submission
  ) then
    raise exception 'No required audio tracks are configured for this assignment.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.audio_tracks track
    where track.edition_id = v_assignment.edition_id
      and track.required_for_submission
      and not exists (
        select 1
        from public.narrator_submissions submission
        where submission.assignment_id = v_assignment.id
          and submission.narrator_user_id = v_user_id
          and submission.audio_track_id = track.id
          and submission.upload_status in ('uploaded', 'in-review', 'approved')
      )
  ) then
    raise exception 'Finish every required track before submitting.' using errcode = '55000';
  end if;

  if v_assignment.status = 'submitted' then
    return jsonb_build_object('assignment_id', v_assignment.id, 'edition_id', v_assignment.edition_id, 'status', 'submitted');
  end if;

  select * into v_edition
  from public.audio_editions
  where id = v_assignment.edition_id
  for update;
  if not found or v_edition.status not in ('assigned', 'recording', 'submitted') then
    raise exception 'Edition is not ready for submission.' using errcode = '55000';
  end if;

  update public.narrator_submissions
  set upload_status = 'in-review'
  where assignment_id = v_assignment.id
    and narrator_user_id = v_user_id
    and upload_status = 'uploaded';

  update public.narrator_assignments
  set status = 'submitted'
  where id = v_assignment.id
    and status in ('accepted', 'recording', 'changes-requested');
  if not found then
    raise exception 'Assignment state changed.' using errcode = '40001';
  end if;

  update public.audio_editions
  set status = 'submitted'
  where id = v_assignment.edition_id
    and status in ('assigned', 'recording', 'submitted');
  if not found then
    raise exception 'Edition state changed.' using errcode = '40001';
  end if;

  return jsonb_build_object('assignment_id', v_assignment.id, 'edition_id', v_assignment.edition_id, 'status', 'submitted');
end;
$$;

revoke all on function public.require_active_narrator(uuid) from public, authenticated;
revoke all on function public.narrator_accept_assignment(uuid) from public;
revoke all on function public.narrator_prepare_submission(uuid, uuid, uuid, text, text, bigint, text) from public;
revoke all on function public.narrator_complete_submission(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.narrator_submit_assignment(uuid) from public;
grant execute on function public.narrator_accept_assignment(uuid) to authenticated;
grant execute on function public.narrator_prepare_submission(uuid, uuid, uuid, text, text, bigint, text) to authenticated;
grant execute on function public.narrator_complete_submission(uuid, uuid, bigint) to service_role;
grant execute on function public.narrator_submit_assignment(uuid) to authenticated;

alter table public.narrator_profiles enable row level security;
alter table public.audio_editions enable row level security;
alter table public.audio_tracks enable row level security;
alter table public.narrator_assignments enable row level security;
alter table public.narrator_submissions enable row level security;

-- Narrators can read their own portal data. They cannot mutate assignment,
-- review, edition, or track records directly.
drop policy if exists "narrator_profiles_select_own" on public.narrator_profiles;
create policy "narrator_profiles_select_own"
on public.narrator_profiles for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "narrator_editions_select_assigned" on public.audio_editions;
create policy "narrator_editions_select_assigned"
on public.audio_editions for select
to authenticated
using (
  exists (
    select 1
    from public.narrator_assignments assignment
    where assignment.edition_id = audio_editions.id
      and assignment.narrator_user_id = (select auth.uid())
  )
);

drop policy if exists "narrator_tracks_select_assigned" on public.audio_tracks;
create policy "narrator_tracks_select_assigned"
on public.audio_tracks for select
to authenticated
using (
  exists (
    select 1
    from public.narrator_assignments assignment
    where assignment.edition_id = audio_tracks.edition_id
      and assignment.narrator_user_id = (select auth.uid())
  )
);

drop policy if exists "narrator_assignments_select_own" on public.narrator_assignments;
create policy "narrator_assignments_select_own"
on public.narrator_assignments for select
to authenticated
using ((select auth.uid()) = narrator_user_id);

drop policy if exists "narrator_submissions_select_own" on public.narrator_submissions;
create policy "narrator_submissions_select_own"
on public.narrator_submissions for select
to authenticated
using ((select auth.uid()) = narrator_user_id);

drop policy if exists "narrator_submissions_insert_own_assignment" on public.narrator_submissions;

drop policy if exists "narrator_profiles_admin_all" on public.narrator_profiles;
create policy "narrator_profiles_admin_all"
on public.narrator_profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "audio_editions_admin_all" on public.audio_editions;
create policy "audio_editions_admin_all"
on public.audio_editions for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "audio_tracks_admin_all" on public.audio_tracks;
create policy "audio_tracks_admin_all"
on public.audio_tracks for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "narrator_assignments_admin_all" on public.narrator_assignments;
create policy "narrator_assignments_admin_all"
on public.narrator_assignments for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "narrator_submissions_admin_all" on public.narrator_submissions;
create policy "narrator_submissions_admin_all"
on public.narrator_submissions for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Column-scoped grants keep private production/admin fields out of narrator
-- clients even when they query PostgREST directly. In particular,
-- narrator_assignments.admin_notes and narrator_submissions.review_note remain
-- private; narrator_feedback is the intentionally narrator-visible review field.
revoke select on public.narrator_profiles from anon, authenticated;
revoke select on public.audio_editions from anon, authenticated;
revoke select on public.audio_tracks from anon, authenticated;
revoke select on public.narrator_assignments from anon, authenticated;
revoke select on public.narrator_submissions from anon, authenticated;

grant select (user_id, display_name, status)
on public.narrator_profiles to authenticated;
grant select (id, book_id, status)
on public.audio_editions to authenticated;
grant select (id, edition_id, position, section_key, title, required_for_submission)
on public.audio_tracks to authenticated;
grant select (id, edition_id, narrator_user_id, status, due_at, narrator_brief, created_at)
on public.narrator_assignments to authenticated;
grant select (
  id,
  assignment_id,
  narrator_user_id,
  audio_track_id,
  track_position,
  track_title,
  original_file_name,
  storage_bucket,
  storage_path,
  mime_type,
  file_size_bytes,
  upload_status,
  narrator_note,
  narrator_feedback,
  created_at,
  uploaded_at
)
on public.narrator_submissions to authenticated;
revoke insert, update, delete on public.narrator_submissions from anon, authenticated;

-- Both buckets stay private. Narrator uploads use short-lived, path-specific
-- signed upload tokens created only after the server verifies an assignment.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'narrator-audio-intake',
  'narrator-audio-intake',
  false,
  52428800,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/flac']
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audiobooks',
  'audiobooks',
  false,
  52428800,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg']
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
