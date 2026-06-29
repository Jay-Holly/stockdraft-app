import { SEASON_TIMEZONE } from "@/lib/season/constants";

export type EasternParts = {
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function getEasternParts(date: Date): EasternParts {
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

export function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

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

export function zonedDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  return alignToEasternWallTime(new Date(utcGuess), hour, minute);
}

export function zonedDateTimeFromIso(
  dateIso: string,
  hour: number,
  minute: number
): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return zonedDateTime(year, month, day, hour, minute);
}

export function addEasternDays(
  parts: EasternParts,
  days: number,
  hour: number,
  minute: number
): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day + days, hour, minute);
  return alignToEasternWallTime(new Date(utcGuess), hour, minute);
}

/** Next Monday 6:00 AM ET strictly after `from` (or today 6 AM if Monday before 6 AM). */
export function nextMondaySixAmEt(from: Date): Date {
  const parts = getEasternParts(from);
  const mins = minutesOfDay(parts.hour, parts.minute);
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
    parts.weekday
  ] ?? 0;

  if (parts.weekday === "Mon" && mins < 6 * 60) {
    return zonedDateTime(parts.year, parts.month, parts.day, 6, 0);
  }

  const daysUntilMonday = (1 - weekdayIndex + 7) % 7 || 7;
  return addEasternDays(parts, daysUntilMonday, 6, 0);
}

/** Monday 6:00 AM ET on or after the calendar date (for beta Friday weeks). */
export function mondaySixAmAfterDateIso(dateIso: string): Date {
  const probe = zonedDateTimeFromIso(dateIso, 12, 0);
  const parts = getEasternParts(probe);
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
    parts.weekday
  ] ?? 0;

  if (parts.weekday === "Mon") {
    return zonedDateTime(parts.year, parts.month, parts.day, 6, 0);
  }

  const daysUntilMonday = (1 - weekdayIndex + 7) % 7 || 7;
  return addEasternDays(parts, daysUntilMonday, 6, 0);
}

export function isFridayDateIso(dateIso: string): boolean {
  return getEasternParts(zonedDateTimeFromIso(dateIso, 12, 0)).weekday === "Fri";
}
