-- SDAI- prefix for AI leagues + 4-step prefix check order for future inserts.
-- No data backfill: audit found zero existing AI leagues needing rename.

drop function if exists public.league_support_code_prefix(text, text, int);

create or replace function public.league_support_code_prefix(
  p_league_type text,
  p_format_type text,
  p_sports_league_id text,
  p_player_count int
)
returns text
language plpgsql
immutable
as $$
begin
  -- 1. AI leagues (sponsor/advertiser audit reporting)
  if p_league_type = 'ai' then
    return 'SDAI';
  end if;

  -- 2. Sports sim leagues
  if p_format_type = 'sports_league' and p_sports_league_id is not null then
    return upper(p_sports_league_id);
  end if;

  -- 3. Standard human player-count leagues
  if p_format_type = 'standard'
    and p_player_count in (2, 4, 6, 8, 10, 12) then
    return 'SDPL' || p_player_count::text;
  end if;

  -- 4. Solo / legacy fallback
  return 'SDPL' || coalesce(nullif(p_player_count, 0), 4)::text;
end;
$$;

create or replace function public.set_league_support_code()
returns trigger
language plpgsql
as $$
declare
  v_prefix text;
begin
  if new.support_code is null then
    v_prefix := public.league_support_code_prefix(
      new.league_type,
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
