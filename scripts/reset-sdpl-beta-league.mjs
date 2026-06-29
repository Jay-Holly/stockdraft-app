#!/usr/bin/env node
/**
 * Wipe and re-seed an SDPL beta_daily league (default: SDAI-00039).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/reset-sdpl-beta-league.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/reset-sdpl-beta-league.mjs SDPL4-00001
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

const supportCode = process.argv[2]?.trim() || "SDAI-00039";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SDAI_BETA_WEEK_CALENDAR = [
  { week: 1, date: "2026-06-29" },
  { week: 2, date: "2026-06-30" },
  { week: 3, date: "2026-07-01" },
  { week: 4, date: "2026-07-02" },
  { week: 5, date: "2026-07-03" },
  { week: 6, date: "2026-07-06" },
  { week: 7, date: "2026-07-07" },
  { week: 8, date: "2026-07-08" },
  { week: 9, date: "2026-07-09" },
  { week: 10, date: "2026-07-10" },
  { week: 11, date: "2026-07-13" },
  { week: 12, date: "2026-07-14" },
  { week: 13, date: "2026-07-15" },
];

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

function generateBetaSchedule(teamIds, weeks = 11) {
  const pairings = generateRoundRobinPairings(teamIds);
  const games = [];
  for (let week = 1; week <= weeks; week++) {
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
  if (data?.display_name) return data.display_name.trim();
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
  const { data: bots } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);
  return [ownerUserId, ...(bots ?? []).map((b) => b.user_id)];
}

async function main() {
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, support_code, owner_user_id, player_count")
    .eq("support_code", supportCode)
    .maybeSingle();

  if (leagueError || !league?.owner_user_id) {
    throw new Error(leagueError?.message ?? `League not found: ${supportCode}`);
  }

  const leagueId = league.id;
  const ownerUserId = league.owner_user_id;

  console.log(`Resetting ${supportCode} (${leagueId})…`);

  await supabase.from("league_matchups").delete().eq("league_id", leagueId);
  await supabase.from("roster_week_baselines").delete().eq("league_id", leagueId);

  await supabase
    .from("league_standings")
    .update({ wins: 0, losses: 0, current_week: 1 })
    .eq("league_id", leagueId);

  await supabase.from("league_season_settings").upsert(
    {
      league_id: leagueId,
      season_format: "beta_daily",
      regular_season_weeks: 11,
      week_calendar: SDAI_BETA_WEEK_CALENDAR,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "league_id" }
  );

  await supabase
    .from("leagues")
    .update({ status: "active", current_week: 1 })
    .eq("id", leagueId);

  const teamIds = await getTeamIds(leagueId, ownerUserId);
  const schedule = generateBetaSchedule(teamIds, 11);

  const rows = await Promise.all(
    schedule.map(async (game) => {
      const homeName = await getMemberName(leagueId, game.homeUserId);
      const awayName = await getMemberName(leagueId, game.awayUserId);
      const humanIsHome = game.homeUserId === ownerUserId;
      const humanIsAway = game.awayUserId === ownerUserId;
      return {
        league_id: leagueId,
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

  const { error: insertError } = await supabase
    .from("league_matchups")
    .insert(rows);

  if (insertError) throw new Error(insertError.message);

  console.log(
    JSON.stringify(
      {
        ok: true,
        supportCode,
        leagueId,
        teams: teamIds.length,
        matchupsInserted: rows.length,
        status: "active",
        currentWeek: 1,
        seasonFormat: "beta_daily",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
