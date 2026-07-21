-- Per-game (single real-game-day) open/close baselines for SDBA/SDHL/SDLB —
-- mirrors roster_week_baselines (018_roster_week_baselines.sql,
-- 034_week_baseline_history.sql) but keyed by game_date instead of
-- week_number, since each multi-asset league game is scored independently
-- from that one day's stock/crypto % gain rather than a weekly cumulative.

create table if not exists public.roster_day_baselines (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  game_date date not null,
  pick_id uuid not null references public.draft_picks(id) on delete cascade,
  value_at_open numeric not null default 0,
  value_at_close numeric,
  captured_at timestamptz not null default now(),
  unique (league_id, user_id, game_date, pick_id)
);

create index if not exists roster_day_baselines_lookup_idx
  on public.roster_day_baselines (league_id, user_id, game_date);

alter table public.roster_day_baselines enable row level security;

-- Mirrors roster_week_baselines: any league member can read every member's
-- baselines (needed for the Matchups page to show an opponent's score), but
-- only the owning user can write their own rows.
drop policy if exists "League members view day baselines" on public.roster_day_baselines;
create policy "League members view day baselines"
  on public.roster_day_baselines
  for select
  to authenticated
  using (public.is_league_member(league_id));

drop policy if exists "Users manage own day baselines" on public.roster_day_baselines;
create policy "Users manage own day baselines"
  on public.roster_day_baselines
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
