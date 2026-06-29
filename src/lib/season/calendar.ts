import {
  FA_STANDARD_OPEN_MINUTES,
  LINEUP_LOCK_END_MINUTES,
  LINEUP_LOCK_START_MINUTES,
  SDPL_REGULAR_SEASON_WEEKS,
  SEASON_TIMEZONE,
} from "@/lib/season/constants";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";
import type {
  LeagueFormatMeta,
  SeasonCalendarErrorCode,
  SeasonCalendarState,
  SeasonSettings,
  SeasonSettingsRow,
  WeekCalendarEntry,
} from "@/lib/season/types";
import { SeasonCalendarError } from "@/lib/season/types";

export { SeasonCalendarError } from "@/lib/season/types";

type EasternParts = {
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getEasternParts(date: Date): EasternParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEASON_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: get("weekday"),
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function isWeekday(weekday: string): boolean {
  return weekday !== "Sat" && weekday !== "Sun";
}

function parseWeekCalendar(raw: unknown): WeekCalendarEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: WeekCalendarEntry[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as WeekCalendarEntry).week === "number" &&
      typeof (item as WeekCalendarEntry).date === "string"
    ) {
      entries.push({
        week: (item as WeekCalendarEntry).week,
        date: (item as WeekCalendarEntry).date,
      });
    }
  }
  return entries.length > 0 ? entries : null;
}

export function resolveSeasonSettings(
  league: LeagueFormatMeta,
  row?: SeasonSettingsRow | null
): SeasonSettings {
  if (!isSdplSeasonRulesLeague(league)) {
    return {
      rulesApply: false,
      seasonFormat: "standard",
      regularSeasonWeeks: SDPL_REGULAR_SEASON_WEEKS,
      weekCalendar: null,
    };
  }

  if (!row) {
    return {
      rulesApply: true,
      seasonFormat: "standard",
      regularSeasonWeeks: SDPL_REGULAR_SEASON_WEEKS,
      weekCalendar: null,
    };
  }

  return {
    rulesApply: true,
    seasonFormat: row.season_format,
    regularSeasonWeeks: row.regular_season_weeks,
    weekCalendar: parseWeekCalendar(row.week_calendar),
  };
}

/**
 * Lineups lock daily 9:30 AM – 4:00 PM ET on every calendar day (including weekends).
 * Crypto moves are not gated by this helper.
 */
export function isLineupLocked(now: Date, settings: SeasonSettings): boolean {
  if (!settings.rulesApply) return false;

  const { hour, minute } = getEasternParts(now);
  const mins = minutesOfDay(hour, minute);
  return mins >= LINEUP_LOCK_START_MINUTES && mins < LINEUP_LOCK_END_MINUTES;
}

/**
 * Standard SDPL: Saturday 9:30 AM ET through Monday 9:30 AM ET (exclusive at close).
 * Beta daily: open outside weekday 9:30 AM – 4:00 PM windows (includes all weekend).
 */
export function isFreeAgencyOpen(now: Date, settings: SeasonSettings): boolean {
  if (!settings.rulesApply) return true;

  if (settings.seasonFormat === "beta_daily") {
    return isBetaDailyFreeAgencyOpen(now);
  }

  return isStandardFreeAgencyOpen(now);
}

function isStandardFreeAgencyOpen(now: Date): boolean {
  const { weekday, hour, minute } = getEasternParts(now);
  const mins = minutesOfDay(hour, minute);

  if (weekday === "Sat" && mins >= FA_STANDARD_OPEN_MINUTES) return true;
  if (weekday === "Sun") return true;
  if (weekday === "Mon" && mins < FA_STANDARD_OPEN_MINUTES) return true;
  return false;
}

function isBetaDailyFreeAgencyOpen(now: Date): boolean {
  const { weekday, hour, minute } = getEasternParts(now);
  if (!isWeekday(weekday)) return true;

  const mins = minutesOfDay(hour, minute);
  return !(mins >= LINEUP_LOCK_START_MINUTES && mins < LINEUP_LOCK_END_MINUTES);
}

export function getSeasonCalendarState(
  now: Date,
  settings: SeasonSettings
): SeasonCalendarState {
  if (!settings.rulesApply) {
    return {
      rulesApply: false,
      seasonFormat: settings.seasonFormat,
      lineupLocked: false,
      freeAgencyOpen: true,
      nextLineupUnlockAt: null,
      nextLineupLockAt: null,
      nextFaOpenAt: null,
      nextFaCloseAt: null,
      lineupLockMessage: null,
      freeAgencyMessage: null,
    };
  }

  const lineupLocked = isLineupLocked(now, settings);
  const freeAgencyOpen = isFreeAgencyOpen(now, settings);

  return {
    rulesApply: true,
    seasonFormat: settings.seasonFormat,
    lineupLocked,
    freeAgencyOpen,
    nextLineupUnlockAt: lineupLocked
      ? formatInstant(nextLineupUnlock(now))
      : null,
    nextLineupLockAt: lineupLocked
      ? null
      : formatInstant(nextLineupLock(now)),
    nextFaOpenAt: freeAgencyOpen ? null : formatInstant(nextFaOpen(now, settings)),
    nextFaCloseAt: freeAgencyOpen
      ? formatInstant(nextFaClose(now, settings))
      : null,
    lineupLockMessage: lineupLocked
      ? "Lineups are locked until 4:00 PM ET."
      : null,
    freeAgencyMessage: freeAgencyOpen
      ? null
      : settings.seasonFormat === "beta_daily"
        ? "Free agency opens at 4:00 PM ET when today's matchup closes."
        : "Free agency opens Saturday at 9:30 AM ET.",
  };
}

export function assertLineupUnlocked(
  now: Date,
  settings: SeasonSettings
): void {
  if (!settings.rulesApply) return;
  if (isLineupLocked(now, settings)) {
    throw new SeasonCalendarError(
      "LINEUP_LOCKED",
      "Lineups are locked until 4:00 PM ET."
    );
  }
}

export function assertFreeAgencyOpen(
  now: Date,
  settings: SeasonSettings
): void {
  if (!settings.rulesApply) return;
  if (!isFreeAgencyOpen(now, settings)) {
    throw new SeasonCalendarError(
      "FA_CLOSED",
      settings.seasonFormat === "beta_daily"
        ? "Free agency opens at 4:00 PM ET when today's matchup closes."
        : "Free agency opens Saturday at 9:30 AM ET."
    );
  }
}

export function seasonCalendarErrorCode(
  error: unknown
): SeasonCalendarErrorCode | null {
  if (error instanceof SeasonCalendarError) return error.code;
  return null;
}

function formatInstant(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** Next 4:00 PM ET unlock from `now` while currently locked. */
function nextLineupUnlock(now: Date): Date {
  const parts = getEasternParts(now);
  const mins = minutesOfDay(parts.hour, parts.minute);
  if (mins < LINEUP_LOCK_END_MINUTES) {
    return zonedDateTime(parts.year, parts.month, parts.day, 16, 0);
  }
  return addEasternDays(parts, 1, 16, 0);
}

/** Next 9:30 AM ET lock from `now` while currently unlocked. */
function nextLineupLock(now: Date): Date {
  const parts = getEasternParts(now);
  const mins = minutesOfDay(parts.hour, parts.minute);
  if (mins < LINEUP_LOCK_START_MINUTES) {
    return zonedDateTime(parts.year, parts.month, parts.day, 9, 30);
  }
  return addEasternDays(parts, 1, 9, 30);
}

function nextFaOpen(now: Date, settings: SeasonSettings): Date {
  if (settings.seasonFormat === "beta_daily") {
    const parts = getEasternParts(now);
    const mins = minutesOfDay(parts.hour, parts.minute);
    if (isWeekday(parts.weekday) && mins < LINEUP_LOCK_END_MINUTES) {
      return zonedDateTime(parts.year, parts.month, parts.day, 16, 0);
    }
    return nextWeekdayAt(parts, 16, 0);
  }

  const parts = getEasternParts(now);
  const weekdayIndex = WEEKDAY_TO_INDEX[parts.weekday] ?? 0;
  const daysUntilSaturday = (6 - weekdayIndex + 7) % 7;
  const saturdayParts =
    daysUntilSaturday === 0 &&
    minutesOfDay(parts.hour, parts.minute) >= FA_STANDARD_OPEN_MINUTES
      ? addEasternDays(parts, 7, 9, 30)
      : addEasternDays(parts, daysUntilSaturday, 9, 30);
  return saturdayParts;
}

function nextFaClose(now: Date, settings: SeasonSettings): Date {
  if (settings.seasonFormat === "beta_daily") {
    return nextBetaFaClose(now);
  }

  const parts = getEasternParts(now);
  const weekdayIndex = WEEKDAY_TO_INDEX[parts.weekday] ?? 0;
  const daysUntilMonday = (1 - weekdayIndex + 7) % 7;
  const mondayOffset =
    daysUntilMonday === 0 &&
    minutesOfDay(parts.hour, parts.minute) >= FA_STANDARD_OPEN_MINUTES
      ? 7
      : daysUntilMonday;
  return addEasternDays(parts, mondayOffset, 9, 30);
}

function nextBetaFaClose(now: Date): Date {
  const parts = getEasternParts(now);
  const mins = minutesOfDay(parts.hour, parts.minute);

  if (isWeekday(parts.weekday) && mins < LINEUP_LOCK_START_MINUTES) {
    return zonedDateTime(parts.year, parts.month, parts.day, 9, 30);
  }

  for (let offset = 1; offset <= 7; offset++) {
    const candidate = addEasternDays(parts, offset, 9, 30);
    if (isWeekday(getEasternParts(candidate).weekday)) {
      return candidate;
    }
  }

  return addEasternDays(parts, 1, 9, 30);
}

function nextWeekdayAt(parts: EasternParts, hour: number, minute: number): Date {
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = addEasternDays(parts, offset, hour, minute);
    if (isWeekday(getEasternParts(candidate).weekday)) {
      return candidate;
    }
  }
  return zonedDateTime(parts.year, parts.month, parts.day, hour, minute);
}

function addEasternDays(
  parts: EasternParts,
  days: number,
  hour: number,
  minute: number
): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day + days, hour, minute);
  return alignToEasternWallTime(new Date(utcGuess), hour, minute);
}

function zonedDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  return alignToEasternWallTime(new Date(utcGuess), hour, minute);
}

/** Adjust a UTC guess until its Eastern wall-clock matches the target hour/minute. */
function alignToEasternWallTime(
  utcGuess: Date,
  hour: number,
  minute: number
): Date {
  let candidate = utcGuess;
  for (let i = 0; i < 6; i++) {
    const parts = getEasternParts(candidate);
    if (parts.hour === hour && parts.minute === minute) {
      return candidate;
    }
    const deltaMinutes =
      (hour - parts.hour) * 60 + (minute - parts.minute);
    candidate = new Date(candidate.getTime() + deltaMinutes * 60_000);
  }
  return candidate;
}

/** Whether a beta-daily calendar week falls on Friday (weekend extension scoring). */
export function isBetaFridayWeekDate(dateIso: string): boolean {
  const probe = zonedDateTimeFromDateIso(dateIso, 12, 0);
  return getEasternParts(probe).weekday === "Fri";
}

function zonedDateTimeFromDateIso(
  dateIso: string,
  hour: number,
  minute: number
): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return zonedDateTime(year, month, day, hour, minute);
}

export function getWeekCalendarEntry(
  settings: SeasonSettings,
  weekNumber: number
): WeekCalendarEntry | null {
  if (!settings.weekCalendar) return null;
  return settings.weekCalendar.find((entry) => entry.week === weekNumber) ?? null;
}
