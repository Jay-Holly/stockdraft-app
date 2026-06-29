import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { migrateActiveSdplLeagues } from "@/lib/matchup/sdpl-schedule";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const forceReseed = request.nextUrl.searchParams.get("forceReseed") === "true";

  try {
    const results = await migrateActiveSdplLeagues(createServiceClient(), {
      forceReseed,
      status: "active",
    });
    return NextResponse.json({ ok: true, leagues: results.length, results });
  } catch (error) {
    console.error("SDPL schedule migration failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "SDPL schedule migration failed",
      },
      { status: 500 }
    );
  }
}
