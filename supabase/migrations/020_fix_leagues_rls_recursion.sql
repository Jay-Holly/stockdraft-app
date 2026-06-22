-- Fix leagues ↔ league_members RLS infinite recursion (again).
--
-- Migration 019 let league_members SELECT query leagues inline. The leagues
-- "Members can view their leagues" policy still subqueries league_members for
-- unclaimed solo leagues, which loops back into league_members policies.
--
-- Use SECURITY DEFINER helpers (same pattern as is_league_member in 006).

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

-- leagues SELECT: no inline league_members subquery
drop policy if exists "Members can view their leagues" on public.leagues;
create policy "Members can view their leagues"
  on public.leagues for select
  to authenticated
  using (
    public.is_league_member(id)
    or public.is_unclaimed_solo_league(id)
    or public.is_ai_league_owner(id)
  );

drop policy if exists "Owners can view their AI leagues" on public.leagues;

-- leagues UPDATE: avoid relying on row-only checks that duplicate owner helper
drop policy if exists "Owner can update AI leagues" on public.leagues;
create policy "Owner can update AI leagues"
  on public.leagues for update
  to authenticated
  using (public.is_ai_league_owner(id))
  with check (public.is_ai_league_owner(id));

-- league_members SELECT: no inline leagues subquery (supersedes 019)
drop policy if exists "Members can view league membership" on public.league_members;
create policy "Members can view league membership"
  on public.league_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_league_member(league_id)
    or public.is_ai_league_owner(league_id)
  );

-- league_members INSERT: owner adding bot rows during league creation
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

-- startLiveDraft assigns draft_slot on all members (including bots)
drop policy if exists "AI league owner can update league members" on public.league_members;
create policy "AI league owner can update league members"
  on public.league_members for update
  to authenticated
  using (public.is_ai_league_owner(league_id))
  with check (public.is_ai_league_owner(league_id));

-- league_draft_state: startLiveDraft insert/update
drop policy if exists "AI league owner can manage draft state" on public.league_draft_state;
create policy "AI league owner can manage draft state"
  on public.league_draft_state for all
  to authenticated
  using (public.is_ai_league_owner(league_id))
  with check (public.is_ai_league_owner(league_id));

-- draft feed events inserted during live draft
drop policy if exists "AI league owner can insert draft events" on public.league_draft_events;
create policy "AI league owner can insert draft events"
  on public.league_draft_events for insert
  to authenticated
  with check (public.is_ai_league_owner(league_id));

-- bot draft rows created at league start
drop policy if exists "Users and owners can insert drafts" on public.drafts;
create policy "Users and owners can insert drafts"
  on public.drafts for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or (
      league_id is not null
      and public.is_ai_league_owner(league_id)
      and exists (
        select 1
        from public.profiles p
        where p.id = drafts.user_id
          and p.is_bot = true
      )
    )
  );

drop policy if exists "Users and owners can update drafts" on public.drafts;
create policy "Users and owners can update drafts"
  on public.drafts for update
  to authenticated
  using (
    auth.uid() = user_id
    or (
      league_id is not null
      and public.is_ai_league_owner(league_id)
      and exists (
        select 1
        from public.profiles p
        where p.id = drafts.user_id
          and p.is_bot = true
      )
    )
  )
  with check (
    auth.uid() = user_id
    or (
      league_id is not null
      and public.is_ai_league_owner(league_id)
      and exists (
        select 1
        from public.profiles p
        where p.id = drafts.user_id
          and p.is_bot = true
      )
    )
  );
