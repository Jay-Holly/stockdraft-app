import {
  LINEUP_LOCK_END_MINUTES,
  MATCHUP_FINALIZE_STANDARD_MINUTES,
} from "@/lib/season/constants";
import {
  getEasternParts,
  isFridayDateIso,
  minutesOfDay,
  mondaySixAmAfterDateIso,
  nextMondaySixAmEt,
  zonedDateTime,
  zonedDateTimeFromIso,
} from "@/lib/season/eastern-time";
import { getWeekCalendarEntry } from "@/lib/season/calendar";
import type { SeasonSettings } from "@/lib/season/types";

/** Whether this week uses Fri 4 PM stock freeze → Mon 6 AM finalize. */
export function weekUsesWeekendExtension(
  settings: SeasonSettings,
  weekNumber: number
): boolean {
  if (!settings.rulesApply) return false;

  if (settings.seasonFormat === "standard") return true;

  const entry = getWeekCalendarEntry(settings, weekNumber);
  if (entry) return isFridayDateIso(entry.date);

  const parts = getEasternParts(new Date());
  return parts.weekday === "Fri";
}

/** When scheduled matchups for this week may be finalized. */
export function computeWeekFinalizeAt(
  settings: SeasonSettings,
  weekNumber: number,
  anchor: Date = new Date()
): Date {
  if (!settings.rulesApply) {
    return anchor;
  }

  if (settings.seasonFormat === "beta_daily") {
    const entry = getWeekCalendarEntry(settings, weekNumber);
    if (entry) {
      if (isFridayDateIso(entry.date)) {
        return mondaySixAmAfterDateIso(entry.date);
      }
      return zonedDateTimeFromIso(entry.date, 16, 0);
    }

    const parts = getEasternParts(anchor);
    if (parts.weekday === "Fri") {
      return mondaySixAmAfterDateIso(
        `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
      );
    }

    return zonedDateTime(parts.year, parts.month, parts.day, 16, 0);
  }

  return nextMondaySixAmEt(anchor);
}

export function isPastFinalizeAt(finalizeAt: string | null, now: Date): boolean {
  if (!finalizeAt) return true;
  const at = new Date(finalizeAt);
  return !Number.isNaN(at.getTime()) && now.getTime() >= at.getTime();
}

/** True during Fri 4 PM ET – Mon 6 AM extension window (after stock freeze captured). */
export function isWeekendExtensionWindow(now: Date): boolean {
  const parts = getEasternParts(now);
  const mins = minutesOfDay(parts.hour, parts.minute);

  if (parts.weekday === "Sat" || parts.weekday === "Sun") return true;
  if (parts.weekday === "Fri" && mins >= LINEUP_LOCK_END_MINUTES) return true;
  if (parts.weekday === "Mon" && mins < MATCHUP_FINALIZE_STANDARD_MINUTES) {
    return true;
  }
  return false;
}
