#!/usr/bin/env node
/**
 * Seed NHL sim_players / sim_player_rankings for this app's "2026" season
 * label from real 2025-26 NHL season totals (api.nhle.com).
 *
 * The 2026-27 NHL season (seasonId 20262027) has zero games played as of
 * this script's writing, so there is nothing to rank yet from the season
 * that's actually about to start. Real, just-completed 2025-26 stats
 * (seasonId 20252026) stand in as the ranking source instead — same shape
 * as seed-sim-nhl-2024.mjs, skaters ranked by points, goalies by a simple
 * fantasy formula. Re-run this once 2026-27 games are on the board to
 * refresh ranks from the actual current season.
 *
 * Rankings only — no injuries. sim_player_injuries is untouched; see
 * seed-sim-nhl-2024.mjs's header for why no free scriptable NHL injury
 * source exists yet.
 *
 * Usage:
 *   node scripts/seed-sim-nhl-2026.mjs [--dry-run]
 *
 * Loads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SPORT = "nhl";
const SEASON = "2026";
const NHL_STATS_SEASON_ID = "20252026";
const EDITORIAL_MAX_RANK = 100;
const TOTAL_RANKS = 384;
const RANK_SOURCE = "computed-2025-26-nhl-points";

const NHL_STATS_API = "https://api.nhle.com/stats/rest/en";

/** Simple fantasy weights for goalies, to put them on a comparable scale to skater points. */
const GOALIE_SCORING = {
  win: 2,
  save: 0.2,
  goalAgainst: -1,
  shutout: 3,
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1).replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));

const DRY_RUN = process.argv.includes("--dry-run");

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
      cayenneExp: `seasonId=${NHL_STATS_SEASON_ID} and gameTypeId=2`,
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

async function clearNhl2026SimData() {
  const { data: players, error: selectError } = await supabase
    .from("sim_players")
    .select("player_id")
    .eq("sport", SPORT)
    .eq("season", SEASON);

  if (selectError) throw selectError;

  const ids = (players ?? []).map((row) => row.player_id);
  if (ids.length === 0) return;

  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
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

async function insertBatched(table, rows, batchSize = 400) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function main() {
  console.log(
    `Seeding sim_* rows for ${SPORT} season="${SEASON}" from real ${NHL_STATS_SEASON_ID} NHL stats...\n`
  );

  console.log("Fetching api.nhle.com skater + goalie season summaries...");
  const [skaters, goalies] = await Promise.all([
    fetchAllPages("skater"),
    fetchAllPages("goalie"),
  ]);
  console.log(`  ${skaters.length} skaters, ${goalies.length} goalies`);

  const rankedCandidates = buildRankedCandidates(skaters, goalies);
  console.log(`  ${rankedCandidates.length} candidates with games played`);

  const top = rankedCandidates.slice(0, TOTAL_RANKS);
  if (top.length < TOTAL_RANKS) {
    console.warn(
      `Warning: only ${top.length} players available (wanted ${TOTAL_RANKS}).`
    );
  }

  const usedPlayerIds = new Set();
  /** @type {Array<object>} */
  const simPlayers = [];
  /** @type {Array<object>} */
  const simRankings = [];

  for (let i = 0; i < top.length; i++) {
    const pick = top[i];
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

  console.log(`Built ${simPlayers.length} players, rank 1-${simRankings.length}.`);
  console.log("Sample (first 5):");
  for (const row of simPlayers.slice(0, 5)) {
    console.log(`  ${row.full_name} (${row.position}, ${row.real_team})`);
  }
  console.log("Sample (last 5):");
  for (const row of simPlayers.slice(-5)) {
    console.log(`  ${row.full_name} (${row.position}, ${row.real_team})`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run set, not writing to the database.");
    return;
  }

  console.log(`\nClearing existing ${SPORT} ${SEASON} sim_* rows...`);
  await clearNhl2026SimData();

  console.log("Inserting sim_players...");
  await insertBatched("sim_players", simPlayers);
  console.log("Inserting sim_player_rankings...");
  await insertBatched("sim_player_rankings", simRankings);

  const editorialCount = simRankings.filter((r) => r.tier === "editorial").length;
  const productionCount = simRankings.filter((r) => r.tier === "production").length;
  const goalieCount = simPlayers.filter((p) => p.position === "G").length;

  console.log("\n=== Seed summary ===");
  console.log(
    `Players: ${simPlayers.length} ranked (${editorialCount} editorial ranks 1-${EDITORIAL_MAX_RANK}, ${productionCount} production ranks ${EDITORIAL_MAX_RANK + 1}-${TOTAL_RANKS}; ${goalieCount} goalies included)`
  );
  console.log(
    "Injuries: not seeded (no free scriptable NHL injury source found yet)."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
