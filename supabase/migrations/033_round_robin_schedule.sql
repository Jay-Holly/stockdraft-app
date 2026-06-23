-- Round-robin schedule: multiple matchups per week, team-vs-team scoring, playoffs

alter table public.leagues add column if not exists current_week int not null default 1
  check (current_week >= 1 and current_week <= 15);

alter table public.league_matchups drop constraint if exists league_matchups_league_id_week_number_key;

alter table public.league_matchups alter column opponent_bot_id drop not null;

alter table public.league_matchups add column if not exists home_user_id uuid
  references public.profiles(id) on delete cascade;
alter table public.league_matchups add column if not exists away_user_id uuid
  references public.profiles(id) on delete cascade;
alter table public.league_matchups add column if not exists home_score numeric;
alter table public.league_matchups add column if not exists away_score numeric;
alter table public.league_matchups add column if not exists winner_user_id uuid
  references public.profiles(id) on delete set null;
alter table public.league_matchups add column if not exists is_playoff boolean not null default false;
alter table public.league_matchups add column if not exists playoff_round text
  check (playoff_round is null or playoff_round in ('semifinal', 'final'));

create unique index if not exists league_matchups_pair_unique_idx
  on public.league_matchups (league_id, week_number, home_user_id, away_user_id)
  where home_user_id is not null and away_user_id is not null;

create index if not exists league_matchups_league_week_idx
  on public.league_matchups (league_id, week_number);

-- Drop legacy winner check so winner_user_id drives results (winner column kept for compat)
alter table public.league_matchups drop constraint if exists league_matchups_winner_check;
