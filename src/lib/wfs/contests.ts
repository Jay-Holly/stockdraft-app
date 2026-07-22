import "server-only";

import {
  addEasternDays,
  getEasternParts,
  zonedDateTime,
  zonedDateTimeFromIso,
  type EasternParts,
} from "@/lib/season/eastern-time";
import { DFS_TIERS } from "@/lib/dfs/contests";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type WfsContest = {
  id: string;
  weekStartDate: string;
  buyIn: number;
  name: string;
  maxEntrants: number;
  entrants: number;
  lockAt: string;
  scoreAt: string;
  status: "open" | "locked" | "scored";
};

/** SDWFS reuses SDDFS's 6 named buy-in tiers/caps, just weekly instead of daily. */
export const WFS_TIERS = DFS_TIERS;

export const WFS_BUY_INS = Object.keys(WFS_TIERS).map(Number) as Array<
  keyof typeof WFS_TIERS
>;

export function tierNameForBuyIn(buyIn: number): string {
  return WFS_TIERS[buyIn as keyof typeof WFS_TIERS]?.name ?? `$${buyIn} Contest`;
}

const WFS_LOCK_HOUR_ET = 9;
const WFS_LOCK_MINUTE_ET = 0;
const WFS_SCORE_HOUR_ET = 16;
const WFS_SCORE_MINUTE_ET = 0;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function isoFromEasternParts(parts: EasternParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

/** Monday of the week containing `parts` (as an ISO date string), in ET. */
function mondayIsoForParts(parts: EasternParts): string {
  const weekdayIndex = WEEKDAY_INDEX[parts.weekday] ?? 1;
  const daysSinceMonday = (weekdayIndex + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const monday = addEasternDays(parts, -daysSinceMonday, 12, 0);
  return isoFromEasternParts(getEasternParts(monday));
}

function fridayIsoFromMondayIso(mondayIso: string): string {
  const [year, month, day] = mondayIso.split("-").map(Number);
  const monday = zonedDateTime(year, month, day, 12, 0);
  const mondayParts = getEasternParts(monday);
  const friday = addEasternDays(mondayParts, 4, 12, 0);
  return isoFromEasternParts(getEasternParts(friday));
}

const WFS_SIGNUP_OPEN_HOUR_ET = 10;
const WFS_SIGNUP_OPEN_MINUTE_ET = 0;

/**
 * Which week_start_date (a Monday) the lobby should show/create right now
 * for NEW entries. This week's Monday is shown only up until this week's
 * own lineup lock (Monday 9 AM ET) plus a 1-hour buffer — from Monday
 * 10 AM ET onward (through the following Sunday), next week's Monday
 * becomes the active signup week, so people can start drafting next
 * week's lineup while this week is still locked/playing out/scoring.
 * The lifecycle cron creates that next week's contest rows at the same
 * 10 AM ET threshold, so they're open and enterable automatically
 * instead of waiting for someone to load the lobby.
 */
export function activeSdwfsContestWeekIso(now = new Date()): string {
  const parts = getEasternParts(now);
  const mondayIso = mondayIsoForParts(parts);

  const weekdayIndex = WEEKDAY_INDEX[parts.weekday] ?? 1;
  const minutesNow = parts.hour * 60 + parts.minute;
  const signupOpenMinutes =
    WFS_SIGNUP_OPEN_HOUR_ET * 60 + WFS_SIGNUP_OPEN_MINUTE_ET;

  // Before Monday 10 AM ET, this week's Monday is still the active signup
  // week (last chance before lock). From Monday 10 AM ET through the rest
  // of the week (and the weekend), next week's Monday is active instead.
  const pastMondaySignupCutoff =
    weekdayIndex === 1 /* Mon */ && minutesNow >= signupOpenMinutes;
  const afterMonday = weekdayIndex === 0 /* Sun */ || weekdayIndex >= 2;

  if (!pastMondaySignupCutoff && !afterMonday) {
    return mondayIso;
  }

  const [year, month, day] = mondayIso.split("-").map(Number);
  const mondayNoon = zonedDateTime(year, month, day, 12, 0);
  const mondayParts = getEasternParts(mondayNoon);
  const nextMonday = addEasternDays(mondayParts, 7, 12, 0);
  return isoFromEasternParts(getEasternParts(nextMonday));
}

/** Idempotently creates the given week's contests (one per buy-in tier) if missing. */
export async function ensureThisWeeksSdwfsContests(
  supabase: ServiceClient,
  weekStartDate: string = activeSdwfsContestWeekIso()
): Promise<void> {
  const lockAt = zonedDateTimeFromIso(
    weekStartDate,
    WFS_LOCK_HOUR_ET,
    WFS_LOCK_MINUTE_ET
  ).toISOString();
  const fridayIso = fridayIsoFromMondayIso(weekStartDate);
  const scoreAt = zonedDateTimeFromIso(
    fridayIso,
    WFS_SCORE_HOUR_ET,
    WFS_SCORE_MINUTE_ET
  ).toISOString();

  const rows = WFS_BUY_INS.map((buyIn) => ({
    week_start_date: weekStartDate,
    buy_in: buyIn,
    max_entrants: WFS_TIERS[buyIn].maxEntrants,
    lock_at: lockAt,
    score_at: scoreAt,
    status: "open" as const,
  }));

  const { error } = await supabase
    .from("sdwfs_contests")
    .upsert(rows, { onConflict: "week_start_date,buy_in", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to ensure this week's SDWFS contests: ${error.message}`);
  }
}

export async function getWfsContestsForThisWeek(): Promise<WfsContest[]> {
  const supabase = createServiceClient();
  const weekStartDate = activeSdwfsContestWeekIso();
  await ensureThisWeeksSdwfsContests(supabase, weekStartDate);

  const { data: contests, error } = await supabase
    .from("sdwfs_contests")
    .select("id, week_start_date, buy_in, max_entrants, lock_at, score_at, status")
    .eq("week_start_date", weekStartDate)
    .order("buy_in", { ascending: true });

  if (error) {
    throw new Error(`Failed to load SDWFS contests: ${error.message}`);
  }

  const { data: entryCounts } = await supabase
    .from("sdwfs_entries")
    .select("contest_id")
    .in("contest_id", (contests ?? []).map((c) => c.id));

  const countByContest = new Map<string, number>();
  for (const row of entryCounts ?? []) {
    countByContest.set(
      row.contest_id,
      (countByContest.get(row.contest_id) ?? 0) + 1
    );
  }

  return (contests ?? []).map((c) => ({
    id: c.id,
    weekStartDate: c.week_start_date,
    buyIn: Number(c.buy_in),
    name: tierNameForBuyIn(Number(c.buy_in)),
    maxEntrants: c.max_entrants,
    entrants: countByContest.get(c.id) ?? 0,
    lockAt: c.lock_at,
    scoreAt: c.score_at,
    status: c.status,
  }));
}

export async function getWfsContestById(id: string): Promise<WfsContest | null> {
  const supabase = createServiceClient();

  const { data: contest, error } = await supabase
    .from("sdwfs_contests")
    .select("id, week_start_date, buy_in, max_entrants, lock_at, score_at, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load SDWFS contest: ${error.message}`);
  }
  if (!contest) return null;

  const { count } = await supabase
    .from("sdwfs_entries")
    .select("id", { count: "exact", head: true })
    .eq("contest_id", id);

  return {
    id: contest.id,
    weekStartDate: contest.week_start_date,
    buyIn: Number(contest.buy_in),
    name: tierNameForBuyIn(Number(contest.buy_in)),
    maxEntrants: contest.max_entrants,
    entrants: count ?? 0,
    lockAt: contest.lock_at,
    scoreAt: contest.score_at,
    status: contest.status,
  };
}

/** "2026-07-27" -> "Week of Mon, Jul 27" */
export function formatWfsContestWeekLabel(weekStartDateIso: string): string {
  const [year, month, day] = weekStartDateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  return `Week of ${formatted}`;
}

export function prizePoolForContest(contest: WfsContest): number {
  return Math.round(contest.buyIn * contest.entrants * 0.92 * 100) / 100;
}
