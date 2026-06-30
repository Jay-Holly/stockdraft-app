import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { getLeagueTeamIds } from "@/lib/matchup/league-teams";
import { backfillFinalizeAtForLeagueWeek } from "@/lib/matchup/finalize-week";
import {
  buildMatchupInsertRows,
  buildSdplRegularSeasonSchedule,
} from "@/lib/matchup/sdpl-schedule";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";
import { resetLeagueBonusPoolForSeason } from "@/lib/awards/pool";
import { staleDuplicateCryptoPickIds } from "@/lib/roster/crypto-picks";
import type { DraftPick } from "@/lib/draft/types";
import { SDAI_BETA_WEEK_CALENDAR } from "@/lib/season/beta-schedule";
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

/** Remove zero-budget crypto shells left behind by full swaps/rebalances. */
export async function cleanupDeadCryptoDraftPicksForLeague(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<number> {
  const supabase = supabaseOverride ?? createServiceClient();
  const { data: drafts } = await supabase
    .from("drafts")
    .select("id")
    .eq("league_id", leagueId);

  let removed = 0;

  for (const draft of drafts ?? []) {
    const { data: deadPicks } = await supabase
      .from("draft_picks")
      .select("id")
      .eq("draft_id", draft.id)
      .eq("pick_type", "crypto")
      .lte("budget_spent", 0.01)
      .lte("shares", 0.000001);

    if (!deadPicks?.length) continue;

    const ids = deadPicks.map((pick) => pick.id);
    const { error } = await supabase.from("draft_picks").delete().in("id", ids);
    if (error) {
      throw new Error(`Failed to delete dead crypto picks: ${error.message}`);
    }
    removed += ids.length;
  }

  return removed;
}

/** Keep one active crypto row per symbol (latest updated_at); delete stale duplicates. */
export async function cleanupDuplicateActiveCryptoDraftPicksForLeague(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<number> {
  const supabase = supabaseOverride ?? createServiceClient();
  const { data: drafts } = await supabase
    .from("drafts")
    .select("id")
    .eq("league_id", leagueId);

  let removed = 0;

  for (const draft of drafts ?? []) {
    const { data: picks } = await supabase
      .from("draft_picks")
      .select("*")
      .eq("draft_id", draft.id);

    if (!picks?.length) continue;

    const staleIds = staleDuplicateCryptoPickIds(picks as DraftPick[]);
    if (staleIds.length === 0) continue;

    const { error } = await supabase.from("draft_picks").delete().in("id", staleIds);
    if (error) {
      throw new Error(
        `Failed to delete duplicate active crypto picks: ${error.message}`
      );
    }
    removed += staleIds.length;
  }

  return removed;
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
  await resetLeagueBonusPoolForSeason(leagueId, supabase);
  await cleanupDeadCryptoDraftPicksForLeague(leagueId, supabase);
  await cleanupDuplicateActiveCryptoDraftPicksForLeague(leagueId, supabase);

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
    })
    .eq("id", leagueId);

  const teamIds = await getLeagueTeamIds(leagueId, ownerUserId);
  if (teamIds.length < 2) {
    throw new Error(
      `Not enough teams to seed schedule (${teamIds.length} found).`
    );
  }

  const schedule = buildSdplRegularSeasonSchedule(teamIds, regularSeasonWeeks);
  const rows = await buildMatchupInsertRows(
    leagueId,
    ownerUserId,
    schedule,
    supabase
  );

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
