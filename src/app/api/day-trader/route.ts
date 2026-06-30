import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { getDayTraderContestContext } from "@/lib/day-trader/contest-access";
import { listDayTraderEligibleLeagues } from "@/lib/day-trader/eligible-leagues";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const [context, eligibleLeagues] = await Promise.all([
      getDayTraderContestContext(user.id, now),
      listDayTraderEligibleLeagues(user.id),
    ]);

    let positions: Array<{ symbol: string; shares: number; slotOrder: number }> =
      [];
    if (context.entry) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("day_trader_positions")
        .select("symbol, shares, slot_order")
        .eq("entry_id", context.entry.id)
        .order("slot_order", { ascending: true });

      positions =
        data?.map((row) => ({
          symbol: row.symbol,
          shares: Number(row.shares),
          slotOrder: row.slot_order,
        })) ?? [];
    }

    return NextResponse.json({
      contest: context.contest,
      entry: context.entry,
      windowOpen: context.windowOpen,
      canEnter: context.canEnter && eligibleLeagues.length > 0,
      eligibleLeagues,
      positions,
      now: now.toISOString(),
    });
  } catch (error) {
    console.error("Day Trader status error:", error);
    return NextResponse.json(
      { error: "Could not load Day Trader status." },
      { status: 500 }
    );
  }
}
