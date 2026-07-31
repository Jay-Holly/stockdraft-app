import { tierNameForBuyIn } from "@/lib/dfs/contests";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Per-user data keyed off the auth cookie — must never be cached and served
// to a different viewer.
export const dynamic = "force-dynamic";

type DayEntry = {
  contestId: string;
  contestName: string;
  buyIn: number;
  contestDate: string;
  contestStatus: "open" | "locked" | "scored";
  finalRank: number | null;
  payout: number | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ entriesByDay: {} });
  }

  // Sunday of the current week, in the viewer-independent server locale.
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartIso = weekStart.toISOString().split("T")[0];

  // !inner is required for the embedded contest_date filter to apply —
  // without it PostgREST ignores the .gte() and returns every entry.
  const { data: entries, error } = await supabase
    .from("sddfs_entries")
    .select(
      "id, contest_id, total_score, final_rank, payout, sddfs_contests!inner(buy_in, contest_date, status)"
    )
    .eq("user_id", user.id)
    .gte("sddfs_contests.contest_date", weekStartIso)
    .order("entered_at", { ascending: false });

  if (error || !entries || entries.length === 0) {
    return NextResponse.json({ entriesByDay: {} });
  }

  const entriesByDay: Record<string, DayEntry[]> = {};

  for (const entry of entries) {
    const contest = Array.isArray(entry.sddfs_contests)
      ? entry.sddfs_contests[0]
      : entry.sddfs_contests;

    if (!contest) continue;

    const buyIn = Number(contest.buy_in);
    const contestDate = contest.contest_date;
    if (!entriesByDay[contestDate]) {
      entriesByDay[contestDate] = [];
    }

    entriesByDay[contestDate].push({
      contestId: entry.contest_id,
      contestName: tierNameForBuyIn(buyIn),
      buyIn,
      contestDate,
      contestStatus: contest.status as DayEntry["contestStatus"],
      finalRank: entry.final_rank,
      payout: entry.payout == null ? null : Number(entry.payout),
    });
  }

  return NextResponse.json({ entriesByDay });
}
