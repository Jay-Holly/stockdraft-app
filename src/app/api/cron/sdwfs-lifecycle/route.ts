import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { runSdwfsLifecycle } from "@/lib/sdwfs/lifecycle";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const result = await runSdwfsLifecycle();
    return NextResponse.json({ ok: true, now: now.toISOString(), ...result });
  } catch (error) {
    console.error("SDWFS lifecycle sync failed:", error);
    return NextResponse.json(
      { error: "SDWFS lifecycle sync failed" },
      { status: 500 }
    );
  }
}
