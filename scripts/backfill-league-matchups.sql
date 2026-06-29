-- ON HOLD — do not run until support_code renames + round-robin pseudocode are approved.
-- Use migration 040 (league_id UUID targets) or node script with --league-id after rename.
-- Requires migration 033 (drops one-matchup-per-week unique constraint).

-- Inspect member composition first:
-- SELECT l.support_code, l.player_count, l.status,
--        lm.user_id, lm.display_name, lm.draft_slot, lm.bot_personality
-- FROM leagues l
-- JOIN league_members lm ON lm.league_id = l.id
-- WHERE l.support_code IN ('SDFL-00022', 'SDFL-00024')
-- ORDER BY l.support_code, lm.draft_slot NULLS LAST;

-- Prefer the Node backfill for full round-robin generation:
--   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-human-league-matchups.mjs SDFL-00022 SDFL-00024

-- Minimal 2-team week-1 fallback (run only if you cannot use the script):
-- (Repeat per league / generalize with the script above for 4+ teams.)

WITH target AS (
  SELECT id, owner_user_id
  FROM public.leagues
  WHERE support_code = 'SDFL-00022'
),
members AS (
  SELECT lm.*, row_number() OVER (ORDER BY lm.draft_slot NULLS LAST, lm.user_id) AS rn
  FROM public.league_members lm
  JOIN target t ON t.id = lm.league_id
),
existing AS (
  SELECT count(*) AS c FROM public.league_matchups m JOIN target t ON t.id = m.league_id
)
INSERT INTO public.league_matchups (
  league_id, week_number, home_user_id, away_user_id,
  is_playoff, playoff_round, opponent_bot_id, opponent_name, status
)
SELECT
  (SELECT id FROM target),
  1,
  m1.user_id,
  m2.user_id,
  false,
  null,
  m2.user_id,
  coalesce(m2.display_name, 'Opponent'),
  'scheduled'
FROM members m1
JOIN members m2 ON m2.rn = 2
CROSS JOIN existing e
WHERE m1.rn = 1 AND e.c = 0;

-- Repeat for SDFL-00024 by changing support_code above, or use the Node script.
