import "server-only";

import { tierNameForBuyIn } from "@/lib/wfs/contests";
import { createClient } from "@/lib/supabase/server";

export type MyWfsEntryPick = {
  sector: string;
  symbol: string;
  pctChange: number | null;
};

export type MyWfsEntry = {
  entryId: string;
  contestId: string;
  buyIn: number;
  contestName: string;
  weekStartDate: string;
  contestStatus: "open" | "locked" | "scored";
  totalScore: number | null;
  finalRank: number | null;
  payout: number | null;
  picks: MyWfsEntryPick[];
};

export async function getMyWfsEntries(): Promise<MyWfsEntry[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data: entries, error } = await supabase
    .from("sdwfs_entries")
    .select(
      "id, contest_id, total_score, final_rank, payout, sdwfs_contests(buy_in, week_start_date, status)"
    )
    .eq("user_id", user.id)
    .order("entered_at", { ascending: false });

  if (error || !entries || entries.length === 0) return [];

  const { data: picks } = await supabase
    .from("sdwfs_entry_picks")
    .select("entry_id, sector, symbol, pct_change")
    .in(
      "entry_id",
      entries.map((e) => e.id)
    );

  const picksByEntry = new Map<string, MyWfsEntryPick[]>();
  for (const pick of picks ?? []) {
    const list = picksByEntry.get(pick.entry_id) ?? [];
    list.push({
      sector: pick.sector,
      symbol: pick.symbol,
      pctChange: pick.pct_change,
    });
    picksByEntry.set(pick.entry_id, list);
  }

  return entries.map((entry) => {
    const contest = Array.isArray(entry.sdwfs_contests)
      ? entry.sdwfs_contests[0]
      : entry.sdwfs_contests;

    const buyIn = Number(contest?.buy_in ?? 0);

    return {
      entryId: entry.id,
      contestId: entry.contest_id,
      buyIn,
      contestName: tierNameForBuyIn(buyIn),
      weekStartDate: contest?.week_start_date ?? "",
      contestStatus: (contest?.status ?? "open") as MyWfsEntry["contestStatus"],
      totalScore: entry.total_score,
      finalRank: entry.final_rank,
      payout: entry.payout,
      picks: picksByEntry.get(entry.id) ?? [],
    };
  });
}
