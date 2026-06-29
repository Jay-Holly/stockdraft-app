import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { createClient } from "@/lib/supabase/server";
import {
  clearActiveLeagueCookie,
  getActiveLeagueIdFromCookie,
  resolveActiveLeagueId,
  setActiveLeagueCookie,
  verifyUserCanAccessLeague,
} from "@/lib/league/active-league";
import {
  deleteAiLeagueForUser,
  getAiLeagueSummary,
  listAiLeagueListItems,
} from "@/lib/league/ai-league";
import {
  deleteHumanLeagueForUser,
  listHumanLeaguesForUser,
} from "@/lib/league/human-league";
import {
  ensureAiLeagueReadyForMatchups,
  ensureHumanLeagueReadyForMatchups,
  scoreAllActiveAiMatchups,
} from "@/lib/matchup/scoring";

export async function GET() {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureAiLeagueReadyForMatchups(user.id);
  await ensureHumanLeagueReadyForMatchups(user.id);
  await scoreAllActiveAiMatchups(user.id);

  const [aiLeagues, humanLeagues, activeLeagueId] = await Promise.all([
    listAiLeagueListItems(user.id),
    listHumanLeaguesForUser(user.id),
    resolveActiveLeagueId(user.id),
  ]);

  const activeHuman = humanLeagues.find((h) => h.league.id === activeLeagueId);
  const activeSummary =
    activeLeagueId && !activeHuman
      ? await getAiLeagueSummary(user.id, activeLeagueId)
      : null;

  return NextResponse.json({
    leagues: aiLeagues,
    humanLeagues,
    activeLeagueId,
    activeSummary,
    activeHumanLeague: activeHuman ?? null,
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

  if (!(await verifyUserCanAccessLeague(user.id, body.leagueId))) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  await setActiveLeagueCookie(body.leagueId);

  const humanLeagues = await listHumanLeaguesForUser(user.id);
  const activeHuman = humanLeagues.find((h) => h.league.id === body.leagueId);
  const summary = activeHuman
    ? null
    : await getAiLeagueSummary(user.id, body.leagueId);

  return NextResponse.json({
    success: true,
    activeLeagueId: body.leagueId,
    activeSummary: summary,
    activeHumanLeague: activeHuman ?? null,
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

  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("league_type, owner_user_id")
    .eq("id", body.leagueId)
    .maybeSingle();

  if (!league || league.owner_user_id !== user.id) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  const result =
    league.league_type === "human"
      ? await deleteHumanLeagueForUser(user.id, body.leagueId)
      : await deleteAiLeagueForUser(user.id, body.leagueId);

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
