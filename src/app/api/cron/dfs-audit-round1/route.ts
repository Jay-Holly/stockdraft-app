import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { findStaleRunningAuditDate, runAuditRound1 } from "@/lib/dfs/audit";
import { easternDateIso, recentEasternDates } from "@/lib/dfs/audit-dates";
import { isPricingFrozen } from "@/lib/market/pricing-freeze";

export const dynamic = "force-dynamic";

/**
 * Round 1 of the nightly DFS price audit: completeness, with recovery.
 *
 * Runs repeatedly through its window because the independent source's free
 * tier only allows 8 symbol lookups per minute — each invocation spends one
 * minute's budget and the round finishes across however many runs it needs.
 * Once the round has passed, later invocations in the window are cheap no-ops.
 *
 * `?date=YYYY-MM-DD` re-runs a past date by hand.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Direct instruction, 2026-08-27: no Twelve Data calls for the rest of the
  // day — see pricing-freeze.ts.
  if (isPricingFrozen()) {
    return NextResponse.json({ ok: true, skipped: "pricing frozen for the day" });
  }

  const dateParam = request.nextUrl.searchParams.get("date");
  const auditDate = dateParam?.trim() || easternDateIso();

  try {
    const result = await runAuditRound1(auditDate);

    if (result.status === "failed") {
      console.error(
        `[dfs-audit:1] ${auditDate} FAILED — ${result.message}`,
        JSON.stringify(result.issues)
      );
    }

    // Today's date is handled above regardless. A prior date's round can be
    // left stuck at "running" once the calendar moves past it — nobody else
    // ever asks it to resume. Give one such date, if any, one more batch.
    let staleResult = null;
    if (!dateParam) {
      const staleDate = await findStaleRunningAuditDate(
        1,
        recentEasternDates(3)
      );
      if (staleDate) {
        staleResult = await runAuditRound1(staleDate);
        if (staleResult.status === "failed") {
          console.error(
            `[dfs-audit:1] stale ${staleDate} FAILED — ${staleResult.message}`,
            JSON.stringify(staleResult.issues)
          );
        }
      }
    }

    return NextResponse.json({ ok: true, ...result, stale: staleResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dfs-audit:1] ${auditDate} threw:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
