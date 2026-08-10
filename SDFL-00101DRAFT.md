# SDFL-00101/00102 Draft Session Handoff — 2026-08-06

Repo: `~/Desktop/stockdraft-no-modules` (main branch, tracks `origin/main`).
DB access: `env.local` (no dot) has `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` for PostgREST reads.

Context: this session babysat two live test drafts in a row —
**SDFL-00101** (deleted mid-session by the user) and **SDFL-00102**
(league id `33fcf0ef-3150-4cee-97c5-1ece1c5104f0`, ran to completion). Four
things got fixed and shipped along the way, all confirmed pushed to `main`
and built clean (`npx tsc --noEmit`, plus the repo's pre-push build hook).

---

## 1. SDFL 2026 draft order wired in — commit `0c9930c`

**What**: `src/lib/league/draft-order-server.ts` now calls
`computeSdfl2026DraftOrder()` (in `src/lib/sim/sdfl-2026-draft-order.ts`) for
SDFL leagues specifically, ordering franchises by their mapped real NFL
team's **original** (pre-trade) slot in the actual 2026 NFL Draft round 1.
Falls back to random shuffle only if a franchise has no real-team identity
claimed yet (shouldn't happen in practice — identity-claim is gated before
a draft can start).

**Why it needed doing**: the code existed (`SDFL_2026_ORIGINAL_DRAFT_ORDER`,
all 32 teams, user-reviewed) but was never called from anywhere — see
`SDFL_2026_SEASON_HANDOFF.md` item 6, "built, NOT wired in." This session
wired the call site only; the underlying order data was already correct.

**Verified live** on SDFL-00102: all 32 `league_members.draft_slot` values
came out non-random and matched the real-team mapping, not the old
`random_shuffle` default.

**Untouched**: snake-order pick sequencing (`draft-turn-order.ts`) — that
was already correct (round 1 forward 1→32, round 2 reverse 32→1, etc. — any
`format_type === "sports_league"` league already snakes). The draft-order
wiring only decides who sits in which of the 32 slots; snake logic is a
separate, pre-existing mechanic layered on top.

---

## 2. Draft-finish load spike fixed — commit `746194b`

**Symptom user hit**: right as SDFL-00102's draft finished, **every team
got logged out simultaneously**. Traced via the Supabase dashboard's Aug 6
~1pm graphs: Postgres threw 891 errors in that window, Auth's health check
responded in 23s (vs the middleware's 3s timeout at
`src/lib/supabase/middleware.ts:17`), so every request in that window got
treated as signed-out and bounced to `/auth`.

**Root cause**: `captureWeekBaselinesForLeague()`
(`src/lib/roster/weekly.ts`) fired one **live external quote-provider call
per manager** via unbounded `Promise.all` — for a 32-team league finishing
its draft, that's ~32 concurrent external calls plus their DB round trips,
all from a single request (the one that resolved the final draft pick and
triggered `finalizeHumanLeagueAfterDraft`). On an already-capacity-limited
Supabase project (Free/Nano tier, over quota — see
`stockdraft-supabase-capacity` memory), that burst was enough to saturate
Postgres/Auth for everyone, not just that league.

**Fix**: `captureWeekBaselinesForLeague` now does one pass to figure out
what every manager needs, fetches the league's **whole deduplicated symbol
set in a single shared quote fetch** (a stock-draft pool has heavy overlap
across managers — 32 redundant calls collapse into 1), then writes each
manager's baseline concurrency-capped at 6. The user who triggered the
capture (e.g. the draft-completing league owner) goes first as a
tie-breaker within that cap, though the real fix is the shared fetch, not
the ordering.

**Not fixed, still a real risk**: the underlying Supabase capacity ceiling
itself (Free/Nano tier, already over quota, restricted from Aug 9 2026 per
existing memory `stockdraft-supabase-capacity`). This session's fix reduces
how hard a single draft-finish event hits it, but doesn't raise the
ceiling. **Must size up the Supabase plan before the Sept 4 SDFL 2026
launch** — a bigger or more-concurrent draft could still trip this.

---

## 3. SDFL crypto draft rule — commit `4ee6b51`

**What the user found** (deliberately, stress-testing the draft): with 6
teams they drafted themselves, one team ended up with 5 of the 5 tracked
cryptos (BTC/ETH/BNB/ZEC/XMR) while another had just 1 — both "full" 13-pick
rosters, wildly different risk/volatility exposure. No rule stopped it.

**Root cause**: SDFL was the *only* sports-sim league (of SDFL/SDHL/SDBA/
SDLB) with zero starter-split enforcement. SDHL/SDBA/SDLB (the
"multi-asset" leagues, `isMultiAssetSimLeague`) already had a working 5
stock / 5 crypto split; SDFL had nothing.

**Design iteration** (worth knowing if you're touching this again — two
wrong turns before landing here):
1. First pass: added a fixed 7-stock/3-crypto split to SDFL's 10 starter
   rounds, plus made the 3-spot bench stock-only. **Rejected by the user**:
   "we can't limit WHEN players pick something, we can only limit HOW MANY."
   The bench-stock-only restriction was exactly the kind of "when" rule
   they didn't want.
2. Landed on: **no round-based type restriction at all**. Stock or crypto
   is freely pickable in any of the 13 rounds (starter or bench). The only
   rule is a **running global cap of 3 crypto total** across the whole
   draft (`SPORTS_SIM_SDFL_CRYPTO_CAP` in `draft-constants.ts`), checked
   fresh on every turn via `countCryptoPicksAllRounds()` in `engine.ts` —
   not scoped to starter rounds like the multi-asset split is.

**Where it lives**: `getSportsSimEligibilityRule()` in
`src/lib/draft/engine.ts` returns one of two shapes — `multiAssetSplit`
(SDHL/SDBA/SDLB, unchanged, starter-rounds-only 5/5) or `globalCryptoCap`
(SDFL, new, 3 max anywhere). `getTurn()`'s `canPickCrypto` flag is the
actual server-side enforcement gate (checked again at pick-submission time
in `src/lib/draft/server.ts`), so this isn't just a UI restriction.

**Visible in the draft room**: the round header (`turn.label`) now shows
the live crypto count against the cap, e.g. "Round 6 — starter (stock or
crypto $100K) · 2/3 crypto used" — the rule is stated where the pick
actually happens, not hidden or contradicted by stale copy (the old bench
label used to say "stock or crypto, free" even when crypto wasn't actually
allowed there — that's part of what confused the user in the first place).

**Not retroactive**: SDFL-00102's already-finished draft (the one with the
5-vs-1 crypto imbalance) was not repaired. This only affects future SDFL
drafts.

---

## 4. Note: a concurrent session's SDFL 2026 work also landed on `main`

Commit `6d928ee` ("Wire SDFL 2026 season: injury fallback pool, schedule,
season cutover") appeared on `main` between this session's pushes — **not
this session's work**, came from a different concurrent session per the
multi-session warning already in `SDFL_2026_SEASON_HANDOFF.md`. Worth
reading that file fresh rather than trusting this handoff's earlier
in-session snapshot of it, since it may have wired in the SDFL-2026
pick-injury-map table (`sim_sdfl_2026_pick_injury_map`, migration 078) that
this session found was **not yet applied to the database** and deliberately
left uncommitted/unwired for that reason. Confirm migration 078 has
actually been applied before trusting that path is live.

---

## Open items for next session

1. **Supabase capacity** — real fix still pending (see item 2 above).
   Must happen before Sept 4 launch.
2. **Migration 078** (`sim_sdfl_2026_pick_injury_map`) — check whether the
   concurrent session's commit `6d928ee` applied it for real, or whether
   it's still the same "written, not applied" state from
   `SDFL_2026_SEASON_HANDOFF.md`.
3. **SDFL-00102's crypto imbalance** — left unrepaired, intentionally (it
   was a deliberate user stress-test of the old rules, not a real league).
4. This session's draft-order wiring, capture fix, and crypto-cap rule are
   all confirmed **live on `main`** (commits `0c9930c`, `746194b`,
   `4ee6b51`) — no further action needed on those three.
