-- Reliable league-scoped draft pick reads for AI bot boards
--
-- Bot picks are owned by bot profile IDs, not auth.uid(). The draft_picks SELECT
-- policy subquery joins drafts, which can still fail RLS nesting. These SECURITY
-- DEFINER helpers authorize league members / AI league owners and return rows
-- without RLS blocking bot-owned picks.

create or replace function public.get_league_draft(
  p_league_id uuid,
  p_user_id uuid
)
returns public.drafts
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_draft public.drafts;
begin
  if not exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and (
        public.is_league_member(p_league_id)
        or (l.league_type = 'ai' and l.owner_user_id = auth.uid())
      )
  ) then
    return null;
  end if;

  select d.*
  into v_draft
  from public.drafts d
  where d.league_id = p_league_id
    and d.user_id = p_user_id
  limit 1;

  return v_draft;
end;
$$;

create or replace function public.get_league_draft_picks(
  p_league_id uuid,
  p_user_id uuid
)
returns setof public.draft_picks
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_draft_id uuid;
begin
  if not exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and (
        public.is_league_member(p_league_id)
        or (l.league_type = 'ai' and l.owner_user_id = auth.uid())
      )
  ) then
    return;
  end if;

  select d.id
  into v_draft_id
  from public.drafts d
  where d.league_id = p_league_id
    and d.user_id = p_user_id
  limit 1;

  if v_draft_id is null then
    return;
  end if;

  return query
  select dp.*
  from public.draft_picks dp
  where dp.draft_id = v_draft_id
  order by dp.pick_order asc;
end;
$$;

grant execute on function public.get_league_draft(uuid, uuid) to authenticated;
grant execute on function public.get_league_draft_picks(uuid, uuid) to authenticated;

-- Explicit SELECT policy for AI league owners (belt-and-suspenders)
drop policy if exists "AI league owner can view draft picks" on public.draft_picks;
create policy "AI league owner can view draft picks"
  on public.draft_picks for select
  to authenticated
  using (
    exists (
      select 1
      from public.drafts d
      join public.leagues l on l.id = d.league_id
      where d.id = draft_picks.draft_id
        and l.league_type = 'ai'
        and l.owner_user_id = auth.uid()
    )
  );
