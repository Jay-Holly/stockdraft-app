import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";

export const dynamic = "force-dynamic";

/**
 * Admin endpoint to repair missing baselines for a league.
 * Usage: POST /api/admin/repair-league-baselines
 * Body: { supportCode: "SDFL-00094", weekNumber: 1 }
 *
 * Only works with valid service key in environment.
 */
export async function POST(request: Request) {
  try {
    // Basic auth check - in production, add proper auth
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { supportCode, weekNumber } = await request.json();
    if (!supportCode || typeof weekNumber !== "number") {
      return NextResponse.json(
        { error: "Missing supportCode or weekNumber" },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // Get league by support code
    const { data: league, error: leagueError } = await serviceClient
      .from("leagues")
      .select("id, current_week")
      .eq("support_code", supportCode)
      .maybeSingle();

    if (leagueError || !league) {
      return NextResponse.json(
        { error: `League ${supportCode} not found` },
        { status: 404 }
      );
    }

    // Capture baselines
    console.log(
      `[repair-baselines] Capturing week ${weekNumber} baselines for ${supportCode}...`
    );
    await captureWeekBaselinesForLeague(
      league.id,
      weekNumber,
      serviceClient
    );

    // Verify
    const { data: verify, count } = await serviceClient
      .from("roster_week_baselines")
      .select("*", { count: "exact" })
      .eq("league_id", league.id)
      .eq("week_number", weekNumber);

    return NextResponse.json({
      success: true,
      league: supportCode,
      week: weekNumber,
      baselinesCreated: count ?? 0,
    });
  } catch (error) {
    console.error("[repair-baselines] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
