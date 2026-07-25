-- Live drafts advance from any connected viewer's poll (GET /api/draft), which
-- calls executeAutoPick/runBotTurn to draft on behalf of whichever team is
-- currently on the clock -- not necessarily the polling viewer, the league
-- owner, or a bot profile. The existing draft_picks insert policies only
-- cover self-picks and league-owner-on-behalf-of-bot picks, so an idle real
-- human team's auto-pick (triggered by any other member's poll) violates RLS
-- ("new row violates row-level security policy for table draft_picks") and
-- silently/loudly fails, stalling the draft until a privileged (service-role)
-- sweep eventually clears it.
--
-- This policy allows any authenticated league member to insert a pick on
-- behalf of whichever user is currently on the clock for that league's live
-- draft, mirroring the server-side assertOnClock() check already enforced
-- in application code before any insert is attempted.

drop policy if exists "League members can insert on-clock live draft picks" on public.draft_picks;
create policy "League members can insert on-clock live draft picks"
  on public.draft_picks for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.drafts d
      join public.league_draft_state s on s.league_id = d.league_id
      where d.id = draft_picks.draft_id
        and d.user_id = draft_picks.user_id
        and s.status = 'in_progress'
        and s.on_clock_user_id = draft_picks.user_id
        and public.is_league_member(d.league_id)
    )
  );
