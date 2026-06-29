import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { getLeagueMemberTeamName } from "@/lib/league/server";
import { getLeagueTeamIds } from "@/lib/matchup/league-teams";
import { backfillFinalizeAtForLeagueWeek } from "@/lib/matchup/finalize-week";
import type { ScheduledGame } from "@/lib/matchup/schedule";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";
import {
  generateBetaDailyRegularSeasonSchedule,
  SDAI_BETA_WEEK_CALENDAR,
} from "@/lib/season/beta-schedule";
import { resolveSeasonSettings } from "@/lib/season/calendar";
import type { WeekCalendarEntry } from "@/lib/season/types";

export type ResetBetaLeagueOptions = {
  supportCode: string;
  weekCalendar?: WeekCalendarEntry[];
  regularSeasonWeeks?: number;
  supabase?: SupabaseClient;
};

export type ResetBetaLeagueResult = {
  leagueId: string;
  supportCode: string;
  matchupsInserted: number;
  teams: number;
};

async function buildMatchupRows(
  leagueId: string,
  ownerUserId: string,
  games: ScheduledGame[],
  supabase: SupabaseClient
) {
  return Promise.all(
    games.map(async (game) => {
      const homeName = await getLeagueMemberTeamName(leagueId, game.homeUserId);
      const awayName = await getLeagueMemberTeamName(leagueId, game.awayUserId);
      const humanIsHome = game.homeUserId === ownerUserId;
      const humanIsAway = game.awayUserId === ownerUserId;

      return {
        league_id: leagueId,
        week_number: game.weekNumber,
        home_user_id: game.homeUserId,
        away_user_id: game.awayUserId,
        is_playoff: game.isPlayoff,
        playoff_round: game.playoffRound ?? null,
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
        status: "scheduled" as const,
        human_score_pct: null,
        opponent_score_pct: null,
        home_score: null,
        away_score: null,
        winner_user_id: null,
        winner: null,
        scored_at: null,
        finalize_at: null,
        stock_close_captured_at: null,
      };
    })
  );
}

export async function resetSdplBetaLeague(
  options: ResetBetaLeagueOptions
): Promise<ResetBetaLeagueResult> {
  const supabase = options.supabase ?? createServiceClient();
  const weekCalendar = options.weekCalendar ?? SDAI_BETA_WEEK_CALENDAR;
  const regularSeasonWeeks = options.regularSeasonWeeks ?? 11;

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "id, support_code, owner_user_id, player_count, format_type, sports_league_id, league_type"
    )
    .eq("support_code", options.supportCode)
    .maybeSingle();

  if (leagueError || !league?.owner_user_id) {
    throw new Error(
      leagueError?.message ?? `League not found: ${options.supportCode}`
    );
  }

  const leagueId = league.id;
  const ownerUserId = league.owner_user_id;

  await supabase.from("league_matchups").delete().eq("league_id", leagueId);
  await supabase.from("roster_week_baselines").delete().eq("league_id", leagueId);

  await supabase
    .from("league_standings")
    .update({
      wins: 0,
      losses: 0,
      current_week: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);

  await supabase.from("league_season_settings").upsert(
    {
      league_id: leagueId,
      season_format: "beta_daily",
      regular_season_weeks: regularSeasonWeeks,
      week_calendar: weekCalendar,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "league_id" }
  );

  await supabase
    .from("leagues")
    .update({
      status: "active",
      current_week: 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leagueId);

  const teamIds = await getLeagueTeamIds(leagueId, ownerUserId);
  if (teamIds.length < 2) {
    throw new Error(
      `Not enough teams to seed schedule (${teamIds.length} found).`
    );
  }

  const schedule = generateBetaDailyRegularSeasonSchedule(
    teamIds,
    regularSeasonWeeks
  );
  const rows = await buildMatchupRows(leagueId, ownerUserId, schedule, supabase);

  const { error: insertError } = await supabase
    .from("league_matchups")
    .insert(rows);

  if (insertError) {
    throw new Error(`Matchup insert failed: ${insertError.message}`);
  }

  await captureWeekBaselinesForLeague(leagueId, 1, supabase);

  const settings = resolveSeasonSettings(
    {
      formatType: league.format_type ?? "standard",
      sportsLeagueId: league.sports_league_id,
      playerCount: league.player_count,
    },
    {
      season_format: "beta_daily",
      regular_season_weeks: regularSeasonWeeks,
      week_calendar: weekCalendar,
    }
  );

  await backfillFinalizeAtForLeagueWeek(
    leagueId,
    1,
    settings,
    new Date(),
    supabase
  );

  return {
    leagueId,
    supportCode: league.support_code ?? options.supportCode,
    matchupsInserted: rows.length,
    teams: teamIds.length,
  };
}
