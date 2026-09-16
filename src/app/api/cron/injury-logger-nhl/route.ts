import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runNhlInjuryPoll } from "@/lib/injuries/nhl-logger";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The scheduled NHL injury poll. Mirrors src/app/api/cron/injury-logger/route.ts
 * (the NFL one) but filters the in-flight check to sport=nhl so the two
 * pollers never block each other.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: inFlight } = await supabase
    .from("injury_logger_runs")
    .select("id, started_at")
    .eq("sport", "nhl")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 10 * 60_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    console.log(`[cron/injury-logger-nhl] run ${inFlight.id} still running — skipping`);
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "a poll is already running",
      runningRunId: inFlight.id,
    });
  }

  try {
    const result = await runNhlInjuryPoll({ triggeredBy: "cron" });
    return NextResponse.json({ ok: result.status === "complete", ...result });
  } catch (error) {
    console.error("[cron/injury-logger-nhl] poll failed:", error);
    return NextResponse.json(
      { error: "Injury poll failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
