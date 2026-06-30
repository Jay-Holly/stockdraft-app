import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveSeasonSettings } from "@/lib/season/calendar";
import { computeWeekFinalizeAt } from "@/lib/season/finalize-times";
import type { SeasonSettingsRow } from "@/lib/season/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supportCode =
    request.nextUrl.searchParams.get("supportCode")?.trim() ?? "SDAI-00039";
  const weekParam = request.nextUrl.searchParams.get("week");
  const weekNumber = weekParam ? Number.parseInt(weekParam, 10) : null;

  const supabase = createServiceClient();
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "id, support_code, current_week, status, format_type, sports_league_id, player_count, scoring_mode"
    )
    .eq("support_code", supportCode)
    .maybeSingle();

  if (leagueError || !league) {
    return NextResponse.json(
      { error: leagueError?.message ?? "League not found", supportCode },
      { status: leagueError ? 500 : 404 }
    );
  }

  const settingsResult = await supabase
    .from("league_season_settings")
    .select("season_format, regular_season_weeks, week_calendar")
    .eq("league_id", league.id)
    .maybeSingle();

  const settingsRow =
    settingsResult.error &&
    (settingsResult.error.code === "PGRST205" ||
      settingsResult.error.message?.includes("league_season_settings"))
      ? null
      : (settingsResult.data as SeasonSettingsRow | null);

  const settings = resolveSeasonSettings(
    {
      formatType: league.format_type,
      sportsLeagueId: league.sports_league_id,
      playerCount: league.player_count,
    },
    settingsRow
  );

  let matchupsQuery = supabase
    .from("league_matchups")
    .select(
      "id, week_number, status, home_score, away_score, finalize_at, winner_user_id, stock_close_captured_at"
    )
    .eq("league_id", league.id)
    .order("week_number")
    .order("id");

  if (weekNumber != null && !Number.isNaN(weekNumber)) {
    matchupsQuery = matchupsQuery.eq("week_number", weekNumber);
  }

  const { data: matchups, error: matchupsError } = await matchupsQuery;

  if (matchupsError) {
    return NextResponse.json(
      { error: matchupsError.message, supportCode },
      { status: 500 }
    );
  }

  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", league.id);

  const rosterDebug: Array<{
    userId: string;
    pickCount: number;
    week1BaselineCount: number;
    week1OpenTotal: number;
  }> = [];

  for (const draft of drafts ?? []) {
    const { data: draftRow } = await supabase
      .from("drafts")
      .select("id")
      .eq("league_id", league.id)
      .eq("user_id", draft.user_id)
      .maybeSingle();

    const { count: pickCount } = await supabase
      .from("draft_picks")
      .select("id", { count: "exact", head: true })
      .eq("draft_id", draftRow?.id ?? "");

    const { data: baselines } = await supabase
      .from("roster_week_baselines")
      .select("value_at_open")
      .eq("league_id", league.id)
      .eq("user_id", draft.user_id)
      .eq("week_number", 1);

    const week1OpenTotal = (baselines ?? []).reduce(
      (sum, row) => sum + Number(row.value_at_open ?? 0),
      0
    );

    rosterDebug.push({
      userId: draft.user_id,
      pickCount: pickCount ?? 0,
      week1BaselineCount: baselines?.length ?? 0,
      week1OpenTotal,
    });
  }

  const now = new Date();
  const weeks = [...new Set((matchups ?? []).map((m) => m.week_number))].map(
    (week) => ({
      week,
      finalizeAt: computeWeekFinalizeAt(settings, week, now).toISOString(),
      due: now >= computeWeekFinalizeAt(settings, week, now),
    })
  );

  return NextResponse.json({
    ok: true,
    league: {
      id: league.id,
      supportCode: league.support_code,
      currentWeek: league.current_week,
      status: league.status,
      scoringMode: league.scoring_mode,
    },
    seasonSettings: settingsRow
      ? {
          seasonFormat: settingsRow.season_format,
          regularSeasonWeeks: settingsRow.regular_season_weeks,
        }
      : null,
    resolvedSeasonFormat: settings.seasonFormat,
    weeks,
    matchups: matchups ?? [],
    rosterDebug,
  });
}
