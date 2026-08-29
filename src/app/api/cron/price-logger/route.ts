import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSweep } from "@/lib/pricing/logger";

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
