# SDFL 2026 Season — Handoff

Everything being built for SDFL's 2026 season launch (beta target Sept 4,
2026) lives in this one file, kept separate from the shared `HANDOFF.md` at
repo root (that file belongs to whichever session last wrote it — this repo
has multiple concurrent chat sessions working in it, and `HANDOFF.md` has
already been overwritten once by another session's unrelated 2024-era work).

Paste this file's path into a new chat and say "read this and continue" to
pick up the 2026 SDFL work specifically.

**Ground rule carried through this whole effort**: nothing here is wired
into any live flow yet, and nothing has been allowed to touch or affect the
4 existing SDFL leagues currently running on 2024-era data/mechanisms (Take
2, WOOHOO League2, Test After Changes, Deez Nutts2 — all confirmed test
leagues). This is deliberate groundwork for when the real season launches,
built as fully separate, isolated tables/files wherever the old and new
mechanisms would otherwise collide. Cutover (flipping things live) is a
separate future decision, not part of this build.

Repo: `~/Desktop/stockdraft-no-modules`.

---

## 1. Player rankings — LIVE in the database

600 real NFL players, season "2026", covering every fantasy-relevant
position (QB/RB/WR/TE/K plus IDP-relevant LB/DB/CB/DL/DE/DT — true offensive
linemen and nose tackles aren't fantasy-scoring positions and are excluded).

- **Source**: Sleeper API (`api.sleeper.app/v1/players/nfl`, free, no key).
  Ranked by Sleeper's own `search_rank` field.
- **Script**: `scripts/seed-sim-nfl-2026-sleeper.mjs` — already run for real.
  Writes to `sim_players` / `sim_player_rankings`, sport="nfl",
  season="2026", all rows tagged `tier="editorial"` (Sleeper gives one
  continuous rank, not the old curated-vs-stats split from 2024 data, so one
  tier keeps existing tier-filtered lookup code working unmodified).
  Re-runnable any time to refresh; `--dry-run` flag available.
- One team-code fix baked in: Sleeper uses `LAR` for the Rams, this app uses
  `LA`. A stray `OAK` (stale/retired players) in Sleeper's data is dropped,
  not aliased.
- **No injury data included** — Sleeper only has live/current status, not
  dated spans. `sim_player_injuries` is untouched; a different real-time
  source will be wired in later (see "Open questions" below).

## 2. Stock ↔ player map — LIVE in the database

All 503 S&P 500 stocks in the draft pool now map to one of the 600 players
above, by matching rank (rank 1: NVDA → Josh Allen ... rank 503: VLO →
Christian Harris).

- **Script**: `scripts/seed-sim-stock-player-map.mjs`, run with:
  ```
  node --env-file=.env.local scripts/seed-sim-stock-player-map.mjs --sport nfl --season 2026 --max-rank 503
  ```
- **Caveat**: the `--max-rank` flag (added this build to raise the old
  hardcoded 384-rank cap up to 503) has since been **reverted** by another
  concurrent session working in this repo — the file is currently back to
  its original hardcoded `TOTAL_RANKS = 384`, no CLI flag. The 503-row
  database write already happened and is unaffected (it doesn't depend on
  the script file after the fact), but re-running this script today would
  only touch ranks 1-384 unless the flag is re-added.

## 3. Off-S&P-500 fallback player pool — built, NOT wired in

**The problem**: only 503 of the 600 ranked players have a real stock to
attach to (the S&P 500). If someone drafts a stock outside the S&P 500, it
still needs a real player attached for IR purposes later.

**Confirmed design**:
- Ranks **504-600** (the 97 players above the S&P-matched 503) are a
  reserve pool.
- Handed out in **reverse order** — 600 first, then 599, 598...
- **Per SDFL league** — each league's draft has its own independent
  countdown starting at 600, not shared globally.
- **Always takes the next number** if the same off-S&P symbol is drafted
  again elsewhere — no reuse/dedup lookup, chosen as the lower-effort option.

**Why a separate system instead of reusing what SDFL already had**: SDFL
already had a mechanism for this from the 2024 beta trials —
`sim_league_pick_injury_map` / `seedSportsLeaguePickInjuryMapIfMissing`
(`src/lib/sim/pick-injury-map.ts`), which auto-runs for every SDFL league the
moment its draft finishes (`finalizeHumanLeagueAfterDraft` in
`src/lib/matchup/seed-human-schedule.ts`). It assigns *every* pick (not just
off-S&P ones) an injury-rank by cycling 1-100 based on pick number, and once
any row exists for a league, the eligibility-lookup code uses that path
*exclusively* for that league — ignoring the S&P rank map entirely. This is
"not a fix, it's laying new foundation" (user's words) — the 2024 mechanism
and its 4 live test leagues must not be touched.

**So this was built as a fully parallel, isolated system**:
- `supabase/migrations/078_sdfl_2026_pick_injury_map.sql` — new table
  `sim_sdfl_2026_pick_injury_map` (league_id, global_pick_number, symbol,
  injury_rank 504-600). **Written, NOT yet applied to the database.**
- `src/lib/sim/sdfl-2026-pick-injury-map.ts` —
  `seedSdfl2026PickInjuryMapIfMissing()`: reads a finished league's draft
  events, skips S&P symbols and crypto, assigns the next rank counting down
  from 600 to every off-S&P symbol in pick order. Not called from anywhere
  yet.
- `src/lib/sim/sdfl-2026-injury-status.ts` —
  `isSdfl2026StockIrEligible()` and `loadSdfl2026InjuredSymbolsForLeague()`:
  per-symbol eligibility check that looks in the new fallback table first,
  falls back to `sim_stock_player_map` otherwise. Reuses the week/date-window
  math from the existing `injury-status.ts` (imported, not duplicated).
- Typechecked clean (`npx tsc --noEmit`), no errors.

## 4. 2026 schedule — built, NOT run yet

`scripts/seed-sim-nfl-2026-schedule.mjs` seeds `sim_team_schedule` /
`sim_game_results` for sport="nfl" season="2026" from the same nflverse
schedule source used for 2024 (`games.csv`). The real 2026 NFL schedule is
already published (272 REG games, weeks 1-18) — confirmed live from nflverse
before writing the script. Scores are correctly null for every game (season
hasn't started); this is computed from whether nflverse has filled in a
result, not a hardcoded skip. Bye weeks computed the same way the 2024
script did.

**Dry-run only, confirmed clean**: 272 games / 32 teams / weeks 1-18 / 0
scores / 32-of-32 teams with a bye week found. **Not run for real** — user
wants this as backbone only for now.

## 5. Fantasy matchup schedule generation — already existed, no new code needed

Asked about assigning each franchise's weekly SDFL opponent based on the
real city/team they claimed and its real conference (AFC/NFC). This turned
out to be **fully built already**:
- `src/lib/sim/nfl-team-alignment.ts` — each SDFL city slot already maps to
  a real NFL team, SDAL mirrors the AFC, SDNL mirrors the NFC (confirmed
  2024 divisional alignment).
- `src/lib/matchup/sdfl-schedule.ts` — `loadFranchiseRealTeamMap()` +
  `generateSportsSimRegularSeasonSchedule()` mirror the real NFL schedule
  1:1: whatever real team a franchise maps to, that franchise's weekly SDFL
  opponent is whoever maps to that team's real opponent that week (byes
  produce no game that week, same as real life). Fully season-agnostic —
  reads `sim_game_results` filtered by one shared constant,
  `CURRENT_SIM_SEASON` (`src/lib/sim/sport.ts:30`), currently `"2024"`.
- **So the only remaining work is data + one constant, not new logic**: (a)
  get the 2026 schedule into `sim_game_results` (item 4 above, not run), (b)
  flip `CURRENT_SIM_SEASON` to `"2026"` when ready. That flip is global — it
  affects every sports-sim league at once, including the 4 live SDFL test
  leagues — so it's a deliberate cutover step.

## 6. SDFL stock-draft order — built, NOT wired in

**The idea**: each SDFL franchise's position in the live stock draft should
match the real position its mapped NFL team held in the actual 2026 NFL
Draft's round 1 — using the **original** (pre-trade) order based on final
standings, not the order teams actually picked in after this year's
draft-day trades moved some slots around.

**Source data** (web-researched, cross-checked across two sources — NFL.com
and Tankathon draft-order coverage — trade notes like "pick 10, from
Bengals" were reversed to recover the original standings-based owner):

```
 1 LV    9 KC    17 DET   25 CHI
 2 NYJ  10 CIN   18 MIN   26 BUF
 3 ARI  11 MIA   19 CAR   27 SF
 4 TEN  12 DAL   20 GB    28 HOU
 5 NYG  13 ATL   21 PIT   29 LA  (Rams)
 6 CLE  14 BAL   22 LAC   30 DEN
 7 WAS  15 TB    23 PHI   31 NE
 8 NO   16 IND   24 JAX   32 SEA
```

All 32 real teams, each exactly once. User reviewed and approved this list
before it was built into code.

- **File**: `src/lib/sim/sdfl-2026-draft-order.ts` —
  `SDFL_2026_ORIGINAL_DRAFT_ORDER` (the 32-team array above),
  `getOriginalDraftSlotForRealTeam()`, and
  `computeSdfl2026DraftOrder(supabase, leagueId)`: loads a league's
  franchise → real-team mapping (reuses `loadFranchiseRealTeamMap` from
  `sdfl-schedule.ts`), sorts franchises by their real team's original draft
  slot, returns userIds pick-1-first — same output shape as the existing
  `applyStandardDraftOrderMethod()` used by standard (non-SDFL) leagues, so
  it could later be dropped in as an alternative method for SDFL
  specifically. Franchises with no real-team mapping yet (identity not
  claimed) are appended at the end.
- Typechecked clean, not called from anywhere yet.

---

## Not done / open questions

1. **Run `scripts/seed-sim-nfl-2026-schedule.mjs` for real** when ready to
   have the 2026 schedule live in the DB.
2. **Apply migration 078** (`sim_sdfl_2026_pick_injury_map` table).
3. **Decide the actual cutover** for SDFL from 2024 mechanisms to 2026 ones
   — draft-order method, pick-injury-map seeding, and `CURRENT_SIM_SEASON`
   all need a deliberate switch-over plan (season flag on the league row?
   new leagues only? explicit per-league migration?). Not decided yet.
4. **Injury source decided: nflverse (same source as the 2024 data), NOT
   built yet.** Two candidates were checked:
   - **nflverse** (`injuries_2026.csv`, same release used by
     `scripts/seed-sim-nfl-2024.mjs`) — confirmed **does not exist yet**
     (404 as of this check). It only fills in once the real regular season
     starts and official weekly injury reports begin — same pattern as
     2024's data.
   - **ESPN's public injuries API** (`site.api.espn.com/apis/site/v2/sports/football/nfl/injuries`,
     free, no key) — confirmed live and updating right now (preseason,
     32 teams, 800 tracked players, real statuses/dates/reporter comments).
   - **User chose nflverse over ESPN**, specifically to avoid preseason
     roster-battle "questionable" noise muddying real season-impacting
     injuries — wait for the regular season and nflverse's official-report-
     based data, same trusted source/shape as 2024.
   - **Not buildable yet** — there's nothing to fetch until nflverse
     publishes `injuries_2026.csv`. When it exists, the fetch/parse pattern
     from `scripts/seed-sim-nfl-2024.mjs` (the `NFLVERSE.injuries` /
     `weeklyRosters` handling) is the template to reuse for a 2026 version,
     feeding into `sim_player_injuries` and the off-S&P fallback pool from
     item 3.
5. **`--max-rank` flag on `seed-sim-stock-player-map.mjs` was reverted** by
   a concurrent session (see item 2) — re-add if the script needs to be
   re-run for ranks above 384 again.
6. MLB/NBA/NHL have not been touched by any of this — still on their 2024,
   384-deep data, separate effort if/when needed.
