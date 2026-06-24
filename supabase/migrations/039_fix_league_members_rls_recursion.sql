-- Fix league_members RLS infinite recursion during human league creation.
--
-- Root cause: a league_members policy still subqueries public.leagues inline while
-- a leagues SELECT policy subqueries public.league_members inline (often from
-- migrations 006/019 if 020/028 were skipped). That cycle triggers:
--   "infinite recursion detected in policy for relation league_members"
--
-- Fix: SECURITY DEFINER helpers only — same pattern as 006 and 020.

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.league_members
    where league_id = p_league_id
      and user_id = auth.uid()
  );
$$;

grant execute on function public.is_league_member(uuid) to authenticated;

create or replace function public.is_ai_league_owner(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.league_type = 'ai'
      and l.owner_user_id = auth.uid()
  );
$$;

grant execute on function public.is_ai_league_owner(uuid) to authenticated;

create or replace function public.is_human_league_owner(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.league_type = 'human'
      and l.owner_user_id = auth.uid()
  );
$$;

grant execute on function public.is_human_league_owner(uuid) to authenticated;

create or replace function public.is_unclaimed_solo_league(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.is_solo = true
  )
  and not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
  );
$$;

grant execute on function public.is_unclaimed_solo_league(uuid) to authenticated;

create or replace function public.is_human_league_member(p_league_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.league_type = 'human'
  )
  and public.is_league_member(p_league_id);
$$;

grant execute on function public.is_human_league_member(uuid) to authenticated;

-- leagues SELECT: never inline-subquery league_members
drop policy if exists "Members can view their leagues" on public.leagues;
create policy "Members can view their leagues"
  on public.leagues for select
  to authenticated
  using (
    public.is_league_member(id)
    or public.is_unclaimed_solo_league(id)
    or (league_type = 'ai' and owner_user_id = auth.uid())
    or (league_type = 'human' and owner_user_id = auth.uid())
    or (is_solo = true and owner_user_id is null)
  );

drop policy if exists "Owners can view their AI leagues" on public.leagues;
create policy "Owners can view their AI leagues"
  on public.leagues for select
  to authenticated
  using (league_type = 'ai' and owner_user_id = auth.uid());

drop policy if exists "Owners can view their human leagues" on public.leagues;
create policy "Owners can view their human leagues"
  on public.leagues for select
  to authenticated
  using (league_type = 'human' and owner_user_id = auth.uid());

-- league_members SELECT: never inline-subquery leagues
drop policy if exists "Members can view league membership" on public.league_members;
create policy "Members can view league membership"
  on public.league_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_league_member(league_id)
    or public.is_ai_league_owner(league_id)
    or public.is_human_league_owner(league_id)
  );

-- league_members INSERT: no inline leagues join (supersedes 007/019-style policies)
drop policy if exists "Owner can add AI league bot members" on public.league_members;
create policy "Owner can add AI league bot members"
  on public.league_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or (
      public.is_ai_league_owner(league_id)
      and exists (
        select 1
        from public.profiles p
        where p.id = league_members.user_id
          and p.is_bot = true
      )
    )
  );

drop policy if exists "Human league owner can add members" on public.league_members;
create policy "Human league owner can add members"
  on public.league_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or public.is_human_league_owner(league_id)
  );

drop policy if exists "AI league owner can update league members" on public.league_members;
create policy "AI league owner can update league members"
  on public.league_members for update
  to authenticated
  using (public.is_ai_league_owner(league_id))
  with check (public.is_ai_league_owner(league_id));

drop policy if exists "Human league members can update draft slots" on public.league_members;
create policy "Human league members can update draft slots"
  on public.league_members for update
  to authenticated
  using (public.is_human_league_member(league_id))
  with check (public.is_human_league_member(league_id));
