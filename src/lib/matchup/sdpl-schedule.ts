import type { SupabaseClient } from "@supabase/supabase-js";

import { getLeagueMemberTeamName } from "@/lib/league/server";
import {
  generateCyclingRegularSeasonSchedule,
  getSdplPlayoffWeeks,
  missingSdplRegularSeasonWeeks,
  sdplScheduleNeedsReseed,
  type ScheduledGame,
} from "@/lib/matchup/schedule";
import { backfillFinalizeAtForLeagueWeek } from "@/lib/matchup/finalize-week";
import { resolveSeasonSettings } from "@/lib/season/calendar";
import { SDPL_REGULAR_SEASON_WEEKS } from "@/lib/season/constants";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";
import type { SeasonSettings } from "@/lib/season/types";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";

export type SdplLeagueMeta = {
  id: string;
  format_type?: string | null;
  sports_league_id?: string | null;
  player_count?: number | null;
  owner_user_id?: string | null;
  status?: string | null;
  current_week?: number | null;
};

export function isSdplRulesLeagueRow(league: SdplLeagueMeta): boolean {
  return isSdplSeasonRulesLeague({
    formatType: league.format_type ?? "standard",
    sportsLeagueId: league.sports_league_id ?? null,
    playerCount: league.player_count ?? null,
  });
}

async function getLeagueTeamIdsWithServiceClient(
  supabase: SupabaseClient,
  leagueId: string,
  ownerUserId: string
): Promise<string[]> {
  const { data: members } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  if (members?.length) {
    return members.map((member) => member.user_id);
  }

  return [ownerUserId];
}

export function resolveSdplRegularSeasonWeeks(
  settings: SeasonSettings
): number {
  return settings.regularSeasonWeeks || SDPL_REGULAR_SEASON_WEEKS;
}

export function buildSdplRegularSeasonSchedule(
  teamIds: string[],
  regularSeasonWeeks: number = SDPL_REGULAR_SEASON_WEEKS
): ScheduledGame[] {
  return generateCyclingRegularSeasonSchedule(teamIds, regularSeasonWeeks);
}

export function regularSeasonWeekNumbersForSchedule(
  games: ScheduledGame[]
): number[] {
  return [...new Set(games.map((game) => game.weekNumber))].sort(
    (a, b) => a - b
  );
}

export {
  missingSdplRegularSeasonWeeks,
  sdplScheduleNeedsReseed,
} from "@/lib/matchup/schedule";

export async function buildMatchupInsertRows(
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
      };
    })
  );
}

export type MigrateSdplScheduleResult = {
  leagueId: string;
  supportCode?: string | null;
  action: "skipped" | "extended" | "reseeded";
  regularSeasonWeeks: number;
  matchupsInserted: number;
  playoffWeeks: { semifinalWeek: number; finalsWeek: number };
  error?: string;
};

export async function migrateSdplLeagueToCyclingSchedule(
  leagueId: string,
  supabase: SupabaseClient,
  options?: { forceReseed?: boolean }
): Promise<MigrateSdplScheduleResult> {
  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "id, support_code, format_type, sports_league_id, player_count, owner_user_id, status, current_week"
    )
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league) {
    return {
      leagueId,
      action: "skipped",
      regularSeasonWeeks: SDPL_REGULAR_SEASON_WEEKS,
      matchupsInserted: 0,
      playoffWeeks: getSdplPlayoffWeeks(SDPL_REGULAR_SEASON_WEEKS),
      error: leagueError?.message ?? "League not found",
    };
  }

  if (!isSdplRulesLeagueRow(league)) {
    return {
      leagueId,
      supportCode: league.support_code,
      action: "skipped",
      regularSeasonWeeks: SDPL_REGULAR_SEASON_WEEKS,
      matchupsInserted: 0,
      playoffWeeks: getSdplPlayoffWeeks(SDPL_REGULAR_SEASON_WEEKS),
    };
  }

  const settingsResult = await supabase
    .from("league_season_settings")
    .select("season_format, regular_season_weeks, week_calendar")
    .eq("league_id", leagueId)
    .maybeSingle();

  const settings = resolveSeasonSettings(
    {
      formatType: league.format_type ?? "standard",
      sportsLeagueId: league.sports_league_id,
      playerCount: league.player_count,
    },
    settingsResult.data ?? null
  );

  const regularSeasonWeeks = resolveSdplRegularSeasonWeeks(settings);
  const playoffWeeks = getSdplPlayoffWeeks(regularSeasonWeeks);
  const ownerUserId = league.owner_user_id;
  if (!ownerUserId) {
    return {
      leagueId,
      supportCode: league.support_code,
      action: "skipped",
      regularSeasonWeeks,
      matchupsInserted: 0,
      playoffWeeks,
      error: "Missing league owner",
    };
  }

  const teamIds = await getLeagueTeamIdsWithServiceClient(
    supabase,
    leagueId,
    ownerUserId
  );
  if (teamIds.length < 2) {
    return {
      leagueId,
      supportCode: league.support_code,
      action: "skipped",
      regularSeasonWeeks,
      matchupsInserted: 0,
      playoffWeeks,
      error: "Not enough teams",
    };
  }

  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("week_number, is_playoff, status")
    .eq("league_id", leagueId);

  const regularRows = (matchups ?? []).filter((row) => !row.is_playoff);
  const regularWeekNumbers = [
    ...new Set(regularRows.map((row) => row.week_number)),
  ].sort((a, b) => a - b);

  const completedRegular = regularRows.some((row) => row.status === "complete");
  const fullSchedule = buildSdplRegularSeasonSchedule(
    teamIds,
    regularSeasonWeeks
  );

  const needsReseed =
    options?.forceReseed ||
    sdplScheduleNeedsReseed(regularWeekNumbers, regularSeasonWeeks);

  let gamesToInsert: ScheduledGame[] = [];
  let action: MigrateSdplScheduleResult["action"] = "skipped";

  if (needsReseed && !completedRegular) {
    await supabase.from("league_matchups").delete().eq("league_id", leagueId);
    await supabase
      .from("roster_week_baselines")
      .delete()
      .eq("league_id", leagueId);

    await supabase
      .from("league_standings")
      .update({ wins: 0, losses: 0, current_week: 1 })
      .eq("league_id", leagueId);

    await supabase
      .from("leagues")
      .update({ status: "active", current_week: 1 })
      .eq("id", leagueId);

    gamesToInsert = fullSchedule;
    action = "reseeded";
  } else {
    const missingWeeks = missingSdplRegularSeasonWeeks(
      regularWeekNumbers,
      regularSeasonWeeks
    );

    if (missingWeeks.length === 0) {
      return {
        leagueId,
        supportCode: league.support_code,
        action: "skipped",
        regularSeasonWeeks,
        matchupsInserted: 0,
        playoffWeeks,
      };
    }

    gamesToInsert = fullSchedule.filter((game) =>
      missingWeeks.includes(game.weekNumber)
    );
    action = "extended";
  }

  if (gamesToInsert.length === 0) {
    return {
      leagueId,
      supportCode: league.support_code,
      action,
      regularSeasonWeeks,
      matchupsInserted: 0,
      playoffWeeks,
    };
  }

  const rows = await buildMatchupInsertRows(
    leagueId,
    ownerUserId,
    gamesToInsert,
    supabase
  );

  const { error: insertError } = await supabase
    .from("league_matchups")
    .insert(rows);

  if (insertError) {
    return {
      leagueId,
      supportCode: league.support_code,
      action,
      regularSeasonWeeks,
      matchupsInserted: 0,
      playoffWeeks,
      error: insertError.message,
    };
  }

  if (action === "reseeded") {
    await captureWeekBaselinesForLeague(leagueId, 1, supabase);
    await backfillFinalizeAtForLeagueWeek(
      leagueId,
      1,
      settings,
      new Date(),
      supabase
    );
  } else {
    const firstNewWeek = Math.min(...gamesToInsert.map((g) => g.weekNumber));
    await backfillFinalizeAtForLeagueWeek(
      leagueId,
      firstNewWeek,
      settings,
      new Date(),
      supabase
    );
  }

  return {
    leagueId,
    supportCode: league.support_code,
    action,
    regularSeasonWeeks,
    matchupsInserted: rows.length,
    playoffWeeks,
  };
}

export async function migrateActiveSdplLeagues(
  supabase: SupabaseClient,
  options?: { forceReseed?: boolean; status?: string }
): Promise<MigrateSdplScheduleResult[]> {
  const status = options?.status ?? "active";
  const { data: leagues } = await supabase
    .from("leagues")
    .select(
      "id, support_code, format_type, sports_league_id, player_count, owner_user_id, status, current_week"
    )
    .eq("status", status);

  const results: MigrateSdplScheduleResult[] = [];

  for (const league of leagues ?? []) {
    if (!isSdplRulesLeagueRow(league)) continue;
    results.push(
      await migrateSdplLeagueToCyclingSchedule(league.id, supabase, options)
    );
  }

  return results;
}
