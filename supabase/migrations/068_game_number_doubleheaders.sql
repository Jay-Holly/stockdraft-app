-- MLB doubleheaders put two genuinely distinct real games on the same
-- calendar date between the same two teams — game_date alone can't tell
-- them apart. Add game_number (defaults to 1, the common case) to both
-- sim_game_results and league_matchups, and widen their uniqueness to
-- include it so a doubleheader's second leg doesn't collide with the first.

alter table public.sim_game_results
  add column if not exists game_number smallint not null default 1;

alter table public.league_matchups
  add column if not exists game_number smallint not null default 1;

-- Rebuild league_matchups' pair-uniqueness to also distinguish game_number.
-- Existing weekly leagues never set more than game_number 1, so this is a
-- pure widening for them (no behavior change) while multi-asset leagues can
-- now insert a second doubleheader-leg row for the same
-- (week, home, away, game_date) that would otherwise violate the index from
-- migration 066.
drop index if exists public.league_matchups_pair_unique_idx;

create unique index league_matchups_pair_unique_idx
  on public.league_matchups (
    league_id,
    week_number,
    home_user_id,
    away_user_id,
    coalesce(game_date, '0001-01-01'::date),
    game_number
  )
  where home_user_id is not null and away_user_id is not null;
