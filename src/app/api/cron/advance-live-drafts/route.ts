import { NextResponse, type NextRequest } from "next/server";

import { verifyCronAuth } from "@/lib/cron/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { runWithSupabaseClient } from "@/lib/supabase/context";
import { ensureLiveDraftProgress } from "@/lib/draft/live-draft";

/**
 * Bot turns get a ~2s deadline (see assignOnClock), but nothing previously
 * advanced a live draft except a browser actively polling GET /api/draft —
 * ensureLiveDraftProgress only ran as a side effect of that poll. If no tab
 * was open between a human's picks, bot turns sat idle on an already-expired
 * deadline until someone happened to reload the page. This cron drives every
 * in-progress live draft forward on its own regardless of who's watching.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_LEAGUES_PER_RUN = 25;

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const { data: dueStates, error } = await supabase
      .from("league_draft_state")
      .select("league_id")
      .eq("status", "in_progress")
      .limit(MAX_LEAGUES_PER_RUN);

    if (error) {
      console.error("[advance-live-drafts] lookup failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const leagueIds = (dueStates ?? []).map((row) => row.league_id as string);
    const errors: string[] = [];
    let advanced = 0;

    for (const leagueId of leagueIds) {
      try {
        const result = await runWithSupabaseClient(supabase, () =>
          ensureLiveDraftProgress(leagueId, { interactive: false })
        );
        if (result.error) {
          errors.push(`${leagueId}: ${result.error}`);
        } else {
          advanced += 1;
        }
      } catch (leagueError) {
        const message =
          leagueError instanceof Error
            ? leagueError.message
            : "Unknown error advancing live draft.";
        errors.push(`${leagueId}: ${message}`);
        console.error(
          `[advance-live-drafts] league=${leagueId} threw:`,
          leagueError
        );
      }
    }

    if (errors.length > 0) {
      console.error("[advance-live-drafts] errors:", errors.join(" | "));
    }

    return NextResponse.json({
      ok: true,
      attempted: leagueIds.length,
      advanced,
      errors,
    });
  } catch (error) {
    console.error("[advance-live-drafts] failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Advance live drafts cron failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
