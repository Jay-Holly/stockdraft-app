-- Browse public "waiting" human leagues for join-by-league-id flow (no invite token).
-- Two call shapes via optional params:
--   sports-sim: p_sports_league_id set, p_player_count null
--   player league: p_sports_league_id null, p_player_count set (format_type='standard')

create or replace function public.list_public_human_leagues(
  p_sports_league_id text default null,
  p_player_count int default null
)
returns table (
  league_id uuid,
  league_name text,
  commissioner_username text,
  member_count bigint,
  player_count int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    l.id,
    l.name,
    coalesce(p.username, 'Commissioner'),
    (
      select count(*)::bigint
      from public.league_members lm
      where lm.league_id = l.id
    ),
    l.player_count
  from public.leagues l
  left join public.profiles p on p.id = l.owner_user_id
  where l.league_type = 'human'
    and l.status = 'waiting'
    and l.visibility = 'public'
    and (
      (p_sports_league_id is not null
        and l.format_type = 'sports_league'
        and l.sports_league_id = p_sports_league_id)
      or
      (p_sports_league_id is null
        and l.format_type = 'standard'
        and l.sports_league_id is null
        and l.player_count = p_player_count)
    )
  order by l.created_at desc;
$$;

grant execute on function public.list_public_human_leagues(text, int) to anon, authenticated;
