-- Fix human league creation RLS (same pattern as 021 for AI leagues).
--
-- Symptom: "new row violates row-level security policy for table leagues"
-- on .insert().select() when creating a human league.
--
-- INSERT WITH CHECK must allow league_type = 'human'.
-- INSERT ... RETURNING also requires SELECT RLS on the new row before
-- league_members exists — use direct row-column checks, not SECURITY DEFINER
-- helpers that re-query leagues (migration 028 used is_*_league_owner).

drop policy if exists "Authenticated users can create leagues" on public.leagues;
create policy "Authenticated users can create leagues"
  on public.leagues for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      (
        league_type = 'solo'
        and (owner_user_id is null or owner_user_id = auth.uid())
      )
      or (league_type = 'ai' and owner_user_id = auth.uid())
      or (league_type = 'human' and owner_user_id = auth.uid())
    )
  );

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

-- Explicit owner SELECT for INSERT ... RETURNING before league_members row exists.
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
