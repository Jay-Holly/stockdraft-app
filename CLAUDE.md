# CLAUDE.md — StockDuel

Standing context and rules for anyone (human or Claude) working in this repo.
Read this before starting.

---

## 0. What this phase is actually about

The pricing rebuild is done and it works. Alpaca plus the price log solved
roughly 98% of the real problems this system had.

**Everything being built on top of that is reputation cover.** Not bug-chasing.
The holds, the two-source corroboration, the audits, the append-only record —
they exist so that Jay, and StockDuel, can stand behind every number the app
has ever shown. A Pittsburgh beta is days away and a sponsor demo follows in
October.

So the thing that matters most about this system is not that it is clever. It
is that **it can explain itself.** Every price carries its source, the moment it
was true, whether an independent source agreed, and who corrected it if anyone
did — in a table nothing can edit after the fact. That is what turns a player
dispute into a two-minute conversation and a sponsor question into an easy one.

Four consequences, and they should drive what gets worked on first:

1. **Rank work by reputational exposure, not technical severity.** A silent
   failure a player can screenshot outranks an elegant internal fix.
2. **Silence is the real damage.** Holding a payout for an excellent reason and
   telling nobody looks, from the player's side, exactly like taking their
   money. When the system holds, something has to surface it.
3. **Refusals are an asset.** Contests the system declined to settle because it
   could not verify a price are the strongest possible evidence that it works.
   Present them that way; do not quietly clean them up.
4. **Prefer a defensible record over a merely correct answer.** Two independent
   sources written next to a number beats one source that happens to be right.

---

## 1. What this project is

StockDuel — a fantasy platform where managers draft S&P 500 stocks and crypto
instead of athletes and compete on real market performance.
Next.js 15, Supabase (Postgres), Vercel. Repo: `github.com/Jay-Holly/stockdraft-app`.

- **SDPL / SDAI** — core stock-draft fantasy. SDPL is real people; **SDAI is a
  live interactive tutorial**: 13 business days, each day simulating a week,
  a winner each day, one portfolio carried throughout. It is a new player's
  first experience of StockDuel.
- **SDFL / SDBA / SDHL / SDLB** — same draft mechanic, each stock secretly
  mapped to a real athlete, with injuries driving an IR mechanic.
- **SDDFS / SDWFS** — daily and weekly fantasy contests. **These are the only
  leagues where real money moves.** All other "payouts" are in-game bonus
  currency into a player's crypto pool.
- **Day Trader** — a separate contest layered on top.

---

## 2. Architecture invariants — do not violate these

**The logger is the only thing that talks to a market data provider.**
It sweeps the pool on a schedule and writes every observation to `price_log`.
Every league, every contest, every page reads what it wrote. No provider call
belongs in a scoring path or a page load. The one sanctioned exception is the
DFS audit (`src/lib/dfs/audit.ts`), which must use an independent source —
an auditor reading the log it is auditing is checking the log against itself.

**A missing price is a miss, never a number.** Not zero, not the last known
price, not the draft-day price. Every incident this system has had came from a
failed lookup becoming a plausible number that then got scored and paid out.

**A contest that cannot be priced honestly holds.** It stays open and retries.
It never settles on a substitute. Partial pricing holds too: settling 39 of 40
symbols scores the 40th neutral while its rivals score for real.

**Baselines chain.** A period's opening value is the previous period's *closing*
value. Only a team's first baseline of a season comes from a live quote. This is
what makes overnight and weekend gaps land somewhere instead of vanishing.
Applies to SDFL, SDPL, SDAI and SDLB/SDHL/SDBA. Not to SDDFS, SDWFS or Day
Trader, which are each one self-contained span.

**A prior close is a position value; a live quote is a price per share.**
Confusing them turns an $80,000 position into an opening value of ~$348.

**Anchors are corroborated at capture.** The open comes from Alpaca (one batch
call, written immediately — contests lock on it and cannot wait). The close comes
from Finnhub (consolidated; Alpaca's free tier is IEX-only and does not run the
closing auction). Each is checked against the other for free, and the verdict is
stored in the same row as the price.

**Never rewrite an anchor a contest may already have locked on.** Mark it
divergent, log it, queue it. Correction is a deliberate supersession, which
keeps the original visible forever.

---

## 3. Working with Jay

- **Jay is non-technical.** Plain language. No jargon dumps, no AI-speak.
- **He says when to look. Do not investigate on your own.** Answer what he
  asked, then stop. Don't volunteer things he already knows about his own
  system.
- **Raise a real concern once, then drop it.**
- **When he describes the system, he is describing INTENT, not current code.**
  Don't "correct" him.
- **When he says something twice, it's a decision.** Act on it.
- **When in doubt, ask.** One clarifying question is cheaper than a wrong
  implementation, and far cheaper than a turn spent testing a guess.

### Preserve his usage credits — this is a priority, not a nicety

- Don't re-read files already read this session unless they changed.
- Don't re-run the same check, test or search without a reason.
- Never use a screenshot or vision to verify something a log, a `curl`, a
  `grep` or a direct read of the database can answer as text.
- Don't narrate every micro-step. Batch findings and report once.
- Prefer one scripted tool call over several back-and-forth turns.
- **Fail fast on tool paths.** Two failures on the same approach means switch
  approaches, not try a third time.
- When he needs to confirm something visually, open it in the browser/navigator
  so he can look — don't burn a vision call interpreting it yourself.

---

## 4. Hard rules for working here

**1. Never report work as done without proof.** "Implemented", "committed",
"pushed" and "deployed" are four separate facts — do not conflate them. Give the
commit hash. Do not call anything live without confirming the deployment.

**2. A typecheck is not proof.** This rebuild has repeatedly found load-bearing
bugs that compiled cleanly: an auth header built but never attached, a cache
with a hidden warm-up dependency, and `isUsableQuote` stubbed to return `false`
for every price on earth. Anything touching money or a score gets a live test
against real output before it is called done.

**3. `next dev` passing is not `next build` passing.** They check different
things, and the pre-push hook runs the latter. Run `npm run build` before
pushing, deliberately, rather than finding out at push time.

**4. Investigate before building.** Search for the existing pattern and reuse
it. Several files deleted in the 2026-08-27 cleanup still exist on `main` and
are better restored than rewritten — their comments record real incidents.

**5. Pure logic goes in its own file.** The decisions that matter — whether a
contest may lock, what a roster is worth, whether two sources agree — live in
pure modules (`src/lib/dfs/lock-plan.ts`, `src/lib/scoring/`) precisely so they
can be tested without settling a real contest in the production database.

**6. Never commit, push or deploy without being asked.** Every time.

**7. Keep this file current — it is the handoff.**
This document is read at the start of every session and is the only thing a
fresh session knows. Before finishing a session, update it:

- Correct any fact that changed. Move finished items out of "open questions"
  into "settled", or delete them.
- Replace §10 "Where to pick up" wholesale with the current state.
- **Edit in place. Do not append.** This file loads in full every session and
  costs tokens every time, so a session log appended here is paid for forever.
  Session narrative belongs in a handoff doc, not here. If this file is growing
  every session, it is being used wrong.

A stale CLAUDE.md is worse than none, because the next session reads it
confidently and has no reason to doubt it.

---

## 5. Verification checklist

After any meaningful change:

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` passes
- [ ] Live-tested against real data if it touches a price, a score or money
- [ ] Migration applied to the live database, if one was added
- [ ] Stated plainly what is committed, what is pushed, what is deployed

---

## 6. Current system state

**Branch:** `scoring-rebuild`. `main` is what is deployed and is untouched.

**Production pricing is FROZEN** — `FROZEN = true` in
`src/lib/market/pricing-freeze.ts`. Live tests flip it off, test, and flip it
back. Never leave it live.

**The pricing pipeline is built, live-tested and correct:**

- `price_log` / `price_sweep` (migrations 089–092) — append-only. The
  constraints are database-level, not conventions, because every incident this
  system had came from a convention that held everywhere except the one path
  nobody checked. A row is either a price or a failure, never both; a price is
  never zero; a price cannot exist without the moment it was true; a hand-edit
  always records who made it and what it replaced.
- Migration 093 adds anchor corroboration columns. All of 089–093 are applied
  to the live database.
- **The logger** (`src/lib/pricing/logger.ts`) sweeps 502 stocks + 50 crypto =
  552 symbols, every minute, and is the only thing that calls a provider.
- **Write-on-change**: a sample is written only when the price, day high or day
  low actually moved. Anchors and failures are never skipped. Fetching was
  never the cost — Alpaca prices the whole pool in ~350ms — the cost is writing.
- **Sweeps are time-boxed** to 260s (under the 300s platform cap), ordered
  stalest-first, and report honest `not-attempted` rows for whatever they did
  not reach. A trigger skips while a sweep is in flight; a sweep still
  `running` past the platform ceiling is closed out as abandoned.
- **Live updates**: the logger broadcasts changed symbols over Supabase
  Realtime. The push is a *signal* ("ask again now"), never data to render —
  the server stays the only thing that computes what a roster is worth.
- **Admin page** `/admin/prices` — sweep status, problems-first view, full
  552-symbol grid, per-symbol re-fetch, run-now button.

**Provider entitlements, measured from the live keys — not assumed:**

| Provider | Limit | Notes |
|---|---|---|
| Alpaca | 200 req/min | One batch call prices the whole pool. **Free tier = IEX only**; `feed=sip` returns 403. Does not run the opening/closing auction. |
| Finnhub | 60 req/min | **No batch endpoint** — a comma-separated request returns HTTP 200 with all-zero fields. 502 symbols ≈ 9 minutes. |
| CoinGecko | — | One call for the whole crypto pool. At one sweep/minute that is ~43k calls/month — verify the plan before relying on it. |
| Twelve Data | 8/min free | Third line only. Equities only (crypto ticker collision). Recovers a day's open/close from minute bars. |

Measured IEX vs consolidated close divergence: **avg 0.023%, worst 0.073%.**
Invisible on screen; enough to decide a close matchup. That is why the close
anchor comes from Finnhub and the open from Alpaca.

**Keys** live in `.env.local` (gitignored): `ALPACA_API_KEY_ID`,
`ALPACA_API_SECRET_KEY`, Finnhub, Twelve Data, Supabase. The Alpaca account is
free paper-trading — no payment details, no funded brokerage account.

---

## 7. Decisions already made — do not re-litigate

1. **Alpaca is primary for stock samples, Finnhub is the backup, Twelve Data is
   the third line** (equities-only, anchor-recovery-only). Crypto is CoinGecko.
2. **The provider chain is self-healing, never manually flipped.** No outage
   flag is tracked anywhere. Every sweep tries Alpaca fresh; an outage falls to
   Finnhub naturally and recovers by itself the moment Alpaca answers.
3. **A sweep must never run long enough to be platform-killed.**
4. **Off-index stock search is cut for the beta**, not broken. It needs a live
   roster scan for active off-pool symbols plus a paid data source. Player-facing
   message is already in place.
5. **Commit and push are safe without a fresh ask once a batch of work is
   approved. Deploy is never assumed and is asked separately, every time.**
6. **Twelve Data is equities-only, enforced inside that module** (RAIN/crypto
   ticker collision). Settled — do not re-open.

---

## 8. Open questions and known traps

Still unresolved, and easy to get subtly wrong:

- **Day Trader's two leaderboards are mathematically identical.** While
  everyone starts at exactly $500,000, "$ gainer" and "% gainer" rank the same
  list. Needs a product decision — vary starting values, pick a different
  second measure, or make it one prize.
- **No `failed` contest status exists** — still open/locked/scored only. The
  hold behaviour covers the common case (a contest that cannot be priced stays
  open and retries), but there is still no honest way to record a contest that
  can never be scored, instead of laundering it into "scored."
- **Diamond Hands needs intraday low**, not open/close. `day_high`/`day_low` are
  in the log for exactly this — use them, don't recompute from samples.
- **Two different "end of week" instants coexist.** SDLB/SDHL/SDBA score through
  the weekend to **Sunday 4 PM ET** because crypto keeps moving. SDFL, SDPL,
  SDAI, SDDFS and SDWFS all end **Friday**.
- **SDFL's injury system is described in the published rules but is not wired
  into the live draft.** Publishing rules the software doesn't honour is the one
  option to avoid.
- **Frozen contests.** DFS contests that could not be verified are being held
  correctly — but nothing alerts and nothing surfaces them, so they accumulate
  silently. See §0: silence is the real damage.

Solved, recorded so they are not re-derived:

- Money entering a portfolio is not performance — and awards are paid *after* a
  period closes, so the real protection is **ordering** (capture the next
  period's baseline after the deposit), not arithmetic.
- Crypto cost basis is per-manager automatically: each pick stores the shares
  that manager bought with their own budget, surcharge included.

---

## 9. Scale — answered, so it is not re-derived

At 100,000 concurrent users the provider cost **does not move**: the same 552
symbols on the same clock, and one sweep feeds every league. Pressure lands on
Supabase, which is a limit you can buy your way out of. Prices are identical for
every viewer so they cache trivially — but **not in process memory**, because
Vercel runs many instances that each start cold, which is the exact
re-fan-out pattern that has already bitten this system. Score once per sweep,
write standings down, and let pages read the finished table. Never score on a
page load.

The Pittsburgh beta is dozens of people. None of this is work for now.

---

## 10. Where to pick up

*Replace this section entirely at the end of each session. Keep it short — what
is in flight, what is blocked, what is next. Not a history.*

**Last updated:** 2026-08-29

**State:** Branch `scoring-rebuild`, working tree clean, nine commits this
session, **nothing pushed and nothing deployed**. `main` is still what is live.
Migrations 089–093 all applied to the live database. Production pricing is still
frozen.

**Working and proven against real data:** the price log as the only price
source; the logger sweeping every minute with write-on-change; live push to
browsers over Supabase Realtime; DFS contests holding rather than locking on
missing baselines; anchors corroborated at capture; baselines chaining across
periods; season-league scoring wired end to end (`matchup/scoring.ts` has no
stub dependencies left); the DFS audit chain restored.

**Next, in priority order:**

1. **12 SDDFS contests are frozen**, holding real entry fees, and the audit that
   would resolve them has been stuck in `running` since 2026-08-26 (8 of 544
   symbols). Nothing alerts on either. Per §0, a silent hold is the highest
   reputational exposure open. *Jay has explicitly deprioritised the old frozen
   contests themselves — but the alerting gap remains.*
2. **Give `dfs_audit_runs` a stale-run guard**, the same one `price_sweep` now
   has, so a dead run cannot jam every run behind it.
3. **Narrow audit round 2** to skip anchors already corroborated at capture, so
   Twelve Data's 8/min budget is spent only on exceptions. Approved, not built.

**Still stubbed:** `day-trader/leaderboard.ts`, `day-trader/position-gains.ts`,
`sddfs/scoring.ts`, `roster/historical.ts`, `roster/team-stats.ts`, and the
`market/*` cache files (likely dead now that the log exists — check callers
before rebuilding, they may want deleting instead).

**Before deploying:** this branch still contains throwing stubs that `main` has
real code for. Deploying replaces working features with ones that break the
moment a player touches them.
