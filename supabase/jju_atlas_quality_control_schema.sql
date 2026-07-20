-- JJ University Atlas quality-control schema.
-- Run after the Atlas maps, source ingest, and factory schemas.
-- Additive and safe to rerun.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'atlas_generation_jobs_status_check'
      and conrelid = 'public.atlas_generation_jobs'::regclass
  ) then
    alter table public.atlas_generation_jobs
      drop constraint atlas_generation_jobs_status_check;
  end if;
end;
$$;

alter table public.atlas_generation_jobs
add constraint atlas_generation_jobs_status_check
check (status in (
  'queued',
  'running',
  'awaiting_category_review',
  'paused',
  'failed',
  'draft_ready',
  'imported',
  'published'
));

create table if not exists public.atlas_category_reviews (
  id text primary key,
  map_id text not null references public.atlas_maps(id) on delete cascade,
  reference_map_id text references public.atlas_maps(id) on delete set null,
  job_id text references public.atlas_generation_jobs(id) on delete set null,
  run_id text,
  recipe_id text references public.atlas_map_recipes(id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'complete', 'archived')),
  reviewer_notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_category_group_reviews (
  review_id text not null references public.atlas_category_reviews(id) on delete cascade,
  map_id text not null references public.atlas_maps(id) on delete cascade,
  group_id text not null,
  group_status text not null default 'uncertain'
    check (group_status in ('accepted', 'revised', 'rejected', 'uncertain')),
  proposed_title text not null default '',
  proposed_short_title text not null default '',
  proposed_central_claim text not null default '',
  proposed_related_group_ids text[] not null default '{}',
  notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (review_id, group_id)
);

create table if not exists public.atlas_quality_scorecards (
  review_id text primary key references public.atlas_category_reviews(id) on delete cascade,
  map_id text not null references public.atlas_maps(id) on delete cascade,
  recipe_id text references public.atlas_map_recipes(id) on delete set null,
  category_quality integer not null default 3 check (category_quality between 1 and 5),
  field_coverage integer not null default 3 check (field_coverage between 1 and 5),
  factual_accuracy integer not null default 3 check (factual_accuracy between 1 and 5),
  contributor_placement integer not null default 3 check (contributor_placement between 1 and 5),
  key_text_selection integer not null default 3 check (key_text_selection between 1 and 5),
  objection_quality integer not null default 3 check (objection_quality between 1 and 5),
  relation_quality integer not null default 3 check (relation_quality between 1 and 5),
  explanatory_usefulness integer not null default 3 check (explanatory_usefulness between 1 and 5),
  redundancy_noise integer not null default 3 check (redundancy_noise between 1 and 5),
  provenance_support integer not null default 3 check (provenance_support between 1 and 5),
  notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_review_corrections (
  id text primary key,
  review_id text references public.atlas_category_reviews(id) on delete cascade,
  map_id text not null references public.atlas_maps(id) on delete cascade,
  run_id text,
  job_id text references public.atlas_generation_jobs(id) on delete set null,
  recipe_id text references public.atlas_map_recipes(id) on delete set null,
  entity_type text not null default '',
  entity_id text not null default '',
  field_name text not null default '',
  correction_type text not null default 'other'
    check (correction_type in (
      'bad_category',
      'missing_category',
      'redundant_category',
      'wrong_membership',
      'weak_explanation',
      'factual_error',
      'missing_contributor',
      'bad_relation',
      'weak_source_support',
      'other'
    )),
  original_value jsonb not null default '{}'::jsonb,
  revised_value jsonb not null default '{}'::jsonb,
  reason text not null default '',
  reviewer_status text not null default 'open'
    check (reviewer_status in ('open', 'accepted', 'applied', 'dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_recipe_feedback (
  id text primary key,
  recipe_id text not null references public.atlas_map_recipes(id) on delete cascade,
  correction_type text not null default 'other',
  summary text not null default '',
  recommendation text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'dismissed')),
  evidence_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_category_checkpoints (
  id text primary key,
  review_id text references public.atlas_category_reviews(id) on delete set null,
  map_id text references public.atlas_maps(id) on delete cascade,
  run_id text,
  job_id text references public.atlas_generation_jobs(id) on delete set null,
  recipe_id text references public.atlas_map_recipes(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_review', 'approved', 'rejected', 'superseded')),
  groups_json jsonb not null default '{"stage":"clustering","ok":true,"groups":[]}'::jsonb,
  reviewer_notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists atlas_category_reviews_map_idx
on public.atlas_category_reviews(map_id, updated_at desc);

create index if not exists atlas_category_reviews_recipe_idx
on public.atlas_category_reviews(recipe_id, updated_at desc);

create index if not exists atlas_category_group_reviews_map_idx
on public.atlas_category_group_reviews(map_id, group_status);

create index if not exists atlas_review_corrections_recipe_idx
on public.atlas_review_corrections(recipe_id, correction_type, created_at desc);

create index if not exists atlas_review_corrections_review_idx
on public.atlas_review_corrections(review_id, created_at desc);

create index if not exists atlas_recipe_feedback_recipe_idx
on public.atlas_recipe_feedback(recipe_id, status, updated_at desc);

create index if not exists atlas_category_checkpoints_run_idx
on public.atlas_category_checkpoints(run_id, status, updated_at desc);

create index if not exists atlas_category_checkpoints_job_idx
on public.atlas_category_checkpoints(job_id, status, updated_at desc);

create index if not exists atlas_category_checkpoints_map_idx
on public.atlas_category_checkpoints(map_id, status, updated_at desc);

drop trigger if exists set_atlas_category_reviews_updated_at on public.atlas_category_reviews;
create trigger set_atlas_category_reviews_updated_at
before update on public.atlas_category_reviews
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_category_group_reviews_updated_at on public.atlas_category_group_reviews;
create trigger set_atlas_category_group_reviews_updated_at
before update on public.atlas_category_group_reviews
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_quality_scorecards_updated_at on public.atlas_quality_scorecards;
create trigger set_atlas_quality_scorecards_updated_at
before update on public.atlas_quality_scorecards
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_review_corrections_updated_at on public.atlas_review_corrections;
create trigger set_atlas_review_corrections_updated_at
before update on public.atlas_review_corrections
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_recipe_feedback_updated_at on public.atlas_recipe_feedback;
create trigger set_atlas_recipe_feedback_updated_at
before update on public.atlas_recipe_feedback
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_category_checkpoints_updated_at on public.atlas_category_checkpoints;
create trigger set_atlas_category_checkpoints_updated_at
before update on public.atlas_category_checkpoints
for each row execute function public.set_updated_at();

alter table public.atlas_category_reviews enable row level security;
alter table public.atlas_category_group_reviews enable row level security;
alter table public.atlas_quality_scorecards enable row level security;
alter table public.atlas_review_corrections enable row level security;
alter table public.atlas_recipe_feedback enable row level security;
alter table public.atlas_category_checkpoints enable row level security;

drop policy if exists "atlas_category_reviews_admin_all" on public.atlas_category_reviews;
create policy "atlas_category_reviews_admin_all"
on public.atlas_category_reviews for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_category_group_reviews_admin_all" on public.atlas_category_group_reviews;
create policy "atlas_category_group_reviews_admin_all"
on public.atlas_category_group_reviews for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_quality_scorecards_admin_all" on public.atlas_quality_scorecards;
create policy "atlas_quality_scorecards_admin_all"
on public.atlas_quality_scorecards for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_review_corrections_admin_all" on public.atlas_review_corrections;
create policy "atlas_review_corrections_admin_all"
on public.atlas_review_corrections for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_recipe_feedback_admin_all" on public.atlas_recipe_feedback;
create policy "atlas_recipe_feedback_admin_all"
on public.atlas_recipe_feedback for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_category_checkpoints_admin_all" on public.atlas_category_checkpoints;
create policy "atlas_category_checkpoints_admin_all"
on public.atlas_category_checkpoints for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update, delete on public.atlas_category_reviews to authenticated;
grant select, insert, update, delete on public.atlas_category_group_reviews to authenticated;
grant select, insert, update, delete on public.atlas_quality_scorecards to authenticated;
grant select, insert, update, delete on public.atlas_review_corrections to authenticated;
grant select, insert, update, delete on public.atlas_recipe_feedback to authenticated;
grant select, insert, update, delete on public.atlas_category_checkpoints to authenticated;
