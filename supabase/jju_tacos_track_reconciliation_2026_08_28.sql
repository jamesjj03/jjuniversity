-- Reconcile the exact approved Tacos alternatives for tracks 10, 13, and 16.
--
-- This migration is deliberately narrower than a publication migration. It:
--   * accepts only the audited QA baseline or its own exact reconciled state;
--   * verifies all 16 track rows, the three replacement files, and the three
--     previous files before changing database references;
--   * snapshots the previous edition, track rows, and Storage object metadata;
--   * updates only the three delivery references and the edition duration;
--   * leaves the edition and every track in QA with published_at null; and
--   * never inserts, updates, moves, or deletes a Storage object.
--
-- The replacement object bytes were independently SHA-256 checked against the
-- sealed human-listen package on 2026-08-28. PostgreSQL cannot hash private
-- Storage payload bytes here, so this transaction additionally pins each live
-- object UUID, byte count, MIME type, and ETag. Any drift aborts the migration.
--
-- Exact rollback: jju_tacos_track_reconciliation_rollback_2026_08_28.sql

begin;

lock table public.audio_editions in share row exclusive mode;
lock table public.audio_tracks in share row exclusive mode;
lock table public.narrator_assignments in share mode;
lock table public.narrator_submissions in share mode;

create table if not exists public.jju_audio_track_reconciliation_audit (
  migration_key text primary key,
  edition_id uuid not null,
  previous_edition jsonb not null,
  previous_tracks jsonb not null
    check (jsonb_typeof(previous_tracks) = 'array'),
  previous_objects jsonb not null
    check (jsonb_typeof(previous_objects) = 'array'),
  target_objects jsonb not null
    check (jsonb_typeof(target_objects) = 'array'),
  sealed_manifest jsonb not null
    check (jsonb_typeof(sealed_manifest) = 'array'),
  recorded_at timestamptz not null default now()
);

alter table public.jju_audio_track_reconciliation_audit enable row level security;
revoke all on public.jju_audio_track_reconciliation_audit
  from public, anon, authenticated, service_role;
grant select on public.jju_audio_track_reconciliation_audit to service_role;

lock table public.jju_audio_track_reconciliation_audit
  in share row exclusive mode;

create temporary table jju_tacos_reconciliation_tracks (
  track_id uuid primary key,
  position integer not null unique,
  title text not null,
  section_key text not null,
  required_for_submission boolean not null,
  storage_bucket text not null,
  mime_type text not null,
  old_storage_path text not null unique,
  old_file_size_bytes bigint not null,
  old_duration_seconds integer not null,
  old_sha256 text not null,
  new_storage_path text not null unique,
  new_file_size_bytes bigint not null,
  new_duration_seconds integer not null,
  new_sha256 text not null
) on commit drop;

insert into jju_tacos_reconciliation_tracks values
  (
    '7cf535d4-7a77-4141-ae49-eb388558201d'::uuid,
    10,
    'Chapter Eight - Back to the Taco Truck',
    'section-011',
    true,
    'audiobooks',
    'audio/mpeg',
    'everything-i-touch-turns-to-tacos/standard/10-992cecfdefaa74d2.mp3',
    5489480,
    137,
    '992cecfdefaa74d2f7872bd40cf9428482b968e7411fa1bcd9ece905bd933cc9',
    'everything-i-touch-turns-to-tacos/standard/10-0a69afb8a56a0b6e.mp3',
    5529152,
    138,
    '0a69afb8a56a0b6e5f842306720778a275bc10d73b127b937b89daee6bfb808c'
  ),
  (
    '216429c4-d79f-4613-a21d-efd0cea6da79'::uuid,
    13,
    'Tips from Max (Just for Kids)',
    'section-014',
    true,
    'audiobooks',
    'audio/mpeg',
    'everything-i-touch-turns-to-tacos/standard/13-ebbf68878706555c.mp3',
    907364,
    23,
    'ebbf68878706555c1abd3588213face53811d0bac6c8e51713d02ffaf1595b7d',
    'everything-i-touch-turns-to-tacos/standard/13-b0646c8581ffc3e4.mp3',
    919892,
    23,
    'b0646c8581ffc3e40a02ac851f592181e95f49b551c269282835d757a2c93ace'
  ),
  (
    '6aec6083-9f6b-4412-a1e4-493f09cf3357'::uuid,
    16,
    'Closing Credits & Copyright',
    'section-017',
    true,
    'audiobooks',
    'audio/mpeg',
    'everything-i-touch-turns-to-tacos/standard/16-743ea9ec251007bb.mp3',
    1775972,
    44,
    '743ea9ec251007bb989f6374513716e25a9120bf64b1cafd732bc964596af927',
    'everything-i-touch-turns-to-tacos/standard/16-5981f85def7c4f7c.mp3',
    1806248,
    45,
    '5981f85def7c4f7cb278cdd5611a3f5ab583d2818f3e7b96ca1f853f2b61f6a9'
  );

create temporary table jju_tacos_reconciliation_objects (
  object_role text not null check (object_role in ('previous', 'target')),
  object_id uuid primary key,
  bucket_id text not null,
  object_name text not null,
  file_size_bytes bigint not null,
  mime_type text not null,
  etag text not null,
  unique (bucket_id, object_name)
) on commit drop;

insert into jju_tacos_reconciliation_objects values
  (
    'previous',
    '22a844c9-ba50-4d9d-bf90-dccbc41677e1'::uuid,
    'audiobooks',
    'everything-i-touch-turns-to-tacos/standard/10-992cecfdefaa74d2.mp3',
    5489480,
    'audio/mpeg',
    '84c0b1f97fb7a34626392b9d05778bb4'
  ),
  (
    'target',
    '96d5d79c-78c6-4ab0-8819-ff320eb2737b'::uuid,
    'audiobooks',
    'everything-i-touch-turns-to-tacos/standard/10-0a69afb8a56a0b6e.mp3',
    5529152,
    'audio/mpeg',
    '1252e630e7e59fac8e394b97634a7329'
  ),
  (
    'previous',
    '742d30ef-e9e8-4408-881a-882af1420e77'::uuid,
    'audiobooks',
    'everything-i-touch-turns-to-tacos/standard/13-ebbf68878706555c.mp3',
    907364,
    'audio/mpeg',
    '518b921828f08d829483e3af22ff3f42'
  ),
  (
    'target',
    '0e5c2c82-6121-45d9-9851-33bea1263359'::uuid,
    'audiobooks',
    'everything-i-touch-turns-to-tacos/standard/13-b0646c8581ffc3e4.mp3',
    919892,
    'audio/mpeg',
    '00eb978682a016e39394ed395fe418d3'
  ),
  (
    'previous',
    '093e228d-e4d6-4418-8f34-df91c3691678'::uuid,
    'audiobooks',
    'everything-i-touch-turns-to-tacos/standard/16-743ea9ec251007bb.mp3',
    1775972,
    'audio/mpeg',
    '082f9b4f3fb128a26d1c64c976e24efc'
  ),
  (
    'target',
    '83f31c60-36e2-42ea-a710-aab815e4b878'::uuid,
    'audiobooks',
    'everything-i-touch-turns-to-tacos/standard/16-5981f85def7c4f7c.mp3',
    1806248,
    'audio/mpeg',
    'bea0b1749701deff6b8ce5d3da6c939c'
  );

do $preflight$
declare
  v_edition_id constant uuid := '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid;
  v_migration_key constant text := 'tacos-approved-alternatives-10-13-16-v1';
  v_has_audit boolean;
  v_edition_status text;
  v_edition_published_at timestamptz;
  v_edition_total_seconds integer;
  v_edition_core_fingerprint text;
  v_track_count bigint;
  v_qa_track_count bigint;
  v_track_core_fingerprint text;
  v_old_matches bigint;
  v_new_matches bigint;
  v_object_matches bigint;
  v_snapshot_track_matches bigint;
  v_snapshot_object_matches bigint;
  v_manifest_matches bigint;
begin
  select
    edition.status,
    edition.published_at,
    edition.total_seconds,
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
  into
    v_edition_status,
    v_edition_published_at,
    v_edition_total_seconds,
    v_edition_core_fingerprint
  from public.audio_editions edition
  where edition.id = v_edition_id;

  if not found then
    raise exception 'The exact audited Tacos edition is missing.'
      using errcode = '55000';
  end if;

  if v_edition_status <> 'qa' or v_edition_published_at is not null then
    raise exception 'Tacos must remain unpublished QA throughout reconciliation.'
      using errcode = '55000';
  end if;

  select
    count(*),
    count(*) filter (
      where track.status = 'qa' and track.published_at is null
    ),
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
  into v_track_count, v_qa_track_count, v_track_core_fingerprint
  from public.audio_tracks track
  where track.edition_id = v_edition_id;

  if v_track_count <> 16 or v_qa_track_count <> 16 then
    raise exception 'Expected exactly 16 unpublished QA tracks for Tacos.'
      using errcode = '55000';
  end if;

  select
    count(*) filter (
      where track.storage_path = expected.old_storage_path
        and track.file_size_bytes = expected.old_file_size_bytes
        and track.duration_seconds = expected.old_duration_seconds
        and track.sha256 = expected.old_sha256
    ),
    count(*) filter (
      where track.storage_path = expected.new_storage_path
        and track.file_size_bytes = expected.new_file_size_bytes
        and track.duration_seconds = expected.new_duration_seconds
        and track.sha256 = expected.new_sha256
    )
  into v_old_matches, v_new_matches
  from jju_tacos_reconciliation_tracks expected
  join public.audio_tracks track
    on track.id = expected.track_id
   and track.edition_id = v_edition_id
   and track.position = expected.position
   and track.title = expected.title
   and track.section_key = expected.section_key
   and track.required_for_submission = expected.required_for_submission
   and track.storage_bucket = expected.storage_bucket
   and track.mime_type = expected.mime_type
   and track.status = 'qa'
   and track.published_at is null;

  if v_old_matches = 3 and v_new_matches = 0 then
    if v_edition_total_seconds <> 1247
      or v_edition_core_fingerprint is distinct from
        '18728f60810e93edeb2ae235c64cda2c838eefa3c32cd6faf97c7a148ad69b39'
      or v_track_core_fingerprint is distinct from
        'f91083c863fc8b17801a8a2bac6645087baf0d00618a9779a2685919eeb85ffc'
    then
      raise exception 'The unreconciled Tacos edition or 16-track fingerprint drifted.'
        using errcode = '55000';
    end if;
  elsif v_new_matches = 3 and v_old_matches = 0 then
    if v_edition_total_seconds <> 1249
      or v_edition_core_fingerprint is distinct from
        'c320d532c495d6ba6bbbd91af45875c7f44bcf948379f727be0a23c7b1d2bc41'
      or v_track_core_fingerprint is distinct from
        '1898c244cf9bd95bdaff9b223257088d1a3a63bc8dd1584a4fd3ef18c8b91fc1'
    then
      raise exception 'The reconciled Tacos edition or 16-track fingerprint drifted.'
        using errcode = '55000';
    end if;
  else
    raise exception 'Tracks 10, 13, and 16 are partial or differ from both sealed states.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.narrator_assignments assignment
    where assignment.edition_id = v_edition_id
  ) or exists (
    select 1
    from public.narrator_submissions submission
    join public.narrator_assignments assignment
      on assignment.id = submission.assignment_id
    where assignment.edition_id = v_edition_id
  ) then
    raise exception 'Narrator workflow rows now reference Tacos; manual review is required.'
      using errcode = '55000';
  end if;

  -- Hold the exact private-bucket settings until commit so a concurrent
  -- Storage configuration change cannot slip between preflight and postcheck.
  perform bucket.id
  from storage.buckets bucket
  where bucket.id = 'audiobooks'
    and bucket.public = false
    and bucket.file_size_limit = 52428800
  for share of bucket;

  if not found then
    raise exception 'The private audiobooks bucket settings drifted.'
      using errcode = '55000';
  end if;

  -- Pin the six exact Storage rows for the remainder of this transaction.
  perform object.id
  from storage.objects object
  join jju_tacos_reconciliation_objects expected
    on expected.object_id = object.id
   and expected.bucket_id = object.bucket_id
   and expected.object_name = object.name
  for share of object;

  select count(*) into v_object_matches
  from jju_tacos_reconciliation_objects expected
  join storage.objects object
    on object.id = expected.object_id
   and object.bucket_id = expected.bucket_id
   and object.name = expected.object_name
   and (object.metadata->>'size')::bigint = expected.file_size_bytes
   and lower(object.metadata->>'mimetype') = expected.mime_type
   and trim(both '"' from object.metadata->>'eTag') = expected.etag;

  if v_object_matches <> 6 then
    raise exception 'A previous or replacement Tacos Storage object drifted.'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.audio_tracks track
    join jju_tacos_reconciliation_tracks expected
      on track.storage_bucket = expected.storage_bucket
     and track.storage_path = expected.new_storage_path
    where track.id <> expected.track_id
  ) then
    raise exception 'A replacement Storage path is already owned by another track.'
      using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.jju_audio_track_reconciliation_audit audit
    where audit.migration_key = v_migration_key
  ) into v_has_audit;

  if v_new_matches = 3 and not v_has_audit then
    raise exception 'The tracks already reference replacements without a reconciliation snapshot.'
      using errcode = '55000';
  end if;

  if v_has_audit then
    if not exists (
      select 1
      from public.jju_audio_track_reconciliation_audit audit
      where audit.migration_key = v_migration_key
        and audit.edition_id = v_edition_id
        and audit.previous_edition @> jsonb_build_object(
          'id', v_edition_id::text,
          'book_id', 'tacos',
          'status', 'qa',
          'published_at', null,
          'total_seconds', 1247
        )
        and jsonb_array_length(audit.previous_tracks) = 3
        and jsonb_array_length(audit.previous_objects) = 3
        and jsonb_array_length(audit.target_objects) = 3
        and jsonb_array_length(audit.sealed_manifest) = 3
    ) then
      raise exception 'The existing Tacos reconciliation audit snapshot is invalid.'
        using errcode = '55000';
    end if;

    select count(*) into v_snapshot_track_matches
    from public.jju_audio_track_reconciliation_audit audit
    cross join lateral jsonb_array_elements(audit.previous_tracks) snapshot
    join jju_tacos_reconciliation_tracks expected
      on snapshot->>'id' = expected.track_id::text
     and (snapshot->>'position')::integer = expected.position
     and snapshot->>'storage_path' = expected.old_storage_path
     and (snapshot->>'file_size_bytes')::bigint = expected.old_file_size_bytes
     and (snapshot->>'duration_seconds')::integer = expected.old_duration_seconds
     and snapshot->>'sha256' = expected.old_sha256
     and snapshot->>'status' = 'qa'
     and snapshot->'published_at' = 'null'::jsonb
    where audit.migration_key = v_migration_key;

    select count(*) into v_manifest_matches
    from public.jju_audio_track_reconciliation_audit audit
    cross join lateral jsonb_array_elements(audit.sealed_manifest) manifest
    join jju_tacos_reconciliation_tracks expected
      on (manifest->>'position')::integer = expected.position
     and manifest->>'track_id' = expected.track_id::text
     and manifest->>'storage_path' = expected.new_storage_path
     and (manifest->>'file_size_bytes')::bigint = expected.new_file_size_bytes
     and (manifest->>'duration_seconds')::integer = expected.new_duration_seconds
     and manifest->>'sha256' = expected.new_sha256
    where audit.migration_key = v_migration_key;

    select count(*) into v_snapshot_object_matches
    from public.jju_audio_track_reconciliation_audit audit
    cross join lateral (
      select 'previous'::text as object_role, previous_object as snapshot
      from jsonb_array_elements(audit.previous_objects) previous_object
      union all
      select 'target'::text as object_role, target_object as snapshot
      from jsonb_array_elements(audit.target_objects) target_object
    ) captured
    join jju_tacos_reconciliation_objects expected
      on expected.object_role = captured.object_role
     and captured.snapshot->>'id' = expected.object_id::text
     and captured.snapshot->>'bucket_id' = expected.bucket_id
     and captured.snapshot->>'name' = expected.object_name
     and (captured.snapshot->'metadata'->>'size')::bigint = expected.file_size_bytes
     and lower(captured.snapshot->'metadata'->>'mimetype') = expected.mime_type
     and trim(both '"' from captured.snapshot->'metadata'->>'eTag') = expected.etag
    where audit.migration_key = v_migration_key;

    if v_snapshot_track_matches <> 3
      or v_snapshot_object_matches <> 6
      or v_manifest_matches <> 3
    then
      raise exception 'The existing Tacos reconciliation snapshot differs from the sealed manifest.'
        using errcode = '55000';
    end if;
  end if;
end;
$preflight$;

insert into public.jju_audio_track_reconciliation_audit (
  migration_key,
  edition_id,
  previous_edition,
  previous_tracks,
  previous_objects,
  target_objects,
  sealed_manifest
)
select
  'tacos-approved-alternatives-10-13-16-v1',
  edition.id,
  to_jsonb(edition),
  (
    select jsonb_agg(to_jsonb(track) order by track.position)
    from public.audio_tracks track
    join jju_tacos_reconciliation_tracks expected
      on expected.track_id = track.id
    where track.edition_id = edition.id
  ),
  (
    select jsonb_agg(to_jsonb(object) order by object.name)
    from storage.objects object
    join jju_tacos_reconciliation_objects expected
      on expected.object_id = object.id
     and expected.object_role = 'previous'
  ),
  (
    select jsonb_agg(to_jsonb(object) order by object.name)
    from storage.objects object
    join jju_tacos_reconciliation_objects expected
      on expected.object_id = object.id
     and expected.object_role = 'target'
  ),
  (
    select jsonb_agg(
      jsonb_build_object(
        'track_id', expected.track_id,
        'position', expected.position,
        'storage_bucket', expected.storage_bucket,
        'storage_path', expected.new_storage_path,
        'mime_type', expected.mime_type,
        'file_size_bytes', expected.new_file_size_bytes,
        'duration_seconds', expected.new_duration_seconds,
        'sha256', expected.new_sha256
      ) order by expected.position
    )
    from jju_tacos_reconciliation_tracks expected
  )
from public.audio_editions edition
where edition.id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
  and edition.status = 'qa'
  and edition.published_at is null
  and edition.total_seconds = 1247
on conflict (migration_key) do nothing;

update public.audio_tracks track
set storage_path = expected.new_storage_path,
    file_size_bytes = expected.new_file_size_bytes,
    duration_seconds = expected.new_duration_seconds,
    sha256 = expected.new_sha256
from jju_tacos_reconciliation_tracks expected
where track.id = expected.track_id
  and track.edition_id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
  and track.position = expected.position
  and track.title = expected.title
  and track.section_key = expected.section_key
  and track.required_for_submission = expected.required_for_submission
  and track.storage_bucket = expected.storage_bucket
  and track.mime_type = expected.mime_type
  and track.storage_path = expected.old_storage_path
  and track.file_size_bytes = expected.old_file_size_bytes
  and track.duration_seconds = expected.old_duration_seconds
  and track.sha256 = expected.old_sha256
  and track.status = 'qa'
  and track.published_at is null;

update public.audio_editions
set total_seconds = 1249
where id = '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid
  and book_id = 'tacos'
  and edition_key = 'standard'
  and source_content_version = 1
  and source_content_sha256 = '6603471a78d74ff63cae6b527b4bd10365724d67bf40c597a28614f67ea6923c'
  and status = 'qa'
  and published_at is null
  and total_seconds = 1247;

do $postcheck$
declare
  v_edition_id constant uuid := '4b93d2dc-72a4-4bac-ab7e-b6ddb192ba46'::uuid;
  v_migration_key constant text := 'tacos-approved-alternatives-10-13-16-v1';
  v_track_count bigint;
  v_qa_track_count bigint;
  v_track_core_fingerprint text;
  v_target_matches bigint;
  v_object_matches bigint;
  v_total_bytes bigint;
  v_track_seconds bigint;
begin
  if not exists (
    select 1
    from public.jju_audio_track_reconciliation_audit audit
    where audit.migration_key = v_migration_key
      and audit.edition_id = v_edition_id
      and jsonb_array_length(audit.previous_tracks) = 3
      and jsonb_array_length(audit.previous_objects) = 3
      and jsonb_array_length(audit.target_objects) = 3
      and jsonb_array_length(audit.sealed_manifest) = 3
  ) then
    raise exception 'The Tacos reconciliation snapshot was not preserved.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.audio_editions edition
    where edition.id = v_edition_id
      and edition.book_id = 'tacos'
      and edition.source_content_version = 1
      and edition.source_content_sha256 = '6603471a78d74ff63cae6b527b4bd10365724d67bf40c597a28614f67ea6923c'
      and edition.edition_key = 'standard'
      and edition.narrator_name = 'James Johnson'
      and edition.language_code = 'en'
      and edition.access_model = 'free'
      and edition.description = 'Narrated by James Johnson.'
      and edition.total_seconds = 1249
      and edition.status = 'qa'
      and edition.published_at is null
  ) then
    raise exception 'The Tacos edition did not finish in the sealed unpublished QA state.'
      using errcode = '55000';
  end if;

  select count(*) into v_target_matches
  from jju_tacos_reconciliation_tracks expected
  join public.audio_tracks track
    on track.id = expected.track_id
   and track.edition_id = v_edition_id
   and track.position = expected.position
   and track.title = expected.title
   and track.section_key = expected.section_key
   and track.required_for_submission = expected.required_for_submission
   and track.storage_bucket = expected.storage_bucket
   and track.storage_path = expected.new_storage_path
   and track.mime_type = expected.mime_type
   and track.file_size_bytes = expected.new_file_size_bytes
   and track.duration_seconds = expected.new_duration_seconds
   and track.sha256 = expected.new_sha256
   and track.status = 'qa'
   and track.published_at is null;

  if v_target_matches <> 3 then
    raise exception 'Tracks 10, 13, and 16 did not reconcile exactly.'
      using errcode = '55000';
  end if;

  select
    count(*),
    count(*) filter (
      where track.status = 'qa' and track.published_at is null
    ),
    sum(track.file_size_bytes),
    sum(track.duration_seconds),
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
  into
    v_track_count,
    v_qa_track_count,
    v_total_bytes,
    v_track_seconds,
    v_track_core_fingerprint
  from public.audio_tracks track
  where track.edition_id = v_edition_id;

  if v_track_count <> 16
    or v_qa_track_count <> 16
    or v_total_bytes <> 49916732
    or v_track_seconds <> 1248
    or v_track_core_fingerprint is distinct from
      '1898c244cf9bd95bdaff9b223257088d1a3a63bc8dd1584a4fd3ef18c8b91fc1'
  then
    raise exception 'The final Tacos 16-track package differs from the sealed QA package.'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'audiobooks'
      and bucket.public = false
      and bucket.file_size_limit = 52428800
  ) then
    raise exception 'The private audiobooks bucket settings changed during reconciliation.'
      using errcode = '55000';
  end if;

  select count(*) into v_object_matches
  from jju_tacos_reconciliation_objects expected
  join storage.objects object
    on object.id = expected.object_id
   and object.bucket_id = expected.bucket_id
   and object.name = expected.object_name
   and (object.metadata->>'size')::bigint = expected.file_size_bytes
   and lower(object.metadata->>'mimetype') = expected.mime_type
   and trim(both '"' from object.metadata->>'eTag') = expected.etag;

  if v_object_matches <> 6 then
    raise exception 'A pinned Tacos Storage object changed during reconciliation.'
      using errcode = '55000';
  end if;
end;
$postcheck$;

commit;
