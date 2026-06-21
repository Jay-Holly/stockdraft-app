-- Fix bot draft RLS for Free AI League
--
-- Symptom: "new row violates row-level security policy for table drafts"
-- for all three bots when Start Free League runs bot drafts.
--
-- Root cause: INSERT policy for bot drafts existed, but SELECT only allowed
-- auth.uid() = user_id. Bot rows are invisible to the league owner, so
-- loadDraftStateDetailed() thinks no draft exists and tries INSERT ... RETURNING,
-- which fails the SELECT check on the returned row.
--
-- Fix: allow league members to SELECT all drafts in their league, and consolidate
-- INSERT/UPDATE policies so the owner can manage bot-owned draft rows.

drop policy if exists "Users can view own drafts" on public.drafts;
drop policy if exists "Users can view own and league drafts" on public.drafts;
create policy "Users can view own and league drafts"
  on public.drafts for select
  to authenticated
  using (
    auth.uid() = user_id
    or (league_id is not null and public.is_league_member(league_id))
  );

drop policy if exists "Users can insert own drafts" on public.drafts;
drop policy if exists "Owner can insert bot drafts" on public.drafts;
drop policy if exists "Users and owners can insert drafts" on public.drafts;
create policy "Users and owners can insert drafts"
  on public.drafts for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or (
      league_id is not null
      and exists (
        select 1
        from public.leagues l
        join public.profiles p on p.id = drafts.user_id
        where l.id = drafts.league_id
          and l.league_type = 'ai'
          and l.owner_user_id = auth.uid()
          and p.is_bot = true
      )
    )
  );

drop policy if exists "Users can update own drafts" on public.drafts;
drop policy if exists "Owner can update bot drafts" on public.drafts;
drop policy if exists "Users and owners can update drafts" on public.drafts;
create policy "Users and owners can update drafts"
  on public.drafts for update
  to authenticated
  using (
    auth.uid() = user_id
    or (
      league_id is not null
      and exists (
        select 1
        from public.leagues l
        join public.profiles p on p.id = drafts.user_id
        where l.id = drafts.league_id
          and l.league_type = 'ai'
          and l.owner_user_id = auth.uid()
          and p.is_bot = true
      )
    )
  )
  with check (
    auth.uid() = user_id
    or (
      league_id is not null
      and exists (
        select 1
        from public.leagues l
        join public.profiles p on p.id = drafts.user_id
        where l.id = drafts.league_id
          and l.league_type = 'ai'
          and l.owner_user_id = auth.uid()
          and p.is_bot = true
      )
    )
  );
