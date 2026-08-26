import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { fillMissingWeekCloses } from "@/lib/roster/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Retries a real close for any pick still missing one, across every active
 * season league — the retry sweep captureWeekCloseSnapshots never had.
 *
 * That capture only runs once a day, from finalize-matchups. A miss there
 * used to mean waiting for tomorrow, and if the week finalized in between,
 * the gap was permanent — honest (nothing fabricated) but never actually
 * resolved. Running every 15 minutes gives a miss another real shot within
 * the hour instead of within a day or never, same cadence as the DFS
 * backfill this mirrors.
 *
 * One league's sweep is capped by Twelve Data's own per-minute budget inside
 * fillMissingWeekCloses; capping the number of LEAGUES processed per
 * invocation here is what keeps a platform with many active leagues from
 * turning one cron tick into a multi-minute scan. Leagues not reached this
 * tick get picked up on the next one — nothing here is order-sensitive or
 * loses work by waiting.
 */
const MAX_LEAGUES_PER_RUN = 15;

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const { data: leagues } = await supabase
      .from("leagues")
      .select("id, support_code")
      .eq("status", "active")
      .eq("league_type", "human");

    if (!leagues || leagues.length === 0) {
      return NextResponse.json({ leaguesChecked: 0, results: [] });
    }

    const { data: standings } = await supabase
      .from("league_standings")
      .select("league_id, current_week")
      .in(
        "league_id",
        leagues.map((l) => l.id)
      );

    // Every manager in a league shares the same current_week. A close only
    // exists for a week that has already ended — current_week is still in
    // progress, so asking Twelve Data about it can never succeed. That was
    // the actual credit-burn bug: this cron ran every 15 minutes asking for
    // ~997 closes across 5 leagues that could never be filled, every single
    // tick, which is what exhausted the 800/day free-tier budget almost
    // immediately. The most recently COMPLETED week is current_week - 1.
    const weekByLeague = new Map<string, number>();
    for (const row of standings ?? []) {
      if (!weekByLeague.has(row.league_id) && row.current_week > 1) {
        weekByLeague.set(row.league_id, row.current_week - 1);
      }
    }

    const due = leagues.filter((l) => weekByLeague.has(l.id));
    const batch = due.slice(0, MAX_LEAGUES_PER_RUN);

    const results = [];
    for (const league of batch) {
      const weekNumber = weekByLeague.get(league.id)!;
      try {
        const result = await fillMissingWeekCloses(
          league.id,
          weekNumber,
          supabase
        );
        if (result.filled > 0 || result.stillMissing > 0) {
          results.push({
            league: league.support_code,
            weekNumber,
            ...result,
          });
        }
      } catch (error) {
        console.error(
          `[sdfl-close-backfill] ${league.support_code} wk${weekNumber} failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    return NextResponse.json({
      leaguesChecked: batch.length,
      leaguesRemaining: due.length - batch.length,
      results,
    });
  } catch (error) {
    console.error("SDFL close backfill failed:", error);
    return NextResponse.json(
      { error: "SDFL close backfill failed" },
      { status: 500 }
    );
  }
}
