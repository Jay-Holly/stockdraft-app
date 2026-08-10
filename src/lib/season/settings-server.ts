import { createClient } from "@/lib/supabase/server";
import {
  getSeasonCalendarState,
  resolveSeasonSettings,
} from "@/lib/season/calendar";
import { enforcesStandardMoveGates } from "@/lib/season/sdpl-league";
import type {
  LeagueFormatMeta,
  SeasonCalendarState,
  SeasonSettings,
  SeasonSettingsRow,
} from "@/lib/season/types";

export type SeasonCalendarPayload = {
  settings: SeasonSettings;
  calendar: SeasonCalendarState;
};

async function loadLeagueSeasonInputs(leagueId: string): Promise<{
  meta: LeagueFormatMeta;
  settingsRow: SeasonSettingsRow | null;
}> {
  const supabase = await createClient();

  const [{ data: leagueRow }, settingsResult] = await Promise.all([
    supabase
      .from("leagues")
      .select("format_type, sports_league_id, player_count")
      .eq("id", leagueId)
      .maybeSingle(),
    supabase
      .from("league_season_settings")
      .select("season_format, regular_season_weeks, week_calendar")
      .eq("league_id", leagueId)
      .maybeSingle(),
  ]);

  const settingsRow =
    settingsResult.error &&
    (settingsResult.error.code === "PGRST205" ||
      settingsResult.error.message.includes("league_season_settings"))
      ? null
      : (settingsResult.data as SeasonSettingsRow | null);

  return {
    meta: {
      formatType: leagueRow?.format_type ?? "standard",
      sportsLeagueId: leagueRow?.sports_league_id ?? null,
      playerCount: leagueRow?.player_count ?? null,
    },
    settingsRow,
  };
}

export async function loadSeasonCalendarForLeague(
  leagueId: string,
  now: Date = new Date()
): Promise<SeasonCalendarPayload> {
  const { meta, settingsRow } = await loadLeagueSeasonInputs(leagueId);

  const settings = resolveSeasonSettings(meta, settingsRow);
  const calendar = getSeasonCalendarState(now, settings);

  return { settings, calendar };
}

/**
 * Same calendar, but with the lineup-lock and free-agency gates forced on for
 * leagues that enforce move gates without using SDPL's season structure —
 * today that means SDFL.
 *
 * Use this ONLY for roster-move enforcement and the lock/FA banner. Scoring,
 * week finalization and awards must keep loadSeasonCalendarForLeague, whose
 * rulesApply stays SDPL-only: turning it on for SDFL there would change when
 * its weeks finalize and how closing prices are captured.
 */
export async function loadMoveGateCalendarForLeague(
  leagueId: string,
  now: Date = new Date()
): Promise<SeasonCalendarPayload> {
  const { meta, settingsRow } = await loadLeagueSeasonInputs(leagueId);

  const base = resolveSeasonSettings(meta, settingsRow);
  const settings =
    base.rulesApply || !enforcesStandardMoveGates(meta)
      ? base
      : { ...base, rulesApply: true };
  const calendar = getSeasonCalendarState(now, settings);

  return { settings, calendar };
}
