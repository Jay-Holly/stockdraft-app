#!/usr/bin/env node
/**
 * Seed MLB 2024 sports-sim reference tables (sim_* only).
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-sim-mlb-2024.mjs
 *
 * All 384 ranks are computed from 2024 MLB StatsAPI season stats (no CSV).
 * Writes via SUPABASE_SERVICE_ROLE_KEY; only touches sim_* rows for sport=mlb, season=2024.
 */

import { createClient } from "@supabase/supabase-js";

const SPORT = "mlb";
const SEASON = "2024";
const EDITORIAL_MAX_RANK = 100;
const TOTAL_RANKS = 384;
const SEASON_END_DATE = "2024-09-30";
const RANK_SOURCE = "computed-2024-fantasy-points";

/** Editable fantasy scoring weights for 2024 computed ranks. */
const FANTASY_SCORING = {
  hitters: {
    single: 1,
    double: 2,
    triple: 3,
    homeRun: 4,
    run: 1,
    rbi: 1,
    walk: 1,
    stolenBase: 2,
    strikeout: -0.5,
  },
  pitchers: {
    out: 0.33,
    win: 4,
    save: 5,
    hold: 2,
    strikeout: 1,
    earnedRun: -1,
    hitAllowed: -0.5,
    walkAllowed: -0.5,
  },
};

const MLB_API = "https://statsapi.mlb.com/api/v1";
const SCHEDULE_START = "2024-03-20";
const SCHEDULE_END = "2024-11-01";
const TX_START = "2024-01-01";
const TX_END = "2024-11-15";

const TEAM_ALIASES = {
  ARI: "AZ",
  ARZ: "AZ",
  CHW: "CWS",
  KAN: "KC",
  SDP: "SD",
  SFG: "SF",
  TBR: "TB",
  WSN: "WSH",
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

function normalizeTeamAbbrev(team) {
  const upper = (team ?? "").trim().toUpperCase();
  return TEAM_ALIASES[upper] ?? upper;
}

function matchKey(fullName, team) {
  return `${normalizeDisplayName(fullName).toLowerCase()}|${normalizeTeamAbbrev(team)}`;
}

function tierForRank(rank) {
  return rank <= EDITORIAL_MAX_RANK ? "editorial" : "production";
}

function makePlayerId(fullName, team, usedIds) {
  let base = `mlb-${SEASON}-${slugify(fullName)}`;
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  const withTeam = `${base}-${normalizeTeamAbbrev(team).toLowerCase()}`;
  usedIds.add(withTeam);
  return withTeam;
}

async function fetchJson(apiPath) {
  const res = await fetch(`${MLB_API}${apiPath}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${apiPath}: HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchTeams() {
  const data = await fetchJson(`/teams?sportId=1&season=${SEASON}`);
  return (data.teams ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    abbreviation: normalizeTeamAbbrev(team.abbreviation),
  }));
}

async function fetchTeamRoster(teamId) {
  const data = await fetchJson(
    `/teams/${teamId}/roster?rosterType=fullSeason&season=${SEASON}`
  );
  return data.roster ?? [];
}

async function fetchAllRosters(teams) {
  const entries = [];
  for (const team of teams) {
    const roster = await fetchTeamRoster(team.id);
    for (const row of roster) {
      const fullName = row.person?.fullName?.trim();
      if (!fullName) continue;
      entries.push({
        person_id: row.person.id,
        full_name: fullName,
        team: team.abbreviation,
        position: row.position?.abbreviation ?? null,
      });
    }
  }
  return entries;
}

async function fetchAllSeasonStats(group) {
  const pageSize = 2000;
  let offset = 0;
  let total = Infinity;
  /** @type {object[]} */
  const splits = [];

  while (offset < total) {
    const data = await fetchJson(
      `/stats?stats=season&season=${SEASON}&sportId=1&gameType=R&group=${group}&playerPool=all&limit=${pageSize}&offset=${offset}`
    );
    const block = data.stats?.[0];
    if (!block) break;
    total = block.totalSplits ?? splits.length;
    const page = block.splits ?? [];
    splits.push(...page);
    offset += page.length;
    if (page.length === 0 || page.length < pageSize) break;
  }

  return splits;
}

async function fetchScheduleGames() {
  const data = await fetchJson(
    `/schedule?sportId=1&startDate=${SCHEDULE_START}&endDate=${SCHEDULE_END}&gameType=R&season=${SEASON}`
  );
  /** @type {object[]} */
  const games = [];
  for (const day of data.dates ?? []) {
    for (const game of day.games ?? []) {
      if (String(game.season) !== SEASON || game.gameType !== "R") continue;
      if (game.status?.abstractGameState !== "Final") continue;
      games.push(game);
    }
  }
  return games;
}

async function fetchTransactions() {
  const data = await fetchJson(
    `/transactions?startDate=${TX_START}&endDate=${TX_END}&sportId=1`
  );
  return data.transactions ?? [];
}

function buildRosterIndex(rosterEntries) {
  /** @type {Map<string, { person_id: number, full_name: string, team: string, position: string | null }>} */
  const byKey = new Map();
  /** @type {Map<number, { person_id: number, full_name: string, team: string, position: string | null }>} */
  const byPersonId = new Map();

  for (const entry of rosterEntries) {
    byKey.set(matchKey(entry.full_name, entry.team), entry);
    byPersonId.set(entry.person_id, entry);
  }

  return { byKey, byPersonId };
}

function inningsToOuts(inningsPitched) {
  const text = String(inningsPitched ?? "0");
  const [whole, frac = "0"] = text.split(".");
  return Number(whole) * 3 + Number(frac);
}

function computeHitterFantasyPoints(stat) {
  const hits = Number(stat.hits) || 0;
  const doubles = Number(stat.doubles) || 0;
  const triples = Number(stat.triples) || 0;
  const homeRuns = Number(stat.homeRuns) || 0;
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const w = FANTASY_SCORING.hitters;

  return (
    singles * w.single +
    doubles * w.double +
    triples * w.triple +
    homeRuns * w.homeRun +
    (Number(stat.runs) || 0) * w.run +
    (Number(stat.rbi) || 0) * w.rbi +
    (Number(stat.baseOnBalls) || 0) * w.walk +
    (Number(stat.stolenBases) || 0) * w.stolenBase +
    (Number(stat.strikeOuts) || 0) * w.strikeout
  );
}

function computePitcherFantasyPoints(stat) {
  const outs = Number(stat.outs) || inningsToOuts(stat.inningsPitched);
  const w = FANTASY_SCORING.pitchers;

  return (
    outs * w.out +
    (Number(stat.wins) || 0) * w.win +
    (Number(stat.saves) || 0) * w.save +
    (Number(stat.holds) || 0) * w.hold +
    (Number(stat.strikeOuts) || 0) * w.strikeout +
    (Number(stat.earnedRuns) || 0) * w.earnedRun +
    (Number(stat.hits) || 0) * w.hitAllowed +
    (Number(stat.baseOnBalls) || 0) * w.walkAllowed
  );
}

function buildFantasyIndex(hittingSplits, pitchingSplits) {
  /** @type {Map<number, { person_id: number, full_name: string, team: string, position: string, fantasy_points: number, hit_fp: number, pit_fp: number }>} */
  const byPerson = new Map();

  for (const split of hittingSplits) {
    const personId = split.player?.id;
    const team = normalizeTeamAbbrev(split.team?.abbreviation);
    const fullName = split.player?.fullName;
    if (!personId || !team || !fullName) continue;

    const fp = computeHitterFantasyPoints(split.stat ?? {});
    const position = split.position?.abbreviation ?? "DH";
    const existing = byPerson.get(personId);
    if (existing) {
      existing.fantasy_points += fp;
      existing.hit_fp += fp;
      if (existing.position === "P" && position !== "P") {
        existing.position = position;
      }
    } else {
      byPerson.set(personId, {
        person_id: personId,
        full_name: fullName,
        team,
        position,
        fantasy_points: fp,
        hit_fp: fp,
        pit_fp: 0,
      });
    }
  }

  for (const split of pitchingSplits) {
    const personId = split.player?.id;
    const team = normalizeTeamAbbrev(split.team?.abbreviation);
    const fullName = split.player?.fullName;
    if (!personId || !team || !fullName) continue;

    const fp = computePitcherFantasyPoints(split.stat ?? {});
    const position = split.position?.abbreviation ?? "P";
    const existing = byPerson.get(personId);
    if (existing) {
      existing.fantasy_points += fp;
      existing.pit_fp += fp;
      if (existing.hit_fp === 0 || existing.pit_fp >= existing.hit_fp) {
        existing.position = position;
      }
    } else {
      byPerson.set(personId, {
        person_id: personId,
        full_name: fullName,
        team,
        position,
        fantasy_points: fp,
        hit_fp: 0,
        pit_fp: fp,
      });
    }
  }

  return [...byPerson.values()]
    .filter((row) => row.fantasy_points > 0)
    .sort((a, b) => b.fantasy_points - a.fantasy_points);
}

function resolveMlbTeamAbbrev(tx, teamIdToAbbrev, teamNameToAbbrev) {
  for (const side of [tx.toTeam, tx.fromTeam]) {
    if (!side?.id) continue;
    const abbrev = teamIdToAbbrev.get(side.id);
    if (abbrev) return abbrev;
  }

  const desc = tx.description ?? "";
  const teamNames = [...teamNameToAbbrev.keys()].sort(
    (a, b) => b.length - a.length
  );
  for (const name of teamNames) {
    if (desc.startsWith(name)) return teamNameToAbbrev.get(name);
  }

  return null;
}

function parseRetroactiveDate(description) {
  const match = description.match(
    /retroactive to ([A-Za-z]+ \d{1,2}, \d{4})/i
  );
  if (!match) return null;
  const parsed = new Date(match[1]);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function isIlTransfer(description) {
  return /transferred .+ to the 60-day injured list/i.test(description);
}

function isIlOpen(description) {
  return (
    /placed .+ on the .+injured list/i.test(description) &&
    !isIlTransfer(description)
  );
}

function isIlClose(description) {
  return (
    /reinstated/i.test(description) ||
    /activated from the injured list/i.test(description) ||
    /\bactivated\b/i.test(description)
  );
}

function isIlAction(description) {
  return isIlOpen(description) || isIlClose(description);
}

function buildIlSpansForPlayer(sortedTx, seasonEndDate) {
  /** @type {Array<{ start_date: string, end_date: string, injury: string }>} */
  const spans = [];
  let open = null;

  for (const tx of sortedTx) {
    const desc = tx.description ?? "";
    if (isIlTransfer(desc)) continue;

    if (isIlOpen(desc)) {
      if (open) {
        open.end_date = tx.date;
        spans.push(open);
      }
      open = {
        start_date: tx.retro_date ?? tx.date,
        end_date: seasonEndDate,
        injury: desc,
      };
      continue;
    }

    if (isIlClose(desc) && open) {
      open.end_date = tx.date;
      spans.push(open);
      open = null;
    }
  }

  if (open) spans.push(open);
  return spans;
}

function countTeamGamesBetween(teamGameDates, startDate, endDate) {
  return teamGameDates.filter((date) => date >= startDate && date < endDate)
    .length;
}

async function clearMlb2024SimData() {
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
  console.log(`Seeding sim_* tables for ${SPORT} ${SEASON}...\n`);

  const teams = await fetchTeams();
  const teamIdToAbbrev = new Map(
    teams.map((team) => [team.id, team.abbreviation])
  );
  const teamNameToAbbrev = new Map(
    teams.map((team) => [team.name, team.abbreviation])
  );

  console.log("Fetching MLB StatsAPI rosters, stats, schedule, transactions...");
  const [rosterEntries, hittingSplits, pitchingSplits, scheduleGames, transactions] =
    await Promise.all([
      fetchAllRosters(teams),
      fetchAllSeasonStats("hitting"),
      fetchAllSeasonStats("pitching"),
      fetchScheduleGames(),
      fetchTransactions(),
    ]);

  console.log(
    `  ${hittingSplits.length} hitting splits, ${pitchingSplits.length} pitching splits`
  );

  const { byKey: rosterByKey, byPersonId: rosterByPersonId } =
    buildRosterIndex(rosterEntries);

  const rankedCandidates = buildFantasyIndex(hittingSplits, pitchingSplits);
  const top384 = rankedCandidates.slice(0, TOTAL_RANKS);

  if (top384.length < TOTAL_RANKS) {
    console.warn(
      `Warning: only ${top384.length} players with fantasy points (wanted ${TOTAL_RANKS}).`
    );
  }

  const usedPlayerIds = new Set();
  /** @type {Array<object>} */
  const simPlayers = [];
  /** @type {Array<object>} */
  const simRankings = [];
  /** @type {Map<string, string>} */
  const matchKeyToPlayerId = new Map();
  /** @type {Map<number, string>} */
  const personIdToPlayerId = new Map();

  for (let i = 0; i < top384.length; i++) {
    const pick = top384[i];
    const rank = i + 1;
    const key = matchKey(pick.full_name, pick.team);
    const rosterHit =
      rosterByPersonId.get(pick.person_id) ?? rosterByKey.get(key);
    const fullName = rosterHit?.full_name ?? pick.full_name;
    const team = rosterHit?.team ?? pick.team;
    const position = rosterHit?.position ?? pick.position;
    const playerId = makePlayerId(fullName, team, usedPlayerIds);
    const resolvedKey = matchKey(fullName, team);

    matchKeyToPlayerId.set(resolvedKey, playerId);
    personIdToPlayerId.set(pick.person_id, playerId);

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
      tier: tierForRank(rank),
      rank_source: RANK_SOURCE,
    });
  }

  /** @type {Array<object>} */
  const gameResults = [];
  /** @type {Map<string, string[]>} */
  const teamGameDates = new Map();

  for (const game of scheduleGames) {
    const home = normalizeTeamAbbrev(game.teams?.home?.team?.abbreviation);
    const away = normalizeTeamAbbrev(game.teams?.away?.team?.abbreviation);
    const homeScore = Number(game.teams?.home?.score);
    const awayScore = Number(game.teams?.away?.score);
    const gameDate = (game.officialDate ?? game.gameDate?.slice(0, 10)) || null;
    if (!home || !away || !gameDate) continue;

    for (const team of [home, away]) {
      if (!teamGameDates.has(team)) teamGameDates.set(team, []);
      teamGameDates.get(team).push(gameDate);
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
      week: null,
      game_date: gameDate,
      home_team: home,
      away_team: away,
      winning_team: winningTeam,
      losing_team: losingTeam,
      home_score: Number.isFinite(homeScore) ? homeScore : null,
      away_score: Number.isFinite(awayScore) ? awayScore : null,
    });
  }

  for (const dates of teamGameDates.values()) {
    dates.sort();
  }

  const teamSchedules = teams.map((team) => ({
    sport: SPORT,
    season: SEASON,
    team: team.abbreviation,
    bye_week: null,
    is_outdoor: null,
    stadium_lat: null,
    stadium_lng: null,
  }));

  /** @type {Map<string, object[]>} */
  const ilTxByPlayerTeam = new Map();
  let ilTransactionsTotal = 0;
  let ilTransactionsMatched = 0;
  let ilTransactionsDiscarded = 0;
  /** @type {string[]} */
  const injuryReconciliation = [];

  for (const tx of transactions) {
    const desc = tx.description ?? "";
    if (!isIlAction(desc)) continue;
    if (isIlTransfer(desc)) continue;

    ilTransactionsTotal++;

    const personId = tx.person?.id;
    const fullName = tx.person?.fullName?.trim();
    const teamAbbrev = resolveMlbTeamAbbrev(
      tx,
      teamIdToAbbrev,
      teamNameToAbbrev
    );

    if (!personId || !fullName || !teamAbbrev) {
      ilTransactionsDiscarded++;
      continue;
    }

    const key = matchKey(fullName, teamAbbrev);
    let playerId = matchKeyToPlayerId.get(key);
    if (!playerId && personIdToPlayerId.has(personId)) {
      playerId = personIdToPlayerId.get(personId);
    }

    if (!playerId) {
      ilTransactionsDiscarded++;
      injuryReconciliation.push(
        `${tx.date}: ${fullName} (${teamAbbrev}) — ${desc}`
      );
      continue;
    }

    ilTransactionsMatched++;
    const bucketKey = `${playerId}|${teamAbbrev}`;
    if (!ilTxByPlayerTeam.has(bucketKey)) ilTxByPlayerTeam.set(bucketKey, []);
    ilTxByPlayerTeam.get(bucketKey).push({
      date: tx.date,
      retro_date: parseRetroactiveDate(desc),
      description: desc,
    });
  }

  /** @type {Array<object>} */
  const simInjuries = [];

  for (const [bucketKey, rows] of ilTxByPlayerTeam) {
    const [playerId, teamAbbrev] = bucketKey.split("|");
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const spans = buildIlSpansForPlayer(sorted, SEASON_END_DATE);
    const dates = teamGameDates.get(teamAbbrev) ?? [];

    for (const span of spans) {
      const gamesMissed =
        dates.length > 0
          ? countTeamGamesBetween(dates, span.start_date, span.end_date)
          : null;

      simInjuries.push({
        player_id: playerId,
        start_week: null,
        end_week: null,
        start_date: span.start_date,
        end_date: span.end_date,
        injury: span.injury,
        status: "il",
        games_missed: gamesMissed,
        source: "mlb/statsapi:transactions",
      });
    }
  }

  console.log("Clearing existing MLB 2024 sim_* rows...");
  await clearMlb2024SimData();

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
  const productionCount = simRankings.filter(
    (r) => r.tier === "production"
  ).length;
  const playersWithIlSpans = new Set(simInjuries.map((row) => row.player_id))
    .size;

  console.log("\n=== Seed summary ===");
  console.log(
    `Players: ${simPlayers.length} ranked (both tiers from computed 2024 fantasy points: ${editorialCount} editorial ranks 1–100, ${productionCount} production ranks 101–384)`
  );
  console.log(
    `Injuries: ${simInjuries.length} IL spans for ${playersWithIlSpans} sim players (${ilTransactionsMatched}/${ilTransactionsTotal} IL transactions matched; ${ilTransactionsDiscarded} discarded)`
  );
  console.log("Bye weeks: none (MLB has no byes)");
  console.log(`Games: ${gameResults.length} regular-season results loaded`);

  const uniqueReconciliation = [...new Set(injuryReconciliation)];
  if (uniqueReconciliation.length > 0) {
    console.log(
      "\n=== Injury/transaction name reconciliation (failed sim_players match) ==="
    );
    console.log(
      "These IL transactions did not match a ranked player by name+team (accents, traded teams, etc.):\n"
    );
    for (const line of uniqueReconciliation) {
      console.log(`  ${line}`);
    }
  } else {
    console.log(
      "\nInjury reconciliation: all IL transactions matched ranked sim_players."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
