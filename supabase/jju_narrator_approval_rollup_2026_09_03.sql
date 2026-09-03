-- Roll an entirely reviewed narrator delivery up to its private production
-- assignment and audio edition. Publication, production-master promotion, and
-- audio-track delivery fields remain separate and untouched.

begin;

create or replace function public.roll_up_narrator_assignment_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.narrator_assignments%rowtype;
  v_edition public.audio_editions%rowtype;
begin
  if new.upload_status is distinct from 'approved'
    or old.upload_status is not distinct from 'approved'
  then
    return new;
  end if;

  -- Serialize the final check per assignment. If two final tracks are approved
  -- together, the second transaction sees the first approval after this lock.
  select * into v_assignment
  from public.narrator_assignments
  where id = new.assignment_id
  for update;

  if not found
    or v_assignment.narrator_user_id is distinct from new.narrator_user_id
  then
    raise exception 'Approved submission is not linked to its narrator assignment.'
      using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.audio_tracks track
    where track.id = new.audio_track_id
      and track.edition_id = v_assignment.edition_id
  ) then
    raise exception 'Approved submission is not linked to its assignment edition.'
      using errcode = '23503';
  end if;

  -- James reviews only an assignment that the narrator submitted. Earlier
  -- approvals remain track-level decisions until the formal handoff occurs.
  if v_assignment.status <> 'submitted' then
    return new;
  end if;

  select * into v_edition
  from public.audio_editions
  where id = v_assignment.edition_id
  for update;

  if not found then
    raise exception 'Narrator assignment edition was not found.'
      using errcode = '23503';
  end if;

  if v_edition.status <> 'submitted' then
    return new;
  end if;

  -- A zero-track plan can never become approved accidentally.
  if not exists (
    select 1
    from public.audio_tracks track
    where track.edition_id = v_assignment.edition_id
      and track.required_for_submission
  ) then
    return new;
  end if;

  -- Completion keeps one verified, non-superseded version current per track.
  -- Fail closed if that invariant is broken or any required current version is
  -- still uploaded, under review, or waiting for a requested change.
  if exists (
    select 1
    from public.audio_tracks track
    where track.edition_id = v_assignment.edition_id
      and track.required_for_submission
      and (
        (
          select count(*)
          from public.narrator_submissions current_submission
          where current_submission.assignment_id = v_assignment.id
            and current_submission.narrator_user_id = v_assignment.narrator_user_id
            and current_submission.audio_track_id = track.id
            and current_submission.upload_status in (
              'uploaded',
              'in-review',
              'changes-requested',
              'approved'
            )
        ) <> 1
        or not exists (
          select 1
          from public.narrator_submissions approved_submission
          where approved_submission.assignment_id = v_assignment.id
            and approved_submission.narrator_user_id = v_assignment.narrator_user_id
            and approved_submission.audio_track_id = track.id
            and approved_submission.upload_status = 'approved'
        )
      )
  ) then
    return new;
  end if;

  update public.narrator_assignments
  set status = 'approved'
  where id = v_assignment.id
    and status = 'submitted';
  if not found then
    raise exception 'Narrator assignment changed during final approval.'
      using errcode = '40001';
  end if;

  update public.audio_editions
  set status = 'approved'
  where id = v_assignment.edition_id
    and status = 'submitted';
  if not found then
    raise exception 'Audio edition changed during final approval.'
      using errcode = '40001';
  end if;

  return new;
end;
$$;

revoke all on function public.roll_up_narrator_assignment_approval()
  from public, anon, authenticated, service_role;

drop trigger if exists roll_up_narrator_assignment_approval
  on public.narrator_submissions;
create trigger roll_up_narrator_assignment_approval
after update of upload_status on public.narrator_submissions
for each row
when (
  new.upload_status = 'approved'
  and old.upload_status is distinct from new.upload_status
)
execute function public.roll_up_narrator_assignment_approval();

commit;
