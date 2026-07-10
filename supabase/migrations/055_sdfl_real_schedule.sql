-- SDFL real-schedule mirroring: current_week needs to reach the Stock Draft
-- Bowl (week 22 = 18 regular-season weeks + 4 playoff rounds), and
-- playoff_round needs SDFL's 4-round bracket vocabulary alongside SDPL's
-- existing semifinal/final/third_place values.

alter table public.leagues
  drop constraint if exists leagues_current_week_check;

alter table public.leagues
  add constraint leagues_current_week_check
  check (current_week >= 1 and current_week <= 25);

alter table public.league_matchups
  drop constraint if exists league_matchups_playoff_round_check;

alter table public.league_matchups
  add constraint league_matchups_playoff_round_check
  check (
    playoff_round is null or playoff_round in (
      'semifinal', 'final', 'third_place',
      'wild_card', 'divisional', 'conference_championship'
    )
  );
