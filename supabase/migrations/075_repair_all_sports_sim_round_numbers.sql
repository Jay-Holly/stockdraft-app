-- Universal version of 074: repairs the same non-atomic-insert round_number
-- corruption (fixed going forward by 073) across every sports-sim league
-- (SDFL/SDHL/SDBA/SDLB, or format_type = 'sports_league'), not just one.
--
-- Scoped to sports-sim leagues specifically because that's the only mode
-- where round always advances by exactly 1 per pick regardless of pick
-- type (see getNextRoundAfterPick in src/lib/draft/engine.ts) — so a pick's
-- chronological position within its own team is always the correct round
-- number. Standard/AI-league draft rules have crypto-budget and bench-phase
-- branches where that invariant does NOT hold, so this repair must not run
-- against them.

-- 1) Fix draft_picks.round_number from pick_order (0-indexed insertion order).
update public.draft_picks dp
set round_number = dp.pick_order + 1
from public.drafts d
join public.leagues l on l.id = d.league_id
where dp.draft_id = d.id
  and (
    l.format_type = 'sports_league'
    or lower(l.sports_league_id) in ('sdfl', 'sdhl', 'sdba', 'sdlb')
  )
  and dp.round_number != dp.pick_order + 1;

-- 2) Fix drafts.current_round to match each team's actual pick count.
update public.drafts d
set current_round = coalesce(pc.cnt, 0) + 1
from public.leagues l,
  (
    select draft_id, count(*) as cnt
    from public.draft_picks
    group by draft_id
  ) pc
where d.league_id = l.id
  and d.id = pc.draft_id
  and (
    l.format_type = 'sports_league'
    or lower(l.sports_league_id) in ('sdfl', 'sdhl', 'sdba', 'sdlb')
  )
  and d.current_round != coalesce(pc.cnt, 0) + 1;

-- 3) Fix league_draft_events.round_number from each user's chronological
--    pick order within their league (feeds the Round Recap panel).
with ranked as (
  select e.id, row_number() over (partition by e.league_id, e.user_id order by e.created_at asc) as rn
  from public.league_draft_events e
  join public.leagues l on l.id = e.league_id
  where l.format_type = 'sports_league'
     or lower(l.sports_league_id) in ('sdfl', 'sdhl', 'sdba', 'sdlb')
)
update public.league_draft_events e
set round_number = r.rn
from ranked r
where e.id = r.id
  and e.round_number != r.rn;
