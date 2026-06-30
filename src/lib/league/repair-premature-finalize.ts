import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { backfillFinalizeAtForLeagueWeek } from "@/lib/matchup/finalize-week";
import { finalizeMatchupsForLeagueWeek } from "@/lib/matchup/scoring";
import { syncLeagueCurrentWeek } from "@/lib/matchup/league-teams";
import { resolveSeasonSettings } from "@/lib/season/calendar";
import {
  computeWeekFinalizeAt,
  isPastFinalizeAt,
} from "@/lib/season/finalize-times";
import { createServiceClient } from "@/lib/supabase/service";
import type { SeasonSettingsRow } from "@/lib/season/types";

export type RepairPrematureFinalizeOptions = {
  supportCode: string;
  /** Reopen this week (for re-score) and any later weeks finalized before due. */
  reopenFromWeek: number;
  /** When set, run finalize for this week after repair if its window has passed. */
  finalizeWeek?: number;
  now?: Date;
  supabase?: SupabaseClient;
};

export type RepairPrematureFinalizeResult = {
  leagueId: string;
  supportCode: string;
  reopenedWeeks: number[];
  currentWeek: number;
  finalizedWeek?: number;
  finalized?: boolean;
};

async function loadSettings(
  supabase: SupabaseClient,
  leagueId: string,
  formatType: string,
  sportsLeagueId: string | null,
  playerCount: number | null
) {
  const settingsResult = await supabase
    .from("league_season_settings")
    .select("season_format, regular_season_weeks, week_calendar")
    .eq("league_id", leagueId)
    .maybeSingle();

  const settingsRow =
    settingsResult.error &&
    (settingsResult.error.code === "PGRST205" ||
      settingsResult.error.message?.includes("league_season_settings"))
      ? null
      : (settingsResult.data as SeasonSettingsRow | null);

  return resolveSeasonSettings(
    {
      formatType,
      sportsLeagueId,
      playerCount,
    },
    settingsRow
  );
}

async function reapplyStandingsFromCompleteMatchups(
  supabase: SupabaseClient,
  leagueId: string
): Promise<void> {
  await supabase
    .from("league_standings")
    .update({ wins: 0, losses: 0, updated_at: new Date().toISOString() })
    .eq("league_id", leagueId);

  const { data: completed } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id")
    .eq("league_id", leagueId)
    .eq("status", "complete");

  for (const matchup of completed ?? []) {
    if (!matchup.home_user_id || !matchup.away_user_id || !matchup.winner_user_id) {
      continue;
    }

    const loserId =
      matchup.winner_user_id === matchup.home_user_id
        ? matchup.away_user_id
        : matchup.home_user_id;

    for (const [userId, delta] of [
      [matchup.winner_user_id, { wins: 1, losses: 0 }],
      [loserId, { wins: 0, losses: 1 }],
    ] as const) {
      const { data: row } = await supabase
        .from("league_standings")
        .select("wins, losses")
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!row) continue;

      await supabase
        .from("league_standings")
        .update({
          wins: (row.wins ?? 0) + delta.wins,
          losses: (row.losses ?? 0) + delta.losses,
          updated_at: new Date().toISOString(),
        })
        .eq("league_id", leagueId)
        .eq("user_id", userId);
    }
  }
}

export async function repairPrematureSdplFinalization(
  options: RepairPrematureFinalizeOptions
): Promise<RepairPrematureFinalizeResult> {
  const supabase = options.supabase ?? createServiceClient();
  const now = options.now ?? new Date();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "id, support_code, current_week, format_type, sports_league_id, player_count"
    )
    .eq("support_code", options.supportCode)
    .maybeSingle();

  if (leagueError || !league) {
    throw new Error(
      leagueError?.message ?? `League not found: ${options.supportCode}`
    );
  }

  const settings = await loadSettings(
    supabase,
    league.id,
    league.format_type,
    league.sports_league_id,
    league.player_count
  );

  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("id, week_number, status")
    .eq("league_id", league.id)
    .gte("week_number", options.reopenFromWeek)
    .eq("status", "complete")
    .order("week_number");

  const reopenedWeeks: number[] = [];

  for (const matchup of matchups ?? []) {
    const finalizeAt = computeWeekFinalizeAt(
      settings,
      matchup.week_number,
      now
    ).toISOString();
    const due = isPastFinalizeAt(finalizeAt, now);
    const reopenForRescore =
      options.finalizeWeek != null &&
      matchup.week_number === options.finalizeWeek;
    const reopenPremature = !due;

    if (!reopenForRescore && !reopenPremature) continue;

    if (!reopenedWeeks.includes(matchup.week_number)) {
      reopenedWeeks.push(matchup.week_number);
    }

    await supabase
      .from("league_matchups")
      .update({
        status: "scheduled",
        home_score: null,
        away_score: null,
        winner_user_id: null,
        human_score_pct: null,
        opponent_score_pct: null,
        winner: null,
        scored_at: null,
        stock_close_captured_at: null,
      })
      .eq("id", matchup.id);

    await backfillFinalizeAtForLeagueWeek(
      league.id,
      matchup.week_number,
      settings,
      now,
      supabase
    );
  }

  await reapplyStandingsFromCompleteMatchups(supabase, league.id);
  await syncLeagueCurrentWeek(league.id, options.reopenFromWeek, supabase);

  let finalized: boolean | undefined;
  if (options.finalizeWeek != null) {
    const finalizeAt = computeWeekFinalizeAt(
      settings,
      options.finalizeWeek,
      now
    ).toISOString();

    if (isPastFinalizeAt(finalizeAt, now)) {
      const result = await finalizeMatchupsForLeagueWeek(
        league.id,
        options.finalizeWeek,
        now,
        supabase
      );
      finalized = result.finalized;
    }
  }

  const { data: refreshed } = await supabase
    .from("leagues")
    .select("current_week")
    .eq("id", league.id)
    .single();

  return {
    leagueId: league.id,
    supportCode: league.support_code ?? options.supportCode,
    reopenedWeeks: [...new Set(reopenedWeeks)].sort((a, b) => a - b),
    currentWeek: refreshed?.current_week ?? options.reopenFromWeek,
    finalizedWeek: options.finalizeWeek,
    finalized,
  };
}
