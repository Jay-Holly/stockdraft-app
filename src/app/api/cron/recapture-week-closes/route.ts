import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { recaptureWeekCloseSnapshotsForLeague } from "@/lib/league/recapture-week-closes";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supportCode =
    request.nextUrl.searchParams.get("supportCode")?.trim() ?? "SDAI-00039";
  const weekNumber = Number.parseInt(
    request.nextUrl.searchParams.get("week") ?? "1",
    10
  );

  if (!Number.isFinite(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "Invalid week parameter" }, { status: 400 });
  }

  try {
    const result = await recaptureWeekCloseSnapshotsForLeague({
      supportCode,
      weekNumber,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      `Week close recapture failed (${supportCode} w${weekNumber}):`,
      error
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Week close recapture failed",
      },
      { status: 500 }
    );
  }
}
