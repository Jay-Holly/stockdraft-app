import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isSdplSeasonRulesLeague, isSportsSimLeague } from "@/lib/season/sdpl-league";
import { resolveSeasonSettings } from "@/lib/season/calendar";
import type { SeasonSettingsRow } from "@/lib/season/types";

export const dynamic = "force-dynamic";

/**
 * Catches the two failure signatures that let SDAI-00039 sit stranded for
 * days without anyone noticing:
 *  1. A matchup past its finalize_at that never actually got scored (the
 *     daily finalize cron only touches status="active" leagues, so once a
 *     league mis-flips to "complete" it stops being checked at all).
 *  2. A league marked "complete" that never produced a real terminal-round
 *     result — applies to every league format, not just SDPL/SDAI:
 *     "final" for SDPL/SDAI (isSdplSeasonRulesLeague), and
 *     "conference_championship" for the sports-sim formats
 *     (SDFL/SDHL/SDBA/SDLB, isSportsSimLeague).
 * This is read-only — it flags, it does not repair. Repair stays a manual,
 * confirmed action via /api/cron/repair-premature-finalize.
 */

const STALL_GRACE_HOURS = 20;
/** Standard leagues finalize on a real ~weekly cadence (often the Fri 4pm
 * lock -> Mon 6am finalize weekend extension) — 8 days clears a normal
 * week with room to spare, while still catching a genuine multi-week stall. */
const STANDARD_CADENCE_GRACE_HOURS = 24 * 8;

type LeagueRow = {
  id: string;
  support_code: string | null;
  status: string;
  current_week: number;
  format_type: string | null;
  sports_league_id: string | null;
  player_count: number | null;
};

function terminalPlayoffRound(league: LeagueRow): string | null {
  if (
    isSportsSimLeague({
      formatType: league.format_type,
      sportsLeagueId: league.sports_league_id,
    })
  ) {
    return "conference_championship";
  }
  if (
    isSdplSeasonRulesLeague({
      formatType: league.format_type,
      sportsLeagueId: league.sports_league_id,
      playerCount: league.player_count,
    })
  ) {
    return "final";
  }
  return null;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: leagues, error: leaguesError } = await supabase
    .from("leagues")
    .select(
      "id, support_code, status, current_week, format_type, sports_league_id, player_count"
    )
    .in("status", ["active", "complete"]);

  if (leaguesError) {
    return NextResponse.json({ error: leaguesError.message }, { status: 500 });
  }

  const now = new Date();

  const stalled: Array<{
    leagueId: string;
    supportCode: string | null;
    weekNumber: number;
    finalizeAt: string;
  }> = [];

  const prematureComplete: Array<{
    leagueId: string;
    supportCode: string | null;
    terminalRound: string;
  }> = [];

  for (const league of (leagues ?? []) as LeagueRow[]) {
    if (league.status === "active") {
      // Grace period depends on the league's actual pace: beta_daily
      // leagues (one trading day = one week, like SDAI-00039) should
      // finalize same-day, so a short window is a real stall. Standard
      // leagues finalize on a real ~weekly cadence (often via the Fri
      // 4pm lock -> Mon 6am finalize weekend extension), so 20 hours is
      // routine, not stalled — flagging those would just be noise.
      const settingsRow = await supabase
        .from("league_season_settings")
        .select("season_format, regular_season_weeks, week_calendar")
        .eq("league_id", league.id)
        .maybeSingle();

      const settings = resolveSeasonSettings(
        {
          formatType: league.format_type,
          sportsLeagueId: league.sports_league_id,
          playerCount: league.player_count,
        },
        settingsRow.data as SeasonSettingsRow | null
      );

      const graceHours =
        settings.rulesApply && settings.seasonFormat === "beta_daily"
          ? STALL_GRACE_HOURS
          : STANDARD_CADENCE_GRACE_HOURS;

      const staleCutoff = new Date(
        now.getTime() - graceHours * 60 * 60 * 1000
      ).toISOString();

      const { data: overdue } = await supabase
        .from("league_matchups")
        .select("week_number, finalize_at")
        .eq("league_id", league.id)
        .eq("status", "scheduled")
        .lt("finalize_at", staleCutoff)
        .order("finalize_at", { ascending: true })
        .limit(1);

      if (overdue && overdue.length > 0) {
        stalled.push({
          leagueId: league.id,
          supportCode: league.support_code,
          weekNumber: overdue[0].week_number,
          finalizeAt: overdue[0].finalize_at,
        });
      }
    }

    if (league.status === "complete") {
      const terminalRound = terminalPlayoffRound(league);
      if (!terminalRound) continue;

      const { count } = await supabase
        .from("league_matchups")
        .select("*", { count: "exact", head: true })
        .eq("league_id", league.id)
        .eq("playoff_round", terminalRound)
        .eq("status", "complete")
        .not("winner_user_id", "is", null);

      if (!count || count === 0) {
        prematureComplete.push({
          leagueId: league.id,
          supportCode: league.support_code,
          terminalRound,
        });
      }
    }
  }

  if (stalled.length > 0) {
    console.error(
      `[audit-league-health] ${stalled.length} league(s) with overdue unfinalized matchups:`,
      JSON.stringify(stalled)
    );
  }
  if (prematureComplete.length > 0) {
    console.error(
      `[audit-league-health] ${prematureComplete.length} league(s) marked complete with no finished championship:`,
      JSON.stringify(prematureComplete)
    );
  }

  return NextResponse.json({
    ok: true,
    checkedAt: now.toISOString(),
    leaguesChecked: leagues?.length ?? 0,
    stalled,
    prematureComplete,
    healthy: stalled.length === 0 && prematureComplete.length === 0,
  });
}
