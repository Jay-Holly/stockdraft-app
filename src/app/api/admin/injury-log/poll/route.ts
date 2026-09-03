import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { runInjuryPoll } from "@/lib/injuries/logger";

/**
 * Admin-triggered poll — the "run a poll now" button on the Injuries page.
 * Same logger, same log, same rules as the cron. Recorded as triggered_by
 * 'manual' with the admin's user id, mirroring
 * src/app/api/admin/price-log/sweep/route.ts.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  try {
    const result = await runInjuryPoll({
      triggeredBy: "manual",
      triggeredByUser: admin.userId,
    });
    return NextResponse.json({ ok: result.status === "complete", ...result });
  } catch (error) {
    console.error("[admin/injury-log/poll] poll failed:", error);
    return NextResponse.json(
      { error: "Poll failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
