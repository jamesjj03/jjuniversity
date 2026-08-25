-- Demote the exact accidentally published Tacos baseline to QA.
--
-- This migration is intentionally specific to the live rows audited on
-- 2026-08-24. It snapshots the edition and all 16 tracks, checks immutable
-- row fingerprints and Storage references, then changes only status and
-- published_at. It never inserts, updates, moves, or deletes Storage objects.
--
-- A rerun is a no-op only while this same edition remains in the corrected QA
-- state. If it is intentionally republished later, rerunning this migration
-- aborts instead of silently demoting an approved release.

begin;

lock table public.audio_editions in share row exclusive mode;
lock table public.audio_tracks in share row exclusive mode;
lock table public.narrator_assignments in share mode;
lock table public.narrator_submissions in share mode;

create table if not exists public.jju_audio_release_state_audit (
  migration_key text primary key,
  edition_id uuid not null,
  previous_edition jsonb not null,
  previous_tracks jsonb not null,
  recorded_at timestamptz not null default now()
);

alter table public.jju_audio_release_state_audit enable row level security;
revoke all on public.jju_audio_release_state_audit
  from public, anon, authenticated, service_role;
grant select on public.jju_audio_release_state_audit to service_role;

do $preflight$
declare
  v_edition_id constant uuid := '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid;
  v_status text;
  v_edition_core_fingerprint text;
  v_track_core_fingerprint text;
  v_track_count bigint;
  v_target_object_count bigint;
  v_has_audit boolean;
begin
  select edition.status,
         encode(
           extensions.digest(
             concat_ws('|',
               edition.id::text,
               edition.book_id,
               edition.edition_key,
               edition.access_model,
               edition.source_content_version::text,
               edition.source_content_sha256,
               edition.total_seconds::text,
               edition.narrator_name,
               edition.language_code,
               edition.description
             ),
             'sha256'
           ),
           'hex'
         )
  into v_status, v_edition_core_fingerprint
  from public.audio_editions edition
  where edition.id = v_edition_id;

  if not found then
    raise exception 'The exact audited Tacos edition is missing.'
      using errcode = '55000';
  end if;

  if v_edition_core_fingerprint <> '18728f60810e93edeb2ae235c64cda2c838eefa3c32cd6faf97c7a148ad69b39' then
    raise exception 'The Tacos edition core fields differ from the audited baseline.'
      using errcode = '55000';
  end if;

  select count(*),
         encode(
           extensions.digest(
             string_agg(
               concat_ws('|',
                 track.id::text,
                 track.edition_id::text,
                 track.position::text,
                 track.title,
                 track.section_key,
                 track.required_for_submission::text,
                 track.storage_bucket,
                 track.storage_path,
                 track.mime_type,
                 track.file_size_bytes::text,
                 track.duration_seconds::text,
                 track.sha256
               ),
               chr(10) order by track.position
             ),
             'sha256'
           ),
           'hex'
         )
  into v_track_count, v_track_core_fingerprint
  from public.audio_tracks track
  where track.edition_id = v_edition_id;

  if v_track_count <> 16
     or v_track_core_fingerprint <> 'f91083c863fc8b17801a8a2bac6645087baf0d00618a9779a2685919eeb85ffc'
  then
    raise exception 'The Tacos track set differs from the exact audited 16-row baseline.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.narrator_assignments assignment
    where assignment.edition_id = v_edition_id
  ) or exists (
    select 1
    from public.narrator_submissions submission
    join public.narrator_assignments assignment on assignment.id = submission.assignment_id
    where assignment.edition_id = v_edition_id
  ) then
    raise exception 'Narrator workflow rows now reference the Tacos edition; manual review is required.'
      using errcode = '55000';
  end if;

  select count(*) into v_target_object_count
  from public.audio_tracks track
  join storage.objects object
    on object.bucket_id = track.storage_bucket
   and object.name = track.storage_path
  where track.edition_id = v_edition_id;

  if v_target_object_count <> 16 then
    raise exception 'Not all 16 audited Tacos delivery objects are present in private Storage.'
      using errcode = '55000';
  end if;

  select exists (
    select 1 from public.jju_audio_release_state_audit
    where migration_key = 'tacos-published-to-qa-v1'
  ) into v_has_audit;

  if v_status = 'published' then
    if v_has_audit then
      raise exception 'This edition was corrected once and has since been republished; refusing to demote it again.'
        using errcode = '55000';
    end if;
    if exists (
      select 1 from public.audio_tracks
      where edition_id = v_edition_id
        and (status <> 'published' or published_at is null)
    ) or exists (
      select 1 from public.audio_editions
      where id = v_edition_id and published_at is null
    ) then
      raise exception 'The published Tacos state is partial; refusing an automatic correction.'
        using errcode = '55000';
    end if;
  elsif v_status = 'qa' then
    if not v_has_audit then
      raise exception 'The edition is already QA without this migration audit record.'
        using errcode = '55000';
    end if;
    if exists (
      select 1 from public.audio_tracks
      where edition_id = v_edition_id
        and (status <> 'qa' or published_at is not null)
    ) or exists (
      select 1 from public.audio_editions
      where id = v_edition_id and published_at is not null
    ) then
      raise exception 'The corrected Tacos QA state is internally inconsistent.'
        using errcode = '55000';
    end if;
  else
    raise exception 'Expected the exact published baseline or corrected QA state; found status "%".', v_status
      using errcode = '55000';
  end if;
end;
$preflight$;

insert into public.jju_audio_release_state_audit
  (migration_key, edition_id, previous_edition, previous_tracks)
select
  'tacos-published-to-qa-v1',
  edition.id,
  to_jsonb(edition),
  (
    select jsonb_agg(to_jsonb(track) order by track.position)
    from public.audio_tracks track
    where track.edition_id = edition.id
  )
from public.audio_editions edition
where edition.id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
  and edition.status = 'published'
on conflict (migration_key) do nothing;

update public.audio_tracks
set status = 'qa',
    published_at = null
where edition_id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
  and status = 'published';

update public.audio_editions
set status = 'qa',
    published_at = null
where id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
  and status = 'published';

do $postcheck$
declare
  v_edition_id constant uuid := '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid;
begin
  if not exists (
    select 1 from public.jju_audio_release_state_audit
    where migration_key = 'tacos-published-to-qa-v1'
      and edition_id = v_edition_id
      and jsonb_array_length(previous_tracks) = 16
      and previous_edition->>'status' = 'published'
  ) then
    raise exception 'The Tacos pre-correction snapshot was not preserved.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.audio_editions
    where id = v_edition_id
      and status = 'qa'
      and published_at is null
  ) or (
    select count(*) from public.audio_tracks
    where edition_id = v_edition_id
      and status = 'qa'
      and published_at is null
  ) <> 16 then
    raise exception 'The Tacos rows did not finish in the exact 1-edition/16-track QA state.'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from public.audio_tracks track
    join storage.objects object
      on object.bucket_id = track.storage_bucket
     and object.name = track.storage_path
    where track.edition_id = v_edition_id
  ) <> 16 then
    raise exception 'A referenced private Storage object disappeared during correction.'
      using errcode = '55000';
  end if;
end;
$postcheck$;

commit;
