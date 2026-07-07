import {
  SDPL_REGULAR_SEASON_WEEKS,
  SDPL_TOTAL_SEASON_WEEKS,
} from "@/lib/season/constants";
import type { WeekCalendarEntry } from "@/lib/season/types";

/**
 * Sponsor-demo standard SDPL calendar: Week 1 matchup period begins 2026-07-06,
 * Week 1 finalizes 2026-07-14 at 6:00 AM ET, then weekly Mondays through the season.
 */
export const SDPL_SPONSOR_DEMO_WEEK1_FINALIZE = "2026-07-14";

export function buildStandardSdplWeekCalendar(
  week1FinalizeMondayIso: string,
  totalWeeks: number = SDPL_TOTAL_SEASON_WEEKS
): WeekCalendarEntry[] {
  const [year, month, day] = week1FinalizeMondayIso.split("-").map(Number);
  const entries: WeekCalendarEntry[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const finalize = new Date(Date.UTC(year, month - 1, day + (week - 1) * 7));
    const iso = `${finalize.getUTCFullYear()}-${String(
      finalize.getUTCMonth() + 1
    ).padStart(2, "0")}-${String(finalize.getUTCDate()).padStart(2, "0")}`;
    entries.push({ week, date: iso });
  }

  return entries;
}

export const SDPL_SPONSOR_DEMO_WEEK_CALENDAR = buildStandardSdplWeekCalendar(
  SDPL_SPONSOR_DEMO_WEEK1_FINALIZE
);

export const SDPL_SPONSOR_DEMO_REGULAR_SEASON_WEEKS = SDPL_REGULAR_SEASON_WEEKS;
