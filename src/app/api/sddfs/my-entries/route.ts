import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const revalidate = 300;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ entriesByDay: {} });
  }

  const weekStart = new Date();
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - day);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartIso = weekStart.toISOString().split("T")[0];

  const { data: entries, error } = await supabase
    .from("sddfs_entries")
    .select(
      "id, contest_id, total_score, final_rank, payout, sddfs_contests(buy_in, contest_date, status)"
    )
    .eq("user_id", user.id)
    .order("entered_at", { ascending: false });

  if (error || !entries || entries.length === 0) {
    return NextResponse.json({ entriesByDay: {} });
  }

  const { data: tierNames } = await supabase
    .from("sddfs_contests")
    .select("id, buy_in")
    .in(
      "id",
      entries.map((e) => e.contest_id)
    );

  const tierMap = new Map(
    (tierNames ?? []).map((t) => [t.id, tierNameForBuyIn(Number(t.buy_in))])
  );

  const entriesByDay: Record<string, any[]> = {};

  for (const entry of entries) {
    const contest = Array.isArray(entry.sddfs_contests)
      ? entry.sddfs_contests[0]
      : entry.sddfs_contests;

    if (!contest) continue;

    const contestDate = contest.contest_date;
    if (!entriesByDay[contestDate]) {
      entriesByDay[contestDate] = [];
    }

    entriesByDay[contestDate].push({
      contestId: entry.contest_id,
      contestName: tierMap.get(entry.contest_id) ?? "Contest",
      buyIn: Number(contest.buy_in),
      contestStatus: contest.status,
      finalRank: entry.final_rank,
      payout: entry.payout ? Number(entry.payout) : undefined,
    });
  }

  return NextResponse.json({ entriesByDay });
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
