-- Reskin: database for accounts + cloud saving.
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

-- Built sites (one row per project)
create table if not exists public.projects (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  name       text not null default 'My site',
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Saved components (uiverse / MUI / 21st.dev / pasted)
create table if not exists public.components (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  collection text not null default 'My kit',
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Row level security: everyone can only see and change their own rows.
alter table public.projects   enable row level security;
alter table public.components enable row level security;

drop policy if exists "own projects"   on public.projects;
drop policy if exists "own components" on public.components;

create policy "own projects" on public.projects
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own components" on public.components
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
