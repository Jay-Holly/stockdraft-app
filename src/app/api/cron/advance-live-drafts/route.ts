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
/**
 * Vercel fires this every minute. maxDuration must stay under that interval or
 * a slow run is still going when the next one starts, and the overlapping runs
 * stack up and exhaust the database's connections. Budget the work below the
 * ceiling so a run always finishes before its successor begins.
 */
export const maxDuration = 50;
export const dynamic = "force-dynamic";

const MAX_LEAGUES_PER_RUN = 25;
const RUN_BUDGET_MS = 40_000;

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    // Only drafts whose clock has actually run out need advancing. Without this
    // the cron re-processed every in-progress draft once a minute forever,
    // including ones sitting on a live deadline and abandoned test leagues.
    // A future pick_deadline_at also means another run holds the lease, so
    // skipping those keeps concurrent runs off each other's leagues.
    const nowIso = new Date().toISOString();
    const { data: dueStates, error } = await supabase
      .from("league_draft_state")
      .select("league_id")
      .eq("status", "in_progress")
      .or(`pick_deadline_at.is.null,pick_deadline_at.lte.${nowIso}`)
      .order("pick_deadline_at", { ascending: true, nullsFirst: true })
      .limit(MAX_LEAGUES_PER_RUN);

    if (error) {
      console.error("[advance-live-drafts] lookup failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const leagueIds = (dueStates ?? []).map((row) => row.league_id as string);
    const errors: string[] = [];
    let advanced = 0;
    let skipped = 0;

    const startedAt = Date.now();

    for (const leagueId of leagueIds) {
      // Stop before Vercel's ceiling so the run exits cleanly rather than being
      // killed mid-league. Anything left over is still due on the next minute.
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        skipped = leagueIds.length - (advanced + errors.length);
        console.warn(
          `[advance-live-drafts] run budget reached; deferring ${skipped} league(s) to the next run.`
        );
        break;
      }

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
      skipped,
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
