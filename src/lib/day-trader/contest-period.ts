import {
  LINEUP_LOCK_END_MINUTES,
  LINEUP_LOCK_START_MINUTES,
} from "@/lib/season/constants";
import {
  addEasternDays,
  getEasternParts,
  minutesOfDay,
  type EasternParts,
} from "@/lib/season/eastern-time";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function mondayToFridayBounds(parts: EasternParts): {
  weekStart: Date;
  weekEnd: Date;
} {
  const weekdayIndex = WEEKDAY_INDEX[parts.weekday] ?? 0;
  const daysSinceMonday = weekdayIndex === 0 ? 6 : weekdayIndex - 1;

  const weekStart = addEasternDays(
    parts,
    -daysSinceMonday,
    Math.floor(LINEUP_LOCK_START_MINUTES / 60),
    LINEUP_LOCK_START_MINUTES % 60
  );
  const weekStartParts = getEasternParts(weekStart);
  const weekEnd = addEasternDays(
    weekStartParts,
    4,
    Math.floor(LINEUP_LOCK_END_MINUTES / 60),
    LINEUP_LOCK_END_MINUTES % 60
  );

  return { weekStart, weekEnd };
}

/** Mon 9:30 AM ET – Fri 4:00 PM ET for the calendar week containing `now`. */
export function getDayTraderWeekBounds(now: Date = new Date()): {
  weekStart: Date;
  weekEnd: Date;
} {
  return mondayToFridayBounds(getEasternParts(now));
}

/**
 * Contest row to create or open next: the active week while the window is open,
 * otherwise the next Mon–Fri block (early Monday, post-close Friday, weekend).
 */
export function getDayTraderUpcomingWeekBounds(now: Date = new Date()): {
  weekStart: Date;
  weekEnd: Date;
} {
  const current = getDayTraderWeekBounds(now);
  if (isDayTraderContestWindowOpen(now)) {
    return current;
  }

  const parts = getEasternParts(now);
  const weekdayIndex = WEEKDAY_INDEX[parts.weekday] ?? 0;
  const mins = minutesOfDay(parts.hour, parts.minute);

  if (weekdayIndex === 1 && mins < LINEUP_LOCK_START_MINUTES) {
    return current;
  }

  const weekStartParts = getEasternParts(current.weekStart);
  const nextWeekStart = addEasternDays(
    weekStartParts,
    7,
    Math.floor(LINEUP_LOCK_START_MINUTES / 60),
    LINEUP_LOCK_START_MINUTES % 60
  );
  const nextWeekStartParts = getEasternParts(nextWeekStart);
  const nextWeekEnd = addEasternDays(
    nextWeekStartParts,
    4,
    Math.floor(LINEUP_LOCK_END_MINUTES / 60),
    LINEUP_LOCK_END_MINUTES % 60
  );

  return { weekStart: nextWeekStart, weekEnd: nextWeekEnd };
}

/** True during Mon 9:30 AM ET – Fri 4:00 PM ET (entries + trading). */
export function isDayTraderContestWindowOpen(now: Date = new Date()): boolean {
  const parts = getEasternParts(now);
  const weekdayIndex = WEEKDAY_INDEX[parts.weekday] ?? 0;

  if (weekdayIndex === 0 || weekdayIndex === 6) return false;

  const mins = minutesOfDay(parts.hour, parts.minute);
  if (weekdayIndex === 1 && mins < LINEUP_LOCK_START_MINUTES) return false;
  if (weekdayIndex === 5 && mins >= LINEUP_LOCK_END_MINUTES) return false;

  return true;
}

/** True when Friday contest should snapshot (at or after 4:00 PM ET). */
export function isDayTraderWeekFinalizeDue(now: Date = new Date()): boolean {
  const parts = getEasternParts(now);
  if (parts.weekday !== "Fri") return false;
  return minutesOfDay(parts.hour, parts.minute) >= LINEUP_LOCK_END_MINUTES;
}
