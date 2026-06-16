-- Adds first-class Lulu asset fields to existing print products.
-- Safe to run more than once in the Supabase SQL Editor.

alter table public.print_products add column if not exists lulu_pod_package_id text;
alter table public.print_products add column if not exists public_interior_url text;
alter table public.print_products add column if not exists public_cover_url text;
