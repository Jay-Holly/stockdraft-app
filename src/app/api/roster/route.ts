import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveActiveAiLeague } from "@/lib/league/active-league";
import { loadRosterView, requireSeasonLeague } from "@/lib/roster/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const started = Date.now();

  try {
    const { user } = await getAuthenticatedUserId();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const season = await requireSeasonLeague(user.id);
    if ("error" in season) {
      return NextResponse.json({ error: season.error }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const weekParam = searchParams.get("week");
    const weekNumber = weekParam ? Number(weekParam) : undefined;

    const result = await loadRosterView(user.id, season.league.id, {
      weekNumber: Number.isFinite(weekNumber) ? weekNumber : undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    const league = await resolveActiveAiLeague(user.id, season.league.id);
    const elapsedMs = Date.now() - started;

    return NextResponse.json(
      {
        ...result.roster,
        leagueName: league?.name ?? "Free AI League",
      },
      { headers: { "X-Roster-Load-Ms": String(elapsedMs) } }
    );
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const message =
      err instanceof Error ? err.message : "Could not load roster";
    console.error("Roster GET error:", err);
    return NextResponse.json(
      { error: message, elapsedMs },
      { status: 500, headers: { "X-Roster-Load-Ms": String(elapsedMs) } }
    );
  }
}
