#!/usr/bin/env node
/**
 * Migrate active SDPL leagues to 11-week cycling regular season schedules.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-sdpl-cycling-schedule.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-sdpl-cycling-schedule.mjs --force-reseed
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-sdpl-cycling-schedule.mjs SDAI-00039
 *
 * Loads NEXT_PUBLIC_SUPABASE_URL from .env.local when present.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
loadEnvFile(path.join(process.cwd(), ".env.vercel.production"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const forceReseed = process.argv.includes("--force-reseed");

function parseSupportCodeArg() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) continue;
    return arg;
  }
  return null;
}

const supportCode = parseSupportCodeArg();

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SDPL_COUNTS = [4, 6, 8, 10, 12];
const SPORTS_SIM = ["sdfl", "sdhl", "sdba", "sdlb"];

function isSdplLeague(league) {
  if (league.format_type === "sports_league") return false;
  const sim = league.sports_league_id?.toLowerCase();
  if (sim && SPORTS_SIM.includes(sim)) return false;
  return SDPL_COUNTS.includes(league.player_count ?? 0);
}

function getSdplPlayoffWeeks(regularSeasonWeeks) {
  return {
    semifinalWeek: regularSeasonWeeks + 1,
    finalsWeek: regularSeasonWeeks + 2,
  };
}

function generateRoundRobinPairings(teamIds) {
  const n = teamIds.length;
  if (n < 2) return [];
  const schedule = [];
  for (let round = 0; round < n - 1; round++) {
    const pairs = [[teamIds[0], teamIds[round + 1]]];
    const rest = teamIds.filter((_, index) => index !== 0 && index !== round + 1);
    for (let i = 0; i < rest.length / 2; i++) {
      pairs.push([rest[i], rest[rest.length - 1 - i]]);
    }
    schedule.push(pairs);
  }
  return schedule;
}

function generateCyclingSchedule(teamIds, totalWeeks = 11) {
  const pairings = generateRoundRobinPairings(teamIds);
  if (!pairings.length) return [];
  const games = [];
  for (let week = 1; week <= totalWeeks; week++) {
    for (const [homeUserId, awayUserId] of pairings[(week - 1) % pairings.length]) {
      games.push({ weekNumber: week, homeUserId, awayUserId });
    }
  }
  return games;
}

async function getMemberName(leagueId, userId) {
  const { data } = await supabase
    .from("league_members")
    .select("display_name")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.display_name?.trim()) return data.display_name.trim();
  const { data: profile } = await supabase
    .from("profiles")
    .select("team_name, username")
    .eq("id", userId)
    .maybeSingle();
  return profile?.team_name?.trim() || profile?.username?.trim() || "Team";
}

async function getTeamIds(leagueId, ownerUserId) {
  const { data: members } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });
  if (members?.length) return members.map((m) => m.user_id);
  return [ownerUserId];
}

async function migrateLeague(league) {
  const regularSeasonWeeks = 11;
  const ownerUserId = league.owner_user_id;
  if (!ownerUserId) {
    return { supportCode: league.support_code, action: "skipped", error: "no owner" };
  }

  const teamIds = await getTeamIds(league.id, ownerUserId);
  if (teamIds.length < 2) {
    return { supportCode: league.support_code, action: "skipped", error: "not enough teams" };
  }

  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("week_number, is_playoff, status")
    .eq("league_id", league.id);

  const regularRows = (matchups ?? []).filter((row) => !row.is_playoff);
  const regularWeeks = [...new Set(regularRows.map((r) => r.week_number))].sort((a, b) => a - b);
  const completedRegular = regularRows.some((row) => row.status === "complete");
  const needsReseed =
    forceReseed || regularWeeks.length === 0 || regularWeeks.some((w) => w > regularSeasonWeeks);

  const fullSchedule = generateCyclingSchedule(teamIds, regularSeasonWeeks);
  let action = "skipped";
  let gamesToInsert = [];

  if (needsReseed && !completedRegular) {
    await supabase.from("league_matchups").delete().eq("league_id", league.id);
    await supabase.from("roster_week_baselines").delete().eq("league_id", league.id);
    await supabase
      .from("league_standings")
      .update({ wins: 0, losses: 0, current_week: 1 })
      .eq("league_id", league.id);
    await supabase
      .from("leagues")
      .update({ status: "active", current_week: 1 })
      .eq("id", league.id);
    gamesToInsert = fullSchedule;
    action = "reseeded";
  } else {
    const missing = [];
    for (let w = 1; w <= regularSeasonWeeks; w++) {
      if (!regularWeeks.includes(w)) missing.push(w);
    }
    if (missing.length === 0) {
      return {
        supportCode: league.support_code,
        action: "skipped",
        regularSeasonWeeks,
        playoffWeeks: getSdplPlayoffWeeks(regularSeasonWeeks),
        matchupsInserted: 0,
      };
    }
    gamesToInsert = fullSchedule.filter((g) => missing.includes(g.weekNumber));
    action = "extended";
  }

  const rows = await Promise.all(
    gamesToInsert.map(async (game) => {
      const homeName = await getMemberName(league.id, game.homeUserId);
      const awayName = await getMemberName(league.id, game.awayUserId);
      const humanIsHome = game.homeUserId === ownerUserId;
      const humanIsAway = game.awayUserId === ownerUserId;
      return {
        league_id: league.id,
        week_number: game.weekNumber,
        home_user_id: game.homeUserId,
        away_user_id: game.awayUserId,
        is_playoff: false,
        playoff_round: null,
        opponent_bot_id: humanIsHome
          ? game.awayUserId
          : humanIsAway
            ? game.homeUserId
            : game.awayUserId,
        opponent_name: humanIsHome
          ? awayName
          : humanIsAway
            ? homeName
            : `${homeName} vs ${awayName}`,
        status: "scheduled",
      };
    })
  );

  if (rows.length > 0) {
    const { error } = await supabase.from("league_matchups").insert(rows);
    if (error) {
      return {
        supportCode: league.support_code,
        action,
        error: error.message,
      };
    }
  }

  return {
    supportCode: league.support_code,
    action,
    regularSeasonWeeks,
    playoffWeeks: getSdplPlayoffWeeks(regularSeasonWeeks),
    matchupsInserted: rows.length,
    teams: teamIds.length,
  };
}

async function main() {
  let query = supabase
    .from("leagues")
    .select("id, support_code, format_type, sports_league_id, player_count, owner_user_id, status")
    .eq("status", "active");

  if (supportCode) {
    query = query.eq("support_code", supportCode);
  }

  const { data: leagues, error } = await query;
  if (error) throw new Error(error.message);

  const targets = (leagues ?? []).filter(isSdplLeague);
  const results = [];

  for (const league of targets) {
    results.push(await migrateLeague(league));
    console.log(JSON.stringify(results[results.length - 1]));
  }

  console.log(`\nDone: ${results.length} SDPL league(s) processed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
