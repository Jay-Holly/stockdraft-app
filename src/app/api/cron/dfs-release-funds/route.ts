import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { releaseFundsForDate, type ReleaseResult } from "@/lib/dfs/fund-release";
import { recentEasternDates } from "@/lib/dfs/audit-dates";

export const dynamic = "force-dynamic";

/** How many recent Eastern dates a single release run reconsiders. */
const LOOKBACK_DAYS = 3;

/**
 * The last gate before money moves. Credits DFS winners for a settled date,
 * and only if both audit rounds passed for it — a contest can be fully
 * scored, ranked and visible on the leaderboard while its payout still sits
 * held here.
 *
 * Runs just after midnight ET and reconsiders the last few days, so a date
 * whose audit finished late still gets paid. Releasing is idempotent (see
 * releaseFundsForDate), so revisiting a paid date is a no-op.
 *
 * `?date=YYYY-MM-DD` releases one specific date by hand.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateParam = request.nextUrl.searchParams.get("date")?.trim();
  const dates = dateParam ? [dateParam] : recentEasternDates(LOOKBACK_DAYS);

  const results: ReleaseResult[] = [];

  try {
    for (const date of dates) {
      results.push(await releaseFundsForDate(date));
    }

    const totalContests = results.reduce((n, r) => n + r.released.length, 0);
    const totalPaid = results.reduce(
      (sum, r) => sum + r.released.reduce((s, c) => s + c.totalReleased, 0),
      0
    );

    return NextResponse.json({
      ok: true,
      datesChecked: dates,
      contestsReleased: totalContests,
      totalPaid: Math.round(totalPaid * 100) / 100,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dfs-release] threw:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
