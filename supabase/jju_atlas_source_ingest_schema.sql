-- JJ University Atlas source ingest schema.
-- Run after supabase/jju_atlas_maps_schema.sql.
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

create table if not exists public.atlas_sources (
  id text primary key,
  title text not null,
  creator text not null default '',
  source_type text not null default 'other'
    check (source_type in ('book', 'article', 'note', 'manual', 'seed', 'web', 'other')),
  territory_slug text not null default '',
  branch_slug text not null default '',
  map_slug text not null default '',
  file_path text,
  canonical_url text,
  content_hash text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_source_chunks (
  source_id text not null references public.atlas_sources(id) on delete cascade,
  chunk_index integer not null,
  heading text not null default '',
  chunk_text text not null,
  char_count integer not null default 0,
  token_estimate integer not null default 0,
  content_hash text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_id, chunk_index)
);

create table if not exists public.atlas_generation_runs (
  id text primary key,
  requested_territory_slug text not null default '',
  requested_branch_slug text not null default '',
  requested_map_slug text not null default '',
  topic_prompt text not null default '',
  source_ids text[] not null default '{}',
  output_draft_path text,
  draft_map_slug text,
  provider text,
  model text,
  validation_ok boolean,
  validation_errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.atlas_map_sources (
  source_id text not null references public.atlas_sources(id) on delete cascade,
  map_slug text not null,
  map_id text references public.atlas_maps(id) on delete set null,
  territory_slug text not null default '',
  branch_slug text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (source_id, map_slug)
);

create index if not exists atlas_sources_scope_idx
on public.atlas_sources(territory_slug, branch_slug, map_slug);

create index if not exists atlas_sources_type_idx
on public.atlas_sources(source_type);

create index if not exists atlas_sources_updated_idx
on public.atlas_sources(updated_at desc);

create index if not exists atlas_source_chunks_source_order_idx
on public.atlas_source_chunks(source_id, chunk_index);

create index if not exists atlas_generation_runs_requested_idx
on public.atlas_generation_runs(requested_territory_slug, requested_branch_slug, requested_map_slug);

create index if not exists atlas_generation_runs_created_idx
on public.atlas_generation_runs(created_at desc);

create index if not exists atlas_map_sources_map_slug_idx
on public.atlas_map_sources(map_slug);

drop trigger if exists set_atlas_sources_updated_at on public.atlas_sources;
create trigger set_atlas_sources_updated_at
before update on public.atlas_sources
for each row execute function public.set_updated_at();

drop trigger if exists set_atlas_source_chunks_updated_at on public.atlas_source_chunks;
create trigger set_atlas_source_chunks_updated_at
before update on public.atlas_source_chunks
for each row execute function public.set_updated_at();

alter table public.atlas_sources enable row level security;
alter table public.atlas_source_chunks enable row level security;
alter table public.atlas_generation_runs enable row level security;
alter table public.atlas_map_sources enable row level security;

drop policy if exists "atlas_sources_admin_all" on public.atlas_sources;
create policy "atlas_sources_admin_all"
on public.atlas_sources for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_source_chunks_admin_all" on public.atlas_source_chunks;
create policy "atlas_source_chunks_admin_all"
on public.atlas_source_chunks for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_generation_runs_admin_all" on public.atlas_generation_runs;
create policy "atlas_generation_runs_admin_all"
on public.atlas_generation_runs for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "atlas_map_sources_admin_all" on public.atlas_map_sources;
create policy "atlas_map_sources_admin_all"
on public.atlas_map_sources for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update, delete on public.atlas_sources to authenticated;
grant select, insert, update, delete on public.atlas_source_chunks to authenticated;
grant select, insert, update, delete on public.atlas_generation_runs to authenticated;
grant select, insert, update, delete on public.atlas_map_sources to authenticated;
