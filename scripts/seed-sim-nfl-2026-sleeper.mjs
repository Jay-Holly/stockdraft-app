#!/usr/bin/env node
/**
 * Seed NFL 2026 sim_players / sim_player_rankings from the Sleeper API.
 *
 * Rankings only — no injuries. A separate, real-time injury source will
 * populate sim_player_injuries later; this script does not touch that table.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-sim-nfl-2026-sleeper.mjs [--dry-run]
 *
 * Loads NEXT_PUBLIC_SUPABASE_URL from .env.local when present.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SPORT = "nfl";
const SEASON = "2026";
const TOTAL_RANKS = 600;
const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

// Sleeper team code -> this app's real_team convention. Only known mismatch
// so far: Rams (LAR here vs LA in sim_players). OAK is stale/retired data
// from Sleeper and is dropped, not aliased.
const TEAM_ALIAS = { LAR: "LA" };
const DROP_TEAMS = new Set(["OAK"]);

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

function makePlayerId(fullName, team, usedIds) {
  let base = `nfl-${SEASON}-${slugify(fullName)}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  const withTeam = `${base}-${(team ?? "unk").toLowerCase()}`;
  usedIds.add(withTeam);
  return withTeam;
}

async function fetchSleeperPlayers() {
  const res = await fetch(SLEEPER_PLAYERS_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sleeper fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function clearNfl2026Rankings() {
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

async function insertInChunks(table, rows) {
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function main() {
  console.log(`Seeding sim_players / sim_player_rankings for ${SPORT} ${SEASON} from Sleeper...\n`);

  const raw = await fetchSleeperPlayers();
  const usedPlayerIds = new Set();

  const candidates = Object.values(raw)
    .filter((p) => p.active === true)
    .filter((p) => typeof p.team === "string" && p.team && !DROP_TEAMS.has(p.team))
    .filter((p) => Number.isFinite(p.search_rank))
    .sort((a, b) => a.search_rank - b.search_rank)
    .slice(0, TOTAL_RANKS);

  if (candidates.length < TOTAL_RANKS) {
    console.warn(
      `Warning: only found ${candidates.length} fantasy-ranked active players, wanted ${TOTAL_RANKS}.`
    );
  }

  /** @type {Array<{ player_id: string, sport: string, season: string, full_name: string, display_name: string, position: string | null, real_team: string | null }>} */
  const simPlayers = [];
  /** @type {Array<{ player_id: string, rank: number, tier: string, rank_source: string }>} */
  const simRankings = [];

  candidates.forEach((p, index) => {
    const fullName = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (!fullName) return;

    const team = TEAM_ALIAS[p.team] ?? p.team;
    const playerId = makePlayerId(fullName, team, usedPlayerIds);
    const rank = index + 1;

    simPlayers.push({
      player_id: playerId,
      sport: SPORT,
      season: SEASON,
      full_name: fullName,
      display_name: normalizeDisplayName(fullName),
      position: p.position ?? null,
      real_team: team,
    });
    simRankings.push({
      player_id: playerId,
      rank,
      tier: "editorial",
      rank_source: "sleeper:search_rank",
    });
  });

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

  console.log(`\nClearing existing ${SPORT} ${SEASON} rankings...`);
  await clearNfl2026Rankings();

  console.log(`Inserting ${simPlayers.length} sim_players rows...`);
  await insertInChunks("sim_players", simPlayers);

  console.log(`Inserting ${simRankings.length} sim_player_rankings rows...`);
  await insertInChunks("sim_player_rankings", simRankings);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
