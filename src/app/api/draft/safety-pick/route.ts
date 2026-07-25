import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { toggleSafetyPickQueue } from "@/lib/draft/live-draft";
import { resolveActiveLeagueId } from "@/lib/league/active-league";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { symbol, leagueId: bodyLeagueId } = body as {
    symbol?: string | null;
    leagueId?: string;
  };

  if (!symbol || typeof symbol !== "string") {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const leagueId = await resolveActiveLeagueId(user.id, bodyLeagueId ?? null);
  if (!leagueId) {
    return NextResponse.json(
      { error: "No active draft league found. Select a league on the dashboard." },
      { status: 400 }
    );
  }

  const result = await toggleSafetyPickQueue(
    user.id,
    leagueId,
    symbol.toUpperCase()
  );
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    safetyPickQueue: result.queue ?? [],
    safetyPickSymbol: result.queue?.[0] ?? null,
  });
}
