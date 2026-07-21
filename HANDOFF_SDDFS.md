# SDDFS — Session Handoff

Paste this file's path into a new chat and say "read HANDOFF_SDDFS.md and
continue" — everything needed to pick up cleanly is here.

**Note:** this repo also has a separate `HANDOFF.md` for unrelated league-
scoring/SDFL-map work from a different session thread. Don't merge the two —
they cover different features. This file is SDDFS-only.

## Status: nothing committed to git yet

Everything below exists as **uncommitted local files** (`git status --short`
shows them all untracked) plus **one real change already applied directly to
production Supabase** (the migration). Nothing has been pushed, committed, or
deployed to Vercel. Repo working tree is shared with other background
sessions — don't `git add -A`; stage only the SDDFS-specific paths listed
below when ready to commit.

## What SDDFS is

A new real-money DFS (daily fantasy) game mode, "StockDraft DFS" / **SDDFS**,
added alongside the existing league/draft system and Day Trader. Format
borrowed from the competitor stkdraft.com (see the old `HANDOFF.md` for the
naming/copyright discussion that's still paused, unresolved, user-led) but
reimplemented as our own:

- 12-pick lineup: one stock from each of the 11 GICS sectors + Crypto
  (Technology, Financials, Healthcare, Consumer Discretionary, Consumer
  Staples, Energy, Industrials, Materials, Real Estate, Utilities,
  Communication Services, Crypto)
- Picks are **not exclusive** — any number of players can pick the same
  stock (explicit user correction mid-session; an earlier version wrongly
  removed picked stocks from the pool — reverted)
- Buy-in tiers: $2 / $5 / $10 / $25 / $50 / $100, one contest per tier per
  day, 10-entrant cap, one entry per user per contest
- Lock at 9:00 AM ET, score at market close (4:00 PM ET) on open→close %
  change summed across all 12 picks
- Top 3 paid 50/30/20% of a 92%-of-buy-ins pool; **ties split the pooled
  share evenly** across however many entries tie within (or straddling) the
  paid range — verified with a standalone test script, logic lives in
  `computeSddfsPayouts` (`src/lib/sddfs/scoring.ts`)

## Files (all new, all untracked)

- `supabase/migrations/065_sddfs_contest.sql` — **already applied to
  production** via `npx supabase db push` (confirmed: project
  `tkdhgzstxclwubtzvlwc`, ran clean, 3 new tables live). Creates
  `sddfs_contests`, `sddfs_entries`, `sddfs_entry_picks` with RLS: users can
  read everything, but can only insert/edit their own entries/picks while
  the parent contest's `status = 'open'` — enforced at the Postgres level,
  not just the UI.
- `src/lib/dfs/contests.ts` — `ensureTodaysSddfsContests()` idempotently
  upserts today's 6 buy-in rows if missing (this is the hook point for the
  user's stated future idea: "auto-spawn a new $10 block when one fills" —
  not built yet, just noted). `getDfsContestsForToday()` /
  `getDfsContestById()` read real rows + live entrant counts.
- `src/lib/dfs/my-teams.ts` — `getMyDfsEntries()`, server-side, reads the
  logged-in user's entries joined with contest + picks.
- `src/lib/sddfs/scoring.ts` — `computeSddfsPayouts()` (pure, tested via
  ad-hoc script, not a committed test file) + `finalizeSddfsContest()`
  (writes `total_score`/`final_rank`/`payout` back to `sddfs_entries`,
  flips contest to `scored`).
- `src/lib/sddfs/lifecycle.ts` — `runSddfsLifecycle()`: locks any `open`
  contest past `lock_at` (snapshotting each pick's `open_price` from cached
  quotes at that moment), then scores any `locked` contest once it's past
  4 PM ET (fetches close prices, computes `pct_change` per pick, calls
  `finalizeSddfsContest`).
- `src/app/api/cron/sddfs-lifecycle/route.ts` — cron endpoint wrapping the
  above, registered in `vercel.json` on `*/15 * * * *`. **Never
  successfully tested end-to-end against the live cron auth** — no
  `CRON_SECRET` in local `.env.local`, so this was verified by type-check +
  code review only, not an authenticated HTTP call. Test this for real
  before trusting it in production.
- `src/app/api/sddfs/enter/route.ts` — POST, creates an entry + 12 picks
  for the authenticated user, rejects if contest isn't `open` or picks.length
  !== 12. Verified live: real row landed in `sddfs_entries`/
  `sddfs_entry_picks`.
- `src/app/api/sddfs/swap-pick/route.ts` — PATCH, lets a user replace one
  sector's symbol on an entry they own, while the contest is still `open`.
  Verified live: swapped Technology AAPL→MSFT, confirmed the write actually
  landed in Supabase (not just local React state).
- `src/components/dfs/DfsShell.tsx` — pill-nav header (Dashboard / Lobby /
  My Teams / Free Agents), modeled directly on the existing
  `SeasonShell.tsx` pattern (`season-nav`/`season-nav-link` CSS classes,
  same active-tab styling) per explicit user request to match the league
  page look.
- `src/components/dfs/DfsLineupBuilder.tsx` — the draft/lineup-builder UI:
  sector pills, searchable stock list (max-h-[70vh] internal scroll, not
  page-scroll), auto-advances to the next unfilled sector after each pick,
  "Enter Team" button appears at 12/12 and posts to `/api/sddfs/enter`.
- `src/components/dfs/FreeAgentPanel.tsx` — lists a user's open (unlocked)
  entries, "Make Move" per sector opens the same kind of searchable
  picker, PATCHes `/api/sddfs/swap-pick` on selection.
- `src/app/stockdraft-dfs/page.tsx` (lobby), `[contestId]/page.tsx` (draft
  page), `my-teams/page.tsx`, `free-agents/page.tsx` — all wired to
  `DfsShell`, all server components pulling real data from the lib
  functions above.
- `src/components/DashboardContent.tsx` — added an "SDDFS" button next to
  the existing "Day Trader" button (modified, tracked file — this one
  needs `git add` explicitly since it's not a new file).

## Verified working, live, against real Supabase data

- Migration applied, 3 tables confirmed live via direct query
- Lobby renders 6 real contest rows (auto-created by
  `ensureTodaysSddfsContests`)
- Entered a real contest end-to-end (12 picks, hit Enter Team, row appeared
  in `sddfs_entries`/`sddfs_entry_picks`)
- My Teams reads and displays that real entry (picks, status, contest info)
- Free Agents swap: changed a real pick, confirmed the DB row updated, not
  just local UI state
- `tsc --noEmit` clean on every file above

## NOT built / NOT verified — be upfront about this if asked "is it done"

1. **Lifecycle cron never fired for real** — lock/score transitions are
   logic-reviewed, not live-tested (see cron note above). Before trusting
   payouts/locking in production, set a real `CRON_SECRET`, deploy, and
   watch it fire once through a full lock→score cycle.
2. **No entry-fee charge** — `sddfs_entries.insert` doesn't touch any
   balance/payment table. Entering is currently free; there is no wallet
   deduction or payment integration at all.
3. **Auto-spawn new contest block when one fills** — user's stated future
   idea, explicitly deferred, not implemented. `ensureTodaysSddfsContests`
   is the natural place to add it (currently just one row per buy-in per
   day, hard cap of 10 entrants with no overflow handling).
4. **No admin/ops UI** for contests — everything is driven by the cron +
   the ensure-function; there's no way to manually adjust `lock_at`,
   force-lock, or force-score a contest short of writing SQL directly.
5. Copyright/naming exposure re: stkdraft.com — still an open, paused,
   user-led discussion (see old `HANDOFF.md`), not resolved by building
   SDDFS.

## Next up (pick one, ask the user)

- Test the lifecycle cron for real (set `CRON_SECRET`, force a contest's
  `lock_at` into the past, hit the route, confirm lock + open_price
  snapshot; then force contest_date + fake late-day time to test scoring)
- Design/build the entry-fee/wallet piece
- Build the auto-spawn-new-block behavior
- Commit + deploy what's here (currently 100% uncommitted)
