import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { findStaleRunningAuditDate, runAuditRound2 } from "@/lib/dfs/audit";
import { easternDateIso, recentEasternDates } from "@/lib/dfs/audit-dates";
import { isPricingFrozen } from "@/lib/market/pricing-freeze";

export const dynamic = "force-dynamic";

/**
 * Round 2 of the nightly DFS price audit: independent verification of every
 * price round 1 confirmed exists. Requires a passing round 1 and refuses to
 * run otherwise.
 *
 * Same budgeted, resumable shape as round 1 — see that route for why.
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
    const result = await runAuditRound2(auditDate);

    if (result.status === "failed") {
      console.error(
        `[dfs-audit:2] ${auditDate} FAILED — ${result.message}`,
        JSON.stringify(result.issues)
      );
    }

    // Same reasoning as round 1: a prior date's round 2 can be left stuck at
    // "running" once the calendar moves past it. Give one such date one more
    // batch — runAuditRound2 itself already defers (skips, doesn't error) a
    // date whose round 1 is still "running", so this can't race ahead of it.
    let staleResult = null;
    if (!dateParam) {
      const staleDate = await findStaleRunningAuditDate(
        2,
        recentEasternDates(3)
      );
      if (staleDate) {
        staleResult = await runAuditRound2(staleDate);
        if (staleResult.status === "failed") {
          console.error(
            `[dfs-audit:2] stale ${staleDate} FAILED — ${staleResult.message}`,
            JSON.stringify(staleResult.issues)
          );
        }
      }
    }

    return NextResponse.json({ ok: true, ...result, stale: staleResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dfs-audit:2] ${auditDate} threw:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
