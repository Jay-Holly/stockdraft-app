# StockDraft — Session Handoff

Paste this file's path into a new chat and say "read HANDOFF.md and continue" —
everything needed to pick up cleanly is here.

## What this session was about

Getting all four sports-sim leagues (SDFL/NFL, SDLB/MLB, SDBA/NBA, SDHL/NHL)
onto equal footing — real player data, real schedules, a real map+identity
claim flow, and a from-scratch scoring/matchup design — then starting the
build. **The scoring/matchup engine itself is not built yet** — that's the
next big chunk of work.

## Done and verified live in the database this session

### 1. Real player rankings, all 4 sports, 384 deep
`sim_players` / `sim_player_rankings` for nfl/mlb/nba/nhl, season "2024" —
100 editorial (curated top-100) + 284 production (stats-based) ranks each.
- NFL: pre-existing, untouched.
- MLB: fixed a real bug in `scripts/seed-sim-mlb-2024.mjs` — the MLB StatsAPI
  stats endpoint's `team` object has no `abbreviation` field (only
  id/name/link), so every stat row was silently dropped and 0 players got
  ranked. Fixed by falling back to a `teamIdToAbbrev` map built from the
  `/teams` endpoint. Same bug existed a second time in the schedule-parsing
  code path — fixed the same way.
- NBA: new `scripts/seed-sim-nba-2024.mjs`, ranks by stats.nba.com's own EFF
  efficiency stat (season totals). `leagueleaders` endpoint works reliably;
  heavier endpoints (`leaguedashplayerstats`, `leaguegamelog`,
  `leaguedashteamstats`) consistently time out from this environment — avoid
  them, use `leagueleaders`.
- NHL: new `scripts/seed-sim-nhl-2024.mjs`, skaters ranked by points, goalies
  by a simple weighted formula (wins/saves/goals-against/shutouts), merged
  into one list. `api.nhle.com/stats/rest/en/{skater,goalie}/summary` works,
  paginate with `start`/`limit=100` (max page size, ignores larger `limit`
  values).

### 2. Injuries — real for NFL/MLB, borrowed for NBA/NHL
- NFL: 293 real spans (nflverse). MLB: 187 real spans (MLB StatsAPI IL
  transactions log).
- **NBA and NHL have no free, scriptable, dated injury-history source.**
  Checked extensively: live-status-only pages (ESPN/CBS/Yahoo/Daily Faceoff),
  team-aggregate-only blogs (NHL Injury Viz), and the one source that would
  have covered both (Pro Sports Transactions) is Cloudflare-challenge-blocked
  even through the real browser tool, not just curl/WebFetch.
- Per user's call: `scripts/borrow-mlb-injuries-for-nba-nhl.mjs` reuses MLB's
  187 real spans, split at the season midpoint (2024-06-27) — first-half
  spans (99) go to NBA, second-half (88) go to NHL, mapped onto the player
  at the **same `sim_player_rankings.rank`** in the target sport. Tagged
  `source: borrowed-from-mlb-2024:first-half` / `:second-half` so it's never
  mistaken for real data later. The `injury` text field literally carries
  the original MLB player/team names — intentional, left as an obvious
  "this is fake" signature.
- User explicitly wants real injuries to matter (it's the "luck of the
  draw" element that makes sports-sim leagues feel like real fantasy sports,
  as opposed to SDPL leagues) — this is flavor/risk, not currently gating
  anything mechanically.

### 3. Stock↔player rank map, all 4 sports
`sim_stock_player_map` (384 rows each, nfl/mlb/nba/nhl) — maps a drafted
stock's S&P 500 market-cap rank to the athlete at the same rank, via
`scripts/seed-sim-stock-player-map.mjs`. Previously hardcoded to refuse
anything but `--sport nfl` even though the table and all sports-sim leagues
already share one draft_pool — that guard was just never extended. Relaxed
to accept nfl/mlb/nba/nhl; ran for all three new sports.

### 4. Real schedules, all 4 sports (not results — just dates/opponents)
`sim_team_schedule` / `sim_game_results`, season "2024":
- NFL 272 games / 32 teams (pre-existing).
- MLB 2469 games / 30 teams — same abbreviation bug as above, fixed.
- NBA 1236 games / 30 teams — new `scripts/seed-sim-schedule-espn.mjs`,
  pulls `site.api.espn.com/apis/site/v2/sports/{sport}/scoreboard?dates=YYYYMMDD`
  day-by-day across the real season. Had to filter out NBA All-Star Weekend
  draft "teams" (CAN/CHK/KEN/SHQ) and alias GS→GSW, NO→NOP, NY→NYK, SA→SAS,
  UTAH→UTA, WSH→WAS to match `sim_players.real_team`.
- NHL 1331 games / 32 teams — same script. Had to filter out 4 Nations
  Face-Off national teams (CAN/FIN/SWE/USA) and alias LA→LAK, NJ→NJD,
  SJ→SJS, TB→TBL, UTAH→UTA.
- **Important**: winner/score fields are stored (free from the same API
  response) but are NOT authoritative for fantasy purposes — per user's
  explicit call, the real game's result is irrelevant; only which two real
  teams played and on what date matters, for generating fantasy matchup
  pairing/structure.

### 5. Franchise map images replaced + city/team/color identity built for all 4
- User provided 4 finished map graphics (title + every city dot baked in) at
  `~/Desktop/STOCK DRAFT/Sports Sim League Maps/*.png` — copied into
  `public/images/league/{sdfl,sdba,sdhl,sdlb}-map.png`. The app had been
  using a blank state-outline PNG with dynamically-positioned dots instead
  (that's why Baltimore's visibility was never confirmed — wrong background
  entirely, not a coordinate bug).
- Built a dot-auto-detection pipeline (Python, color-threshold + connected-
  components + circularity filter) to get precise pixel coordinates per
  marker per image rather than eyeballing — scripts are in the scratchpad,
  not committed (ad-hoc tooling, not part of the app).
- **Only got as far as SDFL's coordinates fully verified** (34→32 dedup: two
  false positives were a stray "M" glyph from the Minneapolis label and a
  split Miami dot). SDBA/SDHL/SDLB marker coordinates were NOT finished —
  see "Not done" below.
- Built full city/team-name/color identity parity for SDBA/SDHL/SDLB,
  matching what SDFL already had (SDFL itself has NO logo generation — just
  an unused DB column — so logos were explicitly descoped for all 4):
  - Migration `064_generic_league_map_franchise_identity.sql` — added
    `franchise_city`, `team_name`, `franchise_colors`, `identity_completed_at`
    to `league_map_slot_claims`. Applied live.
  - `src/lib/league/generic-franchise-validation.ts` — real blocked-nickname
    lists (NBA 30, NHL 32, MLB 30) mirroring SDFL's NFL-nickname block.
  - `src/lib/league/generic-team-map.ts` — added
    `submitGenericFranchiseIdentity`, expanded payload with `myIdentity`.
  - `src/app/api/leagues/[id]/team-map/route.ts` — added PATCH handler.
  - `src/components/league/GenericTeamMapForm.tsx` — rebuilt to mirror
    `SdflIdentityForm.tsx`'s two-step flow (claim → city/name/colors).
  - `tsc --noEmit` clean.

### 6. Standings page (new)
`loadStandingSeeds` / `sortStandingsForSeeding` already existed (used
internally for playoff seeding) but had **never been rendered anywhere** —
no standings UI existed at all before this. Built:
- `src/components/season/StandingsPageContent.tsx` — real wins/losses/
  season-gain% table, sorted the same way playoff seeding sorts.
- `src/app/standings/page.tsx` — was a stub that just redirected to
  `/league`; now a real page following the same pattern as `awards/page.tsx`.
- Added "Standings" to the shared tab bubble in
  `src/components/season/SeasonShell.tsx` (appears on every league page —
  user was explicit this should NOT be a dashboard link).

## Full scoring/matchup design, agreed but NOT YET BUILT

This is the big remaining piece. Every decision below was explicitly
confirmed with the user across a long back-and-forth — do not re-litigate,
just build it.

- **Roster**: 5 stock + 5 crypto + 3 shared "stash" slots (13 total,
  matches the existing `SPORTS_SIM_*` draft-constants: 10 starters + 3
  bench, so the draft engine's round structure may already fit — needs
  verification, see below). Stash slots hold anything, no injury
  verification required to use one (injuries are flavor, not a gate).
- **No IR eligibility gating** — explicitly dropped in favor of open
  anytime free agency + stash. This conveniently sidesteps the NBA/NHL
  real-injury-data gap (which doesn't exist anyway, see above), but it was
  a deliberate simplification, not a workaround — don't reintroduce IR
  gating.
- **Real-schedule-mirroring matchups** (this is the part that needs actual
  engineering): claim a real city → inherit that real team's actual
  2024/24-25 game-by-game schedule. The **real result is irrelevant** —
  fantasy manager portfolio performance decides who wins each matchup, the
  real schedule only supplies who-plays-whom-and-when.
  - **MLB**: real 3-4 game series stay grouped as series in the regular
    season (win the series = win more individual games within it, need to
    define exact series-win semantics).
  - **NBA/NHL regular season**: opponent changes day-to-day exactly as the
    real 2024-25 schedule did (no repeated series until playoffs) — i.e.
    near-daily matchup cadence, NOT the uniform weekly cadence that was
    discussed earlier and then superseded by this real-schedule approach.
  - **NFL**: already works this way (existing `generateSportsSimRegularSeasonSchedule`
    in `src/lib/matchup/sdfl-schedule.ts` — one real game per week including
    byes). This is the pattern to generalize to the other 3 sports.
  - **Playoffs, all sports**: once the real regular season ends, switch to
    best-of-series brackets matching the real round's length — best-of-3
    (first to 2), best-of-5 (first to 3), best-of-7 (first to 4). MLB/NBA/NHL
    playoff bracket structure needs mapping to each sport's actual 2024/24-25
    playoff format.
  - **Ties stand as ties** (regular season) — no tiebreaker mechanic wanted.
- **Scoring windows** (stocks vs. crypto, within whatever matchup cadence
  the schedule produces):
  - Stocks: Mon 9:30am – Fri 4:30pm (market hours).
  - Crypto: Fri 4:30pm – Mon 6:00am (weekend + off-hours).
  - Pure percentage-gain scoring, no dollar weighting (normalizes a $500
    stock's small move against a $50 stock's move). Same $5 price floor
    that already exists elsewhere in the app should apply here too (avoid
    penny-stock noise inflating % gains) — not yet confirmed this is wired
    in for these leagues specifically.
- **Free-agent moves**:
  - Crypto: anytime, no restriction (same as other league types already
    work).
  - Stock: **only** unlocked 4:30pm–9:30am Monday–Friday (i.e. outside
    market hours) — locked during the 9:30am-4:30pm window so nobody can
    react mid-session to a live price move.
  - **Sector-match required** when swapping a stock: must pick up from the
    same sector you're dropping from. The sector categorization already
    exists (`src/lib/draft/pool-meta.ts`, AI/Tech/EV/Media/Space/Crypto) but
    is NOT currently enforced anywhere in the real FA/waiver code
    (`src/lib/roster/moves.ts` `applyWaiverClaim` has zero sector
    restriction today) — this needs new enforcement logic, gated to just
    these 3 leagues (or maybe all sports-sim leagues incl. SDFL — wasn't
    explicitly discussed for SDFL, worth asking).
  - `applyWaiverClaim` currently runs through `enforceSportsSimIrMoveAllowed`
    (an IR gate) — since IR is being dropped for these 3 sports, this gate
    needs to either bypass for sdba/sdhl/sdlb specifically or be
    reconsidered generally.
  - Whether SDFL/SDLB/SDBA/SDHL already has (or needs) a dedicated
    free-agent picking **page/UI** wasn't confirmed — user said "use what
    we already have built," implying reuse of an existing FA page, but
    that page hasn't been located/verified in this session. Check
    `src/app/free-agents/page.tsx` (referenced in `SeasonShell` LINKS) next.

## Concrete next steps, roughly in dependency order

1. **Find/verify the existing free-agent page** (`/free-agents`) and
   whether it already works for sports-sim leagues or needs adapting.
2. **Build sector-match enforcement** in the waiver-claim path, scoped to
   sdba/sdhl/sdlb (confirm with user whether sdfl should get this too).
3. **Build the stock-move time-lock** (block waiver claims on stock symbols
   during 9:30am–4:30pm weekday market hours for these 3 leagues).
4. **Bypass/rework the IR gate** in `applyWaiverClaim` for sdba/sdhl/sdlb.
5. **Verify the roster-slot shape** actually matches 5 stock + 5 crypto + 3
   stash — check whether `SPORTS_SIM_BENCH_ROUNDS = 3` /
   `SPORTS_SIM_STARTER_ROUNDS = 10` in `src/lib/draft/draft-constants.ts`
   already produces this split (10 starters presumably needs to be 5+5
   stock/crypto specifically, not just "10 of either") or needs adjusting.
6. **Generalize `generateSportsSimRegularSeasonSchedule`** (currently
   NFL-only, mirrors real week-by-week schedule 1:1) to MLB/NBA/NHL using
   the new `sim_game_results` data — this is the biggest single piece of
   remaining work. Needs: per-sport series-grouping (MLB), day-by-day
   pairing (NBA/NHL), and a playoff-format switch once each sport's real
   regular season ends.
7. **Build the actual weekday-stock/weekend-crypto scoring window logic**
   and wire it into whatever this new schedule/matchup engine produces.
8. **Finish SDBA/SDHL/SDLB map marker coordinates** — only SDFL's were
   verified against the new image. The dot-detection script pattern is
   proven; just needs re-running per image + visual spot-check + updating
   `src/lib/league/sdba-team-map-coords.ts` / `sdhl-...` / `sdlb-...`
   (confirm these files exist/match the new image dimensions — they were
   likely built against the old placeholder coordinate space).

## Also still open from before this session (untouched, lower priority)

- SDFL franchise map: "circles should be solid not hollow when unclaimed" —
  this looked resolved by the new baked-in-dot images, but worth a final
  visual confirmation once the map form is wired to the new images end to end.
- Document the $/% matchup tiebreaker rule on the actual rules page.
- Week-1 lineup bug — shows a swapped-in crypto retroactively (needs
  symbol-per-week schema change, `src/lib/roster/weekly.ts` /
  `src/lib/roster/moves.ts`).
- Full scoring-call-site consolidation (~8 scattered places computing team
  value — see prior handoff, not touched this session).
- Day Trader portfolio math / awards-pool cross-page consistency — never
  audited.
- stkdraft.com naming/copyright discussion — paused, user wants to lead it.

## Operational notes (carried forward, still apply)

- **Deploy pattern**: never `git add -A` — working tree is shared with other
  background sessions. Deploy via clean `git archive HEAD | tar -x -C
  <tmpdir>` snapshot, never directly from this working directory.
- **DB write gate**: production Supabase writes via raw REST scripts get
  blocked by an auto-mode classifier unless the user names the exact
  table/action explicitly. Always dry-run first, show exact numbers.
- **cwd drift**: Bash tool cwd occasionally resets to `/Users/jaymacbook` —
  always `cd ~/Desktop/stockdraft-no-modules` defensively if something 404s.
- Port 3000 was held by another concurrent chat session's dev server for
  most of this session — verification had to rely on `tsc --noEmit` instead
  of a live click-through for the map/identity changes. Worth a real
  browser pass once a port is free.
- Never claim "done" without commit hash + push confirmation + verified
  live-in-DB counts (this session verified everything against the live
  database directly, not just script logs — keep doing that).
