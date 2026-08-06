#!/usr/bin/env node
/**
 * Seed sim_team_schedule / sim_game_results for NFL season 2026 — dates and
 * opponents only. Games haven't been played yet, so scores/winner/loser are
 * null for every row; that's expected, not a bug.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-sim-nfl-2026-schedule.mjs [--dry-run]
 *
 * Source: nflverse schedules release (games.csv), same source used for the
 * 2024 seed. Loads NEXT_PUBLIC_SUPABASE_URL from .env.local when present.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SPORT = "nfl";
const SEASON = "2026";
const SCHEDULE_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows[0];
  return rows.slice(1).map((cells) => {
    const record = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = (cells[i] ?? "").trim();
    }
    return record;
  });
}

async function fetchCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }
  return parseCsv(await res.text());
}

function buildTeamByeWeekMap(allTeams, teamWeeks, allWeeks) {
  const byeWeekByTeam = new Map();
  for (const team of allTeams) {
    const played = teamWeeks.get(team) ?? new Set();
    const byeWeek = allWeeks.find((week) => !played.has(week)) ?? null;
    byeWeekByTeam.set(team, byeWeek);
  }
  return byeWeekByTeam;
}

async function insertBatched(table, rows) {
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function clearNfl2026Schedule() {
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

async function main() {
  console.log(`Seeding sim_team_schedule / sim_game_results for ${SPORT} ${SEASON}...\n`);

  const scheduleRows = await fetchCsv(SCHEDULE_URL);

  const regGames = scheduleRows.filter(
    (row) => String(row.season) === SEASON && row.game_type === "REG"
  );

  if (regGames.length === 0) {
    console.error(`No REG season ${SEASON} rows found in nflverse schedule.`);
    process.exit(1);
  }

  const teamWeeks = new Map();
  const gameResults = [];

  for (const game of regGames) {
    const week = Number(game.week);
    const home = game.home_team?.toUpperCase();
    const away = game.away_team?.toUpperCase();
    if (!home || !away || !Number.isFinite(week)) continue;

    for (const team of [home, away]) {
      if (!teamWeeks.has(team)) teamWeeks.set(team, new Set());
      teamWeeks.get(team).add(week);
    }

    const homeScore = Number(game.home_score);
    const awayScore = Number(game.away_score);
    const hasScore = game.home_score !== "" && game.away_score !== "";

    let winningTeam = null;
    let losingTeam = null;
    if (hasScore) {
      if (homeScore > awayScore) {
        winningTeam = home;
        losingTeam = away;
      } else if (awayScore > homeScore) {
        winningTeam = away;
        losingTeam = home;
      }
    }

    gameResults.push({
      sport: SPORT,
      season: SEASON,
      week,
      game_date: game.gameday || null,
      home_team: home,
      away_team: away,
      winning_team: winningTeam,
      losing_team: losingTeam,
      home_score: hasScore ? homeScore : null,
      away_score: hasScore ? awayScore : null,
    });
  }

  const allWeeks = [...new Set(regGames.map((g) => Number(g.week)).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
  const allTeams = [...teamWeeks.keys()].sort();
  const byeWeekByTeam = buildTeamByeWeekMap(allTeams, teamWeeks, allWeeks);

  const teamSchedules = allTeams.map((team) => ({
    sport: SPORT,
    season: SEASON,
    team,
    bye_week: byeWeekByTeam.get(team) ?? null,
    is_outdoor: null,
    stadium_lat: null,
    stadium_lng: null,
  }));

  const playedCount = gameResults.filter((g) => g.home_score != null).length;

  console.log(`Built ${gameResults.length} games across ${allTeams.length} teams, weeks 1-${allWeeks.length}.`);
  console.log(`Games with a final score: ${playedCount} (expected 0 — 2026 season hasn't started).`);
  console.log(`Teams with a bye week found: ${teamSchedules.filter((t) => t.bye_week != null).length}/${allTeams.length}.`);

  if (DRY_RUN) {
    console.log("\n--dry-run set, not writing to the database.");
    return;
  }

  console.log(`\nClearing existing ${SPORT} ${SEASON} schedule/results...`);
  await clearNfl2026Schedule();

  console.log("Inserting sim_team_schedule...");
  await insertBatched("sim_team_schedule", teamSchedules);
  console.log("Inserting sim_game_results...");
  await insertBatched("sim_game_results", gameResults);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
