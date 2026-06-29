-- Backfill missing human-league matchup schedules (round-robin, league_id keyed).
-- Requires: 033 (round-robin constraint), 040 (support_code renames + trigger).
--
-- Targets (post-rename):
--   SDPL2-00022  cf0b58c3-b7df-4478-aa5f-0871cb021bfe
--   SDPL2-00024  7c7962ba-3a4b-461f-a739-0a785eee8a3e
-- Skipped: SDPL2-00020 (still drafting)

create or replace function public.backfill_human_league_matchups_by_id(p_league_id uuid)
returns table(seeded boolean, game_count int, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_team_ids uuid[];
  v_member_names jsonb;
  v_n int;
  v_round int;
  v_week int;
  v_home uuid;
  v_away uuid;
  v_rest uuid[];
  v_rest_len int;
  v_i int;
  v_home_name text;
  v_away_name text;
  v_existing int;
  v_inserted int := 0;
  v_league_type text;
  v_status text;
begin
  select l.owner_user_id, l.league_type, l.status
  into v_owner_id, v_league_type, v_status
  from public.leagues l
  where l.id = p_league_id;

  if v_owner_id is null then
    return query select false, 0, format('League id %s not found', p_league_id);
    return;
  end if;

  if v_league_type <> 'human' then
    return query select false, 0, 'Not a human league';
    return;
  end if;

  if v_status = 'drafting' or v_status = 'waiting' then
    return query select false, 0, format('League status %s — skip until draft complete', v_status);
    return;
  end if;

  select count(*) into v_existing
  from public.league_matchups m
  where m.league_id = p_league_id;

  if v_existing > 0 then
    return query select false, v_existing, 'Matchups already exist';
    return;
  end if;

  select
    array_agg(lm.user_id order by lm.draft_slot nulls last, lm.user_id),
    jsonb_object_agg(lm.user_id::text, coalesce(nullif(trim(lm.display_name), ''), 'Team'))
  into v_team_ids, v_member_names
  from public.league_members lm
  where lm.league_id = p_league_id;

  v_n := coalesce(array_length(v_team_ids, 1), 0);
  if v_n < 2 then
    return query select false, 0, format('Only %s team(s) found', v_n);
    return;
  end if;

  -- Fixed-pivot round-robin (matches src/lib/matchup/schedule.ts generateRoundRobinPairings).
  for v_round in 0..(v_n - 2) loop
    v_week := v_round + 1;

    v_home := v_team_ids[1];
    v_away := v_team_ids[v_round + 2];
    v_home_name := coalesce(v_member_names ->> v_home::text, 'Home');
    v_away_name := coalesce(v_member_names ->> v_away::text, 'Away');

    insert into public.league_matchups (
      league_id, week_number, home_user_id, away_user_id,
      is_playoff, playoff_round, opponent_bot_id, opponent_name, status
    ) values (
      p_league_id, v_week, v_home, v_away,
      false, null,
      case
        when v_home = v_owner_id then v_away
        when v_away = v_owner_id then v_home
        else v_away
      end,
      case
        when v_home = v_owner_id then v_away_name
        when v_away = v_owner_id then v_home_name
        else v_home_name || ' vs ' || v_away_name
      end,
      'scheduled'
    );
    v_inserted := v_inserted + 1;

    select array_agg(uid order by idx)
    into v_rest
    from unnest(v_team_ids) with ordinality as t(uid, idx)
    where idx not in (1, v_round + 2);

    v_rest_len := coalesce(array_length(v_rest, 1), 0);
    for v_i in 1..(v_rest_len / 2) loop
      v_home := v_rest[v_i];
      v_away := v_rest[v_rest_len - v_i + 1];
      v_home_name := coalesce(v_member_names ->> v_home::text, 'Home');
      v_away_name := coalesce(v_member_names ->> v_away::text, 'Away');

      insert into public.league_matchups (
        league_id, week_number, home_user_id, away_user_id,
        is_playoff, playoff_round, opponent_bot_id, opponent_name, status
      ) values (
        p_league_id, v_week, v_home, v_away,
        false, null,
        case
          when v_home = v_owner_id then v_away
          when v_away = v_owner_id then v_home
          else v_away
        end,
        case
          when v_home = v_owner_id then v_away_name
          when v_away = v_owner_id then v_home_name
          else v_home_name || ' vs ' || v_away_name
        end,
        'scheduled'
      );
      v_inserted := v_inserted + 1;
    end loop;
  end loop;

  update public.leagues
  set current_week = 1
  where id = p_league_id
    and status in ('active', 'complete');

  return query select true, v_inserted, format('Seeded %s matchup row(s)', v_inserted);
end;
$$;

-- SDPL2-00022 (formerly SDFL-00022)
select * from public.backfill_human_league_matchups_by_id('cf0b58c3-b7df-4478-aa5f-0871cb021bfe');

-- SDPL2-00024 (formerly SDFL-00024)
select * from public.backfill_human_league_matchups_by_id('7c7962ba-3a4b-461f-a739-0a785eee8a3e');
