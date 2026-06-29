-- Audit: AI leagues (league_type = 'ai') whose support_code is not SDAI-.
-- Run in Supabase SQL Editor (postgres / service role — not blocked by RLS).
-- Do NOT rename until this list is reviewed and approved.

-- Expected: league_type = 'ai' → SDAI-{suffix} (always, regardless of player_count/format_type)

with ai_leagues as (
  select
    l.id,
    l.name,
    l.support_code,
    l.league_type,
    l.format_type,
    l.sports_league_id,
    l.player_count,
    l.status,
    l.owner_user_id,
    l.created_at,
    upper(split_part(l.support_code, '-', 1)) as current_prefix,
    regexp_replace(l.support_code, '^[A-Za-z0-9]+-', '') as numeric_suffix,
    'SDAI' as expected_prefix,
    'SDAI-' || regexp_replace(l.support_code, '^[A-Za-z0-9]+-', '') as expected_support_code
  from public.leagues l
  where l.league_type = 'ai'
)
select
  support_code as current_support_code,
  expected_support_code,
  current_prefix,
  expected_prefix,
  numeric_suffix,
  format_type,
  sports_league_id,
  player_count,
  status,
  name,
  id,
  created_at
from ai_leagues
where current_prefix is distinct from expected_prefix
order by created_at, support_code;

-- All AI leagues (including already-correct SDAI- rows, if any):
-- select * from ai_leagues order by created_at;

-- Count summary:
-- select current_prefix, count(*) from ai_leagues group by 1 order by 1;
