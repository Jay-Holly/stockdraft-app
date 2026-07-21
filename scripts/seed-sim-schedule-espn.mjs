#!/usr/bin/env node
/**
 * Seed sim_team_schedule + sim_game_results for nba/nhl 2024-25 from ESPN's
 * scoreboard API (site.api.espn.com), one date at a time across the real
 * regular season. Fantasy scoring never uses the winner/score fields here —
 * only game_date + home/away team pairing matters, to drive real-schedule
 * matchup generation. Winner/score are still stored since the schema has
 * the columns and they're free from the same response, but nothing in the
 * sports-sim design should read them as authoritative.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-sim-schedule-espn.mjs --sport nba
 *   node --env-file=.env.local scripts/seed-sim-schedule-espn.mjs --sport nhl
 */

import { createClient } from "@supabase/supabase-js";

const SEASON = "2024";

const SPORT_CONFIG = {
  nba: {
    espnPath: "basketball/nba",
    startDate: "2024-10-22",
    endDate: "2025-04-13",
    // ESPN scoreboard abbrevs -> sim_players.real_team abbrevs (from stats.nba.com).
    teamAliases: {
      GS: "GSW",
      NO: "NOP",
      NY: "NYK",
      SA: "SAS",
      UTAH: "UTA",
      WSH: "WAS",
    },
    // NBA All-Star Weekend draft "teams" — not real franchises, must be dropped.
    excludeTeams: new Set(["CAN", "CHK", "KEN", "SHQ"]),
  },
  nhl: {
    espnPath: "hockey/nhl",
    startDate: "2024-10-04",
    endDate: "2025-04-17",
    // ESPN scoreboard abbrevs -> sim_players.real_team abbrevs (from api.nhle.com).
    teamAliases: {
      LA: "LAK",
      NJ: "NJD",
      SJ: "SJS",
      TB: "TBL",
      UTAH: "UTA",
    },
    // 4 Nations Face-Off (Feb 2025) national teams — not real NHL franchises.
    excludeTeams: new Set(["CAN", "FIN", "SWE", "USA"]),
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  let sport = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sport" && args[i + 1]) sport = args[++i].toLowerCase();
  }
  if (!sport || !SPORT_CONFIG[sport]) {
    console.error("Usage: --sport nba|nhl");
    process.exit(1);
  }
  return sport;
}

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

function dateRange(startIso, endIso) {
  const dates = [];
  const cur = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    dates.push(`${y}${m}${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function fetchDay(espnPath, yyyymmdd) {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/scoreboard?dates=${yyyymmdd}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`ESPN scoreboard fetch failed for ${yyyymmdd}: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.events ?? [];
}

async function clearSimData(sport) {
  const { error: schedErr } = await supabase
    .from("sim_team_schedule")
    .delete()
    .eq("sport", sport)
    .eq("season", SEASON);
  if (schedErr) throw schedErr;

  const { error: gameErr } = await supabase
    .from("sim_game_results")
    .delete()
    .eq("sport", sport)
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

function normalizeTeam(raw, aliases, excludeTeams) {
  const upper = (raw ?? "").toUpperCase();
  if (excludeTeams.has(upper)) return null;
  return aliases[upper] ?? upper;
}

async function main() {
  const sport = parseArgs();
  const { espnPath, startDate, endDate, teamAliases, excludeTeams } = SPORT_CONFIG[sport];
  const dates = dateRange(startDate, endDate);

  console.log(
    `Fetching ${sport} schedule from ESPN (${startDate} to ${endDate}, ${dates.length} days)...`
  );

  const gameResults = [];
  const teamDates = new Map();
  let daysWithGames = 0;
  let failedDays = 0;

  for (let i = 0; i < dates.length; i++) {
    const yyyymmdd = dates[i];
    // ESPN's dates=YYYYMMDD query already buckets games by the correct real
    // day (confirmed live: dates=20241214 returns that evening's games even
    // though their own event.date UTC timestamp reads 2024-12-15Txx:00Z for
    // 7pm+ ET starts). Deriving game_date from event.date instead of the
    // query day it was fetched under shifted every evening game forward by
    // one UTC day, colliding with the real next day's slate.
    const queryDateIso = `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
    let events;
    try {
      events = await fetchDay(espnPath, yyyymmdd);
    } catch (err) {
      failedDays++;
      console.warn(`  ${yyyymmdd}: ${err.message}`);
      continue;
    }

    if (events.length > 0) daysWithGames++;

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      // ESPN's dates=X scoreboard returns every game on that calendar day
      // regardless of season type — near the season boundary that includes
      // trailing preseason games (e.g. an Oct 4 2024 Lightning-Hurricanes
      // preseason game shows up alongside real regular-season games on the
      // same date). Only season.type 2 ("regular-season") belongs in the
      // real schedule.
      if (event.season?.type !== 2) continue;

      // Of the NBA's In-Season Tournament rounds, only the Championship
      // game itself is a true extra (83rd) game for the two finalists,
      // excluded from both teams' records — verified against Wikipedia's
      // official per-team game log, where the Championship row is marked
      // "Cup" with no record entry while the Quarterfinal/Semifinal rows
      // are numbered and DO increment the record (they replace a normal
      // schedule slot rather than adding to it, unlike the Championship).
      const noteHeadlines = (comp.notes ?? [])
        .map((note) => note.headline ?? "")
        .join(" ");
      if (/NBA Cup Championship/i.test(noteHeadlines)) {
        continue;
      }

      // A postponed game (e.g. the Jan 2025 LA wildfires) still appears as
      // its own entry on the originally-scheduled date, in addition to the
      // real makeup game on its rescheduled date — counting both doubles
      // that matchup for both teams.
      if (comp.status?.type?.name === "STATUS_POSTPONED") continue;

      const competitors = comp.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      if (!home || !away) continue;

      const homeAbbrev = normalizeTeam(home.team?.abbreviation, teamAliases, excludeTeams);
      const awayAbbrev = normalizeTeam(away.team?.abbreviation, teamAliases, excludeTeams);
      if (!homeAbbrev || !awayAbbrev) continue;

      const gameDate = queryDateIso;

      for (const team of [homeAbbrev, awayAbbrev]) {
        if (!teamDates.has(team)) teamDates.set(team, []);
        teamDates.get(team).push(gameDate);
      }

      const isFinal = comp.status?.type?.completed === true;
      const homeScore = Number(home.score);
      const awayScore = Number(away.score);
      let winningTeam = null;
      let losingTeam = null;
      if (isFinal && Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
        if (homeScore > awayScore) {
          winningTeam = homeAbbrev;
          losingTeam = awayAbbrev;
        } else if (awayScore > homeScore) {
          winningTeam = awayAbbrev;
          losingTeam = homeAbbrev;
        }
      }

      gameResults.push({
        sport,
        season: SEASON,
        week: null,
        game_date: gameDate,
        home_team: homeAbbrev,
        away_team: awayAbbrev,
        winning_team: winningTeam,
        losing_team: losingTeam,
        home_score: Number.isFinite(homeScore) ? homeScore : null,
        away_score: Number.isFinite(awayScore) ? awayScore : null,
      });
    }
  }

  const teamSchedules = [...teamDates.keys()].sort().map((team) => ({
    sport,
    season: SEASON,
    team,
    bye_week: null,
    is_outdoor: null,
    stadium_lat: null,
    stadium_lng: null,
  }));

  console.log(`Clearing existing ${sport} 2024 sim_team_schedule / sim_game_results...`);
  await clearSimData(sport);

  console.log(`Inserting ${teamSchedules.length} sim_team_schedule rows...`);
  if (teamSchedules.length > 0) await insertBatched("sim_team_schedule", teamSchedules);

  console.log(`Inserting ${gameResults.length} sim_game_results rows...`);
  if (gameResults.length > 0) await insertBatched("sim_game_results", gameResults);

  console.log("\n=== Summary ===");
  console.log(`Days scanned: ${dates.length} (${daysWithGames} had games, ${failedDays} fetch failures)`);
  console.log(`Teams: ${teamSchedules.length}`);
  console.log(`Games: ${gameResults.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
