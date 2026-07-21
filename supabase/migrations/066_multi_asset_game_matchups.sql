-- SDBA/SDHL/SDLB (multi-asset sports-sim leagues) need one league_matchups row
-- per individual real game (up to 162/season for MLB, ~82 for NBA/NHL), each
-- with its own independent win/loss decided by that single day's stock/crypto
-- % gain. SDFL/SDPL/SDAI leagues keep exactly one row per (week, home, away)
-- pair — this migration must not change that.
--
-- game_date carries the per-game identity for multi-asset leagues; it stays
-- null for every other league type. week_number is kept populated for all
-- leagues (including multi-asset) purely as a calendar-week grouping label —
-- the UI already reads it generically as "Week N" everywhere.

alter table public.league_matchups
  add column if not exists game_date date;

create index if not exists league_matchups_game_date_idx
  on public.league_matchups (league_id, game_date)
  where game_date is not null;

-- Replace the old (league_id, week_number, home_user_id, away_user_id) unique
-- index with one that also distinguishes game_date. A plain unique index
-- would NOT re-create the same protection for existing weekly leagues, since
-- Postgres treats every NULL as distinct — two weekly rows with game_date
-- both null would no longer collide. Coalescing to a fixed sentinel date
-- keeps the original single-row-per-week guarantee for those leagues while
-- letting multi-asset leagues add one row per real game_date.
drop index if exists public.league_matchups_pair_unique_idx;

create unique index league_matchups_pair_unique_idx
  on public.league_matchups (
    league_id,
    week_number,
    home_user_id,
    away_user_id,
    coalesce(game_date, '0001-01-01'::date)
  )
  where home_user_id is not null and away_user_id is not null;
