-- SECURITY DEFINER helpers for live draft clock + feed

create or replace function public.get_league_draft_feed(p_league_id uuid, p_limit int default 100)
returns setof public.league_draft_events
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_league_member(p_league_id)
     and not exists (
       select 1 from public.leagues l
       where l.id = p_league_id
         and l.league_type = 'ai'
         and l.owner_user_id = auth.uid()
     ) then
    return;
  end if;

  return query
  select e.*
  from public.league_draft_events e
  where e.league_id = p_league_id
  order by e.global_pick_number asc
  limit greatest(1, least(p_limit, 500));
end;
$$;

grant execute on function public.get_league_draft_feed(uuid, int) to authenticated;

create or replace function public.get_league_draft_state(p_league_id uuid)
returns public.league_draft_state
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_state public.league_draft_state;
begin
  if not public.is_league_member(p_league_id)
     and not exists (
       select 1 from public.leagues l
       where l.id = p_league_id
         and l.league_type = 'ai'
         and l.owner_user_id = auth.uid()
     ) then
    return null;
  end if;

  select s.*
  into v_state
  from public.league_draft_state s
  where s.league_id = p_league_id;

  return v_state;
end;
$$;

grant execute on function public.get_league_draft_state(uuid) to authenticated;
