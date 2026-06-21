-- Fix Free AI League creation RLS
--
-- Symptom: "new row violates row-level security policy for table leagues"
-- when clicking Start Free League.
--
-- Root cause: Supabase .insert().select() uses INSERT ... RETURNING, which
-- requires the new row to pass SELECT policies too. The human is not yet in
-- league_members when the league row is returned, so the existing SELECT
-- policy blocked the row (is_solo = false, not a member yet).

drop policy if exists "Users can create solo leagues" on public.leagues;
drop policy if exists "Users can create AI leagues" on public.leagues;
drop policy if exists "Authenticated users can create leagues" on public.leagues;

create policy "Authenticated users can create leagues"
  on public.leagues for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      league_type = 'solo'
      or (league_type = 'ai' and owner_user_id = auth.uid())
    )
  );

drop policy if exists "Owners can view their AI leagues" on public.leagues;
create policy "Owners can view their AI leagues"
  on public.leagues for select
  to authenticated
  using (league_type = 'ai' and owner_user_id = auth.uid());
