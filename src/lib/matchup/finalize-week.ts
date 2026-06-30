import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { captureFridayStockCloseForLeague } from "@/lib/roster/weekly";
import { resolveSeasonSettings } from "@/lib/season/calendar";
import {
  computeWeekFinalizeAt,
  isPastFinalizeAt,
  weekUsesWeekendExtension,
} from "@/lib/season/finalize-times";
import { getEasternParts, minutesOfDay } from "@/lib/season/eastern-time";
import { LINEUP_LOCK_END_MINUTES } from "@/lib/season/constants";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";
import { SDAI_BETA_WEEK_CALENDAR } from "@/lib/season/beta-schedule";
import type { SeasonSettings, SeasonSettingsRow } from "@/lib/season/types";

type JobSupabase = ReturnType<typeof createServiceClient>;

async function loadLeagueSeasonSettings(
  supabase: JobSupabase,
  leagueId: string
): Promise<SeasonSettings> {
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("format_type, sports_league_id, player_count")
    .eq("id", leagueId)
    .maybeSingle();

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
      formatType: leagueRow?.format_type ?? "standard",
      sportsLeagueId: leagueRow?.sports_league_id ?? null,
      playerCount: leagueRow?.player_count ?? null,
    },
    settingsRow
  );
}

/** Bootstrap beta_daily settings when migration seeded matchups but not season settings. */
async function ensureBetaSeasonSettingsIfMissing(
  supabase: JobSupabase,
  leagueId: string,
  supportCode: string | null | undefined
): Promise<void> {
  if (supportCode !== "SDAI-00039") return;

  const { data: existing } = await supabase
    .from("league_season_settings")
    .select("league_id")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (existing) return;

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
}

export async function backfillFinalizeAtForLeagueWeek(
  leagueId: string,
  weekNumber: number,
  settings: SeasonSettings,
  anchor: Date = new Date(),
  supabaseOverride?: JobSupabase
): Promise<void> {
  if (!settings.rulesApply) return;

  const supabase = supabaseOverride ?? createServiceClient();
  const finalizeAt = computeWeekFinalizeAt(settings, weekNumber, anchor);

  await supabase
    .from("league_matchups")
    .update({ finalize_at: finalizeAt.toISOString() })
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "scheduled")
    .is("finalize_at", null);
}

export async function backfillFinalizeAtForLeague(
  leagueId: string
): Promise<void> {
  const supabase = await createClient();
  const settings = await loadLeagueSeasonSettings(
    createServiceClient(),
    leagueId
  );
  if (!settings.rulesApply) return;

  const { data: league } = await supabase
    .from("leagues")
    .select("current_week")
    .eq("id", leagueId)
    .maybeSingle();

  const currentWeek = league?.current_week ?? 1;
  await backfillFinalizeAtForLeagueWeek(
    leagueId,
    currentWeek,
    settings,
    new Date(),
    createServiceClient()
  );
}

export async function setNextWeekFinalizeAt(
  leagueId: string,
  weekNumber: number,
  anchor: Date = new Date()
): Promise<void> {
  const supabase = createServiceClient();
  const settings = await loadLeagueSeasonSettings(supabase, leagueId);
  if (!settings.rulesApply) return;

  const finalizeAt = computeWeekFinalizeAt(settings, weekNumber, anchor);
  await supabase
    .from("league_matchups")
    .update({ finalize_at: finalizeAt.toISOString() })
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "scheduled");
}

function isFridayStockCaptureDue(now: Date): boolean {
  const parts = getEasternParts(now);
  return (
    parts.weekday === "Fri" &&
    minutesOfDay(parts.hour, parts.minute) >= LINEUP_LOCK_END_MINUTES
  );
}

export async function captureFridayStockCloseForActiveLeagues(
  now: Date = new Date()
): Promise<{ leagues: number; captured: number; errors: string[] }> {
  const supabase = createServiceClient();
  let captured = 0;
  const errors: string[] = [];

  const { data: leagues } = await supabase
    .from("leagues")
    .select("id, format_type, sports_league_id, player_count, current_week, status")
    .eq("status", "active");

  for (const league of leagues ?? []) {
    if (
      !isSdplSeasonRulesLeague({
        formatType: league.format_type,
        sportsLeagueId: league.sports_league_id,
        playerCount: league.player_count,
      })
    ) {
      continue;
    }

    const settings = await loadLeagueSeasonSettings(supabase, league.id);
    const weekNumber = league.current_week ?? 1;

    if (!weekUsesWeekendExtension(settings, weekNumber)) continue;
    if (!isFridayStockCaptureDue(now)) continue;

    const { data: matchups } = await supabase
      .from("league_matchups")
      .select("stock_close_captured_at")
      .eq("league_id", league.id)
      .eq("week_number", weekNumber)
      .eq("status", "scheduled")
      .limit(1);

    if (matchups?.[0]?.stock_close_captured_at) continue;

    try {
      await captureFridayStockCloseForLeague(
        league.id,
        weekNumber,
        supabase
      );
      captured += 1;
    } catch (error) {
      errors.push(
        `${league.id}: ${
          error instanceof Error ? error.message : "Friday capture failed"
        }`
      );
    }
  }

  return {
    leagues: leagues?.length ?? 0,
    captured,
    errors,
  };
}

export async function finalizeDueMatchupsForAllLeagues(
  now: Date = new Date()
): Promise<{
  leaguesChecked: number;
  weeksFinalized: number;
  errors: string[];
}> {
  const supabase = createServiceClient();
  // Active AI + human leagues share this cron. SDPL rows wait for finalize_at;
  // sports-sim leagues keep legacy immediate finalization.
  const { data: leagues } = await supabase
    .from("leagues")
    .select(
      "id, support_code, format_type, sports_league_id, player_count, status"
    )
    .eq("status", "active");

  let weeksFinalized = 0;
  const errors: string[] = [];

  for (const league of leagues ?? []) {
    const isSdpl = isSdplSeasonRulesLeague({
      formatType: league.format_type,
      sportsLeagueId: league.sports_league_id,
      playerCount: league.player_count,
    });

    const { data: scheduledWeeks } = await supabase
      .from("league_matchups")
      .select("week_number, finalize_at")
      .eq("league_id", league.id)
      .eq("status", "scheduled");

    const weekNumbers = [
      ...new Set((scheduledWeeks ?? []).map((row) => row.week_number)),
    ];

    for (const weekNumber of weekNumbers) {
      let settings: SeasonSettings | null = null;

      if (isSdpl) {
        await ensureBetaSeasonSettingsIfMissing(
          supabase,
          league.id,
          league.support_code
        );
        settings = await loadLeagueSeasonSettings(supabase, league.id);
        await backfillFinalizeAtForLeagueWeek(
          league.id,
          weekNumber,
          settings,
          now,
          supabase
        );
      }

  if (isSdpl) {
        if (!settings) {
          errors.push(
            `${league.id} w${weekNumber}: missing season settings for SDPL finalize`
          );
          continue;
        }
        const finalizeAt = computeWeekFinalizeAt(
          settings,
          weekNumber,
          now
        ).toISOString();
        if (!isPastFinalizeAt(finalizeAt, now)) {
          continue;
        }
      } else {
        const finalizeAt =
          scheduledWeeks?.find((row) => row.week_number === weekNumber)
            ?.finalize_at ?? null;
        if (finalizeAt && !isPastFinalizeAt(finalizeAt, now)) {
          continue;
        }
      }

      try {
        const { finalizeMatchupsForLeagueWeek } = await import(
          "@/lib/matchup/scoring"
        );
        const result = await finalizeMatchupsForLeagueWeek(
          league.id,
          weekNumber,
          now,
          supabase
        );
        if (result.finalized) weeksFinalized += 1;
        if (result.error) {
          errors.push(`${league.id} w${weekNumber}: ${result.error}`);
        }
      } catch (error) {
        errors.push(
          `${league.id} w${weekNumber}: ${
            error instanceof Error ? error.message : "Finalize failed"
          }`
        );
      }
    }
  }

  return {
    leaguesChecked: leagues?.length ?? 0,
    weeksFinalized,
    errors,
  };
}

export async function canFinalizeLeagueWeek(
  leagueId: string,
  weekNumber: number,
  now: Date = new Date()
): Promise<boolean> {
  const supabase = await createClient();
  const settings = await loadLeagueSeasonSettings(createServiceClient(), leagueId);

  if (!settings.rulesApply) return true;

  await backfillFinalizeAtForLeagueWeek(
    leagueId,
    weekNumber,
    settings,
    now,
    createServiceClient()
  );

  const { data } = await supabase
    .from("league_matchups")
    .select("finalize_at")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "scheduled")
    .not("finalize_at", "is", null)
    .limit(1)
    .maybeSingle();

  if (!data?.finalize_at) return false;
  return isPastFinalizeAt(data.finalize_at, now);
}
