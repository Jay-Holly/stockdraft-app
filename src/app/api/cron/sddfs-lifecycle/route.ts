import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSddfsLifecycle } from "@/lib/sddfs/lifecycle";
import { isPricingFrozen } from "@/lib/market/pricing-freeze";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Direct instruction, 2026-08-27: no locking, no scoring, for the rest of
  // the day — see pricing-freeze.ts.
  if (isPricingFrozen()) {
    return NextResponse.json({ ok: true, skipped: "pricing frozen for the day" });
  }

  try {
    const now = new Date();
    const result = await runSddfsLifecycle();
    return NextResponse.json({ ok: true, now: now.toISOString(), ...result });
  } catch (error) {
    console.error("SDDFS lifecycle sync failed:", error);
    return NextResponse.json(
      { error: "SDDFS lifecycle sync failed" },
      { status: 500 }
    );
  }
}
