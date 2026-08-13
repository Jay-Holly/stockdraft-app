import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { runAuditRound1 } from "@/lib/dfs/audit";
import { easternDateIso } from "@/lib/dfs/audit-dates";

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

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dfs-audit:1] ${auditDate} threw:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
