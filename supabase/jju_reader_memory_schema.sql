create table if not exists public.reader_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  book_id text not null,
  section_id text not null,
  section_title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.reader_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  book_id text not null,
  section_id text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.reader_quotes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  book_id text not null,
  book_title text not null default '',
  section_id text not null,
  section_title text not null default '',
  text text not null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists reader_bookmarks_user_book_idx
on public.reader_bookmarks(user_id, book_id);

create index if not exists reader_notes_user_book_idx
on public.reader_notes(user_id, book_id);

create index if not exists reader_quotes_user_book_idx
on public.reader_quotes(user_id, book_id, saved_at desc);

drop trigger if exists set_reader_bookmarks_updated_at on public.reader_bookmarks;
create trigger set_reader_bookmarks_updated_at
before update on public.reader_bookmarks
for each row execute function public.set_updated_at();

drop trigger if exists set_reader_notes_updated_at on public.reader_notes;
create trigger set_reader_notes_updated_at
before update on public.reader_notes
for each row execute function public.set_updated_at();

alter table public.reader_bookmarks enable row level security;
alter table public.reader_notes enable row level security;
alter table public.reader_quotes enable row level security;

drop policy if exists "reader_bookmarks_all_own" on public.reader_bookmarks;
create policy "reader_bookmarks_all_own"
on public.reader_bookmarks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "reader_notes_all_own" on public.reader_notes;
create policy "reader_notes_all_own"
on public.reader_notes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "reader_quotes_all_own" on public.reader_quotes;
create policy "reader_quotes_all_own"
on public.reader_quotes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update, delete on public.reader_bookmarks to authenticated;
grant select, insert, update, delete on public.reader_notes to authenticated;
grant select, insert, update, delete on public.reader_quotes to authenticated;
