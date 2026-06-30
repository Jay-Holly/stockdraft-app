import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { syncDayTraderContestLifecycle } from "@/lib/day-trader/contest-lifecycle";
import {
  isDayTraderTradingWindowOpen,
  isDayTraderWeekFinalizeDue,
} from "@/lib/day-trader/contest-period";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const lifecycle = await syncDayTraderContestLifecycle(now);
    return NextResponse.json({
      ok: true,
      now: now.toISOString(),
      windowOpen: isDayTraderTradingWindowOpen(now),
      finalizeDue: isDayTraderWeekFinalizeDue(now),
      lifecycle,
    });
  } catch (error) {
    console.error("Day Trader lifecycle sync failed:", error);
    return NextResponse.json(
      { error: "Day Trader lifecycle sync failed" },
      { status: 500 }
    );
  }
}
