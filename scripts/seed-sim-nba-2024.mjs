#!/usr/bin/env node
/**
 * Seed NBA 2024-25 sports-sim reference tables (sim_* only).
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-sim-nba-2024.mjs
 *
 * All 384 ranks are computed from 2024-25 stats.nba.com season totals (no CSV),
 * ranked by the league's own EFF efficiency stat — same shape as
 * seed-sim-mlb-2024.mjs. Writes via SUPABASE_SERVICE_ROLE_KEY; only touches
 * sim_* rows for sport=nba, season=2024.
 *
 * No injury source: no free, scriptable, dated NBA injury-history feed was
 * found (live-status pages only, or Cloudflare-blocked historical sites like
 * Pro Sports Transactions / Basketball-Reference). sim_player_injuries is
 * intentionally left empty for nba, same as its current unseeded state —
 * IR eligibility checks simply never trigger until a real source is found.
 * sim_team_schedule / sim_game_results are also left empty: stats.nba.com's
 * game-log endpoints consistently timed out from this environment while the
 * leagueleaders endpoint did not.
 */

import { createClient } from "@supabase/supabase-js";

const SPORT = "nba";
const SEASON = "2024";
const NBA_SEASON_PARAM = "2024-25";
const EDITORIAL_MAX_RANK = 100;
const TOTAL_RANKS = 384;
const RANK_SOURCE = "computed-2024-25-nba-eff";

const NBA_STATS_API = "https://stats.nba.com/stats";
const NBA_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.nba.com/",
  Accept: "application/json",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
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
  let base = `nba-${SEASON}-${slugify(fullName)}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  const withTeam = `${base}-${(team ?? "unk").toLowerCase()}`;
  usedIds.add(withTeam);
  return withTeam;
}

async function fetchLeagueLeadersByEff() {
  const params = new URLSearchParams({
    LeagueID: "00",
    PerMode: "Totals",
    Scope: "S",
    Season: NBA_SEASON_PARAM,
    SeasonType: "Regular Season",
    StatCategory: "EFF",
  });

  const res = await fetch(`${NBA_STATS_API}/leagueleaders?${params}`, {
    headers: NBA_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch leagueleaders: HTTP ${res.status}`);
  }
  const data = await res.json();
  const resultSet = data.resultSet ?? data.resultSets?.[0];
  const headers = resultSet.headers;
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  return (resultSet.rowSet ?? [])
    .map((row) => ({
      person_id: row[idx.PLAYER_ID],
      full_name: row[idx.PLAYER],
      team: row[idx.TEAM],
      games_played: row[idx.GP],
      eff: row[idx.EFF],
    }))
    .filter((row) => row.games_played > 0 && row.full_name && row.team);
}

async function clearNba2024SimData() {
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
  console.log(`Seeding sim_* tables for ${SPORT} ${SEASON} (${NBA_SEASON_PARAM})...\n`);

  console.log("Fetching stats.nba.com league leaders (EFF, season totals)...");
  const rankedCandidates = (await fetchLeagueLeadersByEff()).sort(
    (a, b) => b.eff - a.eff
  );
  console.log(`  ${rankedCandidates.length} players with games played`);

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
      position: null,
      real_team: pick.team,
    });
    simRankings.push({
      player_id: playerId,
      rank,
      tier: tierForRank(rank),
      rank_source: RANK_SOURCE,
    });
  }

  console.log("Clearing existing NBA 2024 sim_* rows...");
  await clearNba2024SimData();

  console.log("Inserting sim_players...");
  await insertBatched("sim_players", simPlayers);
  console.log("Inserting sim_player_rankings...");
  await insertBatched("sim_player_rankings", simRankings);

  const editorialCount = simRankings.filter((r) => r.tier === "editorial").length;
  const productionCount = simRankings.filter((r) => r.tier === "production").length;

  console.log("\n=== Seed summary ===");
  console.log(
    `Players: ${simPlayers.length} ranked (both tiers from ${NBA_SEASON_PARAM} EFF: ${editorialCount} editorial ranks 1–100, ${productionCount} production ranks 101–384)`
  );
  console.log(
    "Injuries: not seeded (no free scriptable NBA injury-history source found)."
  );
  console.log(
    "Games/schedule: not seeded (stats.nba.com game-log endpoints timed out from this environment)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
