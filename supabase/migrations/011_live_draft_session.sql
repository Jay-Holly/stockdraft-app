-- Phase B: Live sequential draft session

alter table public.leagues add column if not exists draft_format text not null default 'async'
  check (draft_format in ('async', 'live'));
alter table public.leagues add column if not exists pick_time_seconds int not null default 120
  check (pick_time_seconds >= 30 and pick_time_seconds <= 600);

create table if not exists public.league_draft_state (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  status text not null default 'in_progress'
    check (status in ('waiting', 'in_progress', 'complete')),
  draft_order uuid[] not null,
  current_pick_index int not null default 0 check (current_pick_index >= 0),
  total_pick_slots int not null check (total_pick_slots > 0),
  on_clock_user_id uuid references public.profiles(id) on delete set null,
  pick_deadline_at timestamptz,
  global_pick_number int not null default 0 check (global_pick_number >= 0),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.league_members add column if not exists draft_slot int
  check (draft_slot is null or draft_slot >= 0);

create index if not exists league_draft_state_on_clock_idx
  on public.league_draft_state (on_clock_user_id);
create index if not exists league_draft_state_status_idx
  on public.league_draft_state (status);

alter table public.league_draft_state enable row level security;

drop policy if exists "League members can view draft state" on public.league_draft_state;
create policy "League members can view draft state"
  on public.league_draft_state for select
  to authenticated
  using (public.is_league_member(league_id));

drop policy if exists "AI league owner can manage draft state" on public.league_draft_state;
create policy "AI league owner can manage draft state"
  on public.league_draft_state for all
  to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_draft_state.league_id
        and l.league_type = 'ai'
        and l.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_draft_state.league_id
        and l.league_type = 'ai'
        and l.owner_user_id = auth.uid()
    )
  );
