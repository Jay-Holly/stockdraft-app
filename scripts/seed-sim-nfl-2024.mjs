#!/usr/bin/env node
/**
 * Seed NFL 2024 sports-sim reference tables (sim_* only).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-sim-nfl-2024.mjs
 *
 * Requires data/nfl-top100-2024.csv (columns: rank,full_name,position,team).
 * Loads NEXT_PUBLIC_SUPABASE_URL from .env.local when present.
 *
 * Injury spans combine nflverse injuries_2024 (game-status Out) with
 * weekly_rosters reserve statuses (RES/INA/PUP/RSN). nflverse has no
 * dedicated 2024 transactions/IR placement log in the injuries release family.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SPORT = "nfl";
const SEASON = "2024";
const EDITORIAL_MAX_RANK = 100;
const TOTAL_RANKS = 384;
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);

const NFLVERSE = {
  injuries: `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${SEASON}.csv`,
  weeklyRosters: `https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${SEASON}.csv`,
  roster: `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${SEASON}.csv`,
  playerStats: `https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_reg_${SEASON}.csv`,
  schedules: `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv`,
};

/** Reserve / inactive designations from nflverse weekly_rosters (no dedicated transactions release). */
const IR_ROSTER_STATUSES = new Set(["RES", "INA", "PUP", "RSN"]);
const ROSTER_STATUS_PRIORITY = {
  RES: 4,
  RSN: 3,
  INA: 2,
  PUP: 2,
  ACT: 0,
  DEV: 0,
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
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || (char === "\r" && next === "\n")) {
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      if (char === "\r") i++;
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const record = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = (cells[i] ?? "").trim();
    }
    return record;
  });
}

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

function matchKey(fullName, team) {
  return `${normalizeDisplayName(fullName).toLowerCase()}|${(team ?? "").toUpperCase()}`;
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

async function fetchCsv(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return parseCsv(await res.text());
}

function readEditorialCsv() {
  const filePath = path.join(process.cwd(), "data", "nfl-top100-2024.csv");
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. Drop the NFL Top 100 CSV there (columns: rank,full_name,position,team).`
    );
  }
  return parseCsv(fs.readFileSync(filePath, "utf8"));
}

function buildRosterIndex(rosterRows) {
  /** @type {Map<string, { gsis_id: string, full_name: string, team: string, position: string }>} */
  const byKey = new Map();
  /** @type {Map<string, { gsis_id: string, full_name: string, team: string, position: string }>} */
  const byGsis = new Map();

  for (const row of rosterRows) {
    if (String(row.season) !== SEASON) continue;
    const team = row.team?.toUpperCase();
    const fullName = row.full_name?.trim();
    if (!team || !fullName) continue;

    const entry = {
      gsis_id: row.gsis_id,
      full_name: fullName,
      team,
      position: row.position?.toUpperCase() ?? "",
    };

    byKey.set(matchKey(fullName, team), entry);
    if (row.gsis_id) byGsis.set(row.gsis_id, entry);
  }

  return { byKey, byGsis };
}

function buildStatsIndex(statsRows) {
  return statsRows
    .filter((row) => String(row.season) === SEASON && row.season_type === "REG")
    .map((row) => ({
      gsis_id: row.player_id,
      full_name: row.player_display_name || row.player_name,
      team: row.recent_team?.toUpperCase(),
      position: row.position?.toUpperCase() ?? "",
      games: Number(row.games) || 0,
      fantasy_points_ppr: Number(row.fantasy_points_ppr) || 0,
    }))
    .filter((row) => row.gsis_id && row.team && row.full_name);
}

async function clearNfl2024SimData() {
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

function buildOutInjurySpans(weekRows) {
  const sorted = [...weekRows].sort(
    (a, b) => Number(a.week) - Number(b.week)
  );
  /** @type {Array<{ start_week: number, end_week: number, injury: string | null, status: string, games_missed: number }>} */
  const spans = [];
  let current = null;

  for (const row of sorted) {
    const status = (row.report_status ?? "").trim();
    const isOut = status.toLowerCase() === "out";
    const week = Number(row.week);

    if (!isOut || !Number.isFinite(week)) {
      if (current) {
        spans.push(current);
        current = null;
      }
      continue;
    }

    const injury = row.report_primary_injury?.trim() || null;
    if (!current) {
      current = {
        start_week: week,
        end_week: week,
        injury,
        status: "out",
        games_missed: 1,
      };
      continue;
    }

    if (week === current.end_week + 1) {
      current.end_week = week;
      current.games_missed += 1;
      if (!current.injury && injury) current.injury = injury;
    } else {
      spans.push(current);
      current = {
        start_week: week,
        end_week: week,
        injury,
        status: "out",
        games_missed: 1,
      };
    }
  }

  if (current) spans.push(current);
  return spans;
}

function pickPreferredRosterStatus(rows) {
  return rows
    .slice()
    .sort(
      (a, b) =>
        (ROSTER_STATUS_PRIORITY[b] ?? -1) - (ROSTER_STATUS_PRIORITY[a] ?? -1)
    )[0];
}

/**
 * Build IR spans from nflverse weekly_rosters status (RES/INA/PUP/RSN).
 * Bridges a one-week gap when that week is the team's bye (common when IR players
 * have no roster row during the bye).
 */
function buildWeeklyReserveSpans(weekStatusByWeek, byeWeek) {
  const weeks = [...weekStatusByWeek.keys()].sort((a, b) => a - b);
  /** @type {Array<{ start_week: number, end_week: number, injury: string | null, status: string, games_missed: number, source: string }>} */
  const spans = [];
  let current = null;

  for (const week of weeks) {
    const status = weekStatusByWeek.get(week);
    const isIr = IR_ROSTER_STATUSES.has(status);

    if (!isIr) {
      if (current) {
        spans.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = {
        start_week: week,
        end_week: week,
        injury: null,
        status: "ir",
        games_missed: 1,
        source: "nflverse/weekly_rosters_2024",
      };
      continue;
    }

    const gap = week - current.end_week;
    const bridgedBye = gap === 2 && byeWeek === current.end_week + 1;
    if (gap === 1 || bridgedBye) {
      current.end_week = week;
      current.games_missed += gap;
    } else {
      spans.push(current);
      current = {
        start_week: week,
        end_week: week,
        injury: null,
        status: "ir",
        games_missed: 1,
        source: "nflverse/weekly_rosters_2024",
      };
    }
  }

  if (current) spans.push(current);
  return spans;
}

function normalizeSpan(span) {
  return {
    start_week: span.start_week,
    end_week: span.end_week,
    injury: span.injury ?? null,
    status: span.status ?? "out",
    games_missed: span.end_week - span.start_week + 1,
    source: span.source ?? "unknown",
  };
}

/**
 * Merge overlapping/adjacent spans. Wider boundaries win; injury text prefers
 * game-status report labels when present.
 */
function mergeInjurySpanLists(spanLists) {
  const flat = spanLists.flat().map(normalizeSpan);
  if (flat.length === 0) return [];

  flat.sort((a, b) => a.start_week - b.start_week || a.end_week - b.end_week);

  /** @type {Array<ReturnType<typeof normalizeSpan>>} */
  const merged = [];
  let current = { ...flat[0] };

  for (let i = 1; i < flat.length; i++) {
    const next = flat[i];
    const overlapsOrAdjacent = next.start_week <= current.end_week + 1;

    if (!overlapsOrAdjacent) {
      merged.push(current);
      current = { ...next };
      continue;
    }

    const widerStart = Math.min(current.start_week, next.start_week);
    const widerEnd = Math.max(current.end_week, next.end_week);
    const injury =
      current.injury && next.injury
        ? current.injury
        : current.injury ?? next.injury;
    const sources = new Set(
      `${current.source}|${next.source}`
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean)
    );

    current = {
      start_week: widerStart,
      end_week: widerEnd,
      injury,
      status: sources.has("nflverse/weekly_rosters_2024") ? "ir" : current.status,
      games_missed: widerEnd - widerStart + 1,
      source: [...sources].sort().join("+"),
    };
  }

  merged.push(current);
  return merged;
}

function buildTeamByeWeekMap(allTeams, teamWeeks, allWeeks) {
  /** @type {Map<string, number | null>} */
  const byeWeekByTeam = new Map();
  for (const team of allTeams) {
    const played = teamWeeks.get(team) ?? new Set();
    const byeWeek = allWeeks.find((week) => !played.has(week)) ?? null;
    byeWeekByTeam.set(team, byeWeek);
  }
  return byeWeekByTeam;
}

async function main() {
  console.log(`Seeding sim_* tables for ${SPORT} ${SEASON}...\n`);

  const [editorialRows, rosterRows, statsRows, injuryRows, weeklyRosterRows, scheduleRows] =
    await Promise.all([
      Promise.resolve(readEditorialCsv()),
      fetchCsv(NFLVERSE.roster),
      fetchCsv(NFLVERSE.playerStats),
      fetchCsv(NFLVERSE.injuries),
      fetchCsv(NFLVERSE.weeklyRosters),
      fetchCsv(NFLVERSE.schedules),
    ]);

  const { byKey: rosterByKey, byGsis } = buildRosterIndex(rosterRows);
  const statsIndex = buildStatsIndex(statsRows);
  const usedPlayerIds = new Set();

  /** @type {Array<{ player_id: string, sport: string, season: string, full_name: string, display_name: string, position: string | null, real_team: string | null }>} */
  const simPlayers = [];
  /** @type {Array<{ player_id: string, rank: number, tier: string, rank_source: string }>} */
  const simRankings = [];
  /** @type {Map<string, string>} */
  const matchKeyToPlayerId = new Map();
  /** @type {string[]} */
  const editorialUnmatched = [];

  for (const row of editorialRows) {
    const rank = Number(row.rank);
    if (!Number.isFinite(rank) || rank < 1 || rank > EDITORIAL_MAX_RANK) continue;

    const fullName = row.full_name?.trim();
    const team = row.team?.trim().toUpperCase();
    const position = row.position?.trim().toUpperCase() || null;
    if (!fullName || !team) continue;

    const key = matchKey(fullName, team);
    const rosterHit = rosterByKey.get(key);
    if (!rosterHit) editorialUnmatched.push(`${rank}. ${fullName} (${team})`);

    const resolvedName = rosterHit?.full_name ?? fullName;
    const resolvedTeam = rosterHit?.team ?? team;
    const resolvedPosition = rosterHit?.position || position;
    const playerId = makePlayerId(resolvedName, resolvedTeam, usedPlayerIds);

    matchKeyToPlayerId.set(key, playerId);
    simPlayers.push({
      player_id: playerId,
      sport: SPORT,
      season: SEASON,
      full_name: resolvedName,
      display_name: normalizeDisplayName(resolvedName),
      position: resolvedPosition,
      real_team: resolvedTeam,
    });
    simRankings.push({
      player_id: playerId,
      rank,
      tier: "editorial",
      rank_source: "nfl-top100-2024",
    });
  }

  if (simPlayers.length !== EDITORIAL_MAX_RANK) {
    console.warn(
      `Warning: expected ${EDITORIAL_MAX_RANK} editorial rows, got ${simPlayers.length}.`
    );
  }

  const editorialKeys = new Set(matchKeyToPlayerId.keys());
  const editorialGsisIds = new Set();
  for (const row of editorialRows) {
    const fullName = row.full_name?.trim();
    const team = row.team?.trim().toUpperCase();
    if (!fullName || !team) continue;
    const hit = rosterByKey.get(matchKey(fullName, team));
    if (hit?.gsis_id) editorialGsisIds.add(hit.gsis_id);
  }

  const productionCandidates = statsIndex
    .filter(
      (row) =>
        SKILL_POSITIONS.has(row.position) &&
        row.games > 0 &&
        !editorialKeys.has(matchKey(row.full_name, row.team)) &&
        !editorialGsisIds.has(row.gsis_id)
    )
    .map((row) => ({
      ...row,
      fpg: row.fantasy_points_ppr / row.games,
      key: matchKey(row.full_name, row.team),
    }))
    .sort((a, b) => b.fpg - a.fpg);

  const productionNeeded = TOTAL_RANKS - simPlayers.length;
  const productionPicks = productionCandidates.slice(0, productionNeeded);
  const productionKeys = new Set();

  for (let i = 0; i < productionPicks.length; i++) {
    const pick = productionPicks[i];
    const rank = EDITORIAL_MAX_RANK + 1 + i;
    const rosterHit = rosterByKey.get(pick.key) ?? byGsis.get(pick.gsis_id);
    const fullName = rosterHit?.full_name ?? pick.full_name;
    const team = rosterHit?.team ?? pick.team;
    const position = rosterHit?.position || pick.position;
    const playerId = makePlayerId(fullName, team, usedPlayerIds);

    productionKeys.add(pick.key);
    matchKeyToPlayerId.set(pick.key, playerId);
    simPlayers.push({
      player_id: playerId,
      sport: SPORT,
      season: SEASON,
      full_name: fullName,
      display_name: normalizeDisplayName(fullName),
      position,
      real_team: team,
    });
    simRankings.push({
      player_id: playerId,
      rank,
      tier: "production",
      rank_source: "nflverse/stats_player_reg_2024:fppg",
    });
  }

  const regGames = scheduleRows.filter(
    (row) =>
      String(row.season) === SEASON &&
      row.game_type === "REG" &&
      row.home_score !== "" &&
      row.away_score !== ""
  );

  /** @type {Map<string, Set<number>>} */
  const teamWeeks = new Map();
  /** @type {Array<object>} */
  const gameResults = [];

  for (const game of regGames) {
    const week = Number(game.week);
    const home = game.home_team?.toUpperCase();
    const away = game.away_team?.toUpperCase();
    const homeScore = Number(game.home_score);
    const awayScore = Number(game.away_score);
    if (!home || !away || !Number.isFinite(week)) continue;

    for (const team of [home, away]) {
      if (!teamWeeks.has(team)) teamWeeks.set(team, new Set());
      teamWeeks.get(team).add(week);
    }

    let winningTeam = null;
    let losingTeam = null;
    if (homeScore > awayScore) {
      winningTeam = home;
      losingTeam = away;
    } else if (awayScore > homeScore) {
      winningTeam = away;
      losingTeam = home;
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
      home_score: Number.isFinite(homeScore) ? homeScore : null,
      away_score: Number.isFinite(awayScore) ? awayScore : null,
    });
  }

  const allWeeks = [...new Set(regGames.map((g) => Number(g.week)).filter(Number.isFinite))].sort(
    (a, b) => a - b
  );
  const allTeams = [...teamWeeks.keys()].sort();
  const byeWeekByTeam = buildTeamByeWeekMap(allTeams, teamWeeks, allWeeks);

  /** @type {Map<string, string>} */
  const playerTeamById = new Map(
    simPlayers.map((player) => [player.player_id, player.real_team])
  );
  /** @type {Map<string, string>} */
  const gsisToPlayerId = new Map();
  for (const [key, playerId] of matchKeyToPlayerId) {
    const rosterHit = rosterByKey.get(key);
    if (rosterHit?.gsis_id) gsisToPlayerId.set(rosterHit.gsis_id, playerId);
  }

  /** @type {Map<string, object[]>} */
  const injuriesByPlayerKey = new Map();
  let injuryRowsTotalReg = 0;
  let injuryRowsMatchedToSim = 0;
  let injuryRowsDiscarded = 0;

  for (const row of injuryRows) {
    if (String(row.season) !== SEASON || row.game_type !== "REG") continue;
    injuryRowsTotalReg++;

    const team = row.team?.toUpperCase();
    const fullName = row.full_name?.trim();
    if (!team || !fullName) {
      injuryRowsDiscarded++;
      continue;
    }

    const key = matchKey(fullName, team);
    if (!matchKeyToPlayerId.has(key)) {
      injuryRowsDiscarded++;
      continue;
    }

    injuryRowsMatchedToSim++;
    if (!injuriesByPlayerKey.has(key)) injuriesByPlayerKey.set(key, []);
    injuriesByPlayerKey.get(key).push(row);
  }

  /** @type {Map<string, Map<number, string>>} */
  const reserveWeekStatusByPlayer = new Map();
  let weeklyRosterRowsTotalReg = 0;
  let weeklyRosterRowsMatchedToSim = 0;
  let weeklyRosterRowsDiscarded = 0;

  for (const row of weeklyRosterRows) {
    if (String(row.season) !== SEASON || row.game_type !== "REG") continue;
    weeklyRosterRowsTotalReg++;

    const team = row.team?.toUpperCase();
    const week = Number(row.week);
    const status = (row.status ?? "").trim().toUpperCase();
    if (!team || !Number.isFinite(week) || !status) {
      weeklyRosterRowsDiscarded++;
      continue;
    }

    let playerId = row.gsis_id ? gsisToPlayerId.get(row.gsis_id) : null;
    if (!playerId) {
      const fullName = row.full_name?.trim();
      if (!fullName) {
        weeklyRosterRowsDiscarded++;
        continue;
      }
      const key = matchKey(fullName, team);
      if (!matchKeyToPlayerId.has(key)) {
        weeklyRosterRowsDiscarded++;
        continue;
      }
      playerId = matchKeyToPlayerId.get(key);
    }

    weeklyRosterRowsMatchedToSim++;
    if (!reserveWeekStatusByPlayer.has(playerId)) {
      reserveWeekStatusByPlayer.set(playerId, new Map());
    }
    const weekMap = reserveWeekStatusByPlayer.get(playerId);
    const existing = weekMap.get(week);
    weekMap.set(
      week,
      existing ? pickPreferredRosterStatus([existing, status]) : status
    );
  }

  /** @type {Map<string, object[]>} */
  const statusReportSpansByPlayer = new Map();
  let statusReportSpanCount = 0;

  for (const [key, rows] of injuriesByPlayerKey) {
    const playerId = matchKeyToPlayerId.get(key);
    const spans = buildOutInjurySpans(rows).map((span) => ({
      ...span,
      source: "nflverse/injuries_2024",
    }));
    if (spans.length === 0) continue;
    statusReportSpansByPlayer.set(playerId, spans);
    statusReportSpanCount += spans.length;
  }

  /** @type {Map<string, object[]>} */
  const reserveSpansByPlayer = new Map();
  let reserveSpanCount = 0;

  for (const [playerId, weekStatusByWeek] of reserveWeekStatusByPlayer) {
    const team = playerTeamById.get(playerId);
    const byeWeek = team ? (byeWeekByTeam.get(team) ?? null) : null;
    const spans = buildWeeklyReserveSpans(weekStatusByWeek, byeWeek);
    if (spans.length === 0) continue;
    reserveSpansByPlayer.set(playerId, spans);
    reserveSpanCount += spans.length;
  }

  /** @type {Array<object>} */
  const simInjuries = [];
  let injurySpansMerged = 0;
  let injurySpansNewFromReserve = 0;
  let injurySpansUnchanged = 0;
  let injurySpansExtended = 0;

  const injuryPlayerIds = new Set([
    ...statusReportSpansByPlayer.keys(),
    ...reserveSpansByPlayer.keys(),
  ]);

  for (const playerId of injuryPlayerIds) {
    const statusSpans = statusReportSpansByPlayer.get(playerId) ?? [];
    const reserveSpans = reserveSpansByPlayer.get(playerId) ?? [];

    if (reserveSpans.length === 0) {
      injurySpansUnchanged += statusSpans.length;
      for (const span of statusSpans) {
        simInjuries.push({
          player_id: playerId,
          start_week: span.start_week,
          end_week: span.end_week,
          start_date: null,
          end_date: null,
          injury: span.injury,
          status: span.status,
          games_missed: span.games_missed,
          source: span.source,
        });
      }
      continue;
    }

    if (statusSpans.length === 0) {
      injurySpansNewFromReserve += reserveSpans.length;
      for (const span of reserveSpans) {
        simInjuries.push({
          player_id: playerId,
          start_week: span.start_week,
          end_week: span.end_week,
          start_date: null,
          end_date: null,
          injury: span.injury,
          status: span.status,
          games_missed: span.games_missed,
          source: span.source,
        });
      }
      continue;
    }

    const preMergeCount = statusSpans.length + reserveSpans.length;
    const merged = mergeInjurySpanLists([statusSpans, reserveSpans]);
    injurySpansMerged += preMergeCount - merged.length;

    for (const span of merged) {
      const widerThanAnyStatus = statusSpans.some(
        (candidate) =>
          span.start_week <= candidate.start_week &&
          span.end_week >= candidate.end_week &&
          (span.start_week < candidate.start_week ||
            span.end_week > candidate.end_week)
      );
      if (widerThanAnyStatus) injurySpansExtended += 1;

      simInjuries.push({
        player_id: playerId,
        start_week: span.start_week,
        end_week: span.end_week,
        start_date: null,
        end_date: null,
        injury: span.injury,
        status: span.status,
        games_missed: span.games_missed,
        source: span.source,
      });
    }
  }

  const mccaffreyPlayerId = [...matchKeyToPlayerId.entries()].find(
    ([key]) => key.startsWith("christian mccaffrey|")
  )?.[1];

  /** @type {Array<object>} */
  const teamSchedules = [];
  for (const team of allTeams) {
    teamSchedules.push({
      sport: SPORT,
      season: SEASON,
      team,
      bye_week: byeWeekByTeam.get(team) ?? null,
      is_outdoor: null,
      stadium_lat: null,
      stadium_lng: null,
    });
  }

  console.log("Clearing existing NFL 2024 sim_* rows...");
  await clearNfl2024SimData();

  console.log("Inserting sim_players...");
  await insertBatched("sim_players", simPlayers);
  console.log("Inserting sim_player_rankings...");
  await insertBatched("sim_player_rankings", simRankings);
  console.log("Inserting sim_player_injuries...");
  if (simInjuries.length > 0) {
    await insertBatched("sim_player_injuries", simInjuries);
  }
  console.log("Inserting sim_team_schedule...");
  await insertBatched("sim_team_schedule", teamSchedules);
  console.log("Inserting sim_game_results...");
  await insertBatched("sim_game_results", gameResults);

  const editorialCount = simRankings.filter((r) => r.tier === "editorial").length;
  const productionCount = simRankings.filter((r) => r.tier === "production").length;
  const teamsWithBye = teamSchedules.filter((row) => row.bye_week != null).length;
  const mccaffreySpans = mccaffreyPlayerId
    ? simInjuries.filter((row) => row.player_id === mccaffreyPlayerId)
    : [];

  console.log("\n=== Seed summary ===");
  console.log(`Players: ${simPlayers.length} total (${editorialCount} editorial, ${productionCount} production)`);
  const playersWithOutSpans = new Set(simInjuries.map((r) => r.player_id)).size;
  console.log(
    `Injuries: ${simInjuries.length} spans for ${playersWithOutSpans} sim players`
  );
  console.log(
    `  Status report only (before enrichment): ${statusReportSpanCount} spans (${injuryRowsMatchedToSim}/${injuryRowsTotalReg} nflverse REG rows matched; ${injuryRowsDiscarded} discarded)`
  );
  console.log(
    `  Weekly roster IR spans: ${reserveSpanCount} raw spans (${weeklyRosterRowsMatchedToSim}/${weeklyRosterRowsTotalReg} REG rows matched; ${weeklyRosterRowsDiscarded} discarded)`
  );
  console.log(
    `  Merge: ${injurySpansMerged} spans merged, ${injurySpansNewFromReserve} reserve-only added, ${injurySpansUnchanged} status-only unchanged, ${injurySpansExtended} extended by reserve data`
  );
  if (mccaffreySpans.length > 0) {
    console.log("  Christian McCaffrey spans:");
    for (const span of mccaffreySpans) {
      console.log(
        `    Weeks ${span.start_week}–${span.end_week} (${span.status}, ${span.injury ?? "no label"}, source=${span.source})`
      );
    }
  } else {
    console.log("  Christian McCaffrey: no injury spans in sim_players set");
  }
  console.log(`Bye weeks: ${teamsWithBye}/${allTeams.length} teams set`);
  console.log(`Games: ${gameResults.length} regular-season results loaded`);

  if (editorialUnmatched.length > 0) {
    console.log("\n=== Editorial Top 100 — failed nflverse roster match ===");
    console.log(
      "Hand-fix these names/teams in data/nfl-top100-2024.csv (accents, suffixes, team abbrev):\n"
    );
    for (const line of editorialUnmatched) {
      console.log(`  ${line}`);
    }
  } else {
    console.log("\nEditorial Top 100: all names matched nflverse roster.");
  }

  if (productionPicks.length < productionNeeded) {
    console.warn(
      `\nWarning: only ${productionPicks.length} production players (wanted ${productionNeeded}).`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
