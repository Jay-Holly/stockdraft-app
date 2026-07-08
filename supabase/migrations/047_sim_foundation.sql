-- Sports-sim global reference schema (read-only for authenticated users).
-- Writes are performed via service_role only (no INSERT/UPDATE/DELETE policies).

create table if not exists public.sim_players (
  player_id text primary key,
  sport text not null check (sport in ('nfl', 'nba', 'nhl', 'mlb')),
  season text not null,
  full_name text not null,
  display_name text,
  position text,
  real_team text,
  created_at timestamptz not null default now()
);

create index if not exists sim_players_sport_season_idx
  on public.sim_players (sport, season);

create table if not exists public.sim_player_rankings (
  id bigint generated always as identity primary key,
  player_id text not null references public.sim_players (player_id) on delete cascade,
  rank int not null,
  tier text not null check (tier in ('editorial', 'production')),
  rank_source text,
  unique (player_id)
);

create index if not exists sim_player_rankings_player_id_idx
  on public.sim_player_rankings (player_id);

create table if not exists public.sim_player_injuries (
  id bigint generated always as identity primary key,
  player_id text not null references public.sim_players (player_id) on delete cascade,
  start_week int,
  end_week int,
  start_date date,
  end_date date,
  injury text,
  status text,
  games_missed int,
  source text
);

create index if not exists sim_player_injuries_player_id_idx
  on public.sim_player_injuries (player_id);

create table if not exists public.sim_team_schedule (
  id bigint generated always as identity primary key,
  sport text not null check (sport in ('nfl', 'nba', 'nhl', 'mlb')),
  season text not null,
  team text not null,
  bye_week int,
  is_outdoor boolean,
  stadium_lat double precision,
  stadium_lng double precision,
  unique (sport, season, team)
);

create index if not exists sim_team_schedule_sport_season_idx
  on public.sim_team_schedule (sport, season);

create table if not exists public.sim_game_results (
  id bigint generated always as identity primary key,
  sport text not null check (sport in ('nfl', 'nba', 'nhl', 'mlb')),
  season text not null,
  week int,
  game_date date,
  home_team text,
  away_team text,
  winning_team text,
  losing_team text,
  home_score int,
  away_score int
);

create index if not exists sim_game_results_sport_season_idx
  on public.sim_game_results (sport, season);

-- RLS: authenticated read-only; service_role writes bypass RLS (no write policies).

alter table public.sim_players enable row level security;
alter table public.sim_player_rankings enable row level security;
alter table public.sim_player_injuries enable row level security;
alter table public.sim_team_schedule enable row level security;
alter table public.sim_game_results enable row level security;

drop policy if exists "sim_players_read_authenticated" on public.sim_players;
create policy "sim_players_read_authenticated"
  on public.sim_players
  for select
  to authenticated
  using (true);

drop policy if exists "sim_player_rankings_read_authenticated" on public.sim_player_rankings;
create policy "sim_player_rankings_read_authenticated"
  on public.sim_player_rankings
  for select
  to authenticated
  using (true);

drop policy if exists "sim_player_injuries_read_authenticated" on public.sim_player_injuries;
create policy "sim_player_injuries_read_authenticated"
  on public.sim_player_injuries
  for select
  to authenticated
  using (true);

drop policy if exists "sim_team_schedule_read_authenticated" on public.sim_team_schedule;
create policy "sim_team_schedule_read_authenticated"
  on public.sim_team_schedule
  for select
  to authenticated
  using (true);

drop policy if exists "sim_game_results_read_authenticated" on public.sim_game_results;
create policy "sim_game_results_read_authenticated"
  on public.sim_game_results
  for select
  to authenticated
  using (true);
