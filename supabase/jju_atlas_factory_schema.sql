-- JJ University Atlas factory schema.
-- Run after supabase/jju_atlas_maps_schema.sql and supabase/jju_atlas_source_ingest_schema.sql.
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

create table if not exists public.atlas_map_recipes (
  id text primary key,
  title text not null,
  purpose text not null default '',
  grouping_logic text not null default '',
  preferred_group_fields text[] not null default '{}',
  contributor_rules text not null default '',
  expected_relation_types text[] not null default '{}',
  recommended_group_count jsonb not null default '{"min":5,"max":10}'::jsonb,
  generation_instructions text not null default '',
  evaluation_criteria text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_planned_maps (
  id text primary key,
  territory_slug text not null,
  territory_title text not null default '',
  territory_description text not null default '',
  territory_display_order integer not null default 0,
  branch_slug text not null,
  branch_title text not null default '',
  branch_description text not null default '',
  branch_display_order integer not null default 0,
  map_title text not null,
  map_slug text not null,
  summary text not null default '',
  status text not null default 'idea'
    check (status in ('idea', 'queued', 'generating', 'needs_review', 'published', 'paused')),
  recipe_id text references public.atlas_map_recipes(id) on delete set null,
  source_requirements text not null default '',
  notes text not null default '',
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (territory_slug, branch_slug, map_slug)
);

create table if not exists public.atlas_generation_jobs (
  id text primary key,
  planned_map_id text references public.atlas_planned_maps(id) on delete set null,
  territory_slug text not null default '',
  branch_slug text not null default '',
  map_title text not null default '',
  map_slug text not null default '',
  recipe_id text references public.atlas_map_recipes(id) on delete set null,
  topic_prompt text not null default '',
  selected_source_ids text[] not null default '{}',
  provider text,
  model text,
  endpoint text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'paused', 'failed', 'draft_ready', 'imported', 'published')),
  run_id text,
  output_draft_path text,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists atlas_map_recipes_updated_idx
on public.atlas_map_recipes(updated_at desc);

create index if not exists atlas_planned_maps_scope_idx
on public.atlas_planned_maps(territory_slug, branch_slug, map_slug);

create index if not exists atlas_planned_maps_status_idx
on public.atlas_planned_maps(status);

create index if not exists atlas_planned_maps_recipe_idx
on public.atlas_planned_maps(recipe_id);

create index if not exists atlas_generation_jobs_status_idx
on public.atlas_generation_jobs(status, created_at desc);

create index if not exists atlas_generation_jobs_planned_map_idx
on public.atlas_generation_jobs(planned_map_id, created_at desc);

create index if not exists atlas_generation_jobs_run_id_idx
on public.atlas_generation_jobs(run_id);

drop trigger if exists set_atlas_map_recipes_updated_at on public.atlas_map_recipes;
create trigger set_atlas_map_recipes_updated_at
before update on public.atlas_map_recipes
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_planned_maps_updated_at on public.atlas_planned_maps;
create trigger set_atlas_planned_maps_updated_at
before update on public.atlas_planned_maps
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_generation_jobs_updated_at on public.atlas_generation_jobs;
create trigger set_atlas_generation_jobs_updated_at
before update on public.atlas_generation_jobs
for each row execute function public.set_updated_at();

alter table public.atlas_map_recipes enable row level security;
alter table public.atlas_planned_maps enable row level security;
alter table public.atlas_generation_jobs enable row level security;

drop policy if exists "atlas_map_recipes_admin_all" on public.atlas_map_recipes;
create policy "atlas_map_recipes_admin_all"
on public.atlas_map_recipes for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_planned_maps_admin_all" on public.atlas_planned_maps;
create policy "atlas_planned_maps_admin_all"
on public.atlas_planned_maps for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_generation_jobs_admin_all" on public.atlas_generation_jobs;
create policy "atlas_generation_jobs_admin_all"
on public.atlas_generation_jobs for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update, delete on public.atlas_map_recipes to authenticated;
grant select, insert, update, delete on public.atlas_planned_maps to authenticated;
grant select, insert, update, delete on public.atlas_generation_jobs to authenticated;

with recipe_seed (
  id,
  title,
  purpose,
  grouping_logic,
  preferred_group_fields,
  contributor_rules,
  expected_relation_types,
  recommended_group_count,
  generation_instructions,
  evaluation_criteria
) as (
  values
    (
      'theory_family',
      'Theory Family',
      'Organize a field by major explanatory families or schools of thought.',
      'Groups should be conceptual families with distinct explanatory stances, not just people or chronology.',
      array['stance', 'centralClaim', 'whyItMatters', 'objections', 'contributors', 'keyTexts'],
      'Contributors should be attached to the theory family they shaped, extended, or strongly challenged.',
      array['opposes', 'answers', 'reframes', 'borrows', 'neighbors'],
      '{"min":5,"max":10}'::jsonb,
      'Prioritize stable families, central claims, pressure points, and representative contributors. Avoid making one group per person.',
      array['Groups are mutually useful rather than cosmetic', 'Central claims are distinct', 'Objections expose real pressure points', 'Relations explain conceptual movement']
    ),
    (
      'intellectual_lineage',
      'Intellectual Lineage',
      'Trace how ideas, methods, or styles pass through people, schools, and generations.',
      'Groups should be lineages, handoff points, or influence chains with attention to inheritance and mutation.',
      array['lineage', 'centralInheritance', 'turningPoint', 'contributors', 'keyTexts', 'objections'],
      'Contributors should appear where their work changes, transmits, or redirects the lineage.',
      array['influences', 'borrows', 'reframes', 'opposes', 'answers'],
      '{"min":5,"max":9}'::jsonb,
      'Emphasize influence, divergence, continuity, and discontinuity. Preserve chronology where it clarifies structure.',
      array['Influence claims are explicit', 'Groups are not flat eras', 'Relations show transmission or rupture', 'Contributors have clear lineage roles']
    ),
    (
      'historical_movement',
      'Historical Movement',
      'Organize cultural or historical material by movements, scenes, eras, and reactions.',
      'Groups should be movements or scenes with shared style, context, institutions, or oppositional identity.',
      array['movementContext', 'definingStyle', 'centralClaim', 'contributors', 'keyTexts', 'pressurePoints'],
      'Contributors should represent the movement, launch it, popularize it, or define its counter-movement.',
      array['influences', 'opposes', 'reframes', 'neighbors', 'borrows'],
      '{"min":5,"max":10}'::jsonb,
      'Anchor groups in context and style. Do not collapse movements into individual biography unless the source demands it.',
      array['Groups have historical context', 'Movement boundaries are defensible', 'Relations show reaction or influence', 'Representative figures are justified']
    ),
    (
      'discipline_landscape',
      'Discipline Landscape',
      'Map a discipline by methods, subfields, styles, or problem-solving orientations.',
      'Groups should reveal how the discipline is internally organized and how its major methods differ.',
      array['method', 'centralProblem', 'useCases', 'contributors', 'keyTexts', 'limitations'],
      'Contributors should be included when they exemplify or institutionalize a method or subfield.',
      array['neighbors', 'borrows', 'answers', 'opposes', 'reframes'],
      '{"min":5,"max":10}'::jsonb,
      'Prefer categories useful for learning the discipline over encyclopedia taxonomy. Make the map navigable.',
      array['Categories help users learn the field', 'Methods are distinguishable', 'Relations show dependencies and overlap', 'No group is filler']
    ),
    (
      'system_comparison',
      'System Comparison',
      'Compare social, political, technical, or philosophical systems by design commitments and tradeoffs.',
      'Groups should be systems or system families, separated by governance logic, constraints, values, or operating model.',
      array['systemLogic', 'centralClaim', 'tradeoffs', 'contributors', 'keyTexts', 'failureModes'],
      'Contributors should be tied to system design, advocacy, critique, or canonical articulation.',
      array['opposes', 'answers', 'reframes', 'neighbors', 'borrows'],
      '{"min":5,"max":9}'::jsonb,
      'Surface the operating logic of each system and the concrete tradeoffs between systems.',
      array['Systems are compared on meaningful axes', 'Tradeoffs are explicit', 'Relations expose conflict or borrowing', 'Claims are not slogans']
    ),
    (
      'people_and_contributions',
      'People And Contributions',
      'Organize a domain around major contributors and the problems their work changed.',
      'Groups may be contributor clusters, contribution types, or schools around influential people.',
      array['contributionType', 'centralContribution', 'whyItMatters', 'contributors', 'keyTexts', 'limitations'],
      'Contributors are primary units, but every contributor must have a concrete contribution or problem role.',
      array['influences', 'borrows', 'answers', 'reframes', 'neighbors'],
      '{"min":5,"max":10}'::jsonb,
      'Avoid celebrity lists. Cluster people by contribution logic and explain why each person matters.',
      array['People are grouped by contribution logic', 'Reasons are concrete', 'Relations show influence or problem inheritance', 'Coverage is not just fame']
    ),
    (
      'concept_dependency',
      'Concept Dependency',
      'Map concepts by prerequisite, dependency, and abstraction relationships.',
      'Groups should be concepts or concept families ordered by what depends on what.',
      array['definition', 'prerequisites', 'centralUse', 'contributors', 'keyTexts', 'failureModes'],
      'Contributors are secondary and should appear where they clarify, formalize, or transform a dependency.',
      array['depends_on', 'enables', 'reframes', 'opposes', 'neighbors'],
      '{"min":5,"max":10}'::jsonb,
      'Build a dependency-aware map. Make prerequisite chains and abstraction jumps explicit.',
      array['Dependencies are coherent', 'Groups form a usable learning path', 'Relations are directional where needed', 'Concept boundaries are clear']
    ),
    (
      'debate_map',
      'Debate Map',
      'Organize a contested domain by positions, arguments, counterarguments, and live pressure points.',
      'Groups should be positions or camps in a debate, including hybrids when they clarify the field.',
      array['position', 'centralClaim', 'arguments', 'objections', 'contributors', 'keyTexts'],
      'Contributors should be tied to the position they defend, refine, or critique.',
      array['opposes', 'answers', 'reframes', 'borrows', 'neighbors'],
      '{"min":5,"max":9}'::jsonb,
      'Make disagreement legible. Each group should answer what it claims, why, and what pressures it faces.',
      array['Debate positions are distinct', 'Opposition and answer relations are explicit', 'Objections are substantive', 'No neutral filler categories']
    )
)
insert into public.atlas_map_recipes (
  id,
  title,
  purpose,
  grouping_logic,
  preferred_group_fields,
  contributor_rules,
  expected_relation_types,
  recommended_group_count,
  generation_instructions,
  evaluation_criteria
)
select
  id,
  title,
  purpose,
  grouping_logic,
  preferred_group_fields,
  contributor_rules,
  expected_relation_types,
  recommended_group_count,
  generation_instructions,
  evaluation_criteria
from recipe_seed
on conflict (id) do update set
  title = excluded.title,
  purpose = excluded.purpose,
  grouping_logic = excluded.grouping_logic,
  preferred_group_fields = excluded.preferred_group_fields,
  contributor_rules = excluded.contributor_rules,
  expected_relation_types = excluded.expected_relation_types,
  recommended_group_count = excluded.recommended_group_count,
  generation_instructions = excluded.generation_instructions,
  evaluation_criteria = excluded.evaluation_criteria,
  updated_at = now();

with planned_seed (
  id,
  territory_slug,
  territory_title,
  territory_description,
  territory_display_order,
  branch_slug,
  branch_title,
  branch_description,
  branch_display_order,
  map_title,
  map_slug,
  summary,
  status,
  recipe_id,
  source_requirements,
  notes,
  display_order
) as (
  values
    (
      'planned-stem-science-scientific-lineages',
      'stem',
      'STEM',
      'Science, mathematics, engineering, and technical knowledge maps.',
      10,
      'science',
      'Science',
      'Scientific methods, theories, traditions, and lineages.',
      10,
      'Scientific lineages',
      'scientific-lineages',
      'A lineage map of scientific traditions, handoffs, revolutions, and methodological inheritance.',
      'queued',
      'intellectual_lineage',
      'Needs source packets covering major scientific traditions and methodological shifts.',
      'Seeded Atlas Factory v1 idea.',
      10
    ),
    (
      'planned-stem-mathematics-mathematical-styles',
      'stem',
      'STEM',
      'Science, mathematics, engineering, and technical knowledge maps.',
      10,
      'mathematics',
      'Mathematics',
      'Mathematical methods, styles, schools, and conceptual dependencies.',
      20,
      'Mathematical styles',
      'mathematical-styles',
      'A landscape of mathematical styles, methods, problem orientations, and abstractions.',
      'queued',
      'discipline_landscape',
      'Needs sources that distinguish proof styles, abstraction styles, computation, geometry, algebra, and applied methods.',
      'Seeded Atlas Factory v1 idea.',
      20
    ),
    (
      'planned-technology-systems-systems-design',
      'technology',
      'Technology',
      'Technical systems, infrastructure, software, and operational design.',
      20,
      'systems',
      'Systems',
      'Systems thinking, architecture, infrastructure, and design tradeoffs.',
      10,
      'Systems design',
      'systems-design',
      'A comparison map of systems design patterns, constraints, failure modes, and tradeoffs.',
      'queued',
      'system_comparison',
      'Needs source packets on system architecture, resilience, constraints, feedback, and operational failure.',
      'Seeded Atlas Factory v1 idea.',
      30
    ),
    (
      'planned-humanities-philosophy-metaphysics-families',
      'humanities',
      'Humanities',
      'Philosophy, literature, history, language, and interpretive traditions.',
      30,
      'philosophy',
      'Philosophy',
      'Philosophical theories, debates, lineages, and conceptual families.',
      10,
      'Metaphysics families',
      'metaphysics-families',
      'A theory-family map of major metaphysical positions and their pressure points.',
      'queued',
      'theory_family',
      'Use the existing metaphysics source chunks as the initial grounded packet.',
      'Seeded Atlas Factory v1 idea.',
      40
    ),
    (
      'planned-humanities-literature-literary-movements',
      'humanities',
      'Humanities',
      'Philosophy, literature, history, language, and interpretive traditions.',
      30,
      'literature',
      'Literature',
      'Literary movements, genres, writers, texts, and interpretive traditions.',
      20,
      'Literary movements',
      'literary-movements',
      'A movement map of literary schools, scenes, reactions, and canonical texts.',
      'queued',
      'historical_movement',
      'Needs sources covering movements, periods, representative authors, and counter-movements.',
      'Seeded Atlas Factory v1 idea.',
      50
    ),
    (
      'planned-arts-music-music-lineages',
      'arts',
      'Arts',
      'Music, visual art, performance, and creative movements.',
      40,
      'music',
      'Music',
      'Musical traditions, genres, movements, scenes, and influence lines.',
      10,
      'Music lineages',
      'music-lineages',
      'A lineage map of music scenes, styles, innovations, and influence chains.',
      'queued',
      'historical_movement',
      'Needs sources on genres, scenes, historical periods, artists, and stylistic inheritance.',
      'Seeded Atlas Factory v1 idea.',
      60
    ),
    (
      'planned-arts-visual-art-visual-art-movements',
      'arts',
      'Arts',
      'Music, visual art, performance, and creative movements.',
      40,
      'visual-art',
      'Visual Art',
      'Visual art movements, styles, media, artists, and institutions.',
      20,
      'Visual art movements',
      'visual-art-movements',
      'A historical movement map of visual art schools, reactions, and defining styles.',
      'queued',
      'historical_movement',
      'Needs sources on movements, style markers, institutions, artists, and reactions.',
      'Seeded Atlas Factory v1 idea.',
      70
    ),
    (
      'planned-society-politics-political-orders',
      'society',
      'Society',
      'Politics, economics, social systems, institutions, and collective life.',
      50,
      'politics',
      'Politics',
      'Political systems, institutions, ideologies, and governance tradeoffs.',
      10,
      'Political orders',
      'political-orders',
      'A system-comparison map of political orders, institutional logics, and failure modes.',
      'queued',
      'system_comparison',
      'Needs sources covering regime types, institutional design, legitimacy, authority, and tradeoffs.',
      'Seeded Atlas Factory v1 idea.',
      80
    ),
    (
      'planned-society-economics-economic-schools',
      'society',
      'Society',
      'Politics, economics, social systems, institutions, and collective life.',
      50,
      'economics',
      'Economics',
      'Economic schools, debates, systems, and policy frameworks.',
      20,
      'Economic schools',
      'economic-schools',
      'A debate map of economic schools, assumptions, policy claims, and pressure points.',
      'queued',
      'debate_map',
      'Existing economics draft can become the first review seed; needs grounded source packets before model production.',
      'Seeded Atlas Factory v1 idea.',
      90
    )
)
insert into public.atlas_planned_maps (
  id,
  territory_slug,
  territory_title,
  territory_description,
  territory_display_order,
  branch_slug,
  branch_title,
  branch_description,
  branch_display_order,
  map_title,
  map_slug,
  summary,
  status,
  recipe_id,
  source_requirements,
  notes,
  display_order
)
select
  id,
  territory_slug,
  territory_title,
  territory_description,
  territory_display_order,
  branch_slug,
  branch_title,
  branch_description,
  branch_display_order,
  map_title,
  map_slug,
  summary,
  status,
  recipe_id,
  source_requirements,
  notes,
  display_order
from planned_seed
on conflict (territory_slug, branch_slug, map_slug) do update set
  territory_title = excluded.territory_title,
  territory_description = excluded.territory_description,
  territory_display_order = excluded.territory_display_order,
  branch_title = excluded.branch_title,
  branch_description = excluded.branch_description,
  branch_display_order = excluded.branch_display_order,
  map_title = excluded.map_title,
  summary = excluded.summary,
  status = excluded.status,
  recipe_id = excluded.recipe_id,
  source_requirements = excluded.source_requirements,
  notes = excluded.notes,
  display_order = excluded.display_order,
  updated_at = now();
