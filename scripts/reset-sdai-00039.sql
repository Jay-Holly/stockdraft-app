-- One-time wipe + re-seed for SDAI-00039 (beta_daily Jun 29 – Jul 15, 2026).
-- Run in Supabase SQL Editor as postgres/service role.

do $$
declare
  v_league_id uuid;
  v_owner uuid;
  team_ids uuid[];
  team_names text[];
  n int;
  w int;
  idx int;
  home_id uuid;
  away_id uuid;
  home_name text;
  away_name text;
  opp_bot uuid;
  opp_name text;
begin
  select id, owner_user_id
  into v_league_id, v_owner
  from public.leagues
  where support_code = 'SDAI-00039';

  if v_league_id is null then
    raise exception 'League SDAI-00039 not found';
  end if;

  delete from public.league_matchups where league_id = v_league_id;
  delete from public.roster_week_baselines where league_id = v_league_id;

  update public.league_standings
  set wins = 0, losses = 0, current_week = 1, updated_at = now()
  where league_id = v_league_id;

  insert into public.league_season_settings (
    league_id, season_format, regular_season_weeks, week_calendar, updated_at
  ) values (
    v_league_id,
    'beta_daily',
    11,
    '[
      {"week":1,"date":"2026-06-29"},
      {"week":2,"date":"2026-06-30"},
      {"week":3,"date":"2026-07-01"},
      {"week":4,"date":"2026-07-02"},
      {"week":5,"date":"2026-07-03"},
      {"week":6,"date":"2026-07-06"},
      {"week":7,"date":"2026-07-07"},
      {"week":8,"date":"2026-07-08"},
      {"week":9,"date":"2026-07-09"},
      {"week":10,"date":"2026-07-10"},
      {"week":11,"date":"2026-07-13"},
      {"week":12,"date":"2026-07-14"},
      {"week":13,"date":"2026-07-15"}
    ]'::jsonb,
    now()
  )
  on conflict (league_id) do update set
    season_format = excluded.season_format,
    regular_season_weeks = excluded.regular_season_weeks,
    week_calendar = excluded.week_calendar,
    updated_at = now();

  update public.leagues
  set status = 'active', current_week = 1
  where id = v_league_id;

  select array_agg(lm.user_id order by lm.draft_slot nulls last, lm.user_id),
         array_agg(coalesce(nullif(trim(lm.display_name), ''), p.team_name, p.username, 'Team')
                   order by lm.draft_slot nulls last, lm.user_id)
  into team_ids, team_names
  from public.league_members lm
  join public.profiles p on p.id = lm.user_id
  where lm.league_id = v_league_id;

  if team_ids is null or array_length(team_ids, 1) < 2 then
    raise exception 'Not enough league members to seed schedule';
  end if;

  n := array_length(team_ids, 1);

  for w in 1..11 loop
    idx := (w - 1) % (n - 1);

    if n = 4 then
      -- 4-team round-robin cycles: (1v2,3v4), (1v3,2v4), (1v4,2v3)
      if idx = 0 then
        home_id := team_ids[1]; away_id := team_ids[2];
        home_name := team_names[1]; away_name := team_names[2];
        if home_id = v_owner then opp_bot := away_id; opp_name := away_name;
        elsif away_id = v_owner then opp_bot := home_id; opp_name := home_name;
        else opp_bot := away_id; opp_name := home_name || ' vs ' || away_name; end if;
        insert into public.league_matchups (league_id, week_number, home_user_id, away_user_id, is_playoff, playoff_round, opponent_bot_id, opponent_name, status)
        values (v_league_id, w, home_id, away_id, false, null, opp_bot, opp_name, 'scheduled');

        home_id := team_ids[3]; away_id := team_ids[4];
        home_name := team_names[3]; away_name := team_names[4];
        if home_id = v_owner then opp_bot := away_id; opp_name := away_name;
        elsif away_id = v_owner then opp_bot := home_id; opp_name := home_name;
        else opp_bot := away_id; opp_name := home_name || ' vs ' || away_name; end if;
        insert into public.league_matchups (league_id, week_number, home_user_id, away_user_id, is_playoff, playoff_round, opponent_bot_id, opponent_name, status)
        values (v_league_id, w, home_id, away_id, false, null, opp_bot, opp_name, 'scheduled');
      elsif idx = 1 then
        home_id := team_ids[1]; away_id := team_ids[3];
        home_name := team_names[1]; away_name := team_names[3];
        if home_id = v_owner then opp_bot := away_id; opp_name := away_name;
        elsif away_id = v_owner then opp_bot := home_id; opp_name := home_name;
        else opp_bot := away_id; opp_name := home_name || ' vs ' || away_name; end if;
        insert into public.league_matchups (league_id, week_number, home_user_id, away_user_id, is_playoff, playoff_round, opponent_bot_id, opponent_name, status)
        values (v_league_id, w, home_id, away_id, false, null, opp_bot, opp_name, 'scheduled');

        home_id := team_ids[2]; away_id := team_ids[4];
        home_name := team_names[2]; away_name := team_names[4];
        if home_id = v_owner then opp_bot := away_id; opp_name := away_name;
        elsif away_id = v_owner then opp_bot := home_id; opp_name := home_name;
        else opp_bot := away_id; opp_name := home_name || ' vs ' || away_name; end if;
        insert into public.league_matchups (league_id, week_number, home_user_id, away_user_id, is_playoff, playoff_round, opponent_bot_id, opponent_name, status)
        values (v_league_id, w, home_id, away_id, false, null, opp_bot, opp_name, 'scheduled');
      else
        home_id := team_ids[1]; away_id := team_ids[4];
        home_name := team_names[1]; away_name := team_names[4];
        if home_id = v_owner then opp_bot := away_id; opp_name := away_name;
        elsif away_id = v_owner then opp_bot := home_id; opp_name := home_name;
        else opp_bot := away_id; opp_name := home_name || ' vs ' || away_name; end if;
        insert into public.league_matchups (league_id, week_number, home_user_id, away_user_id, is_playoff, playoff_round, opponent_bot_id, opponent_name, status)
        values (v_league_id, w, home_id, away_id, false, null, opp_bot, opp_name, 'scheduled');

        home_id := team_ids[2]; away_id := team_ids[3];
        home_name := team_names[2]; away_name := team_names[3];
        if home_id = v_owner then opp_bot := away_id; opp_name := away_name;
        elsif away_id = v_owner then opp_bot := home_id; opp_name := home_name;
        else opp_bot := away_id; opp_name := home_name || ' vs ' || away_name; end if;
        insert into public.league_matchups (league_id, week_number, home_user_id, away_user_id, is_playoff, playoff_round, opponent_bot_id, opponent_name, status)
        values (v_league_id, w, home_id, away_id, false, null, opp_bot, opp_name, 'scheduled');
      end if;
    else
      raise exception 'reset-sdai-00039.sql currently supports 4-team leagues only (found % teams)', n;
    end if;
  end loop;

  raise notice 'Reset SDAI-00039: league % active week 1, 11-week beta schedule seeded', v_league_id;
end $$;

select l.support_code, l.status, l.current_week, lss.season_format, lss.regular_season_weeks,
       (select count(*) from public.league_matchups m where m.league_id = l.id) as matchup_count,
       (select min(week_number) from public.league_matchups m where m.league_id = l.id) as min_week,
       (select max(week_number) from public.league_matchups m where m.league_id = l.id) as max_week
from public.leagues l
left join public.league_season_settings lss on lss.league_id = l.id
where l.support_code = 'SDAI-00039';
