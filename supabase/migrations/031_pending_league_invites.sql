-- Pending human-league invites for the logged-in user's email (dashboard banner)

create or replace function public.get_pending_human_league_invites()
returns table (
  league_id uuid,
  league_name text,
  invite_token uuid,
  commissioner_team text
)
language sql
security definer
set search_path = public
stable
as $$
  with inviter as (
    select lower(u.email) as email
    from auth.users u
    where u.id = auth.uid()
  )
  select
    l.id,
    l.name,
    l.invite_token,
    coalesce(
      (
        select lm.display_name
        from public.league_members lm
        where lm.league_id = l.id
          and lm.user_id = l.owner_user_id
        limit 1
      ),
      'Commissioner'
    )
  from public.leagues l
  cross join inviter i
  where auth.uid() is not null
    and i.email is not null
    and l.league_type = 'human'
    and l.status = 'waiting'
    and l.invite_token is not null
    and l.invite_email is not null
    and lower(l.invite_email) = i.email
    and l.owner_user_id is distinct from auth.uid()
    and not exists (
      select 1
      from public.league_members lm
      where lm.league_id = l.id
        and lm.user_id = auth.uid()
    )
    and (
      select count(*)::int
      from public.league_members lm
      where lm.league_id = l.id
    ) < l.player_count
  order by l.created_at desc;
$$;

grant execute on function public.get_pending_human_league_invites() to authenticated;
