import "server-only";

import { getEasternParts, zonedDateTimeFromIso } from "@/lib/season/eastern-time";
import { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type DfsContest = {
  id: string;
  contestDate: string;
  buyIn: number;
  name: string;
  maxEntrants: number;
  entrants: number;
  lockAt: string;
  status: "open" | "locked" | "scored";
};

/** SDDFS buy-in tiers, each with its own display name and entrant cap. */
export const DFS_TIERS = {
  2: { name: "$2 Bill", maxEntrants: 150 },
  5: { name: "The 5 Spot", maxEntrants: 100 },
  10: { name: "The Ten'er", maxEntrants: 75 },
  25: { name: "The 25 Spot", maxEntrants: 50 },
  50: { name: "The Fiddy Thousand Cent", maxEntrants: 20 },
  100: { name: "The Big Ciento", maxEntrants: 10 },
} as const;

export const DFS_BUY_INS = Object.keys(DFS_TIERS).map(Number) as Array<
  keyof typeof DFS_TIERS
>;

export function tierNameForBuyIn(buyIn: number): string {
  return DFS_TIERS[buyIn as keyof typeof DFS_TIERS]?.name ?? `$${buyIn} Contest`;
}

const DFS_LOCK_HOUR_ET = 9;
const DFS_LOCK_MINUTE_ET = 0;

function todayIsoInEastern(): string {
  const parts = getEasternParts(new Date());
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

/** Idempotently creates today's contest (one per buy-in tier) if missing. */
export async function ensureTodaysSddfsContests(
  supabase: ServiceClient
): Promise<void> {
  const contestDate = todayIsoInEastern();
  const lockAt = zonedDateTimeFromIso(
    contestDate,
    DFS_LOCK_HOUR_ET,
    DFS_LOCK_MINUTE_ET
  ).toISOString();

  const rows = DFS_BUY_INS.map((buyIn) => ({
    contest_date: contestDate,
    buy_in: buyIn,
    max_entrants: DFS_TIERS[buyIn].maxEntrants,
    lock_at: lockAt,
    status: "open" as const,
  }));

  const { error } = await supabase
    .from("sddfs_contests")
    .upsert(rows, { onConflict: "contest_date,buy_in", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to ensure today's SDDFS contests: ${error.message}`);
  }
}

export async function getDfsContestsForToday(): Promise<DfsContest[]> {
  const supabase = createServiceClient();
  await ensureTodaysSddfsContests(supabase);

  const contestDate = todayIsoInEastern();

  const { data: contests, error } = await supabase
    .from("sddfs_contests")
    .select("id, contest_date, buy_in, max_entrants, lock_at, status")
    .eq("contest_date", contestDate)
    .order("buy_in", { ascending: true });

  if (error) {
    throw new Error(`Failed to load SDDFS contests: ${error.message}`);
  }

  const { data: entryCounts } = await supabase
    .from("sddfs_entries")
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
    contestDate: c.contest_date,
    buyIn: Number(c.buy_in),
    name: tierNameForBuyIn(Number(c.buy_in)),
    maxEntrants: c.max_entrants,
    entrants: countByContest.get(c.id) ?? 0,
    lockAt: c.lock_at,
    status: c.status,
  }));
}

export async function getDfsContestById(id: string): Promise<DfsContest | null> {
  const supabase = createServiceClient();

  const { data: contest, error } = await supabase
    .from("sddfs_contests")
    .select("id, contest_date, buy_in, max_entrants, lock_at, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load SDDFS contest: ${error.message}`);
  }
  if (!contest) return null;

  const { count } = await supabase
    .from("sddfs_entries")
    .select("id", { count: "exact", head: true })
    .eq("contest_id", id);

  return {
    id: contest.id,
    contestDate: contest.contest_date,
    buyIn: Number(contest.buy_in),
    name: tierNameForBuyIn(Number(contest.buy_in)),
    maxEntrants: contest.max_entrants,
    entrants: count ?? 0,
    lockAt: contest.lock_at,
    status: contest.status,
  };
}

export function prizePoolForContest(contest: DfsContest): number {
  return Math.round(contest.buyIn * contest.entrants * 0.92 * 100) / 100;
}
