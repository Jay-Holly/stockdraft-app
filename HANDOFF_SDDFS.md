# SDDFS — Session Handoff

Paste this file's path into a new chat and say "read HANDOFF_SDDFS.md and
continue" — everything needed to pick up cleanly is here.

**Note:** this repo also has a separate `HANDOFF.md` for unrelated league-
scoring/SDFL-map work from a different session thread. Don't merge the two —
they cover different features. This file is SDDFS-only.

## Status: committed, deployed, live in production

Everything below is committed to `main` and deployed to Vercel
(`https://stockdraft-app.vercel.app`). The repo working tree is shared with
other background sessions — always run `git status` and stage only the
specific paths you touched before committing (this has bitten us before:
one commit accidentally swept in another session's unrelated,
not-yet-committed work because it was already `git add`ed).

## What SDDFS is

A real-money DFS (daily fantasy) game mode, "StockDraft Daily Fantasy
Sport" / **SDDFS**, alongside the existing league/draft system and Day
Trader. Format loosely inspired by the competitor stkdraft.com (naming/
copyright discussion is still open, paused, user-led — see old
`HANDOFF.md`) but reimplemented as our own, and the rules copy was
deliberately rewritten to not structurally mirror stkdraft.com's rules
page (different section order/grouping, not just reworded — see
`src/components/dfs/SddfsRulesButton.tsx`).

- 12-pick lineup: one stock from each of the 11 GICS sectors + Crypto.
  Picks are **not exclusive** — any number of entrants can pick the same
  stock.
- 6 named buy-in tiers, each with its own entrant cap (`DFS_TIERS` in
  `src/lib/dfs/contests.ts`):
  - **The $2 Bill** — $2, cap 150
  - **The 5 Spot** — $5, cap 100
  - **The 10'er** — $10, cap 75
  - **The 25 Spot** — $25, cap 50
  - **The Fiddy Hundred Cent** — $50, cap 20
  - **The Big Ciento** — $100, cap 10
  - One contest per tier per day, one entry per user per contest.
- Lock at 9:00 AM ET, score at market close (4:00 PM ET) on open→close %
  change summed across all 12 picks.
- Top 3 paid 50/30/20% of a 92%-of-buy-ins pool; ties split the pooled
  share evenly across however many entries tie within (or straddling) the
  paid range. Logic: `computeSddfsPayouts` (`src/lib/sddfs/scoring.ts`).
- Contest scheduling rolls forward automatically: `activeSddfsContestDateIso()`
  (`src/lib/dfs/contests.ts`) keeps "today" active through its whole
  lifecycle (open → locked at 9 AM → scored at 4 PM close), then flips to
  the next weekday — and the lifecycle cron itself creates that next day's
  contest rows right after close, so they're open and enterable
  immediately instead of waiting for lobby traffic.

## Key fixes from this session (don't reintroduce these bugs)

1. **Pricing bug (real, already happened once in production):** SDDFS
   lock/score originally read prices from the shared `stock_prices`/
   `crypto_prices` cache tables, which are refreshed by a once-daily cron
   covering only a rotating portion of the ~500-symbol pool. Any symbol
   the day's rotation missed kept an identical stale price at both lock
   and close, scoring a false flat 0% (confirmed live: an entire scored
   contest showed every stock at exactly +0.0%, and ETH at -100% from a
   related crypto-quote fallback failure). Fixed by
   `src/lib/sddfs/live-quotes.ts` (`fetchLiveSddfsQuotes`), which fetches
   directly from Finnhub (stocks) and CoinGecko (crypto) for just the
   day's picked symbols — small enough to stay well within rate limits —
   bypassing the stale rotating cache entirely. Used by both
   `lifecycle.ts` (lock/score) and `leaderboard.ts` (live standings
   projection). **If you ever see a suspiciously flat/uniform score
   across many picks, check this first.**
2. **Lineup builder didn't check contest status** — visiting an
   already-locked/scored contest (e.g. an old link) still showed the full
   12-pick drafting UI; users could fill a lineup and only find out it
   was rejected ("This contest is locked") at submission. Fixed in
   `src/app/stockdraft-dfs/[contestId]/page.tsx`: redirects to the user's
   existing entry if one exists, shows a clear closed-state message
   otherwise.
3. **ESLint unescaped-entity build breaks happened twice** — `npm run
   build` runs ESLint and fails on raw apostrophes in JSX text
   (`react/no-unescaped-entities`); `tsc --noEmit` does *not* catch this.
   Always use `&apos;` in JSX text, or run a real `npm run build` before
   trusting a push (though watch for `.next` cache contention with the
   shared dev server — see below).
4. **Shared dev server / `.next` cache contention:** other background
   sessions may have a `next dev` server running against this same repo.
   Running `npm run build` concurrently can corrupt that dev server's
   `.next` state (ENOENT manifest errors) — if you see that, just restart
   the dev server (`preview_stop` + `preview_start` with the `dev3100`
   config in `.claude/launch.json`), don't panic-debug the app code.

## File map

- `supabase/migrations/065_sddfs_contest.sql` — `sddfs_contests`,
  `sddfs_entries`, `sddfs_entry_picks`. RLS: read-all-authenticated,
  insert/edit own rows only while contest `status = 'open'`.
- `src/lib/dfs/contests.ts` — `DFS_TIERS`, `tierNameForBuyIn`,
  `activeSddfsContestDateIso`, `ensureTodaysSddfsContests`,
  `getDfsContestsForToday`, `getDfsContestById`, `formatDfsContestDateLabel`,
  `prizePoolForContest`.
- `src/lib/dfs/my-teams.ts` — `getMyDfsEntries()` for the logged-in user.
- `src/lib/sddfs/scoring.ts` — `computeSddfsPayouts`, `finalizeSddfsContest`.
- `src/lib/sddfs/lifecycle.ts` — `runSddfsLifecycle()`: locks due
  contests (snapshots `open_price` via live quotes), scores locked
  contests past 4 PM ET close, then ensures next-day contests exist.
- `src/lib/sddfs/live-quotes.ts` — direct Finnhub/CoinGecko fetch, bypasses
  the stale shared cache (see fix #1 above).
- `src/lib/sddfs/leaderboard.ts` — `getSddfsContestLeaderboard()`: live
  in-progress standings + projected payout while a contest is `locked`
  (re-prices every pick against a live quote), or the finalized board once
  `scored`.
- `src/app/api/cron/sddfs-lifecycle/route.ts` — cron, `*/15 * * * *` in
  `vercel.json`. **Verified firing for real in production** — `CRON_SECRET`
  is set in Vercel, confirmed via authenticated curl and by watching real
  contests transition open→locked→scored.
- `src/app/api/sddfs/enter/route.ts`, `swap-pick/route.ts` — verified live
  against real Supabase rows.
- `src/components/dfs/DfsShell.tsx` — pill-nav header (Dashboard / Lobby /
  My Teams), purple `[data-league-theme="sddfs"]` accent, optional
  `hideWatermark`/`hideHeaderLogo`/watermark size-opacity overrides.
- `src/components/dfs/DfsLineupBuilder.tsx` — draft/lineup-builder UI.
- `src/components/dfs/FreeAgentPanel.tsx` — swap panel, now embedded
  per-entry on the league page rather than a standalone nav item.
- `src/components/dfs/SddfsRulesButton.tsx` — rules modal, rewritten to
  not structurally mirror stkdraft.com (see note above). Deliberately
  omits any "prohibited participant" clause targeting professional
  traders/analysts — that's this platform's actual target audience.
- `src/app/stockdraft-dfs/page.tsx` — lobby. Big centered logo (no
  watermark on this page specifically), full "StockDraft Daily Fantasy
  Sport" name spelled out under it, date label ("Wed, Jul 23 Contests"),
  purple-bordered tier list styled like the Day Trader landing page.
- `src/app/stockdraft-dfs/[contestId]/page.tsx` — draft page. Redirects
  to the entry page if already entered; shows closed-state message if
  contest isn't `open`.
- `src/app/stockdraft-dfs/entry/[entryId]/page.tsx` — **the per-entry
  "league" page**, only reachable once a contest is entered (linked from
  My Teams). Shows live leaderboard + projected money split, the user's
  lineup, embedded Free Agents swap panel, and the SDDFS logo.
- `src/app/stockdraft-dfs/my-teams/page.tsx` — links to the entry page
  above, not the draft page.
- `src/components/DashboardContent.tsx` — "StockDraft Daily Fantasy
  Sport" button, purple themed, positioned after StockDraft Day Trader in
  the button order (Free Sim League, Player League, Sports League, Day
  Trader, SDDFS).
- `src/app/game-rules/page.tsx` — has a full SDDFS section (lineup,
  tiers table, lock/scoring/payout rules) alongside the other game modes.

## Wallet / My Account (new, adjacent feature — not SDDFS-specific)

Built this session because SDDFS needs real money to actually flow
somewhere. Lives at `/my-account`, linked from the dashboard next to
Manager Profile.

- `supabase/migrations/069_wallet.sql` — `wallet_transactions` ledger
  table (applied to production). Balance is **always derived by summing
  rows** (deposits/wins/refunds positive, withdrawals/entry_fees
  negative), never a stored mutable column — the ledger itself is the
  accounting record. No client insert policy; every write goes through
  the service-role client.
- `src/lib/wallet/ledger.ts` — `getWalletBalance` (completed + pending
  rows — a pending withdrawal holds funds immediately), `listWalletTransactions`
  (month/year/all-time), `recordWalletTransaction`.
- `src/lib/stripe/client.ts` — lazy Stripe client, returns `null` when
  `STRIPE_SECRET_KEY` isn't set rather than throwing.
- `POST /api/wallet/deposit` — Stripe Checkout Session, min $5.
- `POST /api/wallet/webhook` — verifies Stripe signature, credits the
  ledger on `checkout.session.completed`.
- `POST /api/wallet/withdraw` — inserts a `pending` withdrawal row
  immediately (holds the balance) — **no automated payout**, that needs
  Stripe Connect onboarding (connected accounts, identity verification,
  bank linking), not built. Treat as a manual-fulfillment queue for now.
- **Explicitly set up but not activated per user request** — no Stripe
  API keys are configured anywhere, so `isStripeConfigured()` is false
  and the Deposit button returns "Deposits aren't turned on yet." To go
  live: set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in Vercel, and point a Stripe
  webhook at `/api/wallet/webhook` for `checkout.session.completed`.
- **Not wired to SDDFS entries yet** — entering a contest still doesn't
  deduct an entry fee from the wallet, and winning a contest doesn't
  credit it. The `entry_fee` and `win` transaction types exist in the
  schema/type union for exactly this, just not called anywhere yet.

## Verified working, live, against real production data

- Full lock→score cycle observed firing for real via the 15-min cron
  (not just code review) — contests transition open→locked→scored with
  real Finnhub/CoinGecko prices, not stale cache data.
- Entered a real contest end-to-end, swapped a pick via Free Agents,
  confirmed DB writes (not just local state) for both.
- Live leaderboard/payout projection verified mid-day (before a contest
  scores) and the finalized board verified after scoring.
- Contest auto-creation at market close verified — next day's 6 contests
  exist and are enterable without anyone visiting the lobby first.
- `tsc --noEmit` and a full `npm run build` both clean on every file
  touched this session.
- My Account page loads, shows $0.00 balance (no transactions yet),
  Deposit/Withdraw modals open and submit correctly.

## NOT built / NOT verified — be upfront about this if asked "is it done"

1. **No real money moves yet** — Stripe isn't activated (see above).
   SDDFS contests are still effectively free to enter; nothing charges
   or pays out real dollars.
2. **Entry fees / winnings aren't wired to the wallet** — even once
   Stripe is live, `/api/sddfs/enter` needs to actually deduct
   `MIN_DEPOSIT`-style entry fee from wallet balance (and reject if
   insufficient), and `finalizeSddfsContest` needs to credit `win`
   ledger rows for payouts. Neither exists yet.
3. **Withdrawal payouts are manual** — a `pending` ledger row is created,
   but nothing actually sends money anywhere. Needs Stripe Connect
   (or equivalent) to automate.
4. **No admin/ops UI** for contests or the wallet — no way to
   force-lock/force-score a contest, adjust `lock_at`, or review/approve
   pending withdrawals short of writing SQL directly.
5. **Auto-spawn a new contest block when one fills** — user's stated
   future idea (e.g. spin up a second $10 block once the first hits its
   entrant cap), never built. `ensureTodaysSddfsContests` is the natural
   place to add it.
6. Copyright/naming exposure re: stkdraft.com — still an open, paused,
   user-led discussion (see old `HANDOFF.md`). The rules text was
   rewritten to not structurally mirror theirs, but the underlying
   product concept/naming question hasn't been resolved.
7. **No legal/compliance review** for real-money skill-contest operation
   (state eligibility, KYC/AML on withdrawals, licensing) — explicitly
   out of scope for what's been built; only the accounting plumbing.

## Next up (pick one, ask the user)

- Wire entry fees + winnings to the wallet ledger (the two gaps in #2
  above) — this is the natural next step once Stripe is actually
  activated.
- Get a Stripe account set up and flip the deposit flow live.
- Design the withdrawal payout automation (Stripe Connect or otherwise).
- Build the auto-spawn-new-block behavior.
- Admin/ops tooling for contests and pending withdrawals.
