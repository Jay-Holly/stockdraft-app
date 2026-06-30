import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { loadLeaguePageData } from "@/lib/roster/server";
import {
  ensureAiLeagueReadyForMatchups,
  ensureHumanLeagueReadyForMatchups,
  scoreActiveMatchupsOnVisit,
} from "@/lib/matchup/scoring";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    try {
      await ensureAiLeagueReadyForMatchups(user.id);
      await ensureHumanLeagueReadyForMatchups(user.id);
      await scoreActiveMatchupsOnVisit(user.id);
    } catch (sideEffectError) {
      console.error("GET /api/league scoring side effect failed:", sideEffectError);
    }

    const result = await loadLeaguePageData(user.id);
    if (!result.ok) {
      return jsonError(result.error, 400);
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("GET /api/league failed:", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Internal server error loading league data.",
      500
    );
  }
}
