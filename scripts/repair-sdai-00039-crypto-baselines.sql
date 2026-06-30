/**
 * One-time repair for SDAI-00039 crypto baseline integrity.
 *
 * REVIEW ONLY — run manually in Supabase SQL Editor after inspecting previews.
 * Does NOT run automatically from the app.
 *
 * Fixes:
 * 1. value_at_close > value_at_open on active crypto picks (phantom season gain)
 * 2. Orphan baseline rows tied to dead crypto draft_picks (zero budget + shares)
 * 3. Optional: delete dead crypto draft_picks shells (uncomment Step 4)
 */
-- =============================================================================
-- STEP 0: League context
-- =============================================================================
select
  l.id as league_id,
  l.support_code,
  l.current_week,
  l.status
from public.leagues l
where l.support_code = 'SDAI-00039';

-- =============================================================================
-- STEP 1 PREVIEW: Active vs dead crypto draft_picks
-- =============================================================================
select
  dp.id as pick_id,
  dp.symbol,
  dp.budget_spent,
  dp.shares,
  dp.effective_value,
  dp.updated_at,
  dp.acquired_via,
  case
    when dp.budget_spent > 0.01 or dp.shares > 0.000001 then 'active'
    else 'dead_shell'
  end as pick_status
from public.draft_picks dp
join public.drafts d on d.id = dp.draft_id
join public.leagues l on l.id = d.league_id
where l.support_code = 'SDAI-00039'
  and dp.pick_type = 'crypto'
order by dp.symbol, dp.updated_at desc;

-- =============================================================================
-- STEP 2 PREVIEW: Baseline rows (including mismatched close > open)
-- =============================================================================
select
  dp.symbol,
  dp.id as pick_id,
  rwb.week_number,
  rwb.value_at_open,
  rwb.value_at_close,
  rwb.value_at_close - rwb.value_at_open as close_minus_open,
  case
    when dp.budget_spent > 0.01 or dp.shares > 0.000001 then 'active'
    else 'dead_shell'
  end as pick_status
from public.roster_week_baselines rwb
join public.draft_picks dp on dp.id = rwb.pick_id
join public.leagues l on l.id = rwb.league_id
where l.support_code = 'SDAI-00039'
  and dp.pick_type = 'crypto'
order by dp.symbol, rwb.week_number, dp.id;

-- =============================================================================
-- STEP 3 PREVIEW: Rows that Step 3a will fix (close > open on active picks)
-- =============================================================================
select
  dp.symbol,
  rwb.pick_id,
  rwb.week_number,
  rwb.value_at_open,
  rwb.value_at_close
from public.roster_week_baselines rwb
join public.draft_picks dp on dp.id = rwb.pick_id
join public.leagues l on l.id = rwb.league_id
where l.support_code = 'SDAI-00039'
  and dp.pick_type = 'crypto'
  and (dp.budget_spent > 0.01 or dp.shares > 0.000001)
  and rwb.value_at_close is not null
  and rwb.value_at_close > rwb.value_at_open;

-- =============================================================================
-- STEP 3a REPAIR: Align close down to open when close exceeds open (active crypto)
-- =============================================================================
-- begin;

-- update public.roster_week_baselines rwb
-- set value_at_close = rwb.value_at_open
-- from public.draft_picks dp
-- join public.leagues l on l.id = rwb.league_id
-- where rwb.pick_id = dp.id
--   and l.support_code = 'SDAI-00039'
--   and dp.pick_type = 'crypto'
--   and (dp.budget_spent > 0.01 or dp.shares > 0.000001)
--   and rwb.value_at_close is not null
--   and rwb.value_at_close > rwb.value_at_open;

-- =============================================================================
-- STEP 3b PREVIEW: Orphan baseline rows (dead crypto shells)
-- =============================================================================
select
  dp.symbol,
  rwb.pick_id,
  rwb.week_number,
  rwb.value_at_open,
  rwb.value_at_close
from public.roster_week_baselines rwb
join public.draft_picks dp on dp.id = rwb.pick_id
join public.leagues l on l.id = rwb.league_id
where l.support_code = 'SDAI-00039'
  and dp.pick_type = 'crypto'
  and dp.budget_spent <= 0.01
  and dp.shares <= 0.000001;

-- =============================================================================
-- STEP 3b REPAIR: Delete orphan baselines for dead crypto picks
-- =============================================================================
-- begin;

-- delete from public.roster_week_baselines rwb
-- using public.draft_picks dp, public.leagues l
-- where rwb.pick_id = dp.id
--   and rwb.league_id = l.id
--   and l.support_code = 'SDAI-00039'
--   and dp.pick_type = 'crypto'
--   and dp.budget_spent <= 0.01
--   and dp.shares <= 0.000001;

-- =============================================================================
-- STEP 4 PREVIEW (optional): Dead crypto draft_picks to delete
-- =============================================================================
select
  dp.id,
  dp.symbol,
  dp.budget_spent,
  dp.shares,
  dp.updated_at
from public.draft_picks dp
join public.drafts d on d.id = dp.draft_id
join public.leagues l on l.id = d.league_id
where l.support_code = 'SDAI-00039'
  and dp.pick_type = 'crypto'
  and dp.budget_spent <= 0.01
  and dp.shares <= 0.000001;

-- =============================================================================
-- STEP 4 REPAIR (optional): Remove dead crypto draft_picks
-- Baselines for these picks must be deleted first (Step 3b).
-- =============================================================================
-- begin;

-- delete from public.draft_picks dp
-- using public.drafts d, public.leagues l
-- where dp.draft_id = d.id
--   and d.league_id = l.id
--   and l.support_code = 'SDAI-00039'
--   and dp.pick_type = 'crypto'
--   and dp.budget_spent <= 0.01
--   and dp.shares <= 0.000001;

-- commit;

-- =============================================================================
-- STEP 5 VERIFY: crypto_prices freshness (scoring reads this table, NOT crypto_pool)
-- =============================================================================
select symbol, price, change_percent, updated_at
from public.crypto_prices
where symbol in ('BTC', 'ETH', 'XRP')
order by symbol;
