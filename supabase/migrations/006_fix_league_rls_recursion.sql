-- Fix leagues ↔ league_members RLS infinite recursion
--
-- Root cause: leagues SELECT policy queried league_members, while
-- getOrCreateSoloLeague selects league_members with an embedded leagues join.
-- That cross-table cycle triggers "infinite recursion detected in policy
-- for relation league_members" even after simplifying the league_members policy.
--
-- Fix: centralize membership checks in a SECURITY DEFINER function (bypasses RLS).

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

-- league_members: own rows only (no self-join)
drop policy if exists "Members can view league membership" on public.league_members;
create policy "Members can view league membership"
  on public.league_members for select
  using (user_id = auth.uid());

-- leagues: use helper instead of inline league_members subquery
drop policy if exists "Members can view their leagues" on public.leagues;
create policy "Members can view their leagues"
  on public.leagues for select
  using (
    public.is_league_member(id)
    or (
      is_solo = true
      and not exists (
        select 1 from public.league_members lm where lm.league_id = leagues.id
      )
    )
  );

-- league_crypto_buyer_counts
drop policy if exists "League members can read crypto buyer counts" on public.league_crypto_buyer_counts;
create policy "League members can read crypto buyer counts"
  on public.league_crypto_buyer_counts for select
  using (public.is_league_member(league_id));

drop policy if exists "League members can update crypto buyer counts" on public.league_crypto_buyer_counts;
create policy "League members can update crypto buyer counts"
  on public.league_crypto_buyer_counts for update
  using (public.is_league_member(league_id));

drop policy if exists "League members can insert crypto buyer counts" on public.league_crypto_buyer_counts;
create policy "League members can insert crypto buyer counts"
  on public.league_crypto_buyer_counts for insert
  with check (public.is_league_member(league_id));

-- draft_picks (league off-board visibility)
drop policy if exists "League members can view league draft picks" on public.draft_picks;
create policy "League members can view league draft picks"
  on public.draft_picks for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.drafts d
      where d.id = draft_picks.draft_id
        and public.is_league_member(d.league_id)
    )
  );
