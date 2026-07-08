import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/draft/server";
import { setActiveLeagueCookie } from "@/lib/league/active-league";
import { resolveRequestBaseUrl } from "@/lib/app-url";
import { createHumanLeague } from "@/lib/league/human-league";
import type { CreateLeagueConfig } from "@/lib/league/league-config";
import {
  isHumanLeagueSupported,
  playerCountsForFormat,
  playerCountForSportsLeague,
  unsupportedLeagueConfigMessage,
} from "@/lib/league/league-config";
import { parseDraftOrderMethodSetting } from "@/lib/league/draft-order";
import { parseLeagueScoringMode } from "@/lib/league/scoring-mode";

const VALID_COUNTS: CreateLeagueConfig["playerCount"][] = [
  2, 4, 6, 8, 10, 12, 30, 32,
];

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

  const formatType =
    body.formatType === "sports_league" ? "sports_league" : "standard";
  const allowedCounts = playerCountsForFormat(
    formatType,
    typeof body.sportsLeagueId === "string" ? body.sportsLeagueId : undefined
  );
  const rawCount = body.playerCount;
  const sportsRequiredCount =
    formatType === "sports_league"
      ? playerCountForSportsLeague(
          typeof body.sportsLeagueId === "string" ? body.sportsLeagueId : undefined
        )
      : null;
  const playerCount: CreateLeagueConfig["playerCount"] =
    sportsRequiredCount ??
    (VALID_COUNTS.includes(rawCount as CreateLeagueConfig["playerCount"]) &&
    allowedCounts.includes(rawCount as CreateLeagueConfig["playerCount"])
      ? (rawCount as CreateLeagueConfig["playerCount"])
      : allowedCounts[0]);

  const config: CreateLeagueConfig = {
    formatType,
    sportsLeagueId:
      typeof body.sportsLeagueId === "string" ? body.sportsLeagueId : undefined,
    playerCount,
    visibility: body.visibility === "public" ? "public" : "private",
    opponentType:
      body.opponentType === "all_ai" || body.opponentType === "mixed"
        ? body.opponentType
        : "all_human",
    leagueName: typeof body.leagueName === "string" ? body.leagueName : "",
    teamName: typeof body.teamName === "string" ? body.teamName : "",
    inviteEmail: typeof body.inviteEmail === "string" ? body.inviteEmail : "",
    scheduledDraftAt:
      typeof body.scheduledDraftAt === "string" ? body.scheduledDraftAt : null,
    draftOrderMethod: parseDraftOrderMethodSetting(
      typeof body.draftOrderMethod === "string" ? body.draftOrderMethod : undefined
    ),
    scoringMode: parseLeagueScoringMode(body.scoringMode),
  };

  if (!isHumanLeagueSupported(config)) {
    return NextResponse.json(
      { error: unsupportedLeagueConfigMessage(config) },
      { status: 400 }
    );
  }

  const result = await createHumanLeague(user.id, config, {
    inviteBaseUrl: resolveRequestBaseUrl(request),
  });
  if (result.error || !result.league) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await setActiveLeagueCookie(result.league.id);

  return NextResponse.json({
    league: result.league,
    inviteToken: result.inviteToken,
    inviteLink: result.inviteLink,
    activeLeagueId: result.league.id,
  });
}
