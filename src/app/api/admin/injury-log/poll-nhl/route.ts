import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { runNhlInjuryPoll } from "@/lib/injuries/nhl-logger";

/**
 * Admin-triggered NHL poll — mirrors src/app/api/admin/injury-log/poll/route.ts
 * (the NFL one). Same logger rules, same log table, recorded as triggered_by
 * 'manual' with the admin's user id.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  try {
    const result = await runNhlInjuryPoll({
      triggeredBy: "manual",
      triggeredByUser: admin.userId,
    });
    return NextResponse.json({ ok: result.status === "complete", ...result });
  } catch (error) {
    console.error("[admin/injury-log/poll-nhl] poll failed:", error);
    return NextResponse.json(
      { error: "Poll failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
