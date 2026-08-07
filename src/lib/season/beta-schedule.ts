import {
  LINEUP_LOCK_END_MINUTES,
  SDPL_FINALS_WEEK,
  SDPL_REGULAR_SEASON_WEEKS,
  SDPL_SEMIFINAL_WEEK,
  SDPL_TOTAL_SEASON_WEEKS,
} from "@/lib/season/constants";
import { getEasternParts, minutesOfDay } from "@/lib/season/eastern-time";
import type { WeekCalendarEntry } from "@/lib/season/types";
import { generateCyclingRegularSeasonSchedule } from "@/lib/matchup/schedule";

/** SDAI-00039 compressed daily-week beta calendar (Jun 29 – Jul 15, 2026). */
export const SDAI_BETA_WEEK_CALENDAR: WeekCalendarEntry[] = [
  { week: 1, date: "2026-06-29" },
  { week: 2, date: "2026-06-30" },
  { week: 3, date: "2026-07-01" },
  { week: 4, date: "2026-07-02" },
  { week: 5, date: "2026-07-03" },
  { week: 6, date: "2026-07-06" },
  { week: 7, date: "2026-07-07" },
  { week: 8, date: "2026-07-08" },
  { week: 9, date: "2026-07-09" },
  { week: 10, date: "2026-07-10" },
  { week: 11, date: "2026-07-13" },
  { week: SDPL_SEMIFINAL_WEEK, date: "2026-07-14" },
  { week: SDPL_FINALS_WEEK, date: "2026-07-15" },
];

/** @deprecated Use generateCyclingRegularSeasonSchedule from schedule.ts */
export const generateBetaDailyRegularSeasonSchedule =
  generateCyclingRegularSeasonSchedule;

/** NYSE full-day closures. Extend this set as later years' schedules are published. */
const NYSE_HOLIDAYS_2026 = new Set([
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
]);

function isMarketHoliday(iso: string): boolean {
  return NYSE_HOLIDAYS_2026.has(iso);
}

function isoFromUtcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * First trading-day date (ET, YYYY-MM-DD) a new "1 day = 1 week" SDAI season
 * should start on: today if it's a weekday before the 4 PM ET lineup lock,
 * otherwise the next weekday.
 */
export function nextOrCurrentTradingDayIso(anchor: Date = new Date()): string {
  const parts = getEasternParts(anchor);
  let cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const isTradingDay = () => {
    const day = cursor.getUTCDay();
    return day !== 0 && day !== 6 && !isMarketHoliday(isoFromUtcDate(cursor));
  };
  const beforeLock =
    isTradingDay() && minutesOfDay(parts.hour, parts.minute) < LINEUP_LOCK_END_MINUTES;

  if (!beforeLock) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  while (!isTradingDay()) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return isoFromUtcDate(cursor);
}

/**
 * Builds a compressed "1 trading day = 1 week" calendar for a new SDAI
 * league — a quick-to-play format so new users can learn the game without
 * waiting out a real 13-week season. Weekends are skipped; the last two
 * entries are semifinal/finals.
 */
export function buildDailyWeekCalendar(
  startDateIso: string,
  totalWeeks: number = SDPL_TOTAL_SEASON_WEEKS
): WeekCalendarEntry[] {
  const [year, month, day] = startDateIso.split("-").map(Number);
  let cursor = new Date(Date.UTC(year, month - 1, day));
  const entries: WeekCalendarEntry[] = [];

  let week = 1;
  while (week <= totalWeeks) {
    const weekday = cursor.getUTCDay();
    const iso = isoFromUtcDate(cursor);
    if (weekday !== 0 && weekday !== 6 && !isMarketHoliday(iso)) {
      entries.push({
        week: week === totalWeeks - 1 ? SDPL_SEMIFINAL_WEEK : week === totalWeeks ? SDPL_FINALS_WEEK : week,
        date: iso,
      });
      week++;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return entries;
}
