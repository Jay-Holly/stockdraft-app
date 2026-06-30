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
 * Contest row to create or open next: the active week while trading is open,
 * otherwise the next Mon–Fri block (post-close Friday, weekend, early Monday).
 */
export function getDayTraderUpcomingWeekBounds(now: Date = new Date()): {
  weekStart: Date;
  weekEnd: Date;
} {
  const current = getDayTraderWeekBounds(now);
  if (isDayTraderTradingWindowOpen(now)) {
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

/** Previous Friday 4:00 PM ET — entry opens for the contest week starting that Monday. */
export function getDayTraderEntryWindowStart(weekStart: Date): Date {
  const parts = getEasternParts(weekStart);
  return addEasternDays(
    parts,
    -3,
    Math.floor(LINEUP_LOCK_END_MINUTES / 60),
    LINEUP_LOCK_END_MINUTES % 60
  );
}

type ContestWindowBounds = {
  week_start_at: string;
  week_end_at: string;
  status: string;
};

/** Fri 4:00 PM ET (prior week) through Mon 9:30 AM ET (contest week start). */
export function isDayTraderEntryWindowOpenForContest(
  now: Date,
  contest: ContestWindowBounds
): boolean {
  if (contest.status !== "upcoming" && contest.status !== "open") {
    return false;
  }

  const entryStart = getDayTraderEntryWindowStart(
    new Date(contest.week_start_at)
  );
  const entryEnd = new Date(contest.week_start_at);
  return now >= entryStart && now < entryEnd;
}

export const DAY_TRADER_ENTRY_MIDWEEK_CLOSED_MESSAGE =
  "The week is already in progress. Please sign up to play next week before 9:30am EST Monday morning.";

/** Mon 9:30 AM – Fri 4:00 PM ET for this contest week. */
export function isDayTraderTradingWeekUnderway(
  now: Date,
  contest: ContestWindowBounds
): boolean {
  const weekStart = new Date(contest.week_start_at);
  const weekEnd = new Date(contest.week_end_at);
  return now >= weekStart && now < weekEnd;
}

export function getDayTraderEntryBlockedMessage(
  now: Date,
  contest: ContestWindowBounds | null
): string {
  if (
    contest &&
    isDayTraderTradingWeekUnderway(now, contest) &&
    !isDayTraderEntryWindowOpenForContest(now, contest)
  ) {
    return DAY_TRADER_ENTRY_MIDWEEK_CLOSED_MESSAGE;
  }

  return "Entry opens Friday 4:00 PM ET for the upcoming week and closes Monday 9:30 AM ET.";
}

/** True during Mon 9:30 AM ET – Fri 4:00 PM ET (active trading hours). */
export function isDayTraderTradingWindowOpen(now: Date = new Date()): boolean {
  const parts = getEasternParts(now);
  const weekdayIndex = WEEKDAY_INDEX[parts.weekday] ?? 0;

  if (weekdayIndex === 0 || weekdayIndex === 6) return false;

  const mins = minutesOfDay(parts.hour, parts.minute);
  if (weekdayIndex === 1 && mins < LINEUP_LOCK_START_MINUTES) return false;
  if (weekdayIndex === 5 && mins >= LINEUP_LOCK_END_MINUTES) return false;

  return true;
}

/** @deprecated Use isDayTraderTradingWindowOpen */
export const isDayTraderContestWindowOpen = isDayTraderTradingWindowOpen;

export function isDayTraderTradingActiveForContest(
  now: Date,
  contest: ContestWindowBounds
): boolean {
  if (contest.status !== "open") return false;
  const weekStart = new Date(contest.week_start_at);
  const weekEnd = new Date(contest.week_end_at);
  return (
    isDayTraderTradingWindowOpen(now) &&
    now >= weekStart &&
    now < weekEnd
  );
}

export function getDayTraderTradingStatusLabel(input: {
  entryOpen: boolean;
  tradingOpen: boolean;
  contestStatus: string | null;
}): string {
  if (input.tradingOpen) return "Open";
  if (input.contestStatus === "upcoming") return "Opens Monday 9:30 AM ET";
  return "Closed";
}

/** True when Friday contest should snapshot (at or after 4:00 PM ET). */
export function isDayTraderWeekFinalizeDue(now: Date = new Date()): boolean {
  const parts = getEasternParts(now);
  if (parts.weekday !== "Fri") return false;
  return minutesOfDay(parts.hour, parts.minute) >= LINEUP_LOCK_END_MINUTES;
}
