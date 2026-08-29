import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSweep } from "@/lib/pricing/logger";
import { findRunningSweep } from "@/lib/pricing/log-store";

/**
 * The scheduled logger run. Nothing else in the app should ever call
 * runSweep on a timer — this is the one clock.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Query-param overrides exist for one reason: a scoped, watchable manual
  // test (a handful of real symbols) run through the same secret-gated path
  // the schedule uses, without needing a signed-in admin session to trigger
  // it. The scheduled call itself never passes these.
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  const onlySymbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // The sweep runs every minute. A healthy one finishes in about ten seconds,
  // but the Finnhub fallback path has taken over nine minutes when Alpaca is
  // down — so without this, an outage would stack a new sweep on top of the
  // last one every single minute, each fighting the others for the same rate
  // limit and making the outage worse.
  //
  // 300s is the platform's own function ceiling, so a sweep older than that
  // cannot still be legitimately running; findRunningSweep closes those out
  // as abandoned rather than letting one block every sweep after it.
  const inFlight = await findRunningSweep(300_000);
  if (inFlight) {
    console.log(
      `[cron/price-logger] sweep ${inFlight.id} still running (started ${inFlight.startedAt}) — skipping this minute`
    );
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "a sweep is already running",
      runningSweepId: inFlight.id,
    });
  }

  try {
    const result = await runSweep({ triggeredBy: "cron", onlySymbols });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/price-logger] sweep failed:", error);
    return NextResponse.json(
      { error: "Price sweep failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
