-- SDPL2 (2-team player leagues) is retired.
--
-- Two-team leagues fell outside the SDPL season-rules set, so they never got
-- a lineup lock or a free agency window while the format table still listed
-- them as official. The format is no longer offered in the app, and the last
-- legacy row (SDPL2-00024) was deleted on 2026-08-07 along with its members,
-- drafts, picks and matchups.
--
-- This tightens the check constraint so 2 cannot come back via a direct
-- insert. Safe to run only while no leagues row has player_count = 2 —
-- verified empty before writing this migration.

alter table public.leagues drop constraint if exists leagues_player_count_check;
alter table public.leagues add constraint leagues_player_count_check
  check (player_count in (4, 6, 8, 10, 12, 30, 32));
