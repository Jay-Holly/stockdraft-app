-- Same architectural gap as 072 (draft_picks insert), just on the drafts
-- table. Migration 059 let ONLY the league owner's session update a bot's
-- drafts.current_round — but ensureLiveDraftProgress runs on every league
-- member's GET /api/draft poll, not just the owner's, and now also drives
-- idle real-human auto-picks (via 072), not just bot picks. Whenever a
-- non-owner's poll resolves someone else's turn, the current_round UPDATE
-- silently matches zero rows (RLS, no error raised) while the draft_picks
-- INSERT still succeeds — so current_round stays frozen and every later
-- pick for that team re-duplicates the same stale round number.
--
-- This adds a policy allowing any authenticated league member to update the
-- drafts row belonging to whoever is currently on the clock for that
-- league's live draft, mirroring the on-clock check from 072 and the
-- server-side assertOnClock() logic already enforced before any pick.

drop policy if exists "League members can update on-clock live drafts" on public.drafts;
create policy "League members can update on-clock live drafts"
  on public.drafts for update
  to authenticated
  using (
    league_id is not null
    and exists (
      select 1
      from public.league_draft_state s
      where s.league_id = drafts.league_id
        and s.status = 'in_progress'
        and s.on_clock_user_id = drafts.user_id
    )
    and public.is_league_member(drafts.league_id)
  )
  with check (
    league_id is not null
    and exists (
      select 1
      from public.league_draft_state s
      where s.league_id = drafts.league_id
        and s.status = 'in_progress'
        and s.on_clock_user_id = drafts.user_id
    )
    and public.is_league_member(drafts.league_id)
  );
