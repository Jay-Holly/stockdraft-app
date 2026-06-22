-- Allow league members (and AI league owners) to see co-members, including bots.
--
-- Migration 006 limited league_members SELECT to auth.uid() = user_id to avoid
-- RLS recursion. That hid bot rows from human players, which broke:
--   - getLeagueBotMembers() → empty standings on /league
--   - startLiveDraft() → draft_order with only the human → bots never on clock
--   - Live Draft Feed → only human pick events
--
-- is_league_member() is SECURITY DEFINER and bypasses RLS, so using it here is safe.

drop policy if exists "Members can view league membership" on public.league_members;

create policy "Members can view league membership"
  on public.league_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_league_member(league_id)
    or exists (
      select 1
      from public.leagues l
      where l.id = league_members.league_id
        and l.league_type = 'ai'
        and l.owner_user_id = auth.uid()
    )
  );
