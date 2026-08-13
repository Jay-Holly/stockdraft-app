import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { runAuditRound2 } from "@/lib/dfs/audit";
import { easternDateIso } from "@/lib/dfs/audit-dates";

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

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[dfs-audit:2] ${auditDate} threw:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
