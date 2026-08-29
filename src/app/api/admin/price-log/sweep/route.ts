import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { runSweep } from "@/lib/pricing/logger";

/**
 * Admin-triggered sweep — the "run a sweep now" button on the Prices page.
 * Same logger, same log, same rules as the cron. Recorded as triggered_by
 * 'manual' with the admin's user id, so the sweep history shows who ran it.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: admin.status });
  }

  let limitStocks: number | undefined;
  let onlySymbols: string[] | undefined;
  try {
    const body = await request.json();
    if (typeof body?.limitStocks === "number") limitStocks = body.limitStocks;
    if (Array.isArray(body?.symbols) && body.symbols.length > 0) {
      onlySymbols = body.symbols.map((s: unknown) => String(s));
    }
  } catch {
    // No body, or not JSON — a full sweep is the default.
  }

  try {
    const result = await runSweep({
      triggeredBy: "manual",
      triggeredByUser: admin.userId,
      limitStocks,
      onlySymbols,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[admin/price-log/sweep] sweep failed:", error);
    return NextResponse.json(
      { error: "Sweep failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
