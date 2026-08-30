import { getEasternParts } from "@/lib/season/eastern-time";

/** Today's date in Eastern time as YYYY-MM-DD — the audit's unit of work. */
export function easternDateIso(at: Date = new Date()): string {
  const parts = getEasternParts(at);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

/**
 * The last `count` Eastern dates, newest first.
 *
 * The fund-release job walks a few days rather than only "yesterday": it runs
 * just after midnight ET (so the current ET date is already the next day), and
 * looking back a little also picks up a date whose release was missed because
 * an audit finished late or a run was skipped. Releasing is idempotent, so
 * revisiting an already-paid date costs nothing.
 */
export function recentEasternDates(count: number, at: Date = new Date()): string[] {
  const dates: string[] = [];
  for (let i = 1; i <= count; i++) {
    dates.push(easternDateIso(new Date(at.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return dates;
}
