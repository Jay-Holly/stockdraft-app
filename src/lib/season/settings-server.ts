import { createClient } from "@/lib/supabase/server";
import {
  getSeasonCalendarState,
  resolveSeasonSettings,
} from "@/lib/season/calendar";
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

export async function loadSeasonCalendarForLeague(
  leagueId: string,
  now: Date = new Date()
): Promise<SeasonCalendarPayload> {
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

  const meta: LeagueFormatMeta = {
    formatType: leagueRow?.format_type ?? "standard",
    sportsLeagueId: leagueRow?.sports_league_id ?? null,
    playerCount: leagueRow?.player_count ?? null,
  };

  const settings = resolveSeasonSettings(
    meta,
    settingsRow
  );
  const calendar = getSeasonCalendarState(now, settings);

  return { settings, calendar };
}
