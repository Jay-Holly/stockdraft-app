import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSddfsLifecycle } from "@/lib/sddfs/lifecycle";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
