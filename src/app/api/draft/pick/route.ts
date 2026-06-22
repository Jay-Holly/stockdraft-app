import { NextResponse } from "next/server";
import { getAuthenticatedUserId, makeDraftPickForLeague } from "@/lib/draft/server";
import { assertOnClock, isLiveDraftLeague, repairLiveDraftClock } from "@/lib/draft/live-draft";
import { resolveActiveAiLeagueId } from "@/lib/league/active-league";
import { ensureAiLeagueReadyForMatchups } from "@/lib/matchup/scoring";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { symbol, allocation, price, isSearchPick, leagueId: bodyLeagueId } = body as {
    symbol?: string;
    allocation?: number;
    price?: number;
    isSearchPick?: boolean;
    leagueId?: string;
  };

  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const leagueId = await resolveActiveAiLeagueId(user.id, bodyLeagueId ?? null);
  if (!leagueId) {
    return NextResponse.json(
      { error: "No active draft league found. Select a league on the dashboard." },
      { status: 400 }
    );
  }

  const live = await isLiveDraftLeague(leagueId);
  if (live) {
    let onClock = await assertOnClock(leagueId, user.id);
    if (!onClock.ok) {
      await repairLiveDraftClock(leagueId);
      onClock = await assertOnClock(leagueId, user.id);
    }
    if (!onClock.ok) {
      return NextResponse.json({ error: onClock.error }, { status: 400 });
    }
  }

  const result = await makeDraftPickForLeague(
    user.id,
    leagueId,
    symbol,
    allocation,
    price,
    Boolean(isSearchPick)
  );

  if ("error" in result && result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (result.complete) {
    await ensureAiLeagueReadyForMatchups(user.id);
  }

  return NextResponse.json({
    success: true,
    complete: Boolean(result.complete),
    leagueId,
  });
}
