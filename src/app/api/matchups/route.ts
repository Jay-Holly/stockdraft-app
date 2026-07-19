import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { loadMatchupsPageData } from "@/lib/matchup/page-data";
import { resolveActiveLeagueId } from "@/lib/league/active-league";
import {
  ensureAiLeagueReadyForMatchups,
  ensureHumanLeagueReadyForMatchups,
  scoreActiveMatchupsOnVisit,
} from "@/lib/matchup/scoring";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");
    const weekNumber = weekParam ? Number(weekParam) : undefined;
    const viewWeek = Number.isFinite(weekNumber) ? weekNumber : undefined;

    try {
      // Scoped to the league you're actually viewing — these ran across
      // every league the user belongs to on every navigation, including
      // ones with permanently broken schedules that get retried forever.
      const activeLeagueId = await resolveActiveLeagueId(user.id);
      await Promise.all([
        ensureAiLeagueReadyForMatchups(user.id, activeLeagueId ?? undefined),
        ensureHumanLeagueReadyForMatchups(user.id, activeLeagueId ?? undefined),
      ]);
      if (!viewWeek) {
        await scoreActiveMatchupsOnVisit(user.id);
      }
    } catch (sideEffectError) {
      console.error("GET /api/matchups scoring side effect failed:", sideEffectError);
    }

    const result = await loadMatchupsPageData(user.id, { weekNumber: viewWeek });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("GET /api/matchups failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error loading matchups.",
      },
      { status: 500 }
    );
  }
}
