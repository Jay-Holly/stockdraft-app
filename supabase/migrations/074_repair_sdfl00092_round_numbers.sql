-- One-time data repair for league SDFL-00092 (2402b916-a65d-42b9-8cc0-b61b91d91391).
-- The non-atomic insert/round-bump bug (fixed in 073) left several teams
-- with duplicate/stale round_number values on draft_picks, a stale
-- drafts.current_round, and matching stale round_number on the mirrored
-- league_draft_events rows (which back the Round Recap panel). This league
-- uses sports_sim rules, where round always advances by exactly 1 per pick
-- regardless of pick type, so the correct round_number is simply each
-- pick's chronological position within its own team.

-- 1) Fix draft_picks.round_number from pick_order (0-indexed insertion order).
update public.draft_picks dp
set round_number = dp.pick_order + 1
from public.drafts d
where dp.draft_id = d.id
  and d.league_id = '2402b916-a65d-42b9-8cc0-b61b91d91391'
  and dp.round_number != dp.pick_order + 1;

-- 2) Fix drafts.current_round to match each team's actual pick count.
update public.drafts d
set current_round = coalesce(pc.cnt, 0) + 1
from (
  select draft_id, count(*) as cnt
  from public.draft_picks
  group by draft_id
) pc
where d.id = pc.draft_id
  and d.league_id = '2402b916-a65d-42b9-8cc0-b61b91d91391'
  and d.current_round != coalesce(pc.cnt, 0) + 1;

-- 3) Fix league_draft_events.round_number from each user's chronological
--    pick order within this league (feeds the Round Recap panel).
with ranked as (
  select id, row_number() over (partition by user_id order by created_at asc) as rn
  from public.league_draft_events
  where league_id = '2402b916-a65d-42b9-8cc0-b61b91d91391'
)
update public.league_draft_events e
set round_number = r.rn
from ranked r
where e.id = r.id
  and e.round_number != r.rn;
