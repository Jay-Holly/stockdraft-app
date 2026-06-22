-- Fix league creation after migration 020.
--
-- Symptom: "new row violates row-level security policy for table leagues"
-- on .insert().select() when creating an AI league.
--
-- INSERT WITH CHECK was already correct (migration 008). The failure is
-- INSERT ... RETURNING, which also requires the new row to pass SELECT RLS.
-- Migration 020 dropped the direct owner row check from migration 008 and
-- relied only on is_ai_league_owner(id), which re-queries leagues during
-- the INSERT RETURNING policy check and can fail RLS on the same table.
--
-- Fix: keep SECURITY DEFINER helpers for cross-table checks, but restore
-- direct row-column checks for owner/solo visibility (no subquery on leagues).

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
    or (is_solo = true and owner_user_id is null)
  );

-- Restore explicit owner SELECT policy used by INSERT ... RETURNING before
-- the human is added to league_members (same as migration 008).
drop policy if exists "Owners can view their AI leagues" on public.leagues;
create policy "Owners can view their AI leagues"
  on public.leagues for select
  to authenticated
  using (league_type = 'ai' and owner_user_id = auth.uid());
