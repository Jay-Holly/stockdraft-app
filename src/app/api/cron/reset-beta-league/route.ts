import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { resetSdplBetaLeague } from "@/lib/league/reset-beta-league";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supportCode =
    request.nextUrl.searchParams.get("supportCode")?.trim() ?? "SDAI-00039";

  try {
    const result = await resetSdplBetaLeague({ supportCode });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(`Beta league reset failed (${supportCode}):`, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Beta league reset failed",
      },
      { status: 500 }
    );
  }
}
