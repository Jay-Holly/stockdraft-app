import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  resolveActiveAiLeagueId,
  setActiveLeagueCookie,
  verifyUserOwnsLeague,
} from "@/lib/league/active-league";
import {
  getAiLeagueSummary,
  listAiLeagueListItems,
} from "@/lib/league/ai-league";
import {
  ensureAiLeagueReadyForMatchups,
  scoreAllActiveAiMatchups,
} from "@/lib/matchup/scoring";

export async function GET() {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureAiLeagueReadyForMatchups(user.id);
  await scoreAllActiveAiMatchups(user.id);

  const [leagues, activeLeagueId] = await Promise.all([
    listAiLeagueListItems(user.id),
    resolveActiveAiLeagueId(user.id),
  ]);

  const activeSummary = activeLeagueId
    ? await getAiLeagueSummary(user.id, activeLeagueId)
    : null;

  return NextResponse.json({
    leagues,
    activeLeagueId,
    activeSummary,
  });
}

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { leagueId?: string };
  if (!body.leagueId) {
    return NextResponse.json({ error: "leagueId is required." }, { status: 400 });
  }

  if (!(await verifyUserOwnsLeague(user.id, body.leagueId))) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  await setActiveLeagueCookie(body.leagueId);

  const summary = await getAiLeagueSummary(user.id, body.leagueId);
  return NextResponse.json({
    success: true,
    activeLeagueId: body.leagueId,
    activeSummary: summary,
  });
}
