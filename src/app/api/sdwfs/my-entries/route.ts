import { tierNameForBuyIn } from "@/lib/wfs/contests";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Per-user data keyed off the auth cookie — must never be cached and served
// to a different viewer.
export const dynamic = "force-dynamic";

type WeekEntry = {
  contestId: string;
  contestName: string;
  buyIn: number;
  weekStartDate: string;
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
    return NextResponse.json({ entriesByWeek: {} });
  }

  const oneMonthAgo = new Date();
  oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
  const isoDate = oneMonthAgo.toISOString().split("T")[0];

  // !inner is required for the embedded week_start_date filter to apply —
  // without it PostgREST ignores the .gte() and returns every entry.
  const { data: entries, error } = await supabase
    .from("sdwfs_entries")
    .select(
      "id, contest_id, total_score, final_rank, payout, sdwfs_contests!inner(buy_in, week_start_date, status)"
    )
    .eq("user_id", user.id)
    .gte("sdwfs_contests.week_start_date", isoDate)
    .order("entered_at", { ascending: false });

  if (error || !entries || entries.length === 0) {
    return NextResponse.json({ entriesByWeek: {} });
  }

  const entriesByWeek: Record<string, WeekEntry[]> = {};

  for (const entry of entries) {
    const contest = Array.isArray(entry.sdwfs_contests)
      ? entry.sdwfs_contests[0]
      : entry.sdwfs_contests;

    if (!contest) continue;

    const buyIn = Number(contest.buy_in);
    const weekKey = contest.week_start_date;
    if (!entriesByWeek[weekKey]) {
      entriesByWeek[weekKey] = [];
    }

    entriesByWeek[weekKey].push({
      contestId: entry.contest_id,
      contestName: tierNameForBuyIn(buyIn),
      buyIn,
      weekStartDate: contest.week_start_date,
      contestStatus: contest.status as WeekEntry["contestStatus"],
      finalRank: entry.final_rank,
      payout: entry.payout == null ? null : Number(entry.payout),
    });
  }

  return NextResponse.json({ entriesByWeek });
}
