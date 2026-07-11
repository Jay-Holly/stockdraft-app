-- Fix: concurrent auto-pick resolution (bot turns and human timer-expiry
-- auto-picks) could race and insert two draft_picks rows for the same
-- (draft_id, pick_order) slot before either commit was visible to the other.
-- See src/lib/draft/live-draft.ts claimAutoPickTurn for the app-level fix
-- that prevents new duplicates going forward.

-- 1. Clean up existing duplicates, keeping the earliest-created row per slot.
delete from public.draft_picks dp
using (
  select id,
         row_number() over (
           partition by draft_id, pick_order
           order by created_at asc, id asc
         ) as rn
  from public.draft_picks
) ranked
where dp.id = ranked.id
  and ranked.rn > 1;

-- 2. Prevent it from ever happening again at the DB level, as defense in
-- depth alongside the app-level claim.
alter table public.draft_picks
  drop constraint if exists draft_picks_draft_id_pick_order_key;
alter table public.draft_picks
  add constraint draft_picks_draft_id_pick_order_key
  unique (draft_id, pick_order);
