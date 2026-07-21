#!/usr/bin/env node
/**
 * Seed NHL 2024-25 sports-sim reference tables (sim_* only).
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-sim-nhl-2024.mjs
 *
 * All 384 ranks are computed from 2024-25 api.nhle.com season totals (no CSV) —
 * skaters ranked by points, goalies by a simple fantasy formula, merged into
 * one list. Same shape as seed-sim-mlb-2024.mjs / seed-sim-nba-2024.mjs.
 * Writes via SUPABASE_SERVICE_ROLE_KEY; only touches sim_* rows for
 * sport=nhl, season=2024.
 *
 * No injury source: no free, scriptable, dated NHL injury-history feed was
 * found (live-status pages only, team-aggregate blogs, or Cloudflare-blocked
 * historical sites like Pro Sports Transactions / Hockey-Reference).
 * sim_player_injuries is intentionally left empty for nhl, same as its
 * current unseeded state — IR eligibility checks simply never trigger until
 * a real source is found. sim_team_schedule / sim_game_results are also left
 * empty: a full-season NHL schedule pull would require per-day pagination
 * this script doesn't attempt yet.
 */

import { createClient } from "@supabase/supabase-js";

const SPORT = "nhl";
const SEASON = "2024";
const NHL_SEASON_ID = "20242025";
const EDITORIAL_MAX_RANK = 100;
const TOTAL_RANKS = 384;
const RANK_SOURCE = "computed-2024-25-nhl-points";

const NHL_STATS_API = "https://api.nhle.com/stats/rest/en";

/** Simple fantasy weights for goalies, to put them on a comparable scale to skater points. */
const GOALIE_SCORING = {
  win: 2,
  save: 0.2,
  goalAgainst: -1,
  shutout: 3,
};

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizeDisplayName(fullName) {
  return fullName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "")
    .trim();
}

function slugify(fullName) {
  return normalizeDisplayName(fullName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tierForRank(rank) {
  return rank <= EDITORIAL_MAX_RANK ? "editorial" : "production";
}

function makePlayerId(fullName, team, usedIds) {
  let base = `nhl-${SEASON}-${slugify(fullName)}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  const withTeam = `${base}-${(team ?? "unk").toLowerCase()}`;
  usedIds.add(withTeam);
  return withTeam;
}

async function fetchAllPages(group) {
  const pageSize = 100;
  let start = 0;
  let total = Infinity;
  /** @type {object[]} */
  const rows = [];

  while (start < total) {
    const params = new URLSearchParams({
      limit: String(pageSize),
      start: String(start),
      cayenneExp: `seasonId=${NHL_SEASON_ID} and gameTypeId=2`,
    });
    const res = await fetch(`${NHL_STATS_API}/${group}/summary?${params}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${group} summary: HTTP ${res.status}`);
    }
    const data = await res.json();
    total = data.total ?? rows.length;
    const page = data.data ?? [];
    rows.push(...page);
    start += page.length;
    if (page.length === 0) break;
  }

  return rows;
}

function normalizeTeam(teamAbbrevs) {
  // Traded players can carry multiple comma-separated team abbrevs; keep the most recent.
  return (teamAbbrevs ?? "").split(",").pop()?.trim() || null;
}

function buildRankedCandidates(skaters, goalies) {
  const skaterCandidates = skaters
    .filter((row) => row.gamesPlayed > 0 && row.skaterFullName)
    .map((row) => ({
      full_name: row.skaterFullName,
      team: normalizeTeam(row.teamAbbrevs),
      position: row.positionCode ?? null,
      score: row.points ?? 0,
    }));

  const goalieCandidates = goalies
    .filter((row) => row.gamesPlayed > 0 && row.goalieFullName)
    .map((row) => ({
      full_name: row.goalieFullName,
      team: normalizeTeam(row.teamAbbrevs),
      position: "G",
      score:
        (row.wins ?? 0) * GOALIE_SCORING.win +
        (row.saves ?? 0) * GOALIE_SCORING.save +
        (row.goalsAgainst ?? 0) * GOALIE_SCORING.goalAgainst +
        (row.shutouts ?? 0) * GOALIE_SCORING.shutout,
    }));

  return [...skaterCandidates, ...goalieCandidates]
    .filter((row) => row.team)
    .sort((a, b) => b.score - a.score);
}

async function clearNhl2024SimData() {
  const { data: players, error: selectError } = await supabase
    .from("sim_players")
    .select("player_id")
    .eq("sport", SPORT)
    .eq("season", SEASON);

  if (selectError) throw selectError;

  const ids = (players ?? []).map((row) => row.player_id);
  if (ids.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error: injErr } = await supabase
        .from("sim_player_injuries")
        .delete()
        .in("player_id", chunk);
      if (injErr) throw injErr;
      const { error: rankErr } = await supabase
        .from("sim_player_rankings")
        .delete()
        .in("player_id", chunk);
      if (rankErr) throw rankErr;
    }
    const { error: playerErr } = await supabase
      .from("sim_players")
      .delete()
      .in("player_id", ids);
    if (playerErr) throw playerErr;
  }

  const { error: schedErr } = await supabase
    .from("sim_team_schedule")
    .delete()
    .eq("sport", SPORT)
    .eq("season", SEASON);
  if (schedErr) throw schedErr;

  const { error: gameErr } = await supabase
    .from("sim_game_results")
    .delete()
    .eq("sport", SPORT)
    .eq("season", SEASON);
  if (gameErr) throw gameErr;
}

async function insertBatched(table, rows, batchSize = 400) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

async function main() {
  console.log(`Seeding sim_* tables for ${SPORT} ${SEASON} (${NHL_SEASON_ID})...\n`);

  console.log("Fetching api.nhle.com skater + goalie season summaries...");
  const [skaters, goalies] = await Promise.all([
    fetchAllPages("skater"),
    fetchAllPages("goalie"),
  ]);
  console.log(`  ${skaters.length} skaters, ${goalies.length} goalies`);

  const rankedCandidates = buildRankedCandidates(skaters, goalies);
  console.log(`  ${rankedCandidates.length} candidates with games played`);

  const top384 = rankedCandidates.slice(0, TOTAL_RANKS);
  if (top384.length < TOTAL_RANKS) {
    console.warn(
      `Warning: only ${top384.length} players available (wanted ${TOTAL_RANKS}).`
    );
  }

  const usedPlayerIds = new Set();
  /** @type {Array<object>} */
  const simPlayers = [];
  /** @type {Array<object>} */
  const simRankings = [];

  for (let i = 0; i < top384.length; i++) {
    const pick = top384[i];
    const rank = i + 1;
    const playerId = makePlayerId(pick.full_name, pick.team, usedPlayerIds);

    simPlayers.push({
      player_id: playerId,
      sport: SPORT,
      season: SEASON,
      full_name: pick.full_name,
      display_name: normalizeDisplayName(pick.full_name),
      position: pick.position,
      real_team: pick.team,
    });
    simRankings.push({
      player_id: playerId,
      rank,
      tier: tierForRank(rank),
      rank_source: RANK_SOURCE,
    });
  }

  console.log("Clearing existing NHL 2024 sim_* rows...");
  await clearNhl2024SimData();

  console.log("Inserting sim_players...");
  await insertBatched("sim_players", simPlayers);
  console.log("Inserting sim_player_rankings...");
  await insertBatched("sim_player_rankings", simRankings);

  const editorialCount = simRankings.filter((r) => r.tier === "editorial").length;
  const productionCount = simRankings.filter((r) => r.tier === "production").length;
  const goalieCount = simPlayers.filter((p) => p.position === "G").length;

  console.log("\n=== Seed summary ===");
  console.log(
    `Players: ${simPlayers.length} ranked (${editorialCount} editorial ranks 1–100, ${productionCount} production ranks 101–384; ${goalieCount} goalies included)`
  );
  console.log(
    "Injuries: not seeded (no free scriptable NHL injury-history source found)."
  );
  console.log(
    "Games/schedule: not seeded (full-season pull not attempted yet)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
