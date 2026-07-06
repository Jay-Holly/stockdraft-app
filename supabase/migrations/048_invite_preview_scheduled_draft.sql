-- Expose scheduled draft time on public invite previews (join page).

create or replace function public.get_league_invite_preview(p_token uuid)
returns table (
  league_id uuid,
  league_name text,
  commissioner_team text,
  member_count bigint,
  player_count int,
  status text,
  opponent_type text,
  format_type text,
  scheduled_draft_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    l.id,
    l.name,
    coalesce(
      (
        select lm.display_name
        from public.league_members lm
        where lm.league_id = l.id
          and lm.user_id = l.owner_user_id
        limit 1
      ),
      'Commissioner'
    ),
    (
      select count(*)::bigint
      from public.league_members lm
      where lm.league_id = l.id
    ),
    l.player_count,
    l.status,
    l.opponent_type,
    l.format_type,
    l.scheduled_draft_at
  from public.leagues l
  where l.invite_token = p_token
    and l.league_type = 'human'
  limit 1;
$$;

grant execute on function public.get_league_invite_preview(uuid) to anon, authenticated;
