/**
 * One-time repair for SDFL-00085 REGN bench move bug.
 *
 * REVIEW ONLY — run manually in Supabase SQL Editor after inspecting previews.
 * Does NOT run automatically from the app.
 *
 * Fixes:
 * 1. REGN (benched) has shares but budget_spent=0 (should be shares=0)
 * 2. REGN (benched) has no week baseline reset (should be cleared for scoring consistency)
 */
-- =============================================================================
-- STEP 0: League context
-- =============================================================================
select
  l.id as league_id,
  l.league_id as support_code,
  l.current_week,
  l.status
from public.leagues l
where l.league_id = 'sdfl-00085';

-- =============================================================================
-- STEP 1 PREVIEW: Current state of REGN and MAA picks
-- =============================================================================
select
  dp.id as pick_id,
  dp.symbol,
  dp.pick_type,
  dp.budget_spent,
  dp.shares,
  dp.price_at_pick,
  dp.effective_value,
  dp.updated_at
from public.draft_picks dp
join public.drafts d on d.id = dp.draft_id
join public.leagues l on l.id = d.league_id
join public.profiles p on p.id = d.user_id
where l.league_id = 'sdfl-00085'
  and p.username = 'jay13'
  and dp.symbol in ('REGN', 'MAA')
order by dp.symbol;

-- =============================================================================
-- STEP 2 PREVIEW: REGN's week baselines (should be empty after fix)
-- =============================================================================
select
  rwb.pick_id,
  rwb.week_number,
  rwb.value_at_open,
  rwb.value_at_close,
  dp.symbol,
  dp.pick_type
from public.roster_week_baselines rwb
join public.draft_picks dp on dp.id = rwb.pick_id
join public.leagues l on l.id = rwb.league_id
where l.league_id = 'sdfl-00085'
  and dp.symbol = 'REGN'
order by rwb.week_number;

-- =============================================================================
-- STEP 3 PREVIEW: What will be fixed
-- =============================================================================
select
  'REGN shares' as fix_item,
  'Set to 0 (currently ' || (
    select dp.shares::text
    from public.draft_picks dp
    join public.drafts d on d.id = dp.draft_id
    join public.leagues l on l.id = d.league_id
    join public.profiles p on p.id = d.user_id
    where l.league_id = 'sdfl-00085'
      and p.username = 'jay13'
      and dp.symbol = 'REGN'
  ) || ')' as action
union all
select
  'REGN week baselines' as fix_item,
  'Delete ' || (
    select count(*)::text
    from public.roster_week_baselines rwb
    join public.draft_picks dp on dp.id = rwb.pick_id
    join public.leagues l on l.id = rwb.league_id
    where l.league_id = 'sdfl-00085'
      and dp.symbol = 'REGN'
  ) || ' rows' as action;

-- =============================================================================
-- STEP 3a REPAIR: Fix REGN shares and baselines
-- =============================================================================
-- begin;

-- Get the pick ID first for reference
-- with regn_pick as (
--   select dp.id
--   from public.draft_picks dp
--   join public.drafts d on d.id = dp.draft_id
--   join public.leagues l on l.id = d.league_id
--   join public.profiles p on p.id = d.user_id
--   where l.league_id = 'sdfl-00085'
--     and p.username = 'jay13'
--     and dp.symbol = 'REGN'
-- )
-- update public.draft_picks dp
-- set shares = 0
-- from regn_pick
-- where dp.id = regn_pick.id;

-- -- Delete REGN week baselines to prevent phantom scoring
-- with regn_pick as (
--   select dp.id
--   from public.draft_picks dp
--   join public.drafts d on d.id = dp.draft_id
--   join public.leagues l on l.id = d.league_id
--   join public.profiles p on p.id = d.user_id
--   where l.league_id = 'sdfl-00085'
--     and p.username = 'jay13'
--     and dp.symbol = 'REGN'
-- )
-- delete from public.roster_week_baselines rwb
-- using regn_pick
-- where rwb.pick_id = regn_pick.id;

-- commit;

-- =============================================================================
-- STEP 4 VERIFY: Confirm fixes applied
-- =============================================================================
-- Run this after applying Step 3a repairs:
-- select
--   dp.id,
--   dp.symbol,
--   dp.pick_type,
--   dp.shares,
--   dp.budget_spent,
--   (select count(*) from public.roster_week_baselines where pick_id = dp.id) as baseline_count
-- from public.draft_picks dp
-- join public.drafts d on d.id = dp.draft_id
-- join public.leagues l on l.id = d.league_id
-- join public.profiles p on p.id = d.user_id
-- where l.league_id = 'sdfl-00085'
--   and p.username = 'jay13'
--   and dp.symbol = 'REGN';
