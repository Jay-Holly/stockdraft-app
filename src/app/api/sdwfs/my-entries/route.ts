import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const revalidate = 300;

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

  const { data: entries, error } = await supabase
    .from("sdwfs_entries")
    .select(
      "id, contest_id, total_score, final_rank, payout, sdwfs_contests(buy_in, start_date, end_date, status)"
    )
    .eq("user_id", user.id)
    .gte("sdwfs_contests.start_date", isoDate)
    .order("sdwfs_contests.start_date", { ascending: false });

  if (error || !entries || entries.length === 0) {
    return NextResponse.json({ entriesByWeek: {} });
  }

  const { data: tierNames } = await supabase
    .from("sdwfs_contests")
    .select("id, buy_in")
    .in(
      "id",
      entries.map((e) => e.contest_id)
    );

  const tierMap = new Map(
    (tierNames ?? []).map((t) => [t.id, tierNameForBuyIn(Number(t.buy_in))])
  );

  const entriesByWeek: Record<string, any[]> = {};

  for (const entry of entries) {
    const contest = Array.isArray(entry.sdwfs_contests)
      ? entry.sdwfs_contests[0]
      : entry.sdwfs_contests;

    if (!contest) continue;

    const weekKey = `${contest.start_date}_${contest.end_date}`;
    if (!entriesByWeek[weekKey]) {
      entriesByWeek[weekKey] = [];
    }

    entriesByWeek[weekKey].push({
      contestId: entry.contest_id,
      contestName: tierMap.get(entry.contest_id) ?? "Contest",
      buyIn: Number(contest.buy_in),
      startDate: contest.start_date,
      endDate: contest.end_date,
      contestStatus: contest.status,
      finalRank: entry.final_rank,
      payout: entry.payout ? Number(entry.payout) : undefined,
    });
  }

  return NextResponse.json({ entriesByWeek });
}

function tierNameForBuyIn(buyIn: number): string {
  if (buyIn === 2) return "The $2 Bill";
  if (buyIn === 5) return "The 5 Spot";
  if (buyIn === 10) return "The 10'er";
  if (buyIn === 25) return "The 25 Spot";
  if (buyIn === 50) return "The Fiddy Hundred Cent";
  if (buyIn === 100) return "The Big Ciento";
  return `$${buyIn} Contest`;
}
