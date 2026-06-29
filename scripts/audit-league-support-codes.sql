-- Audit: leagues whose support_code prefix does not match league type / format / player count.
-- Run in Supabase SQL Editor (service role / postgres — not blocked by RLS).
-- Do NOT run the correction migration until the mismatched list is reviewed.

-- ---------------------------------------------------------------------------
-- Expected prefix rules (check order):
--   1. league_type = 'ai'                         →  SDAI-
--   2. format_type = 'sports_league'              →  SDFL- / SDHL- / SDBA- / SDLB- (sports_league_id)
--   3. format_type = 'standard' (non-ai)          →  SDPL2- / SDPL4- / … / SDPL12-
--   4. solo / other                               →  SDPL4- fallback (legacy)
-- ---------------------------------------------------------------------------

with parsed as (
  select
    l.id,
    l.name,
    l.support_code,
    l.league_type,
    l.format_type,
    l.sports_league_id,
    l.player_count,
    l.visibility,
    l.opponent_type,
    l.status,
    l.is_solo,
    l.created_at,
    upper(split_part(l.support_code, '-', 1)) as current_prefix,
    regexp_replace(l.support_code, '^[A-Za-z0-9]+-', '') as numeric_suffix,
    case
      when l.league_type = 'ai' then
        'SDAI'
      when l.format_type = 'sports_league' and l.sports_league_id is not null then
        upper(l.sports_league_id)
      when l.format_type = 'standard'
        and l.player_count in (2, 4, 6, 8, 10, 12) then
        'SDPL' || l.player_count::text
      else
        'SDPL4'
    end as expected_prefix,
    case
      when l.league_type = 'ai' then
        'SDAI-' || regexp_replace(l.support_code, '^[A-Za-z0-9]+-', '')
      when l.format_type = 'sports_league' and l.sports_league_id is not null then
        upper(l.sports_league_id) || '-' || regexp_replace(l.support_code, '^[A-Za-z0-9]+-', '')
      when l.format_type = 'standard'
        and l.player_count in (2, 4, 6, 8, 10, 12) then
        'SDPL' || l.player_count::text || '-' || regexp_replace(l.support_code, '^[A-Za-z0-9]+-', '')
      else
        'SDPL4-' || regexp_replace(l.support_code, '^[A-Za-z0-9]+-', '')
    end as expected_support_code
  from public.leagues l
)
select
  support_code as current_support_code,
  expected_support_code,
  current_prefix,
  expected_prefix,
  numeric_suffix,
  league_type,
  format_type,
  sports_league_id,
  player_count,
  visibility,
  opponent_type,
  status,
  is_solo,
  name,
  id,
  created_at
from parsed
where current_prefix is distinct from expected_prefix
order by created_at, support_code;

-- AI-only mismatches (should all become SDAI-):
-- select * from parsed where league_type = 'ai' and current_prefix <> 'SDAI' order by created_at;
