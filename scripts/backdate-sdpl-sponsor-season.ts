#!/usr/bin/env node
/**
 * Align sponsor-demo SDPL leagues to the July 6 season-start calendar.
 *
 * Week 1 runs 2026-07-06 through 2026-07-14; Week 1 finalizes 2026-07-14 6:00 AM ET.
 * Applies identical week_calendar + finalize_at to SDPL4-00047 and SDAI-00040.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx --yes tsx scripts/backdate-sdpl-sponsor-season.ts
 *
 * Loads NEXT_PUBLIC_SUPABASE_URL from .env.local / .env.vercel.production when present.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { resolveSeasonSettings } from "../src/lib/season/calendar";
import { computeWeekFinalizeAt } from "../src/lib/season/finalize-times";
import {
  SDPL_SPONSOR_DEMO_WEEK_CALENDAR,
  SDPL_SPONSOR_DEMO_REGULAR_SEASON_WEEKS,
} from "../src/lib/season/standard-schedule";

function loadEnvFile(filePath: string) {
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

const TARGET_SUPPORT_CODES = ["SDPL4-00047", "SDAI-00040"];

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

type LeagueReport = {
  supportCode: string;
  leagueId: string;
  currentWeek: number;
  settingsUpserted: boolean;
  weeksUpdated: Array<{ week: number; finalizeAt: string; matchups: number }>;
};

async function applyCalendar(league: {
  id: string;
  support_code: string;
  format_type: string | null;
  sports_league_id: string | null;
  player_count: number | null;
  current_week: number | null;
}): Promise<LeagueReport> {
  const { error: settingsError } = await supabase
    .from("league_season_settings")
    .upsert(
      {
        league_id: league.id,
        season_format: "standard",
        regular_season_weeks: SDPL_SPONSOR_DEMO_REGULAR_SEASON_WEEKS,
        week_calendar: SDPL_SPONSOR_DEMO_WEEK_CALENDAR,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "league_id" }
    );

  if (settingsError) {
    throw new Error(
      `${league.support_code}: season settings upsert failed — ${settingsError.message}`
    );
  }

  if ((league.current_week ?? 1) !== 1) {
    await supabase
      .from("leagues")
      .update({ current_week: 1 })
      .eq("id", league.id);
  }

  const settings = resolveSeasonSettings(
    {
      formatType: league.format_type ?? "standard",
      sportsLeagueId: league.sports_league_id,
      playerCount: league.player_count,
    },
    {
      season_format: "standard",
      regular_season_weeks: SDPL_SPONSOR_DEMO_REGULAR_SEASON_WEEKS,
      week_calendar: SDPL_SPONSOR_DEMO_WEEK_CALENDAR,
    }
  );

  const { data: matchups, error: matchupsError } = await supabase
    .from("league_matchups")
    .select("id, week_number, status, finalize_at")
    .eq("league_id", league.id)
    .eq("status", "scheduled");

  if (matchupsError) {
    throw new Error(
      `${league.support_code}: matchup load failed — ${matchupsError.message}`
    );
  }

  const weeksUpdated: LeagueReport["weeksUpdated"] = [];
  const weekNumbers = [
    ...new Set((matchups ?? []).map((row) => row.week_number)),
  ].sort((a, b) => a - b);

  for (const weekNumber of weekNumbers) {
    const finalizeAt = computeWeekFinalizeAt(settings, weekNumber);
    const iso = finalizeAt.toISOString();
    const ids = (matchups ?? [])
      .filter((row) => row.week_number === weekNumber)
      .map((row) => row.id);

    const { error: updateError } = await supabase
      .from("league_matchups")
      .update({ finalize_at: iso })
      .in("id", ids);

    if (updateError) {
      throw new Error(
        `${league.support_code} w${weekNumber}: finalize update failed — ${updateError.message}`
      );
    }

    weeksUpdated.push({
      week: weekNumber,
      finalizeAt: iso,
      matchups: ids.length,
    });
  }

  return {
    supportCode: league.support_code,
    leagueId: league.id,
    currentWeek: 1,
    settingsUpserted: true,
    weeksUpdated,
  };
}

async function main() {
  const { data: leagues, error } = await supabase
    .from("leagues")
    .select(
      "id, support_code, format_type, sports_league_id, player_count, current_week, status"
    )
    .in("support_code", TARGET_SUPPORT_CODES);

  if (error) throw new Error(error.message);

  const byCode = new Map(
    (leagues ?? []).map((league) => [league.support_code, league])
  );

  const reports: LeagueReport[] = [];
  for (const supportCode of TARGET_SUPPORT_CODES) {
    const league = byCode.get(supportCode);
    if (!league) {
      throw new Error(`League not found: ${supportCode}`);
    }
    reports.push(await applyCalendar(league));
    console.log(JSON.stringify(reports[reports.length - 1], null, 2));
  }

  const [a, b] = reports;
  const aFinalize = new Map(a.weeksUpdated.map((w) => [w.week, w.finalizeAt]));
  const mismatches = b.weeksUpdated.filter(
    (w) => aFinalize.get(w.week) !== w.finalizeAt
  );

  if (mismatches.length > 0) {
    console.error("\nSCHEDULE MISMATCH between leagues:");
    for (const row of mismatches) {
      console.error(
        `  week ${row.week}: SDPL4=${aFinalize.get(row.week)} SDAI=${row.finalizeAt}`
      );
    }
    process.exit(1);
  }

  console.log(
    `\nDone: ${reports.length} league(s) aligned. Week 1 finalize: ${aFinalize.get(1)}`
  );
  console.log(
    "SDPL4-00047 and SDAI-00040 have identical weekly finalize_at schedules."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
