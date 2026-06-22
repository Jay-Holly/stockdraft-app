import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import {
  clearActiveLeagueCookie,
  getActiveLeagueIdFromCookie,
  resolveActiveAiLeagueId,
  setActiveLeagueCookie,
  verifyUserOwnsLeague,
} from "@/lib/league/active-league";
import {
  deleteAiLeagueForUser,
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

export async function DELETE(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { leagueId?: string };
  if (!body.leagueId) {
    return NextResponse.json({ error: "leagueId is required." }, { status: 400 });
  }

  const result = await deleteAiLeagueForUser(user.id, body.leagueId);
  if (result.error) {
    const status = result.error === "League not found." ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  const activeCookieId = await getActiveLeagueIdFromCookie();
  if (activeCookieId === body.leagueId) {
    await clearActiveLeagueCookie();
  }

  return NextResponse.json({ success: true });
}
