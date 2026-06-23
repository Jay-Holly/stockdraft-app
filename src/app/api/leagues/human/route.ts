import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { setActiveLeagueCookie } from "@/lib/league/active-league";
import { createHumanLeague } from "@/lib/league/human-league";
import type { CreateLeagueConfig } from "@/lib/league/league-config";
import {
  isHumanLeaguePoCSupported,
  unsupportedLeagueConfigMessage,
} from "@/lib/league/league-config";
import { parseLeagueScoringMode } from "@/lib/league/scoring-mode";

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUserId();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<CreateLeagueConfig> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validCounts = [2, 4, 6, 8, 10, 12] as const;
  const rawCount = body.playerCount;
  const playerCount: CreateLeagueConfig["playerCount"] = validCounts.includes(
    rawCount as (typeof validCounts)[number]
  )
    ? (rawCount as CreateLeagueConfig["playerCount"])
    : 2;

  const config: CreateLeagueConfig = {
    formatType: body.formatType === "sports_league" ? "sports_league" : "standard",
    sportsLeagueId: typeof body.sportsLeagueId === "string" ? body.sportsLeagueId : undefined,
    playerCount,
    visibility: body.visibility === "public" ? "public" : "private",
    opponentType:
      body.opponentType === "all_ai" || body.opponentType === "mixed"
        ? body.opponentType
        : "all_human",
    leagueName: typeof body.leagueName === "string" ? body.leagueName : "",
    teamName: typeof body.teamName === "string" ? body.teamName : "",
    inviteEmail: typeof body.inviteEmail === "string" ? body.inviteEmail : "",
    scoringMode: parseLeagueScoringMode(body.scoringMode),
  };

  if (!isHumanLeaguePoCSupported(config)) {
    return NextResponse.json(
      { error: unsupportedLeagueConfigMessage(config) },
      { status: 400 }
    );
  }

  const result = await createHumanLeague(user.id, config);
  if (result.error || !result.league) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await setActiveLeagueCookie(result.league.id);

  return NextResponse.json({
    league: result.league,
    inviteLink: result.inviteLink,
    activeLeagueId: result.league.id,
  });
}
