-- SDPL season calendar: per-league settings, matchup finalize timestamps, 3rd-place playoffs.
-- Lock/FA/scoring rules apply only to SDPL player-count leagues (app layer); sports-sim leagues unchanged.

create table if not exists public.league_season_settings (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  season_format text not null default 'standard'
    check (season_format in ('standard', 'beta_daily')),
  regular_season_weeks int not null default 11
    check (regular_season_weeks >= 1 and regular_season_weeks <= 13),
  week_calendar jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists league_season_settings_format_idx
  on public.league_season_settings (season_format);

alter table public.league_matchups
  add column if not exists finalize_at timestamptz,
  add column if not exists stock_close_captured_at timestamptz;

alter table public.roster_week_baselines
  add column if not exists stock_value_at_friday_close numeric;

alter table public.league_matchups
  drop constraint if exists league_matchups_playoff_round_check;

alter table public.league_matchups
  add constraint league_matchups_playoff_round_check
  check (playoff_round is null or playoff_round in ('semifinal', 'final', 'third_place'));

alter table public.league_season_settings enable row level security;

drop policy if exists "League members view season settings" on public.league_season_settings;
create policy "League members view season settings"
  on public.league_season_settings for select
  to authenticated
  using (public.is_league_member(league_id));
