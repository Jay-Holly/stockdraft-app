import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { processDueScheduledDrafts } from "@/lib/league/draft-scheduler";
import { createServiceClient } from "@/lib/supabase/service";

/** Bots provisioned per league per cron tick — resumes on the next run. */
const MAX_BOTS_PER_LEAGUE_PER_RUN = 10;

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const result = await processDueScheduledDrafts({
      supabase,
      maxBotsPerLeaguePerRun: MAX_BOTS_PER_LEAGUE_PER_RUN,
    });

    if (result.errors.length > 0) {
      console.error(
        "[start-scheduled-drafts] errors:",
        result.errors.join(" | ")
      );
    }

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      inProgress: result.inProgress,
      errors: result.errors,
      attemptedLeagues: result.attemptedLeagues,
    });
  } catch (error) {
    console.error("[start-scheduled-drafts] failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Scheduled draft cron failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
