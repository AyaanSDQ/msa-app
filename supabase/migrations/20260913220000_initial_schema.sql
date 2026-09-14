-- Initial schema for MSA Prayer & Events Update App
-- Source: msa-app-spec.md §7 (Data Model) and §8 (Authentication & Authorization)

-- ============================================================
-- Tables
-- ============================================================

create table public.updates (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('prayer', 'social', 'announcement', 'exec_meeting')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'deleted')),
  title text not null,
  body text,
  location text,
  event_time timestamptz,
  accepts_feedback boolean default false,
  posted_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table public.executives (
  user_id uuid primary key references auth.users(id),
  display_name text,
  active boolean default true
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  update_id uuid references public.updates(id),
  body text,
  rating int,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.updates enable row level security;
alter table public.executives enable row level security;
alter table public.feedback enable row level security;

-- executives: an exec can read their own allowlist row. This backs the
-- EXISTS-against-executives checks in the policies below — without it,
-- RLS on executives would make those subqueries see no rows even for a
-- legitimate exec. No insert/update/delete policy: the table is managed
-- by Ayaan directly (service role / dashboard), not from the client.
create policy "execs can read own executive row"
  on public.executives for select
  to authenticated
  using (user_id = auth.uid());

-- updates: public read, excluding exec-only and soft-deleted rows.
create policy "anon can read public updates"
  on public.updates for select
  to anon
  using (type <> 'exec_meeting' and status <> 'deleted');

-- updates: active execs can read every row, no filter.
create policy "active execs can read all updates"
  on public.updates for select
  to authenticated
  using (
    exists (
      select 1 from public.executives e
      where e.user_id = auth.uid() and e.active = true
    )
  );

-- updates: only active execs can post/cancel/delete/restore (all are
-- row inserts or status/field updates per spec's soft-delete model).
create policy "active execs can insert updates"
  on public.updates for insert
  to authenticated
  with check (
    exists (
      select 1 from public.executives e
      where e.user_id = auth.uid() and e.active = true
    )
  );

create policy "active execs can update updates"
  on public.updates for update
  to authenticated
  using (
    exists (
      select 1 from public.executives e
      where e.user_id = auth.uid() and e.active = true
    )
  )
  with check (
    exists (
      select 1 from public.executives e
      where e.user_id = auth.uid() and e.active = true
    )
  );

-- feedback: write-only for anon, tied to a post, never publicly readable.
create policy "anon can submit feedback"
  on public.feedback for insert
  to anon
  with check (true);

-- feedback: exec-only read.
create policy "active execs can read feedback"
  on public.feedback for select
  to authenticated
  using (
    exists (
      select 1 from public.executives e
      where e.user_id = auth.uid() and e.active = true
    )
  );

-- ============================================================
-- Grants (RLS above still governs row-level access)
-- ============================================================

grant select on public.updates to anon, authenticated;
grant insert, update on public.updates to authenticated;

grant select on public.executives to authenticated;

grant insert on public.feedback to anon, authenticated;
grant select on public.feedback to authenticated;
