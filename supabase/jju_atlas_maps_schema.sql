-- JJ University Atlas Maps schema.
-- Run after supabase/jju_core_schema.sql.
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

create table if not exists public.atlas_territories (
  id text primary key,
  slug text not null unique,
  title text not null,
  summary text not null default '',
  display_order integer not null default 0,
  published boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_branches (
  id text primary key,
  territory_id text not null references public.atlas_territories(id) on delete cascade,
  slug text not null,
  title text not null,
  summary text not null default '',
  display_order integer not null default 0,
  published boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (territory_id, slug)
);

create table if not exists public.atlas_maps (
  id text primary key,
  branch_id text not null references public.atlas_branches(id) on delete cascade,
  slug text not null,
  title text not null,
  subtitle text not null default '',
  question text not null default '',
  summary text not null default '',
  status text not null default 'queued' check (status in ('live', 'queued')),
  build_mode text not null default 'pipeline-ready' check (build_mode in ('seeded', 'pipeline-ready')),
  review_status text not null default 'published' check (review_status in ('draft', 'needs_review', 'published', 'archived')),
  schema_version integer not null default 1,
  display_order integer not null default 0,
  published boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, slug)
);

alter table public.atlas_maps add column if not exists review_status text not null default 'published';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'atlas_maps_review_status_check'
      and conrelid = 'public.atlas_maps'::regclass
  ) then
    alter table public.atlas_maps
    add constraint atlas_maps_review_status_check
    check (review_status in ('draft', 'needs_review', 'published', 'archived'));
  end if;
end;
$$;

create table if not exists public.atlas_groups (
  map_id text not null references public.atlas_maps(id) on delete cascade,
  id text not null,
  slug text not null,
  title text not null,
  short_title text not null default '',
  family text not null default '',
  stance text not null default '',
  central_claim text not null default '',
  why_it_matters text not null default '',
  objections text[] not null default '{}',
  related_group_ids text[] not null default '{}',
  keywords text[] not null default '{}',
  provenance jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, id),
  unique (map_id, slug)
);

create table if not exists public.atlas_contributors (
  map_id text not null,
  group_id text not null,
  id text not null,
  name text not null,
  role text not null default '',
  reason text not null default '',
  provenance jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, group_id, id),
  foreign key (map_id, group_id) references public.atlas_groups(map_id, id) on delete cascade
);

create table if not exists public.atlas_texts (
  map_id text not null,
  group_id text not null,
  contributor_id text not null,
  id text not null,
  title text not null,
  kind text not null default 'other' check (kind in ('book', 'essay', 'paper', 'dialogue', 'lecture', 'other')),
  provenance jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, group_id, contributor_id, id),
  foreign key (map_id, group_id, contributor_id)
    references public.atlas_contributors(map_id, group_id, id)
    on delete cascade
);

create table if not exists public.atlas_relations (
  map_id text not null references public.atlas_maps(id) on delete cascade,
  id text not null,
  source_id text not null,
  target_id text not null,
  kind text not null check (kind in ('opposes', 'answers', 'reframes', 'borrows', 'neighbors')),
  note text not null default '',
  provenance jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (map_id, id),
  foreign key (map_id, source_id) references public.atlas_groups(map_id, id) on delete cascade,
  foreign key (map_id, target_id) references public.atlas_groups(map_id, id) on delete cascade
);

alter table public.atlas_groups add column if not exists provenance jsonb not null default '[]'::jsonb;
alter table public.atlas_contributors add column if not exists provenance jsonb not null default '[]'::jsonb;
alter table public.atlas_texts add column if not exists provenance jsonb not null default '[]'::jsonb;
alter table public.atlas_relations add column if not exists provenance jsonb not null default '[]'::jsonb;

create index if not exists atlas_territories_order_idx
on public.atlas_territories(display_order, title);

create index if not exists atlas_branches_territory_order_idx
on public.atlas_branches(territory_id, display_order, title);

create index if not exists atlas_maps_branch_order_idx
on public.atlas_maps(branch_id, display_order, title);

create index if not exists atlas_maps_status_idx
on public.atlas_maps(status, published);

create index if not exists atlas_maps_review_status_idx
on public.atlas_maps(review_status, published);

create index if not exists atlas_groups_map_order_idx
on public.atlas_groups(map_id, display_order, title);

create index if not exists atlas_contributors_group_order_idx
on public.atlas_contributors(map_id, group_id, display_order, name);

create index if not exists atlas_texts_contributor_order_idx
on public.atlas_texts(map_id, group_id, contributor_id, display_order, title);

create index if not exists atlas_relations_map_order_idx
on public.atlas_relations(map_id, display_order, id);

drop trigger if exists set_atlas_territories_updated_at on public.atlas_territories;
create trigger set_atlas_territories_updated_at
before update on public.atlas_territories
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_branches_updated_at on public.atlas_branches;
create trigger set_atlas_branches_updated_at
before update on public.atlas_branches
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_maps_updated_at on public.atlas_maps;
create trigger set_atlas_maps_updated_at
before update on public.atlas_maps
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_groups_updated_at on public.atlas_groups;
create trigger set_atlas_groups_updated_at
before update on public.atlas_groups
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_contributors_updated_at on public.atlas_contributors;
create trigger set_atlas_contributors_updated_at
before update on public.atlas_contributors
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_texts_updated_at on public.atlas_texts;
create trigger set_atlas_texts_updated_at
before update on public.atlas_texts
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_relations_updated_at on public.atlas_relations;
create trigger set_atlas_relations_updated_at
before update on public.atlas_relations
for each row execute function public.set_updated_at();

alter table public.atlas_territories enable row level security;
alter table public.atlas_branches enable row level security;
alter table public.atlas_maps enable row level security;
alter table public.atlas_groups enable row level security;
alter table public.atlas_contributors enable row level security;
alter table public.atlas_texts enable row level security;
alter table public.atlas_relations enable row level security;

drop policy if exists "atlas_territories_public_read" on public.atlas_territories;
create policy "atlas_territories_public_read"
on public.atlas_territories for select
to anon, authenticated
using (published);

drop policy if exists "atlas_branches_public_read" on public.atlas_branches;
create policy "atlas_branches_public_read"
on public.atlas_branches for select
to anon, authenticated
using (
  published
  and exists (
    select 1 from public.atlas_territories
    where atlas_territories.id = atlas_branches.territory_id
      and atlas_territories.published
  )
);

drop policy if exists "atlas_maps_public_read" on public.atlas_maps;
create policy "atlas_maps_public_read"
on public.atlas_maps for select
to anon, authenticated
using (
  published
  and exists (
    select 1
    from public.atlas_branches
    join public.atlas_territories on atlas_territories.id = atlas_branches.territory_id
    where atlas_branches.id = atlas_maps.branch_id
      and atlas_branches.published
      and atlas_territories.published
  )
);

drop policy if exists "atlas_groups_public_read" on public.atlas_groups;
create policy "atlas_groups_public_read"
on public.atlas_groups for select
to anon, authenticated
using (
  exists (
    select 1 from public.atlas_maps
    where atlas_maps.id = atlas_groups.map_id
      and atlas_maps.published
  )
);

drop policy if exists "atlas_contributors_public_read" on public.atlas_contributors;
create policy "atlas_contributors_public_read"
on public.atlas_contributors for select
to anon, authenticated
using (
  exists (
    select 1 from public.atlas_maps
    where atlas_maps.id = atlas_contributors.map_id
      and atlas_maps.published
  )
);

drop policy if exists "atlas_texts_public_read" on public.atlas_texts;
create policy "atlas_texts_public_read"
on public.atlas_texts for select
to anon, authenticated
using (
  exists (
    select 1 from public.atlas_maps
    where atlas_maps.id = atlas_texts.map_id
      and atlas_maps.published
  )
);

drop policy if exists "atlas_relations_public_read" on public.atlas_relations;
create policy "atlas_relations_public_read"
on public.atlas_relations for select
to anon, authenticated
using (
  exists (
    select 1 from public.atlas_maps
    where atlas_maps.id = atlas_relations.map_id
      and atlas_maps.published
  )
);

drop policy if exists "atlas_territories_admin_all" on public.atlas_territories;
create policy "atlas_territories_admin_all"
on public.atlas_territories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_branches_admin_all" on public.atlas_branches;
create policy "atlas_branches_admin_all"
on public.atlas_branches for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_maps_admin_all" on public.atlas_maps;
create policy "atlas_maps_admin_all"
on public.atlas_maps for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_groups_admin_all" on public.atlas_groups;
create policy "atlas_groups_admin_all"
on public.atlas_groups for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_contributors_admin_all" on public.atlas_contributors;
create policy "atlas_contributors_admin_all"
on public.atlas_contributors for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_texts_admin_all" on public.atlas_texts;
create policy "atlas_texts_admin_all"
on public.atlas_texts for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_relations_admin_all" on public.atlas_relations;
create policy "atlas_relations_admin_all"
on public.atlas_relations for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.atlas_territories to anon, authenticated;
grant select on public.atlas_branches to anon, authenticated;
grant select on public.atlas_maps to anon, authenticated;
grant select on public.atlas_groups to anon, authenticated;
grant select on public.atlas_contributors to anon, authenticated;
grant select on public.atlas_texts to anon, authenticated;
grant select on public.atlas_relations to anon, authenticated;

grant select, insert, update, delete on public.atlas_territories to authenticated;
grant select, insert, update, delete on public.atlas_branches to authenticated;
grant select, insert, update, delete on public.atlas_maps to authenticated;
grant select, insert, update, delete on public.atlas_groups to authenticated;
grant select, insert, update, delete on public.atlas_contributors to authenticated;
grant select, insert, update, delete on public.atlas_texts to authenticated;
grant select, insert, update, delete on public.atlas_relations to authenticated;
