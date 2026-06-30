import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { repairPrematureSdplFinalization } from "@/lib/league/repair-premature-finalize";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supportCode =
    request.nextUrl.searchParams.get("supportCode")?.trim() ?? "SDAI-00039";
  const reopenFromWeek = Number.parseInt(
    request.nextUrl.searchParams.get("reopenFromWeek") ?? "1",
    10
  );
  const finalizeWeekParam = request.nextUrl.searchParams.get("finalizeWeek");
  const finalizeWeek = finalizeWeekParam
    ? Number.parseInt(finalizeWeekParam, 10)
    : reopenFromWeek;

  try {
    const result = await repairPrematureSdplFinalization({
      supportCode,
      reopenFromWeek,
      finalizeWeek,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(`Repair premature finalize failed (${supportCode}):`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Repair premature finalize failed",
      },
      { status: 500 }
    );
  }
}
