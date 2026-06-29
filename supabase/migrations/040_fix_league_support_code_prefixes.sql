-- Correct support_code prefixes for 3 audited mismatches (SDFL- → SDPL2-).
-- Replace set_league_support_code trigger so future leagues get the right prefix.
-- Run before 041_backfill_human_league_matchups.sql.

-- ---------------------------------------------------------------------------
-- 1. Rename exactly these 3 leagues (suffix preserved)
-- ---------------------------------------------------------------------------

update public.leagues
set support_code = 'SDPL2-00020'
where id = '5cc1a565-f386-4bba-ab41-7a950ba8fd4d'
  and support_code = 'SDFL-00020';

update public.leagues
set support_code = 'SDPL2-00022'
where id = 'cf0b58c3-b7df-4478-aa5f-0871cb021bfe'
  and support_code = 'SDFL-00022';

update public.leagues
set support_code = 'SDPL2-00024'
where id = '7c7962ba-3a4b-461f-a739-0a785eee8a3e'
  and support_code = 'SDFL-00024';

-- ---------------------------------------------------------------------------
-- 2. Shared prefix logic (matches scripts/audit-league-support-codes.sql)
-- ---------------------------------------------------------------------------

create or replace function public.league_support_code_prefix(
  p_format_type text,
  p_sports_league_id text,
  p_player_count int
)
returns text
language plpgsql
immutable
as $$
begin
  if p_format_type = 'sports_league' and p_sports_league_id is not null then
    return upper(p_sports_league_id);
  end if;

  if p_format_type = 'standard'
    and p_player_count in (2, 4, 6, 8, 10, 12) then
    return 'SDPL' || p_player_count::text;
  end if;

  -- Fallback for solo / legacy rows without explicit player_count
  return 'SDPL' || coalesce(nullif(p_player_count, 0), 4)::text;
end;
$$;

-- Keep global numeric suffix sequence aligned with highest suffix in use.
select setval(
  'public.league_support_code_seq',
  coalesce(
    (
      select max(
        nullif(regexp_replace(support_code, '^[A-Za-z0-9]+-', ''), '')::bigint
      )
      from public.leagues
    ),
    0
  ) + 1,
  false
);

-- ---------------------------------------------------------------------------
-- 3. Trigger: assign prefix from league type, not hardcoded SDFL-
-- ---------------------------------------------------------------------------

create or replace function public.set_league_support_code()
returns trigger
language plpgsql
as $$
declare
  v_prefix text;
begin
  if new.support_code is null then
    v_prefix := public.league_support_code_prefix(
      new.format_type,
      new.sports_league_id,
      new.player_count
    );

    new.support_code :=
      v_prefix || '-' || lpad(nextval('public.league_support_code_seq')::text, 5, '0');
  end if;

  return new;
end;
$$;
