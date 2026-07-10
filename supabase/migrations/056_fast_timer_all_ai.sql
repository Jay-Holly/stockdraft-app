-- Fast-timer config for bot-heavy test drafts: bot-only (all_ai) leagues may
-- drop as low as 10 seconds/pick to speed up iteration. Human-involving
-- leagues (all_human, mixed) keep the existing 30-second floor.

alter table public.leagues
  drop constraint if exists leagues_pick_time_seconds_check;

alter table public.leagues
  add constraint leagues_pick_time_seconds_check
  check (
    pick_time_seconds <= 600
    and (
      (opponent_type = 'all_ai' and pick_time_seconds >= 10)
      or (opponent_type is distinct from 'all_ai' and pick_time_seconds >= 30)
    )
  );
