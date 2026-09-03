import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runInjuryPoll } from "@/lib/injuries/logger";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The scheduled injury poll. Nothing else in the app should call
 * runInjuryPoll on a timer — this is the one clock, same rule as
 * src/app/api/cron/price-logger/route.ts.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Weekly cadence, not per-minute — a run stuck past 10 minutes is dead,
  // not still legitimately working, so skip only within that window.
  const supabase = createServiceClient();
  const { data: inFlight } = await supabase
    .from("injury_logger_runs")
    .select("id, started_at")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    console.log(`[cron/injury-logger] run ${inFlight.id} still running — skipping`);
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "a poll is already running",
      runningRunId: inFlight.id,
    });
  }

  try {
    const result = await runInjuryPoll({ triggeredBy: "cron" });
    return NextResponse.json({ ok: result.status === "complete", ...result });
  } catch (error) {
    console.error("[cron/injury-logger] poll failed:", error);
    return NextResponse.json(
      { error: "Injury poll failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
