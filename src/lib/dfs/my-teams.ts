import "server-only";

import { createClient } from "@/lib/supabase/server";

export type MyDfsEntryPick = {
  sector: string;
  symbol: string;
  pctChange: number | null;
};

export type MyDfsEntry = {
  entryId: string;
  contestId: string;
  buyIn: number;
  contestDate: string;
  contestStatus: "open" | "locked" | "scored";
  totalScore: number | null;
  finalRank: number | null;
  payout: number | null;
  picks: MyDfsEntryPick[];
};

export async function getMyDfsEntries(): Promise<MyDfsEntry[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data: entries, error } = await supabase
    .from("sddfs_entries")
    .select(
      "id, contest_id, total_score, final_rank, payout, sddfs_contests(buy_in, contest_date, status)"
    )
    .eq("user_id", user.id)
    .order("entered_at", { ascending: false });

  if (error || !entries || entries.length === 0) return [];

  const { data: picks } = await supabase
    .from("sddfs_entry_picks")
    .select("entry_id, sector, symbol, pct_change")
    .in(
      "entry_id",
      entries.map((e) => e.id)
    );

  const picksByEntry = new Map<string, MyDfsEntryPick[]>();
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
    const contest = Array.isArray(entry.sddfs_contests)
      ? entry.sddfs_contests[0]
      : entry.sddfs_contests;

    return {
      entryId: entry.id,
      contestId: entry.contest_id,
      buyIn: Number(contest?.buy_in ?? 0),
      contestDate: contest?.contest_date ?? "",
      contestStatus: (contest?.status ?? "open") as MyDfsEntry["contestStatus"],
      totalScore: entry.total_score,
      finalRank: entry.final_rank,
      payout: entry.payout,
      picks: picksByEntry.get(entry.id) ?? [],
    };
  });
}
