-- Human-league bot drafts.current_round was never advancing: the update
-- policy on public.drafts only let the *acting user* update their own row,
-- or an AI-league owner update a bot row (is_ai_league_owner requires
-- league_type = 'ai'). SDFL/SDBA/etc. are league_type = 'human', so every
-- current_round update issued on behalf of a bot during a human-league live
-- draft silently matched zero rows — bot picks kept inserting with whatever
-- round_number the draft row was created with (round 1), hiding every pick
-- after the first on opponent draft boards.

drop policy if exists "Users and owners can update drafts" on public.drafts;
create policy "Users and owners can update drafts"
  on public.drafts for update
  to authenticated
  using (
    auth.uid() = user_id
    or (
      league_id is not null
      and (public.is_ai_league_owner(league_id) or public.is_human_league_owner(league_id))
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
      and (public.is_ai_league_owner(league_id) or public.is_human_league_owner(league_id))
      and exists (
        select 1
        from public.profiles p
        where p.id = drafts.user_id
          and p.is_bot = true
      )
    )
  );
