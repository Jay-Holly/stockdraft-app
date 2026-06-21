import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { resolveActiveAiLeague } from "@/lib/league/active-league";
import { loadRosterView, requireSeasonLeague } from "@/lib/roster/server";

export async function GET() {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const season = await requireSeasonLeague(user.id);
  if ("error" in season) {
    return NextResponse.json({ error: season.error }, { status: 400 });
  }

  const result = await loadRosterView(user.id, season.league.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const league = await resolveActiveAiLeague(user.id, season.league.id);

  return NextResponse.json({
    ...result.roster,
    leagueName: league?.name ?? "Free AI League",
  });
}
